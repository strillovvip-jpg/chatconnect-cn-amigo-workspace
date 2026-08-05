import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession } from "./roles";
import { internal } from "./_generated/api";

const authArgs = { code: v.string(), deviceId: v.string() };
const hiddenFriendHistoryTypes = new Set([
  "friend_accepted",
  "friend_rejected",
  "friend_cancelled",
]);

export const listMine = query({
  args: { ...authArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const records = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", auth.code))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 200));
    return records.filter(
      (record) =>
        record.status !== "dismissed" &&
        !hiddenFriendHistoryTypes.has(record.type) &&
        (auth.role !== "user" ||
          (record.type !== "case_shared" && record.type !== "document_shared")),
    );
  },
});

export const unreadMine = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const records = await ctx.db
      .query("notifications")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", auth.code).eq("status", "unread"),
      )
      .order("desc")
      .collect();
    return records.filter(
      (record) =>
        !hiddenFriendHistoryTypes.has(record.type) &&
        (auth.role !== "user" ||
          (record.type !== "case_shared" && record.type !== "document_shared")),
    );
  },
});

export const markRead = mutation({
  args: { ...authArgs, notificationId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const record = await ctx.db
      .query("notifications")
      .withIndex("by_notification_id", (q) =>
        q.eq("notificationId", args.notificationId),
      )
      .unique();
    if (!record || record.userId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (record.status === "unread")
      await ctx.db.patch(record._id, { status: "read", readAt: Date.now() });
  },
});

export const markAllRead = mutation({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const records = await ctx.db
      .query("notifications")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", auth.code).eq("status", "unread"),
      )
      .collect();
    const now = Date.now();
    for (const record of records)
      await ctx.db.patch(record._id, { status: "read", readAt: now });
  },
});

export const dismiss = mutation({
  args: { ...authArgs, notificationId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const record = await ctx.db
      .query("notifications")
      .withIndex("by_notification_id", (q) =>
        q.eq("notificationId", args.notificationId),
      )
      .unique();
    if (!record || record.userId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    await ctx.db.patch(record._id, {
      status: "dismissed",
      readAt: record.readAt ?? Date.now(),
    });
  },
});

export const shareResource = mutation({
  args: {
    ...authArgs,
    targetCode: v.string(),
    kind: v.union(v.literal("case"), v.literal("document")),
    resourceId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    if (auth.role === "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const targetCode = args.targetCode.trim().toUpperCase();
    const targetAccess = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!targetAccess || !["admin", "super_admin"].includes(targetAccess.role))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "案件和文件只能与管理员共享。",
      });
    const target = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到目标用户。" });
    const isCase = args.kind === "case";
    const id = await ctx.db.insert("notifications", {
      notificationId: crypto.randomUUID(),
      userId: targetCode,
      type: isCase ? "case_shared" : "document_shared",
      title: isCase ? "已共享案件" : "已共享文件",
      message: `${auth.session.name} 与您共享了“${args.title}”`,
      data: {
        resourceId: args.resourceId,
        sourceUserId: auth.code,
        source: args.kind,
      },
      status: "unread",
      priority: "high",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: targetCode,
      title: isCase ? "已共享案件" : "已共享文件",
      message: `${auth.session.name} 与您共享了“${args.title}”`,
      url: "/consultation",
    });
    return id;
  },
});

export const announce = mutation({
  args: {
    ...authArgs,
    targetCode: v.optional(v.string()),
    title: v.string(),
    message: v.string(),
    system: v.boolean(),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    if (auth.role === "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const users = args.targetCode
      ? [args.targetCode.trim().toUpperCase()]
      : (await ctx.db.query("auth_codes").collect()).map((user) => user.code);
    for (const userId of users) {
      await ctx.db.insert("notifications", {
        notificationId: crypto.randomUUID(),
        userId,
        type: args.system ? "system_announcement" : "admin_announcement",
        title: args.title.trim(),
        message: args.message.trim(),
        data: { sourceUserId: auth.code },
        status: "unread",
        priority: args.priority,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.push.send, {
        userId,
        title: args.title.trim(),
        message: args.message.trim(),
        url: "/consultation",
      });
    }
  },
});
