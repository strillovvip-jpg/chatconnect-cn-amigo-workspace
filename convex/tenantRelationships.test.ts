import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

const fullFeatures = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: true,
};

async function setupTenantUsers() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("license_profiles", {
      name: "Tenant relationship features",
      features: fullFeatures,
      createdBy: "AIOWN",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const user of [
      {
        code: "AIOWN",
        deviceId: "device-ai-owner",
        name: "Aichijp Owner",
        companyId: "aichijp",
      },
      {
        code: "AIMEM",
        deviceId: "device-ai-member",
        name: "Aichijp Member",
        companyId: "aichijp",
      },
      {
        code: "NYUSR",
        deviceId: "device-ny-user",
        name: "Nyfbi User",
        companyId: "nyfbi",
      },
    ] as const) {
      await ctx.db.insert("auth_codes", {
        code: user.code,
        deviceId: user.deviceId,
        name: user.name,
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: user.code,
        role: "user",
        enabled: true,
        companyId: user.companyId,
        licenseProfileId: profileId,
      });
    }
  });
  return t;
}

async function moveUserToNyfbi(
  t: Awaited<ReturnType<typeof setupTenantUsers>>,
  code: string,
) {
  await t.run(async (ctx) => {
    const allowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!allowed) throw new Error(`Missing fixture code ${code}`);
    await ctx.db.patch(allowed._id, { companyId: "nyfbi" });
  });
}

describe("runtime tenant enforcement for existing direct relationships", () => {
  test("a legacy contact disappears when the recipient moves to another tenant", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("contacts", {
        ownerCode: "AIOWN",
        targetCode: "AIMEM",
        targetName: "Aichijp Member",
        addedAt: new Date().toISOString(),
      });
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.query(api.contacts.getContacts, {
        ownerCode: "AIOWN",
        deviceId: "device-ai-owner",
      }),
    ).resolves.toEqual([]);
  });

  test("a legacy contact cannot authorize message reads or sends after tenant reassignment", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("contacts", {
        ownerCode: "AIOWN",
        targetCode: "AIMEM",
        targetName: "Aichijp Member",
        addedAt: new Date().toISOString(),
      });
      await ctx.db.insert("messages", {
        roomId: "AIMEM:AIOWN",
        senderCode: "AIOWN",
        senderName: "Aichijp Owner",
        type: "text",
        text: "Existing private message",
        sentAt: new Date().toISOString(),
      });
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.query(api.messages.listMessages, {
        myCode: "AIOWN",
        theirCode: "AIMEM",
        deviceId: "device-ai-owner",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.messages.sendText, {
        myCode: "AIOWN",
        myName: "Ignored client name",
        theirCode: "AIMEM",
        deviceId: "device-ai-owner",
        text: "This must not cross tenants",
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("messages").collect()).toHaveLength(1);
      expect(await ctx.db.query("notifications").collect()).toHaveLength(0);
    });
  });
});

