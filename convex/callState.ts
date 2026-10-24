import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  assertActiveAuthorizationTarget,
  assertSameTenant,
  requireSession,
  tenantIdForAllowed,
} from "./roles";
import { effectiveFeatures, requireFeature } from "./features";
import { internal } from "./_generated/api";
import { TRANSFER_CLEANUP_RETRY_OFFSETS_MS } from "./transferCleanupPolicy";
import { canCreateExternalInvite } from "./externalVideoInvites";
import { codeIsInTenant } from "./tenantBoundaries";

const authArgs = { code: v.string(), deviceId: v.string() };
const callerMediaModeValidator = v.union(
  v.literal("camera"),
  v.literal("face-swap"),
);
type CallerMediaMode = "camera" | "face-swap";

function storedCallerMediaMode(call: { callerMediaMode?: CallerMediaMode }) {
  return call.callerMediaMode ?? "camera";
}

function storedParticipantMediaMode(
  call: {
    callerUserId?: string;
    calleeUserId?: string;
    callerMediaMode?: CallerMediaMode;
    calleeMediaMode?: CallerMediaMode;
  },
  code: string,
) {
  if (call.callerUserId === code) return storedCallerMediaMode(call);
  if (call.calleeUserId === code) return call.calleeMediaMode ?? "camera";
  return "camera";
}

function storedParticipantPublisherIdentities(
  call: {
    callerUserId?: string;
    calleeUserId?: string;
    callerIdentity?: string;
    calleeIdentity?: string;
    callerPublisherIdentities?: string[];
    calleePublisherIdentities?: string[];
  },
  code: string,
) {
  if (call.callerUserId === code)
    return Array.from(
      new Set(
        [...(call.callerPublisherIdentities ?? []), call.callerIdentity].filter(
          (identity): identity is string => Boolean(identity),
        ),
      ),
    );
  if (call.calleeUserId === code)
    return Array.from(
      new Set(
        [...(call.calleePublisherIdentities ?? []), call.calleeIdentity].filter(
          (identity): identity is string => Boolean(identity),
        ),
      ),
    );
  return [];
}

function participantIdentityMatchesCode(identity: string, code: string) {
  const normalizedIdentity = identity.trim().toUpperCase();
  const normalizedCode = code.trim().toUpperCase();
  return (
    normalizedIdentity === normalizedCode ||
    normalizedIdentity.startsWith(`${normalizedCode}-`)
  );
}

type DeviceBoundCall = {
  callerUserId?: string;
  calleeUserId?: string;
  callerDeviceId?: string;
  calleeDeviceId?: string;
};

function participantDeviceMatches(
  call: DeviceBoundCall,
  code: string,
  deviceId: string,
) {
  const boundDeviceIds = [
    call.callerUserId === code ? call.callerDeviceId : undefined,
    call.calleeUserId === code ? call.calleeDeviceId : undefined,
  ].filter((value): value is string => Boolean(value));
  return boundDeviceIds.length === 0 || boundDeviceIds.includes(deviceId);
}

function requireParticipantDevice(
  call: DeviceBoundCall,
  code: string,
  deviceId: string,
) {
  if (participantDeviceMatches(call, code, deviceId)) return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "此通话已由另一台设备接手。",
  });
}
const activeCallStatusValues = [
  "ringing",
  "accepted",
  "connecting",
  "connected",
  "active",
] as const;
const activeCallStatuses = new Set<string>(activeCallStatusValues);
const TRANSFER_JOIN_TIMEOUT_MS = 90_000;
const TRANSFER_RECORDING_DRAIN_GRACE_MS = 15_000;
function activeStatusesForBusyCheck(status: string) {
  return activeCallStatuses.has(status);
}

async function scheduleAbandonedReceiverCleanup(
  ctx: MutationCtx,
  transfer: Doc<"call_transfers">,
) {
  if (!transfer.targetIdentity) return;
  await scheduleTransferCleanupRetries(ctx, transfer._id);
}

