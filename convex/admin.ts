import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAdminCanAccessCode,
  getAdminCompanyScope,
  listVisibleAllowedCodes,
  requireAdmin,
  requireSuperAdmin,
} from "./roles";

async function visibleCodeSet(
  ctx: QueryCtx | MutationCtx,
  auth: Awaited<ReturnType<typeof requireAdmin>>,
  usersOnly = false,
) {
  const scope = getAdminCompanyScope(auth);
  if (!scope) return null;
  const records = await listVisibleAllowedCodes(ctx, auth);
  return new Set(
    records
      .filter((record) => !usersOnly || record.role === "user")
      .map((record) => record.code),
  );
}

function codeIsVisible(codes: Set<string> | null, code: string) {
  return codes === null || codes.has(code.trim().toUpperCase());
}

function allCodesVisible(codes: Set<string> | null, values: string[]) {
  return values.every((value) => codeIsVisible(codes, value));
}

function messageIsVisible(
  codes: Set<string> | null,
  record: { senderCode: string; roomId: string },
) {
  if (!codeIsVisible(codes, record.senderCode)) return false;
  const participants = record.roomId.split(":");
  return participants.length === 2
    ? allCodesVisible(codes, participants)
    : true;
}

function p2pCallIsVisible(
  codes: Set<string> | null,
  call: { createdByCode: string; participantCodes: string[] },
) {
  return (
    codeIsVisible(codes, call.createdByCode) &&
    allCodesVisible(codes, call.participantCodes)
  );
}

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
    const scopedAccess = getAdminCompanyScope(auth)
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
    if (getAdminCompanyScope(auth))
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
      (getAdminCompanyScope(auth)
        ? visibleAllowedCodes.filter((item) => item.role === "user")
        : visibleAllowedCodes
      ).map((item) => item.code),
    );
    if (getAdminCompanyScope(auth))
      return users.filter((item) => visibleCodeSet.has(item.code));
    if (auth.role === "super_admin") return users;
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
    const records = await ctx.db.query("contacts").collect();
    if (!getAdminCompanyScope(auth)) return records;
    const visible = new Set(
      (await listVisibleAllowedCodes(ctx, auth)).map((item) => item.code),
    );
    return records.filter(
      (record) =>
        visible.has(record.ownerCode) && visible.has(record.targetCode),
    );
  },
});

export const getAllMessages = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const records = await ctx.db.query("messages").order("desc").take(200);
    if (!getAdminCompanyScope(auth)) return records;
    const visible = new Set(
      (await listVisibleAllowedCodes(ctx, auth)).map((item) => item.code),
    );
    return records.filter((record) => messageIsVisible(visible, record));
  },
});

export const getAllCases = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const records = await ctx.db.query("cases").order("desc").take(100);
    if (!getAdminCompanyScope(auth)) return records;
    const visible = new Set(
      (await listVisibleAllowedCodes(ctx, auth)).map((item) => item.code),
    );
    return records.filter((record) => visible.has(record.assignedCode));
  },
});

export const getGroupCalls = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const visible = await visibleCodeSet(ctx, auth);
    const calls = (
      await ctx.db.query("chat_group_calls").order("desc").take(50)
    ).filter((call) => codeIsVisible(visible, call.createdBy));
    return await Promise.all(
      calls.map(async (call) => {
        const group = await ctx.db.get(call.groupId);
        const creator = await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", call.createdBy))
          .unique();
        const participants = (
          await ctx.db
            .query("chat_group_call_participants")
            .withIndex("by_call", (q) => q.eq("groupCallId", call._id))
            .collect()
        ).filter((participant) => codeIsVisible(visible, participant.userId));
        return {
          ...call,
          title: group?.name ?? "__system_deleted_group__",
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
    const auth = await requireAdmin(ctx, args.password);
    const visible = await visibleCodeSet(ctx, auth);
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
          p2pCallIsVisible(visible, call) &&
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
            name:
              call.callerName ?? call.callerUserId ?? "__system_unknown_user__",
          },
          {
            code: call.calleeUserId ?? call.calleeCode ?? "-",
            name:
              call.calleeName ?? call.calleeUserId ?? "__system_unknown_user__",
          },
        ],
        startedAt: call.connectedAt ?? call.acceptedAt ?? call.createdAt,
      }));
    const groups = (
      await ctx.db.query("chat_group_calls").order("desc").take(100)
    ).filter(
      (call) =>
        codeIsVisible(visible, call.createdBy) &&
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
        ).filter(
          (item) =>
            item.status === "joined" && codeIsVisible(visible, item.userId),
        );
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
          groupName: group?.name ?? "__system_deleted_group__",
        };
      }),
    );
    return [...p2p, ...groupRows].sort((a, b) => b.startedAt - a.startedAt);
  },
});

