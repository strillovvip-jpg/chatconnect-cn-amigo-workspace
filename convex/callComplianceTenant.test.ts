import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

async function setupTenantCalls() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const account of [
      {
        code: "RAVE",
        deviceId: "nyfbi-admin-device",
        role: "super_admin" as const,
        companyId: "nyfbi",
      },
      {
        code: "RAVE1",
        deviceId: "aichijp-admin-device",
        role: "super_admin" as const,
        companyId: "aichijp",
      },
      {
        code: "LEGACY",
        deviceId: "legacy-admin-device",
        role: "super_admin" as const,
        companyId: undefined,
      },
      {
        code: "NYONE",
        deviceId: "ny-one-device",
        role: "user" as const,
        companyId: undefined,
      },
      {
        code: "NYTWO",
        deviceId: "ny-two-device",
        role: "user" as const,
        companyId: undefined,
      },
      {
        code: "AIONE",
        deviceId: "ai-one-device",
        role: "user" as const,
        companyId: "aichijp",
      },
      {
        code: "AITWO",
        deviceId: "ai-two-device",
        role: "user" as const,
        companyId: "aichijp",
      },
    ]) {
      await ctx.db.insert("allowed_codes", {
        code: account.code,
        role: account.role,
        companyId: account.companyId,
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code: account.code,
        deviceId: account.deviceId,
        name: account.code,
        usedAt: new Date(now).toISOString(),
      });
    }

    for (const call of [
      { callId: "ny-p2p", participants: ["NYONE", "NYTWO"] },
      { callId: "ai-p2p", participants: ["AIONE", "AITWO"] },
    ]) {
      await ctx.db.insert("live_calls", {
        callId: call.callId,
        roomName: `${call.callId}-room`,
        type: "video",
        status: "active",
        participantCodes: call.participants,
        createdByCode: call.participants[0],
        createdAt: now,
      });
    }

    for (const group of [
      {
        callId: "ny-group",
        owner: "NYONE",
        tenantId: "nyfbi",
        participants: ["NYONE", "NYTWO"],
      },
      {
        callId: "ai-group",
        owner: "AIONE",
        tenantId: "aichijp",
        participants: ["AIONE", "AITWO"],
      },
    ]) {
      const groupId = await ctx.db.insert("chat_groups", {
        name: group.callId,
        ownerUserId: group.owner,
        tenantId: group.tenantId,
        maxMembers: 10,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const groupCallId = await ctx.db.insert("chat_group_calls", {
        groupId,
        callId: group.callId,
        roomName: `${group.callId}-room`,
        type: "video",
        status: "active",
        createdBy: group.owner,
        startedAt: now,
        maxParticipants: 10,
      });
      for (const participant of group.participants) {
        await ctx.db.insert("chat_group_call_participants", {
          groupCallId,
          userId: participant,
          status: "joined",
          joinedAt: now,
          isHost: participant === group.owner,
        });
      }
    }
  });
  return t;
}

async function insertCompliance(
  t: Awaited<ReturnType<typeof setupTenantCalls>>,
  callId: string,
  participantCodes: string[],
  status: "requested" | "active",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("call_compliance", {
      callId,
      participantCodes,
      consentedCodes: status === "active" ? participantCodes : [],
      declinedCodes: [],
      status,
      requestedBy: participantCodes[0],
      requestedAt: Date.now(),
      activatedAt: status === "active" ? Date.now() : undefined,
      translationEnabled: false,
    });
  });
}

describe("tenant-scoped call compliance", () => {
  test("RAVE and RAVE1 request compliance only for their own P2P calls", async () => {
    const t = await setupTenantCalls();

    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ny-p2p",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ai-p2p",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ai-p2p",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ny-p2p",
      }),
    ).rejects.toThrow();
  });

  test("RAVE and RAVE1 request compliance only for their own group calls", async () => {
    const t = await setupTenantCalls();

    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ny-group",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ai-group",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ai-group",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ny-group",
      }),
    ).rejects.toThrow();
  });

  test("scoped administrators cannot stop another tenant's compliance session", async () => {
    const t = await setupTenantCalls();
    await insertCompliance(t, "ny-p2p", ["NYONE", "NYTWO"], "requested");
    await insertCompliance(t, "ai-p2p", ["AIONE", "AITWO"], "requested");

    await expect(
      t.mutation(api.callCompliance.stop, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ny-p2p",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.stop, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ny-p2p",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.stop, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ai-p2p",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.stop, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ai-p2p",
      }),
    ).resolves.toBeNull();
  });

  test("scoped administrators cannot change translation for another tenant", async () => {
    const t = await setupTenantCalls();
    await insertCompliance(t, "ny-group", ["NYONE", "NYTWO"], "active");
    await insertCompliance(t, "ai-group", ["AIONE", "AITWO"], "active");

    await expect(
      t.mutation(api.callCompliance.setTranslation, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ny-group",
        enabled: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.setTranslation, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ny-group",
        enabled: true,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.setTranslation, {
        password: "RAVE:nyfbi-admin-device",
        callId: "ai-group",
        enabled: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.setTranslation, {
        password: "RAVE1:aichijp-admin-device",
        callId: "ai-group",
        enabled: true,
      }),
    ).resolves.toBeNull();
  });

  test("each scoped administrator dashboard returns only its own tenant", async () => {
    const t = await setupTenantCalls();
    await insertCompliance(t, "ny-p2p", ["NYONE", "NYTWO"], "requested");
    await insertCompliance(t, "ai-group", ["AIONE", "AITWO"], "active");

    const [nySessions, aiSessions] = await Promise.all([
      t.query(api.callCompliance.adminDashboard, {
        password: "RAVE:nyfbi-admin-device",
      }),
      t.query(api.callCompliance.adminDashboard, {
        password: "RAVE1:aichijp-admin-device",
      }),
    ]);

    expect(nySessions.map((item) => item.callId)).toEqual(["ny-p2p"]);
    expect(aiSessions.map((item) => item.callId)).toEqual(["ai-group"]);
  });

  test("a true legacy global administrator retains cross-tenant access", async () => {
    const t = await setupTenantCalls();
    await insertCompliance(t, "ny-p2p", ["NYONE", "NYTWO"], "requested");
    await insertCompliance(t, "ai-p2p", ["AIONE", "AITWO"], "requested");

    const sessions = await t.query(api.callCompliance.adminDashboard, {
      password: "LEGACY:legacy-admin-device",
    });

    expect(sessions.map((item) => item.callId).sort()).toEqual([
      "ai-p2p",
      "ny-p2p",
    ]);
  });
});