async function scheduleTransferCleanupRetries(
  ctx: MutationCtx,
  transferId: Doc<"call_transfers">["_id"],
) {
  const now = Date.now();
  await ctx.db.patch(transferId, {
    cleanupStatus: "pending",
    cleanupAttempts: 0,
    cleanupError: undefined,
    cleanupUpdatedAt: now,
  });
  for (const [attempt, offsetMs] of TRANSFER_CLEANUP_RETRY_OFFSETS_MS.entries())
    await ctx.scheduler.runAt(
      now + offsetMs,
      internal.calls.retryTransferCleanup,
      { transferId, attempt },
    );
}

type DbCtx = Parameters<typeof requireSession>[0];
type TenantAuth = { allowed?: { companyId?: string } | null };

function complianceConsentEpoch(item: {
  consentEpoch?: number;
  activatedAt?: number;
  requestedAt: number;
}) {
  return item.consentEpoch ?? item.activatedAt ?? item.requestedAt;
}

async function requireTransferRecordingDrain(
  ctx: DbCtx,
  transfer: Doc<"call_transfers">,
) {
  const compliance = await ctx.db
    .query("call_compliance")
    .withIndex("by_call", (q) => q.eq("callId", transfer.callId))
    .unique();
  if (compliance?.status === "stopping")
    throw new ConvexError({
      code: "CONFLICT",
      message: "录音仍在结束处理中，请等待最后片段保存。",
    });
  if (
    !compliance ||
    compliance.status !== "active" ||
    !compliance.consentedCodes.includes(transfer.fromUserId)
  )
    return;
  if (
    !transfer.fromDeviceId ||
    transfer.sourceRecordingDrainedAt === undefined ||
    transfer.sourceRecordingDrainEpoch !== complianceConsentEpoch(compliance)
  )
    throw new ConvexError({
      code: "CONFLICT",
      message: "等待来源装置保存最后录音片段。",
    });
}

async function codesMatchAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  codes: string[],
) {
  const tenantId = tenantIdForAllowed(auth.allowed);
  for (const code of new Set(codes)) {
    if (!(await codeIsInTenant(ctx, code, tenantId))) return false;
  }
  return true;
}

async function requireCodesInAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  codes: string[],
) {
  if (await codesMatchAuthTenant(ctx, auth, codes)) return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "无法访问其他授权群组的通话。",
  });
}

async function callMatchesAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  call: { participantCodes: string[] },
) {
  return await codesMatchAuthTenant(ctx, auth, call.participantCodes);
}

async function requireCallInAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  call: { participantCodes: string[] },
) {
  await requireCodesInAuthTenant(ctx, auth, call.participantCodes);
}

async function transferMatchesAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  transfer: {
    fromUserId: string;
    remoteUserId: string;
    targetUserId: string;
  },
) {
  return await codesMatchAuthTenant(ctx, auth, [
    transfer.fromUserId,
    transfer.remoteUserId,
    transfer.targetUserId,
  ]);
}