describe("runtime tenant enforcement for existing one-to-one calls", () => {
  test("a reassigned callee cannot see or answer its former tenant call", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "tenant-reassigned-ringing-call",
        roomName: "tenant-reassigned-ringing-room",
        type: "video",
        status: "ringing",
        participantCodes: ["AIOWN", "AIMEM"],
        createdByCode: "AIOWN",
        callerUserId: "AIOWN",
        calleeUserId: "AIMEM",
        callerName: "Aichijp Owner",
        calleeName: "Aichijp Member",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      });
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.query(api.callState.incomingCall, {
        code: "AIMEM",
        deviceId: "device-ai-member",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callState.respondIncomingCall, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        callId: "tenant-reassigned-ringing-call",
        accept: true,
      }),
    ).rejects.toThrow();
  });

  test("tenant reassignment hides call history and status from both former participants", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "tenant-reassigned-connected-call",
        roomName: "tenant-reassigned-connected-room",
        type: "video",
        status: "accepted",
        participantCodes: ["AIOWN", "AIMEM"],
        createdByCode: "AIOWN",
        callerUserId: "AIOWN",
        calleeUserId: "AIMEM",
        callerName: "Aichijp Owner",
        calleeName: "Aichijp Member",
        acceptedAt: Date.now(),
        createdAt: Date.now(),
      });
    });
    await moveUserToNyfbi(t, "AIMEM");

    for (const user of [
      { code: "AIOWN", deviceId: "device-ai-owner" },
      { code: "AIMEM", deviceId: "device-ai-member" },
    ]) {
      await expect(t.query(api.callState.callHistory, user)).resolves.toEqual(
        [],
      );
      await expect(
        t.query(api.callState.callStatus, {
          ...user,
          callId: "tenant-reassigned-connected-call",
        }),
      ).resolves.toBeNull();
    }
  });

  test("tenant reassignment prevents either former participant from joining the call", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "tenant-reassigned-join-call",
        roomName: "tenant-reassigned-join-room",
        type: "video",
        status: "accepted",
        participantCodes: ["AIOWN", "AIMEM"],
        createdByCode: "AIOWN",
        callerUserId: "AIOWN",
        calleeUserId: "AIMEM",
        callerName: "Aichijp Owner",
        calleeName: "Aichijp Member",
        acceptedAt: Date.now(),
        createdAt: Date.now(),
      });
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.mutation(api.callState.authorizeOutgoingJoin, {
        code: "AIOWN",
        deviceId: "device-ai-owner",
        callId: "tenant-reassigned-join-call",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callState.authorizeIncomingJoin, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        callId: "tenant-reassigned-join-call",
      }),
    ).rejects.toThrow();
  });

  test("a call transfer cannot target a user from another tenant", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "same-tenant-connected-call",
        roomName: "same-tenant-connected-room",
        type: "video",
        status: "connected",
        participantCodes: ["AIOWN", "AIMEM"],
        createdByCode: "AIOWN",
        callerUserId: "AIOWN",
        calleeUserId: "AIMEM",
        callerName: "Aichijp Owner",
        calleeName: "Aichijp Member",
        connectedAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("user_presence", {
        userId: "NYUSR",
        lastSeenAt: Date.now(),
        online: true,
      });
    });

    await expect(
      t.mutation(api.callState.initiateTransfer, {
        code: "AIOWN",
        deviceId: "device-ai-owner",
        callId: "same-tenant-connected-call",
        targetCode: "NYUSR",
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("call_transfers").collect()).toEqual([]);
      expect(await ctx.db.query("notifications").collect()).toEqual([]);
    });
  });

  test("a pending transfer becomes inaccessible when its target changes tenant", async () => {
    const t = await setupTenantUsers();
    await t.run(async (ctx) => {
      const targetAllowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "NYUSR"))
        .unique();
      if (!targetAllowed) throw new Error("Missing NYUSR fixture");
      await ctx.db.patch(targetAllowed._id, { companyId: "aichijp" });
      await ctx.db.insert("live_calls", {
        callId: "pending-transfer-call",
        roomName: "pending-transfer-room",
        type: "video",
        status: "connected",
        participantCodes: ["AIOWN", "AIMEM"],
        createdByCode: "AIOWN",
        callerUserId: "AIOWN",
        calleeUserId: "AIMEM",
        createdAt: Date.now(),
      });
      await ctx.db.insert("call_transfers", {
        callId: "pending-transfer-call",
        roomName: "pending-transfer-room",
        fromUserId: "AIOWN",
        remoteUserId: "AIMEM",
        targetUserId: "NYUSR",
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
    });
    await moveUserToNyfbi(t, "NYUSR");

    await expect(
      t.query(api.callState.pendingTransfer, {
        code: "NYUSR",
        deviceId: "device-ny-user",
      }),
    ).resolves.toBeNull();

    const transferId = await t.run(async (ctx) => {
      const transfer = await ctx.db.query("call_transfers").unique();
      if (!transfer) throw new Error("Missing transfer fixture");
      return transfer._id;
    });
    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "NYUSR",
        deviceId: "device-ny-user",
        transferId,
        accept: true,
      }),
    ).rejects.toThrow();
  });
});

