import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

async function setupTenantFixtures() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    for (const access of [
      {
        code: "RAVE",
        role: "super_admin" as const,
        companyId: " NyFbI ",
      },
      {
        code: "RAVE1",
        role: "super_admin" as const,
        companyId: " AICHIJP ",
      },
      { code: "AIADM", role: "admin" as const, companyId: "aichijp" },
      { code: "NY001", role: "user" as const },
      { code: "NY002", role: "user" as const },
      { code: "AI001", role: "user" as const, companyId: "AichiJp" },
      { code: "AI002", role: "user" as const, companyId: "aichijp" },
    ]) {
      await ctx.db.insert("allowed_codes", { ...access, enabled: true });
    }
    for (const session of [
      { code: "RAVE", deviceId: "ny-admin-device" },
      { code: "RAVE1", deviceId: "ai-admin-device" },
      { code: "AIADM", deviceId: "ai-admin-2-device" },
      { code: "NY001", deviceId: "ny-user-device" },
      { code: "AI001", deviceId: "ai-user-device" },
    ]) {
      await ctx.db.insert("auth_codes", {
        ...session,
        name: session.code,
        usedAt: new Date(now).toISOString(),
      });
    }

    const nyGroup = await ctx.db.insert("chat_groups", {
      name: "NY group",
      ownerUserId: "NY001",
      maxMembers: 10,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const aiGroup = await ctx.db.insert("chat_groups", {
      name: "AI group",
      ownerUserId: "AI001",
      maxMembers: 10,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const nyGroupCall = await ctx.db.insert("chat_group_calls", {
      groupId: nyGroup,
      callId: "ny-group-call",
      roomName: "ny-group-room",
      type: "video",
      status: "active",
      createdBy: "NY001",
      startedAt: now,
      lastActivityAt: now,
      maxParticipants: 10,
    });
    const aiGroupCall = await ctx.db.insert("chat_group_calls", {
      groupId: aiGroup,
      callId: "ai-group-call",
      roomName: "ai-group-room",
      type: "video",
      status: "active",
      createdBy: "AI001",
      startedAt: now,
      lastActivityAt: now,
      maxParticipants: 10,
    });
    await ctx.db.insert("chat_group_call_participants", {
      groupCallId: nyGroupCall,
      userId: "NY001",
      status: "joined",
      joinedAt: now,
      isHost: true,
    });
    await ctx.db.insert("chat_group_call_participants", {
      groupCallId: aiGroupCall,
      userId: "AI001",
      status: "joined",
      joinedAt: now,
      isHost: true,
    });
    for (const call of [
      { prefix: "ny", user: "NY001" },
      { prefix: "ai", user: "AI001" },
    ]) {
      await ctx.db.insert("live_calls", {
        callId: `${call.prefix}-live-call`,
        roomName: `${call.prefix}-live-room`,
        type: "video",
        status: "active",
        participantCodes: [call.user],
        createdByCode: call.user,
        callerUserId: call.user,
        calleeUserId: call.user,
        createdAt: now,
        lastActivityAt: now,
      });
      await ctx.db.insert("live_calls", {
        callId: `${call.prefix}-stale-call`,
        roomName: `${call.prefix}-stale-room`,
        type: "audio",
        status: "connected",
        participantCodes: [call.user],
        createdByCode: call.user,
        callerUserId: call.user,
        calleeUserId: call.user,
        createdAt: now - 300_000,
        lastActivityAt: now - 300_000,
      });
    }

    for (const tenant of [
      { prefix: "ny", user: "NY001" },
      { prefix: "ai", user: "AI001" },
    ]) {
      await ctx.db.insert("contacts", {
        ownerCode: tenant.user,
        targetCode: `${tenant.prefix.toUpperCase()}002`,
        targetName: `${tenant.prefix} contact`,
        addedAt: new Date(now).toISOString(),
      });
      await ctx.db.insert("messages", {
        roomId: `${tenant.prefix}-room`,
        senderCode: tenant.user,
        senderName: tenant.user,
        type: "text",
        text: `${tenant.prefix} message`,
        sentAt: new Date(now).toISOString(),
      });
    }
    const nyCase = await ctx.db.insert("cases", {
      caseNumber: "NY-CASE",
      title: "NY case",
      status: "open",
      priority: "medium",
      category: "fixture",
      description: "fixture",
      assignedCode: "NY001",
      assignedName: "NY001",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    const aiCase = await ctx.db.insert("cases", {
      caseNumber: "AI-CASE",
      title: "AI case",
      status: "in_progress",
      priority: "medium",
      category: "fixture",
      description: "fixture",
      assignedCode: "AI001",
      assignedName: "AI001",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    const nyStorage = await ctx.storage.store(new Blob(["ny document"]));
    const aiStorage = await ctx.storage.store(new Blob(["ai document"]));
    const nyDocument = await ctx.db.insert("case_documents", {
      caseNumber: "NY-CASE",
      fileName: "ny.pdf",
      storageId: nyStorage,
      uploadedByCode: "RAVE",
      uploadedByName: "RAVE",
      uploadedAt: new Date(now).toISOString(),
    });
    const aiDocument = await ctx.db.insert("case_documents", {
      caseNumber: "AI-CASE",
      fileName: "ai.pdf",
      storageId: aiStorage,
      uploadedByCode: "RAVE1",
      uploadedByName: "RAVE1",
      uploadedAt: new Date(now).toISOString(),
    });
    return { nyCase, aiCase, nyDocument, aiDocument };
  });
  return { t, ids };
}

describe("tenant-scoped administration", () => {
  test("a scoped administrator can still see cases created by that administrator", async () => {
    const { t } = await setupTenantFixtures();
    await t.run(async (ctx) => {
      await ctx.db.insert("cases", {
        caseNumber: "AI-ADMIN-CASE",
        title: "Admin-created case",
        status: "open",
        priority: "medium",
        category: "fixture",
        description: "fixture",
        assignedCode: "RAVE1",
        assignedName: "RAVE1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const cases = await t.query(api.admin.getAllCases, {
      password: "RAVE1:ai-admin-device",
    });

    expect(cases.map((record) => record.caseNumber)).toContain("AI-ADMIN-CASE");
  });

  test("legacy cross-tenant relationships never leak through scoped admin views", async () => {
    const { t } = await setupTenantFixtures();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("contacts", {
        ownerCode: "AI001",
        targetCode: "NY001",
        targetName: "legacy cross-tenant contact",
        addedAt: new Date(now).toISOString(),
      });
      await ctx.db.insert("messages", {
        roomId: "AI001:NY001",
        senderCode: "AI001",
        senderName: "AI001",
        type: "text",
        text: "legacy cross-tenant message",
        sentAt: new Date(now).toISOString(),
      });
      await ctx.db.insert("live_calls", {
        callId: "legacy-cross-tenant-call",
        roomName: "legacy-cross-tenant-room",
        type: "video",
        status: "active",
        participantCodes: ["AI001", "NY001"],
        createdByCode: "AI001",
        callerUserId: "AI001",
        calleeUserId: "NY001",
        createdAt: now,
        lastActivityAt: now,
      });
    });

    const password = "RAVE1:ai-admin-device";
    const [contacts, messages, calls, stats] = await Promise.all([
      t.query(api.admin.getAllContacts, { password }),
      t.query(api.admin.getAllMessages, { password }),
      t.query(api.admin.getActiveCalls, { password }),
      t.query(api.admin.getStats, { password }),
    ]);

    expect(contacts.some((record) => record.targetCode === "NY001")).toBe(
      false,
    );
    expect(messages.some((record) => record.roomId === "AI001:NY001")).toBe(
      false,
    );
    expect(
      calls.some((record) => record.id === "legacy-cross-tenant-call"),
    ).toBe(false);
    expect(stats.totalContacts).toBe(1);
    expect(stats.totalMessages).toBe(1);
    expect(stats.activeGroupCalls).toBe(3);
  });

  test("RAVE and RAVE1 list only calls and stats from their normalized tenant", async () => {
    const { t } = await setupTenantFixtures();

    const [nyGroups, aiGroups, nyCalls, aiCalls, nyStats, aiStats] =
      await Promise.all([
        t.query(api.admin.getGroupCalls, {
          password: "RAVE:ny-admin-device",
        }),
        t.query(api.admin.getGroupCalls, {
          password: "RAVE1:ai-admin-device",
        }),
        t.query(api.admin.getActiveCalls, {
          password: "RAVE:ny-admin-device",
        }),
        t.query(api.admin.getActiveCalls, {
          password: "RAVE1:ai-admin-device",
        }),
        t.query(api.admin.getStats, { password: "RAVE:ny-admin-device" }),
        t.query(api.admin.getStats, {
          password: "RAVE1:ai-admin-device",
        }),
      ]);

    expect(nyGroups.map((call) => call.callId)).toEqual(["ny-group-call"]);
    expect(aiGroups.map((call) => call.callId)).toEqual(["ai-group-call"]);
    expect(nyCalls.map((call) => call.id).sort()).toEqual([
      "ny-group-call",
      "ny-live-call",
    ]);
    expect(aiCalls.map((call) => call.id).sort()).toEqual([
      "ai-group-call",
      "ai-live-call",
    ]);
    expect(nyStats).toEqual({
      totalUsers: 1,
      totalContacts: 1,
      totalMessages: 1,
      totalCases: 1,
      openCases: 1,
      inProgressCases: 0,
      activeGroupCalls: 3,
    });
    expect(aiStats).toEqual({
      totalUsers: 1,
      totalContacts: 1,
      totalMessages: 1,
      totalCases: 1,
      openCases: 0,
      inProgressCases: 1,
      activeGroupCalls: 3,
    });
  });

  test("admin cleanup and destructive mutations cannot affect another tenant", async () => {
    const { t, ids } = await setupTenantFixtures();

    await expect(
      t.mutation(api.admin.deleteUser, {
        password: "RAVE1:ai-admin-device",
        code: "NY001",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.admin.updateCaseStatusAdmin, {
        password: "RAVE1:ai-admin-device",
        caseId: ids.nyCase,
        status: "closed",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.admin.deleteCaseAdmin, {
        password: "RAVE1:ai-admin-device",
        caseId: ids.nyCase,
      }),
    ).rejects.toThrow();

    expect(
      await t.mutation(api.admin.cleanupStaleCalls, {
        password: "RAVE1:ai-admin-device",
      }),
    ).toEqual({ p2pEnded: 1, groupsEnded: 0 });

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", "NY001"))
          .unique(),
      ).not.toBeNull();
      expect(await ctx.db.get(ids.nyCase)).toMatchObject({ status: "open" });
      expect(await ctx.db.get(ids.aiCase)).toMatchObject({
        status: "in_progress",
      });
      const nyStale = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", "ny-stale-call"))
        .unique();
      const aiStale = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", "ai-stale-call"))
        .unique();
      expect(nyStale?.status).toBe("connected");
      expect(aiStale?.status).toBe("failed");
    });
  });

  test("document administration, shares, and broadcasts stay within the sender tenant", async () => {
    const { t, ids } = await setupTenantFixtures();

    const aiDocuments = await t.query(api.caseDocuments.listAll, {
      password: "RAVE1:ai-admin-device",
    });
    expect(aiDocuments.map((doc) => doc.fileName)).toEqual(["ai.pdf"]);
    await expect(
      t.mutation(api.caseDocuments.deleteDocument, {
        password: "RAVE1:ai-admin-device",
        documentId: ids.nyDocument,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.notifications.shareResource, {
        code: "RAVE1",
        deviceId: "ai-admin-device",
        targetCode: "RAVE",
        kind: "case",
        resourceId: String(ids.nyCase),
        title: "NY case",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.notifications.announce, {
        code: "RAVE1",
        deviceId: "ai-admin-device",
        targetCode: "NY001",
        title: "AI notice",
        message: "AI only",
        system: false,
        priority: "normal",
      }),
    ).rejects.toThrow();

    await t.mutation(api.notifications.shareResource, {
      code: "RAVE1",
      deviceId: "ai-admin-device",
      targetCode: "AIADM",
      kind: "case",
      resourceId: String(ids.aiCase),
      title: "AI case",
    });
    await t.mutation(api.notifications.announce, {
      code: "RAVE1",
      deviceId: "ai-admin-device",
      title: "AI notice",
      message: "AI only",
      system: false,
      priority: "normal",
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.nyDocument)).not.toBeNull();
      const records = await ctx.db.query("notifications").collect();
      expect(
        records
          .filter((record) => record.type === "admin_announcement")
          .map((record) => record.userId)
          .sort(),
      ).toEqual(["AI001", "AIADM", "RAVE1"]);
      expect(records.filter((record) => record.type === "case_shared")).toEqual(
        [
          expect.objectContaining({
            userId: "AIADM",
            data: expect.objectContaining({ sourceUserId: "RAVE1" }),
          }),
        ],
      );
    });
  });
});
