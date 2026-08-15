import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireSession } from "./roles";
import { effectiveFeatures, requireFeature } from "./features";
import { internal } from "./_generated/api";
import { canCreateExternalInvite } from "./externalVideoInvites";

const authArgs = { code: v.string(), deviceId: v.string() };
const callerMediaModeValidator = v.union(
  v.literal("camera"),
  v.literal("face-swap"),
);
type CallerMediaMode = "camera" | "face-swap";

function storedCallerMediaMode(call: { callerMediaMode?: CallerMediaMode }) {
  return call.callerMediaMode ?? "camera";
}
const activeCallStatuses = new Set([
  "ringing",
  "accepted",
  "connecting",
  "connected",
  "active",
]);
function activeStatusesForBusyCheck(status: string) {
  return activeCallStatuses.has(status);
}

export const prepareP2P = mutation({
  args: {
    ...authArgs,
    theirCode: v.string(),
    callType: v.union(v.literal("audio"), v.literal("video")),
    callerMediaMode: v.optional(callerMediaModeValidator),
  },
  handler: async (ctx, args) => {
    const callerMediaMode = args.callerMediaMode ?? "camera";
    if (args.callType === "audio" && callerMediaMode === "face-swap")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "换脸模式仅支持视讯通话。",
      });
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      args.callType === "video" ? "canVideoCall" : "canVoiceCall",
    );
    const peerCode = args.theirCode.trim().toUpperCase();
    if (peerCode === auth.code)
      throw new ConvexError({ code: "BAD_REQUEST", message: "不能呼叫自己。" });
    const peer = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", peerCode))
      .unique();
    if (!peer)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "对方的授权码无效或尚未登录。",
      });
    if (callerMediaMode === "face-swap") {
      await requireFeature(ctx, args.code, args.deviceId, "canVideoSource");
      await requireFeature(ctx, args.code, args.deviceId, "canAIFace");
      if (!canCreateExternalInvite(auth.license.features))
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "只有全功能授权码可以发起换脸视讯。",
        });
      const contact = await ctx.db
        .query("contacts")
        .withIndex("by_owner_target", (q) =>
          q.eq("ownerCode", auth.code).eq("targetCode", peerCode),
        )
        .unique();
      if (!contact)
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "只能向联系人发起换脸视讯。",
        });
    }
    const peerAllowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", peerCode))
      .unique();
    const peerLicense = await effectiveFeatures(ctx, peerAllowed);
    if (
      !peerLicense.features[
        args.callType === "video" ? "canVideoCall" : "canVoiceCall"
      ]
    )
      throw new ConvexError({
        code: "FEATURE_DISABLED",
        message: "对方的授权码不支持此通话功能。",
      });
    const now = Date.now();
    const pairCodes = [auth.code, peerCode].sort();
    const isSamePair = (call: { participantCodes: string[] }) =>
      call.participantCodes.length === pairCodes.length &&
      pairCodes.every((code) => call.participantCodes.includes(code));
    const latestCalls = await ctx.db
      .query("live_calls")
      .order("desc")
      .take(300);
    const recentCalls = latestCalls.filter(
      (call) =>
        activeStatusesForBusyCheck(call.status) &&
        call.participantCodes.some(
          (code) => code === auth.code || code === peerCode,
        ) &&
        (call.status === "ringing"
          ? Boolean(call.expiresAt && call.expiresAt > now)
          : (call.lastActivityAt ??
              call.connectedAt ??
              call.acceptedAt ??
              call.createdAt) >
            now - 120_000),
    );
    const differentCall = recentCalls.find((call) => !isSamePair(call));
    if (differentCall)
      throw new ConvexError({
        code: "BUSY",
        message: differentCall.participantCodes.includes(auth.code)
          ? "您正在进行其他通话。"
          : "对方正在通话中。",
      });
    const activeStatuses = [
      "ringing",
      "accepted",
      "connecting",
      "connected",
      "active",
    ];
    const candidates = latestCalls.filter(
      (call) =>
        isSamePair(call) &&
        call.callerUserId &&
        call.calleeUserId &&
        activeStatuses.includes(call.status),
    );
    const existing = candidates.find((call) =>
      call.status === "ringing"
        ? Boolean(call.expiresAt && call.expiresAt > now)
        : (call.lastActivityAt ??
            call.connectedAt ??
            call.acceptedAt ??
            call.createdAt) >
          now - 60_000,
    );
    for (const stale of candidates.filter((call) => call !== existing)) {
      await ctx.db.patch(stale._id, {
        status: stale.status === "ringing" ? "missed" : "failed",
        endedAt: now,
        failureReason: "stale_call_timeout",
      });
      if (stale.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", stale.notificationId!),
          )
          .unique();
        if (notification?.status === "unread")
          await ctx.db.patch(notification._id, { status: "expired" });
      }
    }
    if (existing) {
      if (existing.callerUserId === auth.code) {
        if (storedCallerMediaMode(existing) !== callerMediaMode)
          throw new ConvexError({
            code: "CONFLICT",
            message: "已有不同媒体模式的通话。",
          });
        return {
          callId: existing.callId,
          roomName: existing.roomName,
          name: auth.session.name,
          peerCode,
          callerMediaMode,
          localMediaMode: callerMediaMode,
          remoteMediaMode: "camera" as const,
        };
      }
      throw new ConvexError({
        code: "CONFLICT",
        message: "已有正在进行的通话。",
      });
    }
    const callId = crypto.randomUUID();
    const roomName = `${pairCodes.join("-").toLowerCase()}-${callId}`;
    const notificationId = crypto.randomUUID();
    const id = await ctx.db.insert("live_calls", {
      callId,
      roomName,
      type: args.callType,
      callerMediaMode,
      status: "ringing",
      participantCodes: [auth.code, peerCode],
      createdByCode: auth.code,
      callerUserId: auth.code,
      calleeUserId: peerCode,
      callerCode: auth.code,
      calleeCode: peerCode,
      callerName: auth.session.name,
      calleeName: peer.name,
      expiresAt: now + 45_000,
      notificationId,
      createdAt: now,
      lastActivityAt: now,
    });
    console.info("[P2P_CALL] created", {
      callId,
      roomName,
      status: "ringing",
      callerCode: auth.code,
      calleeCode: peerCode,
    });
    await ctx.db.insert("notifications", {
      notificationId,
      userId: peerCode,
      type: args.callType === "video" ? "video_call" : "audio_call",
      title: args.callType === "video" ? "视频来电" : "语音来电",
      message: `${auth.session.name}（${auth.code}）正在呼叫您`,
      data: {
        callId,
        callerUserId: auth.code,
        callerName: auth.session.name,
        callType: args.callType,
        callerMediaMode,
        remoteMediaMode: callerMediaMode,
        source: "call",
      },
      status: "unread",
      priority: "urgent",
      createdAt: now,
      expiresAt: now + 45_000,
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: peerCode,
      title: args.callType === "video" ? "视频来电" : "语音来电",
      message: `${auth.session.name}（${auth.code}）正在呼叫您`,
      url: "/consultation",
    });
    await ctx.scheduler.runAfter(
      45_000,
      internal.callState.expireIncomingCall,
      { callId: id },
    );
    return {
      callId,
      roomName,
      name: auth.session.name,
      peerCode,
      callerMediaMode,
      localMediaMode: callerMediaMode,
      remoteMediaMode: "camera" as const,
    };
  },
});