async function requireTransferInAuthTenant(
  ctx: DbCtx,
  auth: TenantAuth,
  transfer: {
    fromUserId: string;
    remoteUserId: string;
    targetUserId: string;
  },
) {
  await requireCodesInAuthTenant(ctx, auth, [
    transfer.fromUserId,
    transfer.remoteUserId,
    transfer.targetUserId,
  ]);
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
    const peerAllowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", peerCode))
      .unique();
    assertActiveAuthorizationTarget(peerAllowed);
    assertSameTenant(auth.allowed, peerAllowed);
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
      callerDeviceId: args.deviceId,
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
      type: args.callType === "video" ? "video_call" : "audio_call",
      data: {
        callId,
        callerUserId: auth.code,
        callerName: auth.session.name,
        callType: args.callType,
        callerMediaMode,
        remoteMediaMode: callerMediaMode,
        source: "call",
      },
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
    if (!(await callMatchesAuthTenant(ctx, auth, call))) return null;
    return {
      _id: call._id,
      callId: call.callId,
      callerName:
        call.callerName ?? call.callerUserId ?? "__system_unknown_caller__",
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
    if (!(await callMatchesAuthTenant(ctx, auth, call))) return null;
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
    if (!call) return null;
    const joiningTransfer = (
      await ctx.db
        .query("call_transfers")
        .withIndex("by_call", (q) => q.eq("callId", call.callId))
        .order("desc")
        .collect()
    ).find(
      (transfer) =>
        transfer.status === "joining" &&
        transfer.expiresAt > Date.now() &&
        transfer.targetUserId === auth.code &&
        transfer.targetDeviceId === args.deviceId &&
        call.roomName === transfer.roomName &&
        call.participantCodes.includes(transfer.remoteUserId),
    );
    if (
      joiningTransfer &&
      ["connected", "active"].includes(call.status) &&
      (await transferMatchesAuthTenant(ctx, auth, joiningTransfer)) &&
      (await callMatchesAuthTenant(ctx, auth, call))
    ) {
      const peerCode = joiningTransfer.remoteUserId;
      const peer = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", peerCode))
        .unique();
      return {
        status: call.status,
        endedAt: call.endedAt,
        peerCode,
        peerName: peer?.name ?? peerCode,
        peerIdentity:
          call.callerUserId === peerCode
            ? call.callerIdentity
            : call.calleeUserId === peerCode
              ? call.calleeIdentity
              : undefined,
        peerPublisherIdentities: storedParticipantPublisherIdentities(
          call,
          peerCode,
        ),
      };
    }
    if (!call.participantCodes.includes(auth.code)) return null;
    if (!(await callMatchesAuthTenant(ctx, auth, call))) return null;
    if (!participantDeviceMatches(call, auth.code, args.deviceId)) return null;
    const peerCode = call.participantCodes.find((code) => code !== auth.code);
    let peerIdentity =
      call.callerUserId === auth.code
        ? call.calleeIdentity
        : call.calleeUserId === auth.code
          ? call.callerIdentity
          : undefined;
    let peerPublisherIdentities = peerCode
      ? storedParticipantPublisherIdentities(call, peerCode)
      : [];
    if (peerCode) {
      const sameCodeHandoff = (
        await ctx.db
          .query("call_transfers")
          .withIndex("by_call", (q) => q.eq("callId", call.callId))
          .order("desc")
          .collect()
      ).find(
        (transfer) =>
          transfer.status === "joining" &&
          transfer.fromUserId === transfer.targetUserId &&
          transfer.remoteUserId === auth.code &&
          transfer.targetUserId === peerCode &&
          Boolean(transfer.targetIdentity),
      );
      if (sameCodeHandoff?.targetIdentity) {
        peerIdentity = sameCodeHandoff.targetIdentity;
        peerPublisherIdentities = [sameCodeHandoff.targetIdentity];
      }
    }
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
      peerIdentity,
      peerPublisherIdentities,
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
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
    const callerDeviceId =
      call.callerUserId === auth.code
        ? (call.callerDeviceId ?? args.deviceId)
        : call.callerDeviceId;
    const calleeDeviceId =
      call.calleeUserId === auth.code
        ? (call.calleeDeviceId ?? args.deviceId)
        : call.calleeDeviceId;
    const connected = Boolean(callerConnectedAt && calleeConnectedAt);
    await ctx.db.patch(call._id, {
      callerConnectedAt,
      calleeConnectedAt,
      callerDeviceId,
      calleeDeviceId,
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

export const recordParticipantIdentities = internalMutation({
  args: {
    ...authArgs,
    callId: v.string(),
    identities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || !call.participantCodes.includes(auth.code))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无法登记此通话身份。",
      });
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
    const identities = args.identities
      .map((identity) => identity.trim())
      .filter(
        (identity) =>
          identity &&
          identity.toUpperCase().startsWith(`${auth.code.toUpperCase()}-`),
      );
    if (!identities.length)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "通话身份无效。",
      });
    if (call.callerUserId === auth.code) {
      const publisherIdentities = Array.from(
        new Set([...(call.callerPublisherIdentities ?? []), ...identities]),
      );
      await ctx.db.patch(call._id, {
        callerIdentity: identities[0],
        callerPublisherIdentities: publisherIdentities,
      });
      return;
    }
    if (call.calleeUserId === auth.code) {
      const publisherIdentities = Array.from(
        new Set([...(call.calleePublisherIdentities ?? []), ...identities]),
      );
      await ctx.db.patch(call._id, {
        calleeIdentity: identities[0],
        calleePublisherIdentities: publisherIdentities,
      });
      return;
    }
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "您无法登记此通话身份。",
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
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
    const visibleCalls = [];
    for (const call of calls) {
      if (!call.participantCodes.includes(auth.code)) continue;
      if (!(await callMatchesAuthTenant(ctx, auth, call))) continue;
      visibleCalls.push(call);
      if (visibleCalls.length === 50) break;
    }
    return visibleCalls.map((call) => {
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
    await requireCallInAuthTenant(ctx, auth, call);
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
    if (!["accepted", "connecting", "connected"].includes(call.status))
      throw new ConvexError({ code: "CONFLICT", message: "对方尚未接听。" });
    if (call.status === "accepted" || !call.callerDeviceId)
      await ctx.db.patch(call._id, {
        status: call.status === "accepted" ? "connecting" : call.status,
        callerDeviceId: call.callerDeviceId ?? args.deviceId,
      });
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
    if (call.status === "accepted" || !call.calleeDeviceId)
      await ctx.db.patch(call._id, {
        status: call.status === "accepted" ? "connecting" : call.status,
        calleeDeviceId: call.calleeDeviceId ?? args.deviceId,
      });
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
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
        calleeDeviceId: call.calleeDeviceId ?? args.deviceId,
      });
    else if (!call.calleeDeviceId)
      await ctx.db.patch(call._id, { calleeDeviceId: args.deviceId });
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
    await requireCallInAuthTenant(ctx, auth, call);
    if (!participantDeviceMatches(call, auth.code, args.deviceId)) {
      console.info("[P2P_CALL] ignored teardown from replaced device", {
        callId: call.callId,
        participantCode: auth.code,
        deviceId: args.deviceId,
      });
      return;
    }
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
    await requireCallInAuthTenant(ctx, auth, call);
    requireParticipantDevice(call, auth.code, args.deviceId);
    const remote = call.participantCodes.find((code) => code !== auth.code);
    if (!remote)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "找不到当前通话对象。",
      });
    const targetCode = args.targetCode.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(targetCode))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Transfer target code must contain exactly five letters.",
      });
    if (targetCode === remote)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "不能转接给当前通话对象。",
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
    if (
      targetCode === auth.code &&
      ![
        ...(target.deviceIds ?? []),
        target.deviceId,
        target.mobileDeviceId,
        target.mobileAppDeviceId,
        target.desktopDeviceId,
      ].some((deviceId) => deviceId && deviceId !== args.deviceId)
    )
      throw new ConvexError({
        code: "OFFLINE",
        message: "同一授权码尚未登录其他设备。",
      });
    const allowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    assertActiveAuthorizationTarget(allowed);
    assertSameTenant(auth.allowed, allowed);
    const targetLicense = await effectiveFeatures(ctx, allowed);
    if (!targetLicense.features.canTransferCall)
      throw new ConvexError({
        code: "FEATURE_DISABLED",
        message: "转接目标必须使用全功能授权码。",
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
      fromDeviceId: args.deviceId,
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
      title: "Call transfer request",
      message: `${auth.session.name} sent you a call transfer request.`,
      data: {
        transferId,
        callId: call.callId,
        requesterName: auth.session.name,
        requesterUserId: auth.code,
        source: "call_transfer",
      },
      status: "unread",
      priority: "high",
      createdAt: now,
      expiresAt: now + 45_000,
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: targetCode,
      title: "Call transfer request",
      message: `${auth.session.name} sent you a call transfer request.`,
      url: "/consultation",
      type: "call_transfer",
      data: {
        transferId,
        callId: call.callId,
        requesterName: auth.session.name,
        requesterUserId: auth.code,
        source: "call_transfer",
      },
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
    if (
      transfer &&
      ["pending", "accepted", "joining"].includes(transfer.status) &&
      transfer.expiresAt <= Date.now()
    ) {
      const waitingForResponse = transfer.status === "pending";
      await ctx.db.patch(transfer._id, {
        status: waitingForResponse ? "expired" : "failed",
        completedAt: waitingForResponse ? undefined : Date.now(),
        failureReason: waitingForResponse ? "对方未响应" : "接收端加入超时",
      });
      await scheduleAbandonedReceiverCleanup(ctx, transfer);
      if (transfer.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", transfer.notificationId!),
          )
          .unique();
        if (notification?.status === "unread")
          await ctx.db.patch(notification._id, {
            status: waitingForResponse ? "expired" : "dismissed",
            readAt: waitingForResponse ? undefined : Date.now(),
          });
      }
    }
  },
});

