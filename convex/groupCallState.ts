import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSession } from "./roles";
import { requireFeature } from "./features";
import { internal } from "./_generated/api";

const authArgs = { code: v.string(), deviceId: v.string() };
async function member(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"chat_groups">,
  code: string,
) {
  const result = await ctx.db
    .query("chat_group_members")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", code),
    )
    .unique();
  if (!result || result.status !== "active")
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "只有群组成员可以加入通话。",
    });
  return result;
}

async function dismissCallNotifications(
  ctx: MutationCtx,
  groupCallId: Id<"chat_group_calls">,
) {
  const participants = await ctx.db
    .query("chat_group_call_participants")
    .withIndex("by_call", (q) => q.eq("groupCallId", groupCallId))
    .collect();
  for (const participant of participants) {
    if (!participant.notificationId) continue;
    const notification = await ctx.db
      .query("notifications")
      .withIndex("by_notification_id", (q) =>
        q.eq("notificationId", participant.notificationId!),
      )
      .unique();
    if (notification?.status === "unread")
      await ctx.db.patch(notification._id, { status: "expired" });
  }
}

export const createCall = mutation({
  args: {
    ...authArgs,
    groupId: v.id("chat_groups"),
    type: v.union(v.literal("video"), v.literal("audio")),
  },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canGroupCall",
    );
    if (args.type === "video")
      await requireFeature(ctx, args.code, args.deviceId, "canVideoCall");
    else await requireFeature(ctx, args.code, args.deviceId, "canVoiceCall");
    await member(ctx, args.groupId, auth.code);
    const group = await ctx.db.get(args.groupId);
    if (!group || group.status !== "active")
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到群组。" });
    const active =
      (await ctx.db
        .query("chat_group_calls")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", args.groupId).eq("status", "active"),
        )
        .first()) ??
      (await ctx.db
        .query("chat_group_calls")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", args.groupId).eq("status", "ringing"),
        )
        .first());
    if (active) {
      const participant = await ctx.db
        .query("chat_group_call_participants")
        .withIndex("by_call_user", (q) =>
          q.eq("groupCallId", active._id).eq("userId", auth.code),
        )
        .unique();
      const identity =
        participant?.livekitIdentity ?? `${auth.code}-${crypto.randomUUID()}`;
      if (participant)
        await ctx.db.patch(participant._id, {
          status: "joined",
          joinedAt: participant.joinedAt ?? Date.now(),
          livekitIdentity: identity,
        });
      else
        await ctx.db.insert("chat_group_call_participants", {
          groupCallId: active._id,
          userId: auth.code,
          status: "joined",
          joinedAt: Date.now(),
          livekitIdentity: identity,
          isHost: false,
        });
      await ctx.db.patch(active._id, { lastActivityAt: Date.now() });
      return {
        groupCallId: active._id,
        callId: active.callId,
        roomName: active.roomName,
        identity,
        name: auth.session.name,
        groupName: group.name,
        type: active.type,
      };
    }
    const callId = crypto.randomUUID();
    const roomName = `group-${args.groupId}-${callId.slice(0, 8)}`;
    const identity = `${auth.code}-${crypto.randomUUID()}`;
    const groupCallId = await ctx.db.insert("chat_group_calls", {
      groupId: args.groupId,
      callId,
      roomName,
      type: args.type,
      status: "ringing",
      createdBy: auth.code,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      maxParticipants: group.maxMembers,
    });
    const memberships = await ctx.db
      .query("chat_group_members")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    for (const item of memberships.filter((item) => item.status === "active")) {
      const notificationId =
        item.userId === auth.code ? undefined : crypto.randomUUID();
      await ctx.db.insert("chat_group_call_participants", {
        groupCallId,
        userId: item.userId,
        status: item.userId === auth.code ? "joined" : "ringing",
        joinedAt: item.userId === auth.code ? Date.now() : undefined,
        livekitIdentity: item.userId === auth.code ? identity : undefined,
        isHost: item.userId === auth.code || item.role === "owner",
        notificationId,
      });
      if (notificationId)
        await ctx.db.insert("notifications", {
          notificationId,
          userId: item.userId,
          type: "group_video_invite",
          title: args.type === "video" ? "群组视频来电" : "群组语音来电",
          message: `${auth.session.name} 在“${group.name}”中发起了通话`,
          data: {
            groupCallId,
            groupId: args.groupId,
            callId,
            callType: args.type,
            source: "group_call",
          },
          status: "unread",
          priority: "urgent",
          createdAt: Date.now(),
        });
      if (notificationId)
        await ctx.scheduler.runAfter(0, internal.push.send, {
          userId: item.userId,
          title: args.type === "video" ? "群组视频来电" : "群组语音来电",
          message: `${auth.session.name} 在“${group.name}”中发起了通话`,
          url: "/consultation",
        });
    }
    await ctx.db.patch(groupCallId, { status: "active" });
    return {
      groupCallId,
      callId,
      roomName,
      identity,
      name: auth.session.name,
      groupName: group.name,
      type: args.type,
    };
  },
});