export const expireIncomingCall = internalMutation({
  args: { callId: v.id("live_calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call?.status === "ringing" && (call.expiresAt ?? 0) <= Date.now()) {
      const now = Date.now();
      await ctx.db.patch(call._id, { status: "missed", endedAt: now });
      if (call.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", call.notificationId!),
          )
          .unique();
        if (notification)
          await ctx.db.patch(notification._id, {
            type: "missed_call",
            title: "未接来电",
            message: `来自 ${call.callerName ?? call.callerUserId} 的未接来电`,
            status: "unread",
            priority: "high",
            expiresAt: undefined,
          });
      }
    }
  },
});

export const incomingCall = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_callee_status", (q) =>
        q.eq("calleeUserId", auth.code).eq("status", "ringing"),
      )
      .order("desc")
      .first();
    if (!call || !call.expiresAt || call.expiresAt <= Date.now()) return null;
    return {
      _id: call._id,
      callId: call.callId,
      callerName: call.callerName ?? call.callerUserId ?? "未知来电",
      callerCode: call.callerUserId!,
      callType: call.type,
      expiresAt: call.expiresAt,
      localMediaMode: "camera" as const,
      remoteMediaMode: storedCallerMediaMode(call),
    };
  },
});

export const outgoingCall = query({
  args: { ...authArgs, callId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    if (!args.callId) return null;
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId!))
      .unique();
    if (!call || call.callerUserId !== auth.code) return null;
    return {
      status: call.status,
      calleeName: call.calleeName,
      callId: call.callId,
    };
  },
});

