import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAdminCanAccessCode,
  listVisibleAllowedCodes,
  requireAdmin,
  requireSuperAdmin,
} from "./roles";

export const verifyAdmin = query({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireAdmin(ctx, args.password);
      return true;
    } catch {
      return false;
    }
  },
});

export const getAllCodes = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const users = await ctx.db.query("auth_codes").order("desc").collect();
    const access = await listVisibleAllowedCodes(ctx, auth);
    const scopedAccess =
      auth.role === "admin" && auth.allowed?.companyId
        ? access.filter((item) => item.role === "user")
        : access;
    const presence = await ctx.db.query("user_presence").collect();
    const presenceByUser = new Map(presence.map((item) => [item.userId, item]));
    const accessByCode = new Map(scopedAccess.map((item) => [item.code, item]));
    return users
      .filter((item) => accessByCode.has(item.code))
      .map((item) => {
      const state = presenceByUser.get(item.code);
      const grant = accessByCode.get(item.code);
      return {
        ...item,
        role: grant?.role ?? "user",
        enabled: grant?.enabled !== false,
        licenseProfileId: grant?.licenseProfileId,
        expiresAt: grant?.expiresAt,
        online: Boolean(state && Date.now() - state.lastSeenAt < 90_000),
        lastSeenAt: state?.lastSeenAt,
        lastOnlineAt: state?.lastOnlineAt,
        lastOfflineAt: state?.lastOfflineAt,
      };
      });
  },
});

export const getAllowedCodes = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const access = await listVisibleAllowedCodes(ctx, auth);
    if (auth.role === "admin" && auth.allowed?.companyId)
      return access.filter((item) => item.role === "user");
    return access;
  },
});

export const getAllUsers = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const users = await ctx.db.query("auth_codes").collect();
    const visibleAllowedCodes = await listVisibleAllowedCodes(ctx, auth);
    const visibleCodeSet = new Set(
      (auth.role === "admin" && auth.allowed?.companyId
        ? visibleAllowedCodes.filter((item) => item.role === "user")
        : visibleAllowedCodes
      ).map((item) => item.code),
    );
    if (auth.role === "super_admin") return users;
    if (auth.allowed?.companyId)
      return users.filter((item) => visibleCodeSet.has(item.code));
    const superCodes = new Set(
      (await ctx.db.query("allowed_codes").collect())
        .filter((item) => item.role === "super_admin")
        .map((item) => item.code),
    );
    return users.filter((item) => !superCodes.has(item.code));
  },
});

export const getAllContacts = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    return await ctx.db.query("contacts").collect();
  },
});

export const getAllMessages = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    return await ctx.db.query("messages").order("desc").take(200);
  },
});

export const getAllCases = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    await requireAdmin(ctx, args.password);
    return await ctx.db.query("cases").order("desc").take(100);
  },
});

export const getGroupCalls = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    await requireAdmin(ctx, args.password);
    const calls = await ctx.db.query("chat_group_calls").order("desc").take(50);
    return await Promise.all(
      calls.map(async (call) => {
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
          title: group?.name ?? "已删除的群组",
          createdByName: creator?.name ?? call.createdBy,
          participantCount: participants.filter(
            (item) => item.status === "joined",
          ).length,
        };
      }),
    );
  },
});

export const getActiveCalls = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    await requireAdmin(ctx, args.password);
    const activeCutoff = Date.now() - 120_000;
    const activeStatuses = new Set([
      "accepted",
      "connecting",
      "connected",
      "active",
    ]);
    const p2p = (await ctx.db.query("live_calls").order("desc").take(200))
      .filter(
        (call) =>
          activeStatuses.has(call.status) &&
          (call.lastActivityAt ?? call.createdAt) >= activeCutoff,
      )
      .map((call) => ({
        id: call.callId,
        kind: "p2p" as const,
        type: call.type,
        status: call.status,
        participants: [
          {
            code: call.callerUserId ?? call.callerCode ?? "-",
            name: call.callerName ?? call.callerUserId ?? "未知",
          },
          {
            code: call.calleeUserId ?? call.calleeCode ?? "-",
            name: call.calleeName ?? call.calleeUserId ?? "未知",
          },
        ],
        startedAt: call.connectedAt ?? call.acceptedAt ?? call.createdAt,
      }));
    const groups = (
      await ctx.db.query("chat_group_calls").order("desc").take(100)
    ).filter(
      (call) =>
        call.status === "active" &&
        (call.lastActivityAt ?? call.startedAt) >= activeCutoff,
    );
    const groupRows = await Promise.all(
      groups.map(async (call) => {
        const group = await ctx.db.get(call.groupId);
        const joined = (
          await ctx.db
            .query("chat_group_call_participants")
            .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
            .collect()
        ).filter((item) => item.status === "joined");
        const participants = await Promise.all(
          joined.map(async (item) => {
            const user = await ctx.db
              .query("auth_codes")
              .withIndex("by_code", (q) => q.eq("code", item.userId))
              .unique();
            return { code: item.userId, name: user?.name ?? item.userId };
          }),
        );
        return {
          id: call.callId,
          kind: "group" as const,
          type: call.type,
          status: call.status,
          participants,
          startedAt: call.startedAt,
          groupName: group?.name ?? "已删除的群组",
        };
      }),
    );
    return [...p2p, ...groupRows].sort((a, b) => b.startedAt - a.startedAt);
  },
});