export const cleanupStaleCalls = mutation({
  args: { password: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const visible = await visibleCodeSet(ctx, auth);
    const now = Date.now();
    const cutoff = now - 120_000;
    let p2pEnded = 0;
    let groupsEnded = 0;
    for (const call of await ctx.db.query("live_calls").collect()) {
      if (
        p2pCallIsVisible(visible, call) &&
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
        codeIsVisible(visible, call.createdBy) &&
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
    const code = args.code.trim().toUpperCase();
    await assertAdminCanAccessCode(ctx, auth, code);
    const access = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (access?.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法删除总管理员。",
      });
    const record = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (record) await ctx.db.delete(record._id);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_owner", (q) => q.eq("ownerCode", code))
      .collect();
    for (const c of contacts) await ctx.db.delete(c._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "user.delete",
      targetType: "auth_code",
      targetId: code,
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
    const auth = await requireAdmin(ctx, args.password);
    const record = await ctx.db.get(args.caseId);
    if (!record)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到案件。" });
    await assertAdminCanAccessCode(ctx, auth, record.assignedCode);
    await ctx.db.patch(args.caseId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const deleteCaseAdmin = mutation({
  args: { password: v.string(), caseId: v.id("cases") },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const record = await ctx.db.get(args.caseId);
    if (!record)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到案件。" });
    await assertAdminCanAccessCode(ctx, auth, record.assignedCode);
    await ctx.db.delete(args.caseId);
  },
});

export const endGroupCallAdmin = mutation({
  args: { password: v.string(), callId: v.id("group_calls") },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const record = await ctx.db.get(args.callId);
    if (!record)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到群组通话。",
      });
    await assertAdminCanAccessCode(ctx, auth, record.createdByCode);
    await ctx.db.patch(args.callId, { isActive: false });
  },
});

export const getStats = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const users = await ctx.db.query("auth_codes").collect();
    const visibleUsers = await visibleCodeSet(ctx, auth, true);
    const visibleAll = await visibleCodeSet(ctx, auth);
    const contacts = (await ctx.db.query("contacts").collect()).filter(
      (record) =>
        codeIsVisible(visibleAll, record.ownerCode) &&
        codeIsVisible(visibleAll, record.targetCode),
    );
    const messages = (await ctx.db.query("messages").collect()).filter(
      (record) => messageIsVisible(visibleAll, record),
    );
    const cases = (await ctx.db.query("cases").collect()).filter((record) =>
      codeIsVisible(visibleAll, record.assignedCode),
    );
    const activeCalls = (
      await ctx.db.query("chat_group_calls").collect()
    ).filter((record) => codeIsVisible(visibleAll, record.createdBy));
    const p2pCalls = (await ctx.db.query("live_calls").collect()).filter(
      (record) => p2pCallIsVisible(visibleAll, record),
    );
    const openCases = cases.filter((c) => c.status === "open").length;
    const inProgressCases = cases.filter(
      (c) => c.status === "in_progress",
    ).length;
    return {
      totalUsers: users.filter((item) => codeIsVisible(visibleUsers, item.code))
        .length,
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
