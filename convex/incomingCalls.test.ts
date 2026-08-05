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
      name: "测试全功能",
      features: fullFeatures,
      createdBy: "AAAAA",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code: "AAAAA",
      deviceId: "device-a",
      name: "Caller A",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "BBBBB",
      deviceId: "device-b",
      name: "Callee B",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "CCCCC",
      deviceId: "device-c",
      name: "Other C",
      usedAt: new Date().toISOString(),
    });
    for (const code of ["AAAAA", "BBBBB", "CCCCC"]) {
      await ctx.db.insert("allowed_codes", {
        code,
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    const now = Date.now();
    await ctx.db.insert("user_presence", {
      userId: "AAAAA",
      lastSeenAt: now,
      online: true,
      lastOnlineAt: now,
    });
    await ctx.db.insert("user_presence", {
      userId: "BBBBB",
      lastSeenAt: now,
      online: true,
      lastOnlineAt: now,
    });
    await ctx.db.insert("user_presence", {
      userId: "CCCCC",
      lastSeenAt: now,
      online: true,
      lastOnlineAt: now,
    });
  });
  return t;
}

describe("global incoming calls", () => {
  test("callee receives ringing and unrelated users cannot see it", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    const incoming = await t.query(api.callState.incomingCall, {
      code: "BBBBB",
      deviceId: "device-b",
    });
    const unrelated = await t.query(api.callState.incomingCall, {
      code: "CCCCC",
      deviceId: "device-c",
    });
    expect(incoming).toMatchObject({
      callId: created.callId,
      callerCode: "AAAAA",
      callerName: "Caller A",
      callType: "video",
    });
    expect(unrelated).toBeNull();
  });

  test("reject immediately removes callee notification and updates caller", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.respondIncomingCall, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
      accept: false,
    });
    expect(
      await t.query(api.callState.incomingCall, {
        code: "BBBBB",
        deviceId: "device-b",
      }),
    ).toBeNull();
    expect(
      await t.query(api.callState.outgoingCall, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "rejected" });
  });

  test("caller cancellation immediately removes callee notification", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "audio",
    });
    await t.mutation(api.callState.endP2PCall, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    expect(
      await t.query(api.callState.incomingCall, {
        code: "BBBBB",
        deviceId: "device-b",
      }),
    ).toBeNull();
    expect(
      await t.query(api.callState.outgoingCall, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "cancelled" });
  });

  test("callee acceptance keeps the call pending until both participants connect", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    const joined = await t.mutation(
      api.callState.acceptAndAuthorizeIncomingJoin,
      { code: "BBBBB", deviceId: "device-b", callId: created.callId },
    );
    expect(joined.roomName).toBe(created.roomName);
    expect(
      await t.query(api.callState.outgoingCall, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "accepted" });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    expect(
      await t.query(api.callState.outgoingCall, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "connecting" });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    expect(
      await t.query(api.callState.outgoingCall, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "connected" });
  });

  test("both participants observe a remote hangup while unrelated users cannot", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    await t.mutation(api.callState.endP2PCall, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    expect(
      await t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "ended" });
    expect(
      await t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).toBeNull();
  });

  test("a participant cannot create a second simultaneous call", async () => {
    const t = await setup();
    await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "CCCCC",
        callType: "audio",
      }),
    ).rejects.toThrow("您正在进行其他通话");
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "CCCCC",
        deviceId: "device-c",
        theirCode: "BBBBB",
        callType: "audio",
      }),
    ).rejects.toThrow("对方正在通话中");
  });

  test("a failed transfer join rolls back without replacing the original participants", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "CCCCC",
    });
    await t.mutation(api.callState.respondTransfer, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      accept: true,
    });
    await t.mutation(api.callState.failTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      reason: "media timeout",
    });
    expect(
      await t.query(api.callState.myOutgoingTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "failed" });
    expect(
      await t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).toMatchObject({ status: "connected" });
  });

  test("a transfer only replaces the sender after the target confirms joining", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "CCCCC",
    });
    await t.mutation(api.callState.respondTransfer, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      accept: true,
    });
    await t.mutation(api.callState.authorizeTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
    });
    expect(
      await t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ peerCode: "BBBBB" });
    await t.mutation(api.callState.confirmTransferJoined, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
    });
    expect(
      await t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toBeNull();
    expect(
      await t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).toMatchObject({
      status: "connected",
      peerCode: "CCCCC",
      peerName: "Other C",
    });
    expect(
      await t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).toMatchObject({
      status: "connected",
      peerCode: "BBBBB",
      peerName: "Callee B",
    });
  });

  test("a recently backgrounded mobile target can still receive a transfer", async () => {
    const t = await setup();
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    const presence = await t.run(async (ctx) =>
      ctx.db
        .query("user_presence")
        .withIndex("by_user", (q) => q.eq("userId", "CCCCC"))
        .unique(),
    );
    await t.run(async (ctx) =>
      ctx.db.patch(presence!._id, { online: false, lastSeenAt: Date.now() }),
    );
    await expect(
      t.mutation(api.callState.initiateTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
        targetCode: "CCCCC",
      }),
    ).resolves.toBeDefined();
  });
});
