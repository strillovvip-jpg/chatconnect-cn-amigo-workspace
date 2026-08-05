import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSession } from "./roles";
import { internal } from "./_generated/api";

const MAX_GROUP_MEMBERS = 20;
const authArgs = { code: v.string(), deviceId: v.string() };

async function activeMember(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"chat_groups">,
  userId: string,
) {
  const member = await ctx.db
    .query("chat_group_members")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .unique();
  if (!member || member.status !== "active")
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
  return member;
}

async function manageableTarget(ctx: QueryCtx | MutationCtx, code: string) {
  const normalized = code.trim().toUpperCase();
  const user = await ctx.db
    .query("auth_codes")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  if (!user)
    throw new ConvexError({ code: "NOT_FOUND", message: "此授权码不可用。" });
  return user;
}

export const generateUploadUrl = mutation({
  args: { ...authArgs, groupId: v.id("chat_groups") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    await activeMember(ctx, args.groupId, auth.code);
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateGroup = mutation({
  args: {
    ...authArgs,
    groupId: v.id("chat_groups"),
    name: v.string(),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const actor = await activeMember(ctx, args.groupId, auth.code);
    if (actor.role === "member")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有群主或管理员可以编辑群组。",
      });
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "群组名称必须为 1 至 80 个字符。",
      });
    await ctx.db.patch(args.groupId, {
      name,
      avatar: args.avatar?.trim() || undefined,
      updatedAt: Date.now(),
    });
  },
});

export const create = mutation({
  args: {
    ...authArgs,
    name: v.string(),
    avatar: v.optional(v.string()),
    memberCodes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const name = args.name.trim();
    if (!name)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "请输入群组名称。",
      });
    const codes = [
      ...new Set([
        auth.code,
        ...args.memberCodes.map((code) => code.trim().toUpperCase()),
      ]),
    ];
    if (codes.length > MAX_GROUP_MEMBERS)
      throw new ConvexError({
        code: "LIMIT",
        message: `群组最多可有 ${MAX_GROUP_MEMBERS} 人。`,
      });
    for (const code of codes) await manageableTarget(ctx, code);
    const now = Date.now();
    const groupId = await ctx.db.insert("chat_groups", {
      name,
      avatar: args.avatar,
      ownerUserId: auth.code,
      maxMembers: MAX_GROUP_MEMBERS,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const code of codes) {
      await ctx.db.insert("chat_group_members", {
        groupId,
        userId: code,
        role: code === auth.code ? "owner" : "member",
        joinedAt: now,
        status: "active",
      });
      if (code !== auth.code)
        await ctx.db.insert("notifications", {
          notificationId: crypto.randomUUID(),
          userId: code,
          type: "group_invite",
          title: "群组邀请",
          message: `${auth.session.name} 邀请您加入“${name}”`,
          data: { groupId, inviterUserId: auth.code, source: "group" },
          status: "unread",
          priority: "high",
          createdAt: now,
        });
      if (code !== auth.code)
        await ctx.scheduler.runAfter(0, internal.push.send, {
          userId: code,
          title: "群组邀请",
          message: `${auth.session.name} 邀请您加入“${name}”`,
          url: "/consultation",
        });
    }
    return groupId;
  },
});

export const listMine = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const memberships = await ctx.db
      .query("chat_group_members")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", auth.code).eq("status", "active"),
      )
      .collect();
    const results = [];
    for (const membership of memberships) {
      const group = await ctx.db.get(membership.groupId);
      if (!group || group.status !== "active") continue;
      const members = await ctx.db
        .query("chat_group_members")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      const activeCall =
        (await ctx.db
          .query("chat_group_calls")
          .withIndex("by_group_status", (q) =>
            q.eq("groupId", group._id).eq("status", "active"),
          )
          .first()) ??
        (await ctx.db
          .query("chat_group_calls")
          .withIndex("by_group_status", (q) =>
            q.eq("groupId", group._id).eq("status", "ringing"),
          )
          .first());
      results.push({
        ...group,
        myRole: membership.role,
        memberCount: members.filter((m) => m.status === "active").length,
        activeCall,
      });
    }
    return results;
  },
});

export const get = query({
  args: { ...authArgs, groupId: v.id("chat_groups") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    await activeMember(ctx, args.groupId, auth.code);
    const group = await ctx.db.get(args.groupId);
    if (!group || group.status !== "active")
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到群组。" });
    const memberships = await ctx.db
      .query("chat_group_members")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const members = [];
    for (const membership of memberships.filter((m) => m.status === "active")) {
      const user = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", membership.userId))
        .unique();
      members.push({ ...membership, name: user?.name ?? membership.userId });
    }
    const activeCall = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "active"),
      )
      .first();
    const callParticipants = activeCall
      ? await ctx.db
          .query("chat_group_call_participants")
          .withIndex("by_call", (q) => q.eq("groupCallId", activeCall._id))
          .collect()
      : [];
    return { group, members, activeCall, callParticipants };
  },
});