export const authorizeJoin = mutation({
  args: { ...authArgs, groupCallId: v.id("chat_group_calls") },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canGroupCall",
    );
    const call = await ctx.db.get(args.groupCallId);
    if (call)
      await requireFeature(
        ctx,
        args.code,
        args.deviceId,
        call.type === "video" ? "canVideoCall" : "canVoiceCall",
      );
    if (!call || call.status === "ended")
      throw new ConvexError({ code: "NOT_FOUND", message: "群组通话已结束。" });
    await member(ctx, call.groupId, auth.code);
    const participant = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", call._id).eq("userId", auth.code),
      )
      .unique();
    if (participant?.status === "blocked" || participant?.status === "removed")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您已被禁止重新加入此通话。",
      });
    const joined = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
      .collect();
    if (
      joined.filter((item) => item.status === "joined").length >=
      call.maxParticipants
    )
      throw new ConvexError({ code: "LIMIT", message: "通话人数已达到上限。" });
    const identity =
      participant?.livekitIdentity ?? `${auth.code}-${crypto.randomUUID()}`;
    if (participant) {
      await ctx.db.patch(participant._id, {
        status: "joined",
        joinedAt: Date.now(),
        leftAt: undefined,
        livekitIdentity: identity,
      });
      if (participant.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", participant.notificationId!),
          )
          .unique();
        if (notification)
          await ctx.db.patch(notification._id, {
            status: "read",
            readAt: Date.now(),
          });
      }
    } else
      await ctx.db.insert("chat_group_call_participants", {
        groupCallId: call._id,
        userId: auth.code,
        status: "joined",
        joinedAt: Date.now(),
        livekitIdentity: identity,
        isHost: false,
      });
    const group = await ctx.db.get(call.groupId);
    await ctx.db.patch(call._id, {
      status: "active",
      lastActivityAt: Date.now(),
    });
    return {
      roomName: call.roomName,
      callId: call.callId,
      identity,
      name: auth.session.name,
      groupName: group?.name ?? "群组通话",
      type: call.type,
    };
  },
});

export const incoming = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const invitations = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", auth.code).eq("status", "ringing"),
      )
      .order("desc")
      .collect();
    for (const invite of invitations) {
      const call = await ctx.db.get(invite.groupCallId);
      if (!call || call.status === "ended") continue;
      const group = await ctx.db.get(call.groupId);
      const creator = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", call.createdBy))
        .unique();
      const participants = await ctx.db
        .query("chat_group_call_participants")
        .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
        .collect();
      return {
        ...call,
        groupName: group?.name ?? "群组",
        creatorName: creator?.name ?? call.createdBy,
        participantCount: participants.filter((p) => p.status === "joined")
          .length,
      };
    }
    return null;
  },
});

export const decline = mutation({
  args: { ...authArgs, groupCallId: v.id("chat_group_calls") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db.get(args.groupCallId);
    if (!call || call.status === "ended") return;
    await member(ctx, call.groupId, auth.code);
    const participant = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", args.groupCallId).eq("userId", auth.code),
      )
      .unique();
    if (participant?.status === "ringing") {
      await ctx.db.patch(participant._id, { status: "declined" });
      if (participant.notificationId) {
        const notification = await ctx.db
          .query("notifications")
          .withIndex("by_notification_id", (q) =>
            q.eq("notificationId", participant.notificationId!),
          )
          .unique();
        if (notification)
          await ctx.db.patch(notification._id, {
            status: "dismissed",
            readAt: Date.now(),
          });
      }
    }
  },
});