export const callStatus = query({
  args: { ...authArgs, callId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    if (!args.callId) return null;
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId!))
      .unique();
    if (!call || !call.participantCodes.includes(auth.code)) return null;
    const peerCode = call.participantCodes.find((code) => code !== auth.code);
    const peer = peerCode
      ? await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", peerCode))
          .unique()
      : null;
    return {
      status: call.status,
      endedAt: call.endedAt,
      peerCode,
      peerName: peer?.name ?? peerCode,
    };
  },
});

export const markParticipantConnected = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || !call.participantCodes.includes(auth.code))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无法加入此通话。",
      });
    if (!["accepted", "connecting", "connected"].includes(call.status))
      throw new ConvexError({
        code: "CONFLICT",
        message: "通话连接状态无效。",
      });
    const now = Date.now();
    const callerConnectedAt =
      call.callerUserId === auth.code ? now : call.callerConnectedAt;
    const calleeConnectedAt =
      call.calleeUserId === auth.code ? now : call.calleeConnectedAt;
    const connected = Boolean(callerConnectedAt && calleeConnectedAt);
    await ctx.db.patch(call._id, {
      callerConnectedAt,
      calleeConnectedAt,
      status: connected ? "connected" : "connecting",
      connectedAt: connected ? (call.connectedAt ?? now) : call.connectedAt,
      lastActivityAt: now,
    });
    console.info("[P2P_CALL] participant connected", {
      callId: call.callId,
      participantCode: auth.code,
      connected,
    });
  },
});

export const heartbeatCall = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || !call.participantCodes.includes(auth.code))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无法加入此通话。",
      });
    if (
      !["accepted", "connecting", "connected", "active"].includes(call.status)
    )
      return;
    const lastActivityAt = Date.now();
    await ctx.db.patch(call._id, { lastActivityAt });
    await ctx.scheduler.runAfter(
      120_000,
      internal.callState.expireStaleActiveCall,
      { callId: call.callId, lastActivityAt },
    );
  },
});

export const expireStaleActiveCall = internalMutation({
  args: { callId: v.string(), lastActivityAt: v.number() },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !call ||
      !["accepted", "connecting", "connected", "active"].includes(call.status)
    )
      return;
    if ((call.lastActivityAt ?? 0) > args.lastActivityAt) return;
    await ctx.db.patch(call._id, {
      status: "failed",
      endedAt: Date.now(),
      failureReason: "heartbeat_timeout",
    });
  },
});

export const callHistory = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const calls = await ctx.db.query("live_calls").order("desc").take(200);
    return calls
      .filter((call) => call.participantCodes.includes(auth.code))
      .slice(0, 50)
      .map((call) => {
        const outgoing = call.callerUserId === auth.code;
        return {
          callId: call.callId,
          callType: call.type,
          status: call.status,
          direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
          peerCode: outgoing ? call.calleeUserId : call.callerUserId,
          peerName: outgoing ? call.calleeName : call.callerName,
          createdAt: call.createdAt,
          endedAt: call.endedAt,
          canCallBack: [
            "missed",
            "rejected",
            "cancelled",
            "expired",
            "ended",
          ].includes(call.status),
        };
      });
  },
});

export const respondIncomingCall = mutation({
  args: { ...authArgs, callId: v.string(), accept: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || call.calleeUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "此来电不属于当前用户。",
      });
    if (
      call.status !== "ringing" ||
      !call.expiresAt ||
      call.expiresAt <= Date.now()
    )
      throw new ConvexError({ code: "CONFLICT", message: "此来电已过期。" });
    if (args.accept)
      await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        call.type === "video" ? "canVideoCall" : "canVoiceCall",
      );
    if (!args.accept) {
      await ctx.db.patch(call._id, { status: "rejected", endedAt: Date.now() });
      console.info("[P2P_CALL] rejected", {
        callId: call.callId,
        calleeCode: auth.code,
      });
      if (call.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", call.notificationId!),
          )
          .unique();
        if (notification)
          await ctx.db.patch(notification._id, {
            status: "dismissed",
            readAt: Date.now(),
          });
      }
      return null;
    }
    await ctx.db.patch(call._id, {
      status: "accepted",
      acceptedAt: Date.now(),
    });
    console.info("[P2P_CALL] accepted", {
      callId: call.callId,
      calleeCode: auth.code,
    });
    if (call.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", call.notificationId!),
        )
        .unique();
      if (notification)
        await ctx.db.patch(notification._id, {
          status: "read",
          readAt: Date.now(),
        });
    }
    return {
      roomName: call.roomName,
      callId: call.callId,
      callerCode: call.callerUserId!,
      callerName: call.callerName ?? call.callerUserId!,
      callType: call.type,
      name: auth.session.name,
    };
  },
});