describe("runtime tenant enforcement for existing groups", () => {
  test("new groups persist the creator's tenant", async () => {
    const t = await setupTenantUsers();

    const groupId = await t.mutation(api.groups.create, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      name: "Aichijp Group",
      memberCodes: ["AIMEM"],
    });

    await t.run(async (ctx) => {
      await expect(ctx.db.get(groupId)).resolves.toMatchObject({
        tenantId: "aichijp",
      });
    });
  });

  test("a legacy group's owner tenant gates access and hides foreign member data", async () => {
    const t = await setupTenantUsers();
    const groupId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("chat_groups", {
        name: "Legacy Aichijp Group",
        ownerUserId: "AIOWN",
        maxMembers: 20,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      for (const [userId, role] of [
        ["AIOWN", "owner"],
        ["AIMEM", "member"],
        ["NYUSR", "member"],
      ] as const) {
        await ctx.db.insert("chat_group_members", {
          groupId: id,
          userId,
          role,
          joinedAt: Date.now(),
          status: "active",
        });
      }
      return id;
    });

    const visible = await t.query(api.groups.get, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      groupId,
    });
    expect(visible.members.map((member) => member.userId).sort()).toEqual([
      "AIMEM",
      "AIOWN",
    ]);
    await expect(
      t.query(api.groups.get, {
        code: "NYUSR",
        deviceId: "device-ny-user",
        groupId,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "NYUSR",
        deviceId: "device-ny-user",
        groupId,
        type: "text",
        text: "Forged legacy membership",
      }),
    ).rejects.toThrow();
  });

  test("a reassigned member cannot read, write, or join its former tenant group", async () => {
    const t = await setupTenantUsers();
    const groupId = await t.mutation(api.groups.create, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      name: "Aichijp Group",
      memberCodes: ["AIMEM"],
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.query(api.groups.messages, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        groupId,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        groupId,
        type: "text",
        text: "Cross-tenant message",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.groupCallState.createCall, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        groupId,
        type: "video",
      }),
    ).rejects.toThrow();
  });

  test("group calls exclude members whose current tenant no longer matches the group", async () => {
    const t = await setupTenantUsers();
    const groupId = await t.mutation(api.groups.create, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      name: "Aichijp Group",
      memberCodes: ["AIMEM"],
    });
    await moveUserToNyfbi(t, "AIMEM");

    const call = await t.mutation(api.groupCallState.createCall, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      groupId,
      type: "video",
    });

    await t.run(async (ctx) => {
      const participants = await ctx.db
        .query("chat_group_call_participants")
        .withIndex("by_call", (q) => q.eq("groupCallId", call.groupCallId))
        .collect();
      expect(participants.map((participant) => participant.userId)).toEqual([
        "AIOWN",
      ]);
      expect(
        (await ctx.db.query("notifications").collect()).some(
          (notification) =>
            notification.userId === "AIMEM" &&
            notification.type === "group_video_invite",
        ),
      ).toBe(false);
    });
  });

  test("an existing group-call invitation stops being visible after tenant reassignment", async () => {
    const t = await setupTenantUsers();
    const groupId = await t.mutation(api.groups.create, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      name: "Aichijp Group",
      memberCodes: ["AIMEM"],
    });
    const call = await t.mutation(api.groupCallState.createCall, {
      code: "AIOWN",
      deviceId: "device-ai-owner",
      groupId,
      type: "video",
    });
    await moveUserToNyfbi(t, "AIMEM");

    await expect(
      t.query(api.groupCallState.incoming, {
        code: "AIMEM",
        deviceId: "device-ai-member",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.groupCallState.authorizeJoin, {
        code: "AIMEM",
        deviceId: "device-ai-member",
        groupCallId: call.groupCallId,
      }),
    ).rejects.toThrow();
  });
});