export const pendingTransfer = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfers = (
      await Promise.all(
        (["pending", "accepted", "joining"] as const).map((status) =>
          ctx.db
            .query("call_transfers")
            .withIndex("by_target_status", (q) =>
              q.eq("targetUserId", auth.code).eq("status", status),
            )
            .collect(),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt);
    let transfer = null;
    for (const candidate of transfers) {
      if (candidate.expiresAt <= Date.now()) continue;
      if (
        candidate.status !== "pending" &&
        candidate.targetDeviceId !== args.deviceId
      )
        continue;
      if (
        candidate.targetUserId === candidate.fromUserId &&
        candidate.fromDeviceId === args.deviceId
      )
        continue;
      if (await transferMatchesAuthTenant(ctx, auth, candidate)) {
        transfer = candidate;
        break;
      }
    }
    if (!transfer) return null;
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
      _id: transfer._id,
      _creationTime: transfer._creationTime,
      callId: transfer.callId,
      fromUserId: transfer.fromUserId,
      remoteUserId: transfer.remoteUserId,
      targetUserId: transfer.targetUserId,
      status: transfer.status,
      createdAt: transfer.createdAt,
      expiresAt: transfer.expiresAt,
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
    for (const transfer of transfers) {
      if (
        transfer.fromUserId === auth.code &&
        (!transfer.fromDeviceId || transfer.fromDeviceId === args.deviceId) &&
        (await transferMatchesAuthTenant(ctx, auth, transfer))
      )
        return {
          _id: transfer._id,
          _creationTime: transfer._creationTime,
          callId: transfer.callId,
          fromUserId: transfer.fromUserId,
          remoteUserId: transfer.remoteUserId,
          targetUserId: transfer.targetUserId,
          status: transfer.status,
          createdAt: transfer.createdAt,
          expiresAt: transfer.expiresAt,
          acceptedAt: transfer.acceptedAt,
          completedAt: transfer.completedAt,
          failureReason: transfer.failureReason,
        };
    }
    return null;
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
    if (
      transfer.targetUserId === transfer.fromUserId &&
      transfer.fromDeviceId === args.deviceId
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不能在发起转移的设备上接收，请使用另一台设备。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    if (transfer.status !== "pending" || transfer.expiresAt <= Date.now())
      throw new ConvexError({
        code: "CONFLICT",
        message: "此通话转接请求已过期。",
      });
    if (args.accept) {
      const callerCalls = await ctx.db
        .query("live_calls")
        .withIndex("by_caller", (q) => q.eq("callerUserId", auth.code))
        .collect();
      const calleeCalls = (
        await Promise.all(
          activeCallStatusValues.map((status) =>
            ctx.db
              .query("live_calls")
              .withIndex("by_callee_status", (q) =>
                q.eq("calleeUserId", auth.code).eq("status", status),
              )
              .collect(),
          ),
        )
      ).flat();
      const otherCall = [...callerCalls, ...calleeCalls].find(
        (call) =>
          call.callId !== transfer.callId &&
          activeCallStatuses.has(call.status) &&
          ((call.callerUserId === auth.code &&
            (!call.callerDeviceId || call.callerDeviceId === args.deviceId)) ||
            (call.calleeUserId === auth.code &&
              (!call.calleeDeviceId || call.calleeDeviceId === args.deviceId))),
      );
      if (otherCall)
        throw new ConvexError({
          code: "CONFLICT",
          message: "此设备正在另一通话中，请先结束后再接收转接。",
        });
    }
    const now = Date.now();
    const joinDeadline = now + TRANSFER_JOIN_TIMEOUT_MS;
    await ctx.db.patch(
      transfer._id,
      args.accept
        ? {
            status: "accepted",
            acceptedAt: now,
            targetDeviceId: args.deviceId,
            expiresAt: joinDeadline,
          }
        : { status: "rejected", completedAt: now },
    );
    if (args.accept)
      await ctx.scheduler.runAfter(
        TRANSFER_JOIN_TIMEOUT_MS,
        internal.callState.expireTransfer,
        { transferId: transfer._id },
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

export const authorizeTransferJoin = internalMutation({
  args: {
    ...authArgs,
    transferId: v.id("call_transfers"),
    targetIdentity: v.optional(v.string()),
  },
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
      !["accepted", "joining"].includes(transfer.status) ||
      transfer.expiresAt <= Date.now()
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不允许加入此转接通话。",
      });
    if (
      transfer.targetUserId === transfer.fromUserId &&
      transfer.fromDeviceId === args.deviceId
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不能在发起转移的设备上接收，请使用另一台设备。",
      });
    if (
      args.targetIdentity &&
      !args.targetIdentity.trim().toUpperCase().startsWith(`${auth.code}-`)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "转接接收端身份无效。",
      });
    if (transfer.targetDeviceId && transfer.targetDeviceId !== args.deviceId)
      throw new ConvexError({
        code: "CONFLICT",
        message: "此通话转接已由另一台设备接收。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", transfer.callId))
      .unique();
    if (
      !call ||
      !["connected", "active"].includes(call.status) ||
      !call.participantCodes.includes(transfer.remoteUserId)
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "原通话已结束，无法加入转接。",
      });
    await ctx.db.patch(transfer._id, {
      status: "joining",
      targetIdentity: transfer.targetIdentity ?? args.targetIdentity,
      targetDeviceId: transfer.targetDeviceId ?? args.deviceId,
    });
    console.info("[CALL_TRANSFER] target joining", {
      transferId: transfer._id,
      targetUserId: auth.code,
      roomName: transfer.roomName,
    });
    return {
      roomName: transfer.roomName,
      callId: transfer.callId,
      name: auth.session.name,
      callType: call?.type ?? ("video" as const),
      remoteUserId: transfer.remoteUserId,
      remoteMediaMode: call
        ? storedParticipantMediaMode(call, transfer.remoteUserId)
        : ("camera" as const),
      remotePublisherIdentities: call
        ? storedParticipantPublisherIdentities(call, transfer.remoteUserId)
        : [],
      targetIdentity: transfer.targetIdentity ?? args.targetIdentity,
      transferStatus: "joining" as const,
    };
  },
});