export const authorizeOutgoingJoin = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (call)
      await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        call.type === "video" ? "canVideoCall" : "canVoiceCall",
      );
    if (call && storedCallerMediaMode(call) === "face-swap") {
      const fullFeatureAuth = await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        "canVideoSource",
      );
      await requireFeature(ctx, args.code, args.deviceId, "canAIFace");
      if (!canCreateExternalInvite(fullFeatureAuth.license.features))
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "只有全功能授权码可以发起换脸视讯。",
        });
    }
    if (!call || call.callerUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无法加入此通话。",
      });
    if (!["accepted", "connecting", "connected"].includes(call.status))
      throw new ConvexError({ code: "CONFLICT", message: "对方尚未接听。" });
    if (call.status === "accepted")
      await ctx.db.patch(call._id, { status: "connecting" });
    return {
      roomName: call.roomName,
      callId: call.callId,
      calleeCode: call.calleeUserId!,
      calleeName: call.calleeName ?? call.calleeUserId!,
      callType: call.type,
      name: auth.session.name,
      localMediaMode: storedCallerMediaMode(call),
      remoteMediaMode: "camera" as const,
    };
  },
});

export const authorizeIncomingJoin = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (call)
      await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        call.type === "video" ? "canVideoCall" : "canVoiceCall",
      );
    if (
      !call ||
      call.calleeUserId !== auth.code ||
      !["accepted", "connecting", "connected"].includes(call.status)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不允许接听此来电。",
      });
    if (call.status === "accepted")
      await ctx.db.patch(call._id, { status: "connecting" });
    return {
      roomName: call.roomName,
      callId: call.callId,
      callerCode: call.callerUserId!,
      callerName: call.callerName ?? call.callerUserId!,
      callType: call.type,
      name: auth.session.name,
      localMediaMode: "camera" as const,
      remoteMediaMode: storedCallerMediaMode(call),
    };
  },
});

export const acceptAndAuthorizeIncomingJoin = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (call)
      await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        call.type === "video" ? "canVideoCall" : "canVoiceCall",
      );
    if (!call || call.calleeUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "此来电不属于当前用户。",
      });
    if (
      call.status === "ringing" &&
      (!call.expiresAt || call.expiresAt <= Date.now())
    )
      throw new ConvexError({ code: "CONFLICT", message: "此来电已过期。" });
    if (
      !["ringing", "accepted", "connecting", "connected"].includes(call.status)
    )
      throw new ConvexError({ code: "CONFLICT", message: "无法接听此来电。" });
    const now = Date.now();
    if (call.status === "ringing")
      await ctx.db.patch(call._id, {
        status: "accepted",
        acceptedAt: call.acceptedAt ?? now,
      });
    if (call.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", call.notificationId!),
        )
        .unique();
      if (notification?.status === "unread")
        await ctx.db.patch(notification._id, { status: "read", readAt: now });
    }
    return {
      roomName: call.roomName,
      callId: call.callId,
      callerCode: call.callerUserId!,
      callerName: call.callerName ?? call.callerUserId!,
      callType: call.type,
      name: auth.session.name,
      localMediaMode: "camera" as const,
      remoteMediaMode: storedCallerMediaMode(call),
    };
  },
});

export const endP2PCall = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || !call.participantCodes.includes(auth.code))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (
      [
        "ended",
        "rejected",
        "cancelled",
        "expired",
        "missed",
        "failed",
      ].includes(call.status)
    )
      return;
    await ctx.db.patch(call._id, {
      status:
        call.status === "ringing" && call.callerUserId === auth.code
          ? "cancelled"
          : "ended",
      endedAt: Date.now(),
      endedBy: auth.code,
    });
    if (call.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", call.notificationId!),
        )
        .unique();
      if (notification && notification.status === "unread")
        await ctx.db.patch(notification._id, {
          status: "dismissed",
          readAt: Date.now(),
        });
    }
  },
});

