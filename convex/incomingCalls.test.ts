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

async function setup(options?: {
  callerFeatures?: Partial<typeof fullFeatures>;
  calleeFeatures?: Partial<typeof fullFeatures>;
  callerHasCalleeContact?: boolean;
}) {
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
    const callerProfileId = options?.callerFeatures
      ? await ctx.db.insert("license_profiles", {
          name: "Caller feature override",
          features: { ...fullFeatures, ...options.callerFeatures },
          createdBy: "AAAAA",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      : profileId;
    const calleeProfileId = options?.calleeFeatures
      ? await ctx.db.insert("license_profiles", {
          name: "Callee feature override",
          features: { ...fullFeatures, ...options.calleeFeatures },
          createdBy: "BBBBB",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      : profileId;
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
        licenseProfileId: code === "AAAAA" ? callerProfileId : calleeProfileId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (options?.callerHasCalleeContact) {
      await ctx.db.insert("contacts", {
        ownerCode: "AAAAA",
        targetCode: "BBBBB",
        targetName: "Callee B",
        addedAt: new Date().toISOString(),
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
  test("face-swap mode is stored and exposed as caller-local media only", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
    });

    expect(created).toMatchObject({
      callerMediaMode: "face-swap",
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
    });
    const notification = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", "BBBBB").eq("status", "unread"),
        )
        .unique(),
    );
    expect(notification?.data).toMatchObject({
      callerMediaMode: "face-swap",
      remoteMediaMode: "face-swap",
    });
    expect(
      await t.query(api.callState.incomingCall, {
        code: "BBBBB",
        deviceId: "device-b",
      }),
    ).toMatchObject({
      localMediaMode: "camera",
      remoteMediaMode: "face-swap",
    });

    const accepted = await t.mutation(
      api.callState.acceptAndAuthorizeIncomingJoin,
      { code: "BBBBB", deviceId: "device-b", callId: created.callId },
    );
    expect(accepted).toMatchObject({
      localMediaMode: "camera",
      remoteMediaMode: "face-swap",
    });
    expect(
      await t.mutation(api.callState.authorizeOutgoingJoin, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
    });
  });

  test("face-swap calls require the callee to be a caller contact", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "BBBBB",
        callType: "video",
        callerMediaMode: "face-swap",
      }),
    ).rejects.toThrow("联系人");
  });

  test("the callee only needs ordinary video permission", async () => {
    const t = await setup({
      callerHasCalleeContact: true,
      calleeFeatures: {
        canAIFace: false,
        canVideoSource: false,
        canPlayVideo: false,
        canScreenShare: false,
        canTransferCall: false,
        canGroupCall: false,
        canPictureInPicture: false,
        canFloatingWindow: false,
        canFileSearch: false,
        canRecord: false,
      },
    });

    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    expect(created.localMediaMode).toBe("face-swap");

    const accepted = await t.mutation(
      api.callState.acceptAndAuthorizeIncomingJoin,
      { code: "BBBBB", deviceId: "device-b", callId: created.callId },
    );
    expect(accepted).toMatchObject({
      localMediaMode: "camera",
      remoteMediaMode: "face-swap",
    });
  });

  test.each([
    ["canAIFace", { canAIFace: false }],
    ["canVideoSource", { canVideoSource: false }],
  ] as const)(
    "face-swap calls require caller feature %s",
    async (_feature, callerFeatures) => {
      const t = await setup({
        callerHasCalleeContact: true,
        callerFeatures,
      });
      await expect(
        t.mutation(api.callState.prepareP2P, {
          code: "AAAAA",
          deviceId: "device-a",
          theirCode: "BBBBB",
          callType: "video",
          callerMediaMode: "face-swap",
        }),
      ).rejects.toThrow("此授权码无法使用该功能");
    },
  );

  test("face-swap calls reject a partial profile even when AI video flags are enabled", async () => {
    const t = await setup({
      callerHasCalleeContact: true,
      callerFeatures: { canTransferCall: false },
    });
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "BBBBB",
        callType: "video",
        callerMediaMode: "face-swap",
      }),
    ).rejects.toThrow("只有全功能授权码");
  });

  test("face-swap calls reject a custom profile without recording capability", async () => {
    const t = await setup({
      callerHasCalleeContact: true,
      callerFeatures: { canRecord: false },
    });
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "BBBBB",
        callType: "video",
        callerMediaMode: "face-swap",
      }),
    ).rejects.toThrow("只有全功能授权码");
  });

  test("audio calls reject face-swap mode", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "BBBBB",
        callType: "audio",
        callerMediaMode: "face-swap",
      }),
    ).rejects.toThrow("换脸模式仅支持视讯通话");
  });

  test("an existing ringing call cannot be reused with another media mode", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AAAAA",
        deviceId: "device-a",
        theirCode: "BBBBB",
        callType: "video",
        callerMediaMode: "camera",
      }),
    ).rejects.toThrow("已有不同媒体模式的通话");
  });

  test("an active call between the same contacts reuses its existing room", async () => {
    const t = await setup();
    const first = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });

    const retried = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });

    expect(retried.callId).toBe(first.callId);
    expect(retried.roomName).toBe(first.roomName);
  });

  test("a new call between the same contacts gets a different room", async () => {
    const t = await setup();
    const first = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });
    await t.mutation(api.callState.endP2PCall, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: first.callId,
    });

    const second = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
    });

    expect(second.callId).not.toBe(first.callId);
    expect(second.roomName).not.toBe(first.roomName);
    expect(second.roomName).toContain(second.callId);
  });

  test("face-swap permission is checked again before the caller joins", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AAAAA"))
        .unique();
      const profile = await ctx.db.get(allowed!.licenseProfileId!);
      await ctx.db.patch(profile!._id, {
        features: { ...profile!.features, canAIFace: false },
      });
    });

    await expect(
      t.mutation(api.callState.authorizeOutgoingJoin, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).rejects.toThrow("此授权码无法使用该功能");
  });

  test("the full-feature bundle is checked again before the caller joins", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AAAAA"))
        .unique();
      const profile = await ctx.db.get(allowed!.licenseProfileId!);
      await ctx.db.patch(profile!._id, {
        features: { ...profile!.features, canTransferCall: false },
      });
    });

    await expect(
      t.mutation(api.callState.authorizeOutgoingJoin, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).rejects.toThrow("只有全功能授权码");
  });

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

  test("face-swap calls cannot be transferred", async () => {
    const t = await setup({ callerHasCalleeContact: true });
    const created = await t.mutation(api.callState.prepareP2P, {
      code: "AAAAA",
      deviceId: "device-a",
      theirCode: "BBBBB",
      callType: "video",
      callerMediaMode: "face-swap",
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

    await expect(
      t.mutation(api.callState.initiateTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
        targetCode: "CCCCC",
      }),
    ).rejects.toThrow("换脸视讯暂不支持转接");

    expect(
      await t.query(api.callState.pendingTransfer, {
        code: "CCCCC",
        deviceId: "device-c",
      }),
    ).toBeNull();
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