export const authorizeTransferCompletion = internalQuery({
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
      !["joining", "completed"].includes(transfer.status) ||
      (transfer.status === "joining" && transfer.expiresAt <= Date.now())
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不允许完成此转接通话。",
      });
    if (transfer.targetDeviceId && transfer.targetDeviceId !== args.deviceId)
      throw new ConvexError({
        code: "CONFLICT",
        message: "此通话转接已由另一台设备接收。",
      });
    if (!transfer.targetIdentity)
      throw new ConvexError({
        code: "CONFLICT",
        message: "转接接收端尚未取得通话身份。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", transfer.callId))
      .unique();
    const expectedParticipant =
      transfer.status === "completed"
        ? transfer.targetUserId
        : transfer.remoteUserId;
    if (
      !call ||
      !["connected", "active"].includes(call.status) ||
      !call.participantCodes.includes(expectedParticipant)
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "原通话已结束，无法完成转接。",
      });
    if (transfer.status === "joining")
      await requireTransferRecordingDrain(ctx, transfer);
    return {
      roomName: transfer.roomName,
      callId: transfer.callId,
      remoteUserId: transfer.remoteUserId,
      transferSourceCode: transfer.fromUserId,
      targetIdentity: transfer.targetIdentity,
      sourceIdentities:
        transfer.sourceIdentities ??
        storedParticipantPublisherIdentities(call, transfer.fromUserId),
      transferStatus: transfer.status,
    };
  },
});