export const cleanupStaleCalls = mutation({
  args: { password: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    const now = Date.now();
    const cutoff = now - 120_000;
    let p2pEnded = 0;
    let groupsEnded = 0;
    for (const call of await ctx.db.query("live_calls").collect()) {
      if (
        ["accepted", "connecting", "connected", "active"].includes(
          call.status,
        ) &&
        (call.lastActivityAt ?? call.createdAt) < cutoff
      ) {
        await ctx.db.patch(call._id, {
          status: "failed",
          endedAt: now,
          failureReason: "heartbeat_timeout",
        });
        p2pEnded += 1;
      }
    }
    for (const call of await ctx.db.query("chat_group_calls").collect()) {
      if (
        call.status === "active" &&
        (call.lastActivityAt ?? call.startedAt) < cutoff
      ) {
        await ctx.db.patch(call._id, { status: "ended", endedAt: now });
        const participants = await ctx.db
          .query("chat_group_call_participants")
          .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
          .collect();
        for (const participant of participants) {
          if (participant.status === "joined")
            await ctx.db.patch(participant._id, {
              status: "left",
              leftAt: now,
            });
        }
        groupsEnded += 1;
      }
    }
    return { p2pEnded, groupsEnded };
  },
});

export const resetCode = mutation({
  args: { password: v.string(), code: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    await assertAdminCanAccessCode(ctx, auth, args.code);
    const record = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (!record)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    const access = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", record.code))
      .unique();
    if (access?.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法强制退出总管理员。",
      });
    if (auth.role !== "super_admin" && access?.role === "admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员无法强制退出其他管理员。",
      });
    await ctx.db.delete(record._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "auth_code.reset",
      targetType: "auth_code",
      targetId: record.code,
      success: true,
      createdAt: Date.now(),
    });
  },
});

export const deleteUser = mutation({
  args: { password: v.string(), code: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const access = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim().toUpperCase()))
      .unique();
    if (access?.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法删除总管理员。",
      });
    const record = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (record) await ctx.db.delete(record._id);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_owner", (q) => q.eq("ownerCode", args.code))
      .collect();
    for (const c of contacts) await ctx.db.delete(c._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "user.delete",
      targetType: "auth_code",
      targetId: args.code,
      success: true,
      createdAt: Date.now(),
    });
  },
});

export const updateCaseStatusAdmin = mutation({
  args: {
    password: v.string(),
    caseId: v.id("cases"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("closed"),
      v.literal("suspended"),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    await ctx.db.patch(args.caseId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const deleteCaseAdmin = mutation({
  args: { password: v.string(), caseId: v.id("cases") },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    await ctx.db.delete(args.caseId);
  },
});

export const endGroupCallAdmin = mutation({
  args: { password: v.string(), callId: v.id("group_calls") },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    await ctx.db.patch(args.callId, { isActive: false });
  },
});

export const getStats = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const users = await ctx.db.query("auth_codes").collect();
    const visibleAllowedCodes = await listVisibleAllowedCodes(ctx, auth);
    const visibleCodeSet = new Set(
      (auth.role === "admin" && auth.allowed?.companyId
        ? visibleAllowedCodes.filter((item) => item.role === "user")
        : visibleAllowedCodes
      ).map((item) => item.code),
    );
    const contacts = await ctx.db.query("contacts").collect();
    const messages = await ctx.db.query("messages").collect();
    const cases = await ctx.db.query("cases").collect();
    const activeCalls = await ctx.db.query("chat_group_calls").collect();
    const p2pCalls = await ctx.db.query("live_calls").collect();
    const openCases = cases.filter((c) => c.status === "open").length;
    const inProgressCases = cases.filter(
      (c) => c.status === "in_progress",
    ).length;
    return {
      totalUsers: auth.allowed?.companyId
        ? users.filter((item) => visibleCodeSet.has(item.code)).length
        : users.length,
      totalContacts: contacts.length,
      totalMessages: messages.length,
      totalCases: cases.length,
      openCases,
      inProgressCases,
      activeGroupCalls:
        activeCalls.filter((call) => call.status === "active").length +
        p2pCalls.filter((call) =>
          ["accepted", "connecting", "connected", "active"].includes(
            call.status,
          ),
        ).length,
    };
  },
});
