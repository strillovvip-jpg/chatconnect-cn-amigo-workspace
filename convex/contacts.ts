import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  assertActiveAuthorizationTarget,
  isActiveAuthorizationTarget,
  requireSession,
} from "./roles";
import { internal } from "./_generated/api";
import {
  allowedForCode,
  assertCodesCanCommunicate,
  canCodesCommunicate,
} from "./tenantBoundaries";

// Authorization codes are public identifiers, but contact discovery must not
// be an account-enumeration surface. Only one exact five-letter code is ever
// looked up.
export const searchUser = query({
  args: {
    query: v.string(),
    requesterCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.requesterCode, args.deviceId);
    const q = args.query.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(q)) return [];

    const byCode = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (qb) => qb.eq("code", q))
      .first();
    if (q === auth.code) return [];
    const targetAllowed = await allowedForCode(ctx, q);

    if (
      isActiveAuthorizationTarget(targetAllowed) &&
      (await canCodesCommunicate(ctx, auth.code, q))
    ) {
      return [
        byCode
          ? {
              code: byCode.code,
              name: byCode.name,
              department: byCode.department,
            }
          : { code: q, name: q },
      ];
    }
    return [];
  },
});

// Add a contact
export const addContact = mutation({
  args: {
    ownerCode: v.string(),
    targetCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.ownerCode, args.deviceId);
    // Validate target code exists in the imported allowlist or registered users.
    const targetCode = args.targetCode.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(targetCode))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码必须正好包含五个英文字母。",
      });
    if (targetCode === auth.code)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "不能将自己添加为联系人。",
      });
    const target = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .first();
    const targetAllowed = await allowedForCode(ctx, targetCode);
    assertActiveAuthorizationTarget(targetAllowed);
    await assertCodesCanCommunicate(ctx, auth.code, targetCode);
    const targetIdentity = target ?? {
      code: targetCode,
      name: targetCode,
      department: undefined,
    };

    // Check already added
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_owner_target", (q) =>
        q.eq("ownerCode", auth.code).eq("targetCode", targetCode),
      )
      .first();

    if (existing) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "此用户已在您的联系人中。",
      });
    }

    const pending = await ctx.db
      .query("friend_requests")
      .withIndex("by_pair", (q) =>
        q.eq("requesterUserId", auth.code).eq("targetUserId", targetCode),
      )
      .order("desc")
      .first();
    if (pending?.status === "pending")
      throw new ConvexError({
        code: "CONFLICT",
        message: "已发送过联系人请求。",
      });
    const notificationId = crypto.randomUUID();
    const requestId = await ctx.db.insert("friend_requests", {
      requesterUserId: auth.code,
      targetUserId: targetCode,
      status: "pending",
      notificationId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("notifications", {
      notificationId,
      userId: targetCode,
      type: "friend_invite",
      title: "USA.Filing · Contact request",
      message: `${auth.session.name} (${auth.code}) sent you a contact request.`,
      data: {
        friendRequestId: requestId,
        requesterUserId: auth.code,
        requesterName: auth.session.name,
        source: "friend",
      },
      status: "unread",
      priority: "urgent",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: targetCode,
      title: "USA.Filing · Contact request",
      message: `${auth.session.name} (${auth.code}) sent you a contact request.`,
      url: "/consultation",
      type: "friend_invite",
      data: {
        friendRequestId: requestId,
        requesterUserId: auth.code,
        requesterName: auth.session.name,
        source: "friend",
      },
    });
    return { name: targetIdentity.name, pending: true };
  },
});

export const respondFriendRequest = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    requestId: v.id("friend_requests"),
    accept: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.targetUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (request.status !== "pending")
      throw new ConvexError({
        code: "CONFLICT",
        message: "此请求已处理。",
      });
    const requester = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", request.requesterUserId))
      .unique();
    await assertCodesCanCommunicate(ctx, auth.code, request.requesterUserId);
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.accept ? "accepted" : "rejected",
      respondedAt: now,
    });
    if (request.notificationId) {
      const original = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", request.notificationId!),
        )
        .unique();
      if (original)
        await ctx.db.patch(original._id, { status: "dismissed", readAt: now });
    }
    if (args.accept && requester) {
      const pairs = [
        [auth.code, requester],
        [requester.code, auth.session],
      ] as const;
      for (const [ownerCode, target] of pairs) {
        const exists = await ctx.db
          .query("contacts")
          .withIndex("by_owner_target", (q) =>
            q.eq("ownerCode", ownerCode).eq("targetCode", target.code),
          )
          .unique();
        if (!exists)
          await ctx.db.insert("contacts", {
            ownerCode,
            targetCode: target.code,
            targetName: target.name,
            targetDepartment: target.department,
            addedAt: new Date(now).toISOString(),
          });
      }
    }
  },
});

export const cancelFriendRequest = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    requestId: v.id("friend_requests"),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.requesterUserId !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (request.status !== "pending")
      throw new ConvexError({
        code: "CONFLICT",
        message: "此请求已处理。",
      });
    await ctx.db.patch(request._id, {
      status: "cancelled",
      respondedAt: Date.now(),
    });
    if (request.notificationId) {
      const original = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", request.notificationId!),
        )
        .unique();
      if (original)
        await ctx.db.patch(original._id, {
          status: "dismissed",
          readAt: Date.now(),
        });
    }
  },
});

// Remove a contact
export const removeContact = mutation({
  args: {
    ownerCode: v.string(),
    targetCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.ownerCode, args.deviceId);
    const targetCode = args.targetCode.trim().toUpperCase();
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_owner_target", (q) =>
        q.eq("ownerCode", auth.code).eq("targetCode", targetCode),
      )
      .first();

    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到联系人。",
      });
    }

    await ctx.db.delete(existing._id);
    const reciprocal = await ctx.db
      .query("contacts")
      .withIndex("by_owner_target", (q) =>
        q.eq("ownerCode", targetCode).eq("targetCode", auth.code),
      )
      .unique();
    if (reciprocal) await ctx.db.delete(reciprocal._id);
  },
});

// Get all contacts for a user
export const getContacts = query({
  args: { ownerCode: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.ownerCode, args.deviceId);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_owner", (q) => q.eq("ownerCode", auth.code))
      .order("asc")
      .collect();
    const now = Date.now();
    const visible = [];
    for (const contact of contacts) {
      const targetAllowed = await allowedForCode(ctx, contact.targetCode);
      if (
        !isActiveAuthorizationTarget(targetAllowed) ||
        !(await canCodesCommunicate(ctx, auth.code, contact.targetCode))
      )
        continue;
      const presence = await ctx.db
        .query("user_presence")
        .withIndex("by_user", (q) => q.eq("userId", contact.targetCode))
        .unique();
      visible.push({
        ...contact,
        online: Boolean(presence && now - presence.lastSeenAt < 90_000),
        lastSeenAt: presence?.lastSeenAt,
      });
    }
    return visible;
  },
});