export const addMember = mutation({
  args: { ...authArgs, groupId: v.id("chat_groups"), targetCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const actor = await activeMember(ctx, args.groupId, auth.code);
    if (actor.role === "member")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有群主或管理员可以添加成员。",
      });
    const target = await manageableTarget(ctx, args.targetCode);
    const members = await ctx.db
      .query("chat_group_members")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    if (
      members.filter((m) => m.status === "active").length >= MAX_GROUP_MEMBERS
    )
      throw new ConvexError({
        code: "LIMIT",
        message: `群组最多可有 ${MAX_GROUP_MEMBERS} 人。`,
      });
    const existing = members.find((m) => m.userId === target.code);
    if (existing?.status === "active")
      throw new ConvexError({
        code: "CONFLICT",
        message: "此成员已加入群组。",
      });
    if (existing)
      await ctx.db.patch(existing._id, {
        status: "active",
        role: "member",
        joinedAt: Date.now(),
      });
    else
      await ctx.db.insert("chat_group_members", {
        groupId: args.groupId,
        userId: target.code,
        role: "member",
        joinedAt: Date.now(),
        status: "active",
      });
    const group = await ctx.db.get(args.groupId);
    await ctx.db.insert("notifications", {
      notificationId: crypto.randomUUID(),
      userId: target.code,
      type: "group_invite",
      title: "群组邀请",
      message: `${auth.session.name} 邀请您加入“${group?.name ?? "群组"}”`,
      data: {
        groupId: args.groupId,
        inviterUserId: auth.code,
        source: "group",
      },
      status: "unread",
      priority: "high",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: target.code,
      title: "群组邀请",
      message: `${auth.session.name} 邀请您加入“${group?.name ?? "群组"}”`,
      url: "/consultation",
    });
  },
});

export const updateMember = mutation({
  args: {
    ...authArgs,
    groupId: v.id("chat_groups"),
    targetCode: v.string(),
    action: v.union(
      v.literal("promote"),
      v.literal("demote"),
      v.literal("remove"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const actor = await activeMember(ctx, args.groupId, auth.code);
    if (actor.role !== "owner")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有群主可以执行此操作。",
      });
    const target = await activeMember(
      ctx,
      args.groupId,
      args.targetCode.trim().toUpperCase(),
    );
    if (target.role === "owner")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不能修改群主权限。",
      });
    await ctx.db.patch(
      target._id,
      args.action === "remove"
        ? { status: "removed" }
        : { role: args.action === "promote" ? "admin" : "member" },
    );
  },
});

export const leaveOrDissolve = mutation({
  args: { ...authArgs, groupId: v.id("chat_groups"), dissolve: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const member = await activeMember(ctx, args.groupId, auth.code);
    if (args.dissolve) {
      if (member.role !== "owner")
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "只有群主可以解散群组。",
        });
      await ctx.db.patch(args.groupId, {
        status: "dissolved",
        updatedAt: Date.now(),
      });
      const calls = await ctx.db
        .query("chat_group_calls")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", args.groupId).eq("status", "active"),
        )
        .collect();
      for (const call of calls) {
        await ctx.db.patch(call._id, { status: "ended", endedAt: Date.now() });
        const participants = await ctx.db
          .query("chat_group_call_participants")
          .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
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
    } else {
      if (member.role === "owner")
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "群主必须先解散群组。",
        });
      await ctx.db.patch(member._id, { status: "left" });
    }
  },
});

export const messages = query({
  args: { ...authArgs, groupId: v.id("chat_groups") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    await activeMember(ctx, args.groupId, auth.code);
    const records = await ctx.db
      .query("chat_group_messages")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("desc")
      .take(200);
    return await Promise.all(
      records.reverse().map(async (record) => ({
        ...record,
        url: record.storageId
          ? await ctx.storage.getUrl(record.storageId)
          : null,
      })),
    );
  },
});

export const sendMessage = mutation({
  args: {
    ...authArgs,
    groupId: v.id("chat_groups"),
    type: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("video"),
      v.literal("file"),
    ),
    text: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    await activeMember(ctx, args.groupId, auth.code);
    if (args.type === "text" && !args.text?.trim())
      throw new ConvexError({ code: "BAD_REQUEST", message: "请输入消息。" });
    if (args.type === "text" && args.text!.trim().length > 5000)
      throw new ConvexError({ code: "BAD_REQUEST", message: "消息过长。" });
    if (args.type !== "text" && !args.storageId)
      throw new ConvexError({ code: "BAD_REQUEST", message: "找不到附件。" });
    return await ctx.db.insert("chat_group_messages", {
      groupId: args.groupId,
      senderUserId: auth.code,
      senderName: auth.session.name,
      type: args.type,
      text: args.text?.trim(),
      storageId: args.storageId,
      sentAt: Date.now(),
    });
  },
});