export const initiateTransfer = mutation({
  args: { ...authArgs, callId: v.string(), targetCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canTransferCall",
    );
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !call ||
      !["connected", "active"].includes(call.status) ||
      !call.participantCodes.includes(auth.code)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不能转接您未参与的通话。",
      });
    if (storedCallerMediaMode(call) === "face-swap")
      throw new ConvexError({
        code: "FEATURE_DISABLED",
        message: "换脸视讯暂不支持转接。",
      });
    const remote = call.participantCodes.find((code) => code !== auth.code);
    if (!remote)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "找不到当前通话对象。",
      });
    const targetCode = args.targetCode.normalize("NFKC").trim().toUpperCase();
    if (targetCode === auth.code || targetCode === remote)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "不能转接给自己或当前通话对象。",
      });
    const target = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到转接目标的授权码，请输入正确的授权码。",
      });
    const allowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (allowed?.enabled === false)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "转接目标的授权码已停用。",
      });
    const presence = await ctx.db
      .query("user_presence")
      .withIndex("by_user", (q) => q.eq("userId", targetCode))
      .unique();
    // Mobile Safari/PWA fires pagehide when merely backgrounded. Presence is therefore
    // derived from a fresh authenticated heartbeat instead of the eager online flag.
    if (!presence || presence.lastSeenAt < Date.now() - 90_000) {
      throw new ConvexError({
        code: "OFFLINE",
        message: "转接目标当前离线，请等待对方登录后重试。",
      });
    }
    const transfers = await ctx.db
      .query("call_transfers")
      .withIndex("by_call", (q) => q.eq("callId", call.callId))
      .collect();
    if (
      transfers.some((item) =>
        ["pending", "accepted", "joining"].includes(item.status),
      )
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "此通话已有正在进行的转接。",
      });
    const now = Date.now();
    const notificationId = crypto.randomUUID();
    const transferId = await ctx.db.insert("call_transfers", {
      callId: call.callId,
      roomName: call.roomName,
      fromUserId: auth.code,
      remoteUserId: remote,
      targetUserId: targetCode,
      status: "pending",
      createdAt: now,
      expiresAt: now + 45_000,
      notificationId,
    });
    console.info("[CALL_TRANSFER] created", {
      transferId,
      callId: call.callId,
      fromUserId: auth.code,
      remoteUserId: remote,
      targetUserId: targetCode,
    });
    await ctx.db.insert("notifications", {
      notificationId,
      userId: targetCode,
      type: "call_transfer",
      title: "通话转接请求",
      message: `${auth.session.name} 向您发送了通话转接请求`,
      data: { transferId, callId: call.callId, source: "call_transfer" },
      status: "unread",
      priority: "high",
      createdAt: now,
      expiresAt: now + 45_000,
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: targetCode,
      title: "通话转接请求",
      message: `${auth.session.name} 向您发送了通话转接请求`,
      url: "/consultation",
    });
    await ctx.scheduler.runAfter(45_000, internal.callState.expireTransfer, {
      transferId,
    });
    return transferId;
  },
});

export const expireTransfer = internalMutation({
  args: { transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.transferId);
    if (transfer?.status === "pending" && transfer.expiresAt <= Date.now()) {
      await ctx.db.patch(transfer._id, {
        status: "expired",
        failureReason: "对方未响应",
      });
      if (transfer.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", transfer.notificationId!),
          )
          .unique();
        if (notification?.status === "unread")
          await ctx.db.patch(notification._id, { status: "expired" });
      }
    }
  },
});

export const pendingTransfer = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db
      .query("call_transfers")
      .withIndex("by_target_status", (q) =>
        q.eq("targetUserId", auth.code).eq("status", "pending"),
      )
      .order("desc")
      .first();
    if (!transfer || transfer.expiresAt <= Date.now()) return null;
    const from = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.fromUserId))
      .unique();
    const remote = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.remoteUserId))
      .unique();
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", transfer.callId))
      .unique();
    return {
      ...transfer,
      fromName: from?.name ?? transfer.fromUserId,
      remoteName: remote?.name ?? transfer.remoteUserId,
      callType: call?.type ?? ("video" as const),
    };
  },
});

export const myOutgoingTransfer = query({
  args: { ...authArgs, callId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    if (!args.callId) return null;
    const transfers = await ctx.db
      .query("call_transfers")
      .withIndex("by_call", (q) => q.eq("callId", args.callId!))
      .order("desc")
      .collect();
    return transfers.find((item) => item.fromUserId === auth.code) ?? null;
  },
});