export const targetTransferStatus = query({
  args: { ...authArgs, transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (
      !transfer ||
      transfer.targetUserId !== auth.code ||
      (transfer.targetDeviceId && transfer.targetDeviceId !== args.deviceId)
    )
      return null;
    await requireTransferInAuthTenant(ctx, auth, transfer);
    return { status: transfer.status };
  },
});

export const confirmTransferJoined = internalMutation({
  args: {
    ...authArgs,
    transferId: v.id("call_transfers"),
    sourceIdentities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer || transfer.targetUserId !== auth.code)
      throw new ConvexError({
        code: "CONFLICT",
        message: "通话转接状态无效。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    if (
      transfer.status === "completed" &&
      (!transfer.targetDeviceId || transfer.targetDeviceId === args.deviceId)
    )
      return {
        completed: true as const,
        roomName: transfer.roomName,
        fromUserId: transfer.fromUserId,
        targetUserId: transfer.targetUserId,
        targetIdentity: transfer.targetIdentity,
        sourceIdentities: transfer.sourceIdentities ?? args.sourceIdentities,
      };
    if (transfer.status !== "joining")
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
      await scheduleAbandonedReceiverCleanup(ctx, transfer);
      return {
        completed: false as const,
        failureReason: "原通话已结束，无法完成转接。",
      };
    }
    await requireCallInAuthTenant(ctx, auth, call);
    await requireTransferRecordingDrain(ctx, transfer);
    const sourceIdentities = Array.from(
      new Set([
        ...args.sourceIdentities,
        ...storedParticipantPublisherIdentities(call, transfer.fromUserId),
      ]),
    ).filter(
      (identity) =>
        identity !== transfer.targetIdentity &&
        participantIdentityMatchesCode(identity, transfer.fromUserId),
    );
    if (!sourceIdentities.length)
      return {
        completed: false as const,
        failureReason:
          "无法确认原转接端的通话身份，请等待来源装置重新连线后重试。",
      };
    const remote = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.remoteUserId))
      .unique();
    const target = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", transfer.targetUserId))
      .unique();
    const remoteDeviceId =
      call.callerUserId === transfer.remoteUserId
        ? call.callerDeviceId
        : call.calleeUserId === transfer.remoteUserId
          ? call.calleeDeviceId
          : undefined;
    const remoteMediaMode = storedParticipantMediaMode(
      call,
      transfer.remoteUserId,
    );
    const remotePublisherIdentities = storedParticipantPublisherIdentities(
      call,
      transfer.remoteUserId,
    );
    await ctx.db.patch(call._id, {
      participantCodes: [transfer.remoteUserId, transfer.targetUserId],
      callerUserId: transfer.remoteUserId,
      callerDeviceId: remoteDeviceId,
      callerIdentity:
        call.callerUserId === transfer.remoteUserId
          ? call.callerIdentity
          : call.calleeUserId === transfer.remoteUserId
            ? call.calleeIdentity
            : undefined,
      callerPublisherIdentities: remotePublisherIdentities,
      callerCode: transfer.remoteUserId,
      callerName: remote?.name ?? transfer.remoteUserId,
      callerMediaMode: remoteMediaMode,
      calleeUserId: transfer.targetUserId,
      calleeDeviceId: transfer.targetDeviceId ?? args.deviceId,
      calleeIdentity: transfer.targetIdentity,
      calleePublisherIdentities: transfer.targetIdentity
        ? [transfer.targetIdentity]
        : [],
      calleeCode: transfer.targetUserId,
      calleeName: target?.name ?? transfer.targetUserId,
      calleeMediaMode: "camera",
      callerConnectedAt: now,
      calleeConnectedAt: now,
      lastActivityAt: now,
    });
    if (transfer.targetUserId !== transfer.fromUserId) {
      const compliance = await ctx.db
        .query("call_compliance")
        .withIndex("by_call", (q) => q.eq("callId", transfer.callId))
        .unique();
      if (compliance && compliance.status !== "stopped") {
        const previousConsentEpoch = complianceConsentEpoch(compliance);
        if (
          compliance.status === "active" &&
          compliance.consentedCodes.includes(transfer.remoteUserId) &&
          transfer.sourceRecordingDrainEpoch === previousConsentEpoch &&
          remoteDeviceId
        ) {
          const remoteSegments = await ctx.db
            .query("call_recording_segments")
            .withIndex("by_call_participant_device_epoch_started", (q) =>
              q
                .eq("callId", transfer.callId)
                .eq("participantCode", transfer.remoteUserId)
                .eq("deviceId", remoteDeviceId)
                .eq("consentEpoch", previousConsentEpoch),
            )
            .collect();
          for (const segment of remoteSegments)
            if (
              !segment.consumedAt &&
              !segment.storageId &&
              segment.startedAt <= now &&
              segment.expiresAt > now
            )
              await ctx.db.patch(segment._id, {
                transferDrainTransferId: transfer._id,
                transferDrainDeadline: Math.min(
                  segment.expiresAt,
                  now + TRANSFER_RECORDING_DRAIN_GRACE_MS,
                ),
              });
        }
        const declinedCodes = compliance.declinedCodes.filter(
          (code) => code === transfer.remoteUserId,
        );
        await ctx.db.patch(compliance._id, {
          participantCodes: [transfer.remoteUserId, transfer.targetUserId],
          consentedCodes: [],
          consentEpoch: previousConsentEpoch + 1,
          declinedCodes,
          status: declinedCodes.length ? "declined" : "requested",
          requestedAt: now,
          activatedAt: undefined,
          stoppedAt: undefined,
          translationEnabled: false,
        });
      }
    }
    await ctx.db.patch(transfer._id, {
      status: "completed",
      completedAt: now,
      sourceIdentities,
    });
    await scheduleTransferCleanupRetries(ctx, transfer._id);
    console.info("[CALL_TRANSFER] completed", {
      transferId: transfer._id,
      fromUserId: transfer.fromUserId,
      remoteUserId: transfer.remoteUserId,
      targetUserId: transfer.targetUserId,
    });
    return {
      completed: true as const,
      roomName: transfer.roomName,
      fromUserId: transfer.fromUserId,
      targetUserId: transfer.targetUserId,
      targetIdentity: transfer.targetIdentity,
      sourceIdentities,
    };
  },
});