export const leave = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call) return;
    const participant = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", call._id).eq("userId", auth.code),
      )
      .unique();
    if (participant)
      await ctx.db.patch(participant._id, {
        status: "left",
        leftAt: Date.now(),
      });
    const participants = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
      .collect();
    if (
      !participants.some(
        (p) => p._id !== participant?._id && p.status === "joined",
      )
    ) {
      await ctx.db.patch(call._id, { status: "ended", endedAt: Date.now() });
      await dismissCallNotifications(ctx, call._id);
    }
  },
});

export const heartbeat = mutation({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call || call.status === "ended") return;
    const participant = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", call._id).eq("userId", auth.code),
      )
      .unique();
    if (!participant || participant.status !== "joined")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无法加入此通话。",
      });
    const lastActivityAt = Date.now();
    await ctx.db.patch(call._id, { status: "active", lastActivityAt });
    await ctx.scheduler.runAfter(
      120_000,
      internal.groupCallState.expireStaleActiveCall,
      { callId: call.callId, lastActivityAt },
    );
  },
});

export const expireStaleActiveCall = internalMutation({
  args: { callId: v.string(), lastActivityAt: v.number() },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !call ||
      call.status !== "active" ||
      (call.lastActivityAt ?? 0) > args.lastActivityAt
    )
      return;
    const now = Date.now();
    await ctx.db.patch(call._id, { status: "ended", endedAt: now });
    const participants = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
      .collect();
    for (const participant of participants) {
      if (participant.status === "joined")
        await ctx.db.patch(participant._id, { status: "left", leftAt: now });
    }
    await dismissCallNotifications(ctx, call._id);
  },
});

export const callStatus = query({
  args: { ...authArgs, callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const call = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call) return null;
    await member(ctx, call.groupId, auth.code);
    return { status: call.status, endedAt: call.endedAt };
  },
});

export const authorizeHostAction = mutation({
  args: {
    ...authArgs,
    groupCallId: v.id("chat_group_calls"),
    targetCode: v.optional(v.string()),
    action: v.union(
      v.literal("remove"),
      v.literal("block"),
      v.literal("cohost"),
      v.literal("end"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const actor = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", args.groupCallId).eq("userId", auth.code),
      )
      .unique();
    if (!actor?.isHost || actor.status !== "joined")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有主持人可以管理通话。",
      });
    const call = await ctx.db.get(args.groupCallId);
    if (!call)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到群组通话。" });
    if (args.action === "end")
      return { roomName: call.roomName, action: args.action };
    if (!args.targetCode)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "未指定目标成员。",
      });
    const target = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", args.groupCallId).eq("userId", args.targetCode!),
      )
      .unique();
    if (!target)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "目标成员未加入通话。",
      });
    return {
      roomName: call.roomName,
      action: args.action,
      identity: target.livekitIdentity,
    };
  },
});

export const finalizeHostAction = mutation({
  args: {
    ...authArgs,
    groupCallId: v.id("chat_group_calls"),
    targetCode: v.optional(v.string()),
    action: v.union(
      v.literal("remove"),
      v.literal("block"),
      v.literal("cohost"),
      v.literal("end"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const actor = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", args.groupCallId).eq("userId", auth.code),
      )
      .unique();
    if (!actor?.isHost || actor.status !== "joined")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有主持人可以管理通话。",
      });
    if (args.action === "end") {
      await ctx.db.patch(args.groupCallId, {
        status: "ended",
        endedAt: Date.now(),
      });
      await dismissCallNotifications(ctx, args.groupCallId);
      return;
    }
    if (!args.targetCode)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "未指定目标成员。",
      });
    const target = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call_user", (q) =>
        q.eq("groupCallId", args.groupCallId).eq("userId", args.targetCode!),
      )
      .unique();
    if (!target)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "目标成员未加入通话。",
      });
    await ctx.db.patch(
      target._id,
      args.action === "cohost"
        ? { isHost: true }
        : {
            status: args.action === "block" ? "blocked" : "removed",
            leftAt: Date.now(),
          },
    );
  },
});