export const respondTransfer = mutation({
  args: {
    ...authArgs,
    transferId: v.id("call_transfers"),
    accept: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canTransferCall",
    );
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer || transfer.targetUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (transfer.status !== "pending" || transfer.expiresAt <= Date.now())
      throw new ConvexError({
        code: "CONFLICT",
        message: "此通话转接请求已过期。",
      });
    await ctx.db.patch(
      transfer._id,
      args.accept
        ? { status: "accepted", acceptedAt: Date.now() }
        : { status: "rejected", completedAt: Date.now() },
    );
    console.info("[CALL_TRANSFER] response", {
      transferId: transfer._id,
      targetUserId: auth.code,
      accepted: args.accept,
    });
    if (transfer.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", transfer.notificationId!),
        )
        .unique();
      if (notification)
        await ctx.db.patch(notification._id, {
          status: args.accept ? "read" : "dismissed",
          readAt: Date.now(),
        });
    }
    return {
      roomName: transfer.roomName,
      callId: transfer.callId,
      remoteUserId: transfer.remoteUserId,
    };
  },
});

export const authorizeTransferJoin = mutation({
  args: { ...authArgs, transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canTransferCall",
    );
    const transfer = await ctx.db.get(args.transferId);
    if (
      !transfer ||
      transfer.targetUserId !== auth.code ||
      !["accepted", "joining"].includes(transfer.status)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不允许加入此转接通话。",
      });
    await ctx.db.patch(transfer._id, { status: "joining" });
    console.info("[CALL_TRANSFER] target joining", {
      transferId: transfer._id,
      targetUserId: auth.code,
      roomName: transfer.roomName,
    });
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", transfer.callId))
      .unique();
    return {
      roomName: transfer.roomName,
      callId: transfer.callId,
      name: auth.session.name,
      callType: call?.type ?? ("video" as const),
    };
  },
});

export const confirmTransferJoined = mutation({
  args: { ...authArgs, transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (
      !transfer ||
      transfer.targetUserId !== auth.code ||
      transfer.status !== "joining"
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "通话转接状态无效。",
      });
    const now = Date.now();
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", transfer.callId))
      .unique();
    if (
      !call ||
      !["connected", "active"].includes(call.status) ||
      !call.participantCodes.includes(transfer.remoteUserId)
    ) {
      await ctx.db.patch(transfer._id, {
        status: "failed",
        completedAt: now,
        failureReason: "原通话已结束",
      });
      throw new ConvexError({
        code: "CONFLICT",
        message: "原通话已结束，无法完成转接。",
      });
    }
    const remote = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.remoteUserId))
      .unique();
    const target = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.targetUserId))
      .unique();
    await ctx.db.patch(call._id, {
      participantCodes: [transfer.remoteUserId, transfer.targetUserId],
      callerUserId: transfer.remoteUserId,
      callerCode: transfer.remoteUserId,
      callerName: remote?.name ?? transfer.remoteUserId,
      calleeUserId: transfer.targetUserId,
      calleeCode: transfer.targetUserId,
      calleeName: target?.name ?? transfer.targetUserId,
      callerConnectedAt: now,
      calleeConnectedAt: now,
      lastActivityAt: now,
    });
    await ctx.db.patch(transfer._id, { status: "completed", completedAt: now });
    console.info("[CALL_TRANSFER] completed", {
      transferId: transfer._id,
      fromUserId: transfer.fromUserId,
      remoteUserId: transfer.remoteUserId,
      targetUserId: transfer.targetUserId,
    });
  },
});

export const cancelTransfer = mutation({
  args: { ...authArgs, transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer || transfer.fromUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (!["pending", "accepted", "joining"].includes(transfer.status))
      throw new ConvexError({
        code: "CONFLICT",
        message: "通话转接已经结束。",
      });
    await ctx.db.patch(transfer._id, {
      status: "cancelled",
      completedAt: Date.now(),
    });
    if (transfer.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", transfer.notificationId!),
        )
        .unique();
      if (notification?.status === "unread")
        await ctx.db.patch(notification._id, {
          status: "dismissed",
          readAt: Date.now(),
        });
    }
  },
});

export const failTransferJoin = mutation({
  args: {
    ...authArgs,
    transferId: v.id("call_transfers"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer || transfer.targetUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (!["accepted", "joining"].includes(transfer.status)) return;
    await ctx.db.patch(transfer._id, {
      status: "failed",
      completedAt: Date.now(),
      failureReason: args.reason?.slice(0, 200) || "目标用户加入失败",
    });
    if (transfer.notificationId) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", transfer.notificationId!),
        )
        .unique();
      if (notification?.status === "unread")
        await ctx.db.patch(notification._id, {
          status: "dismissed",
          readAt: Date.now(),
        });
    }
  },
});