export const transferCleanupDetails = internalQuery({
  args: { transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) return null;
    const participantIdentities =
      transfer.status === "completed"
        ? (transfer.sourceIdentities ?? [])
        : ["failed", "cancelled", "expired"].includes(transfer.status) &&
            transfer.targetIdentity
          ? [transfer.targetIdentity]
          : [];
    if (!participantIdentities.length) return null;
    return {
      roomName: transfer.roomName,
      fromUserId: transfer.fromUserId,
      remoteUserId: transfer.remoteUserId,
      targetUserId: transfer.targetUserId,
      targetIdentity: transfer.targetIdentity,
      participantIdentities,
      cleanupAttempts: transfer.cleanupAttempts ?? 0,
    };
  },
});

export const recordTransferCleanup = internalMutation({
  args: {
    transferId: v.id("call_transfers"),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer || !transfer.cleanupStatus) return;
    const completed = args.success || transfer.cleanupStatus === "completed";
    await ctx.db.patch(transfer._id, {
      cleanupStatus: completed ? "completed" : "failed",
      cleanupAttempts: (transfer.cleanupAttempts ?? 0) + 1,
      cleanupError: completed ? undefined : args.error?.slice(0, 500),
      cleanupUpdatedAt: Date.now(),
    });
  },
});

export const cancelTransfer = mutation({
  args: { ...authArgs, transferId: v.id("call_transfers") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const transfer = await ctx.db.get(args.transferId);
    if (
      !transfer ||
      transfer.fromUserId !== auth.code ||
      (transfer.fromDeviceId && transfer.fromDeviceId !== args.deviceId)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    if (!["pending", "accepted", "joining"].includes(transfer.status))
      throw new ConvexError({
        code: "CONFLICT",
        message: "通话转接已经结束。",
      });
    await ctx.db.patch(transfer._id, {
      status: "cancelled",
      completedAt: Date.now(),
    });
    await scheduleAbandonedReceiverCleanup(ctx, transfer);
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
    if (
      !transfer ||
      transfer.targetUserId !== auth.code ||
      (transfer.targetDeviceId && transfer.targetDeviceId !== args.deviceId)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    await requireTransferInAuthTenant(ctx, auth, transfer);
    if (!["accepted", "joining"].includes(transfer.status)) return;
    await ctx.db.patch(transfer._id, {
      status: "failed",
      completedAt: Date.now(),
      failureReason: args.reason?.slice(0, 200) || "目标用户加入失败",
    });
    await scheduleAbandonedReceiverCleanup(ctx, transfer);
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
