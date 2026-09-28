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

async function setup() {
  const t = convexTest({ schema, modules });
  const profileId = await t.run(async (ctx) =>
    ctx.db.insert("license_profiles", {
      name: "Full features",
      features: fullFeatures,
      createdBy: "ROOT1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    for (const [code, deviceId, name, role] of [
      ["ROOT1", "root-device", "Root", "super_admin"],
      ["USERB", "user-device", "User B", "user"],
    ] as const) {
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        name,
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code,
        role,
        enabled: true,
        licenseProfileId: profileId,
      });
    }
  });
  return t;
}

describe("system-owned call fallbacks", () => {
  test("admin call queries return locale-neutral system sentinels", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("chat_groups", {
        name: "Temporary group",
        ownerUserId: "ROOT1",
        maxMembers: 4,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const groupCallId = await ctx.db.insert("chat_group_calls", {
        groupId,
        callId: "group-call",
        roomName: "group-room",
        type: "video",
        status: "active",
        createdBy: "ROOT1",
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        maxParticipants: 4,
      });
      await ctx.db.insert("chat_group_call_participants", {
        groupCallId,
        userId: "ROOT1",
        status: "joined",
        joinedAt: Date.now(),
        isHost: true,
      });
      await ctx.db.delete(groupId);
      await ctx.db.insert("live_calls", {
        callId: "unknown-participants",
        roomName: "p2p-room",
        type: "video",
        status: "active",
        participantCodes: [],
        createdByCode: "ROOT1",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const groupCalls = await t.query(api.admin.getGroupCalls, {
      password: "ROOT1:root-device",
    });
    expect(groupCalls[0]?.title).toBe("__system_deleted_group__");

    const activeCalls = await t.query(api.admin.getActiveCalls, {
      password: "ROOT1:root-device",
    });
    expect(
      activeCalls.find((call) => call.kind === "p2p")?.participants,
    ).toEqual([
      { code: "-", name: "__system_unknown_user__" },
      { code: "-", name: "__system_unknown_user__" },
    ]);
    expect(activeCalls.find((call) => call.kind === "group")?.groupName).toBe(
      "__system_deleted_group__",
    );
  });

  test("an incoming caller without identity uses a system sentinel", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "incoming-unknown",
        roomName: "incoming-room",
        type: "audio",
        status: "ringing",
        participantCodes: ["USERB"],
        createdByCode: "SYSTEM",
        calleeUserId: "USERB",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      });
    });

    const incoming = await t.query(api.callState.incomingCall, {
      code: "USERB",
      deviceId: "user-device",
    });
    expect(incoming?.callerName).toBe("__system_unknown_caller__");
  });

  test("missing group metadata uses system sentinels for invite and join", async () => {
    const t = await setup();
    const groupCallId = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("chat_groups", {
        name: "Temporary group",
        ownerUserId: "ROOT1",
        maxMembers: 4,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("chat_group_members", {
        groupId,
        userId: "USERB",
        role: "member",
        joinedAt: Date.now(),
        status: "active",
      });
      const callId = await ctx.db.insert("chat_group_calls", {
        groupId,
        callId: "missing-group-call",
        roomName: "missing-group-room",
        type: "video",
        status: "ringing",
        createdBy: "ROOT1",
        startedAt: Date.now(),
        maxParticipants: 4,
      });
      await ctx.db.insert("chat_group_call_participants", {
        groupCallId: callId,
        userId: "USERB",
        status: "ringing",
        isHost: false,
      });
      await ctx.db.delete(groupId);
      return callId;
    });

    const incoming = await t.query(api.groupCallState.incoming, {
      code: "USERB",
      deviceId: "user-device",
    });
    expect(incoming?.groupName).toBe("__system_group__");

    const joined = await t.mutation(api.groupCallState.authorizeJoin, {
      code: "USERB",
      deviceId: "user-device",
      groupCallId,
    });
    expect(joined.groupName).toBe("__system_group_call__");
  });
});
