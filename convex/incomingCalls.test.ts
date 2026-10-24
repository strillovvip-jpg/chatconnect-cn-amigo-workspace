import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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
      mobileDeviceId: "device-a-mobile",
      desktopDeviceId: "device-a",
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

  test("face-swap calls can be transferred to another authorization code", async () => {
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

    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "CCCCC",
    });

    expect(
      await t.query(api.callState.pendingTransfer, {
        code: "CCCCC",
        deviceId: "device-c",
      }),
    ).toMatchObject({ _id: transferId, targetUserId: "CCCCC" });
  });

  test.each(["ABCD", "CODE1"])(
    "rejects malformed transfer target %s before target discovery",
    async (targetCode) => {
      const t = await setup({ callerHasCalleeContact: true });
      await t.run(async (ctx) => {
        const profile = await ctx.db.query("license_profiles").first();
        if (!profile) throw new Error("Expected a license profile");
        await ctx.db.insert("auth_codes", {
          code: "CODE1",
          deviceId: "device-code-1",
          name: "Invalid-format existing target",
          usedAt: new Date().toISOString(),
        });
        await ctx.db.insert("allowed_codes", {
          code: "CODE1",
          role: "user",
          enabled: true,
          licenseProfileId: profile._id,
        });
        await ctx.db.insert("user_presence", {
          userId: "CODE1",
          lastSeenAt: Date.now(),
          online: true,
        });
      });
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
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      });
      await t.mutation(api.callState.markParticipantConnected, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      });

      await expect(
        t.mutation(api.callState.initiateTransfer, {
          code: "AAAAA",
          deviceId: "device-a",
          callId: created.callId,
          targetCode,
        }),
      ).rejects.toThrow(
        "Transfer target code must contain exactly five letters.",
      );
      await t.run(async (ctx) => {
        expect(await ctx.db.query("call_transfers").collect()).toEqual([]);
        expect(
          (await ctx.db.query("notifications").collect()).filter(
            (notification) => notification.type === "call_transfer",
          ),
        ).toEqual([]);
      });
    },
  );

  test("a transfer receiver is told when the remaining peer publishes face-swap video", async () => {
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
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      identities: ["AAAAA-browser", "AAAAA-face-swap-native"],
    });
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
      targetCode: "CCCCC",
    });
    await t.mutation(api.callState.respondTransfer, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      accept: true,
    });

    await expect(
      t.mutation(internal.callState.authorizeTransferJoin, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
        targetIdentity: "CCCCC-new-mobile",
      }),
    ).resolves.toMatchObject({
      remoteUserId: "AAAAA",
      remoteMediaMode: "face-swap",
      remotePublisherIdentities: ["AAAAA-browser", "AAAAA-face-swap-native"],
    });
  });

  test("only the exact joining target device sees refreshed peer publisher identities", async () => {
    const t = await setup({ callerHasCalleeContact: true });
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
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
      identities: ["BBBBB-old-browser"],
    });
    await t.run(async (ctx) => {
      const target = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "CCCCC"))
        .unique();
      const profile = await ctx.db.query("license_profiles").first();
      if (!target || !profile) throw new Error("Expected test accounts");
      await ctx.db.patch(target._id, { mobileDeviceId: "device-c-other" });
      await ctx.db.insert("auth_codes", {
        code: "DDDDD",
        deviceId: "device-d",
        name: "Unrelated D",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "DDDDD",
        role: "user",
        enabled: true,
        licenseProfileId: profile._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "CCCCC",
    });
    await t.run(async (ctx) => {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", "CCCCC").eq("status", "unread"),
        )
        .unique();
      expect(notification).toMatchObject({
        title: "Call transfer request",
        message: "Caller A sent you a call transfer request.",
      });
      const push = (
        await ctx.db.system.query("_scheduled_functions").collect()
      ).find(
        (job) =>
          job.name === "push:send" &&
          job.state.kind === "pending" &&
          (job.args[0] as { type?: string }).type === "call_transfer",
      );
      expect(push?.args[0]).toMatchObject({
        title: "Call transfer request",
        message: "Caller A sent you a call transfer request.",
      });
    });
    await t.mutation(api.callState.respondTransfer, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      accept: true,
    });
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      targetIdentity: "CCCCC-target-browser",
    });

    await expect(
      t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      peerCode: "BBBBB",
      peerIdentity: "BBBBB-old-browser",
      peerPublisherIdentities: ["BBBBB-old-browser"],
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c-other",
        callId: created.callId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.callState.callStatus, {
        code: "DDDDD",
        deviceId: "device-d",
        callId: created.callId,
      }),
    ).resolves.toBeNull();

    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
      identities: ["BBBBB-new-browser"],
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      peerCode: "BBBBB",
      peerIdentity: "BBBBB-new-browser",
      peerPublisherIdentities: ["BBBBB-old-browser", "BBBBB-new-browser"],
    });
  });

  test("captures a fresh source publisher recorded after transfer completion was prepared", async () => {
    const t = await setup({ callerHasCalleeContact: true });
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
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });
    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      identities: ["AAAAA-old-browser"],
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
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      targetIdentity: "CCCCC-target-browser",
    });
    const prepared = await t.query(
      internal.callState.authorizeTransferCompletion,
      {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      },
    );
    expect(prepared.sourceIdentities).toEqual(["AAAAA-old-browser"]);

    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      identities: ["AAAAA-new-browser"],
    });
    const completed = await t.mutation(
      internal.callState.confirmTransferJoined,
      {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
        sourceIdentities: prepared.sourceIdentities,
      },
    );

    expect(completed).toMatchObject({
      completed: true,
      sourceIdentities: ["AAAAA-old-browser", "AAAAA-new-browser"],
    });
    expect(completed.sourceIdentities).not.toContain("CCCCC-target-browser");
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "completed",
      sourceIdentities: ["AAAAA-old-browser", "AAAAA-new-browser"],
    });
  });

  test("a transfer target must have the full call-transfer feature", async () => {
    const t = await setup({
      calleeFeatures: { canTransferCall: false },
      callerHasCalleeContact: true,
    });
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
    ).rejects.toThrow("转接目标必须使用全功能授权码");
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

  test("an accepted or joining transfer expires so a later handoff is not blocked", async () => {
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
    await expect(
      t.query(api.callState.pendingTransfer, {
        code: "CCCCC",
        deviceId: "device-c",
      }),
    ).resolves.toMatchObject({ _id: transferId, status: "accepted" });
    await t.run(async (ctx) => {
      const target = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "CCCCC"))
        .unique();
      if (!target) throw new Error("Expected transfer target");
      await ctx.db.patch(target._id, { mobileDeviceId: "device-c-other" });
    });
    await expect(
      t.query(api.callState.pendingTransfer, {
        code: "CCCCC",
        deviceId: "device-c-other",
      }),
    ).resolves.toBeNull();
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      targetIdentity: "CCCCC-resumed-mobile",
    });
    await expect(
      t.query(api.callState.pendingTransfer, {
        code: "CCCCC",
        deviceId: "device-c",
      }),
    ).resolves.toMatchObject({ _id: transferId, status: "joining" });
    await t.run(async (ctx) => {
      await ctx.db.patch(transferId, { expiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.callState.expireTransfer, { transferId });

    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "failed",
      failureReason: "接收端加入超时",
    });
    await expect(
      t.mutation(api.callState.initiateTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
        targetCode: "CCCCC",
      }),
    ).resolves.toBeDefined();
  });

  test("a device cannot accept a transfer while it owns another active call", async () => {
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
    await t.run(async (ctx) => {
      await ctx.db.insert("live_calls", {
        callId: "other-call",
        roomName: "other-room",
        type: "video",
        status: "connected",
        participantCodes: ["CCCCC", "DDDDD"],
        createdByCode: "CCCCC",
        callerUserId: "CCCCC",
        callerDeviceId: "device-c",
        callerCode: "CCCCC",
        calleeUserId: "DDDDD",
        calleeDeviceId: "device-d",
        calleeCode: "DDDDD",
        createdAt: Date.now(),
      });
    });
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "CCCCC",
    });

    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
        accept: true,
      }),
    ).rejects.toThrow("正在另一通话");
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
    await t.run(async (ctx) => {
      await ctx.db.insert("call_compliance", {
        callId: created.callId,
        tenantId: "nyfbi",
        participantCodes: ["AAAAA", "BBBBB"],
        consentedCodes: ["AAAAA", "BBBBB"],
        declinedCodes: [],
        status: "active",
        requestedBy: "ADMIN",
        requestedAt: Date.now() - 1_000,
        activatedAt: Date.now() - 500,
        translationEnabled: true,
      });
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
    const transferJoin = await t.mutation(
      internal.callState.authorizeTransferJoin,
      {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      },
    );
    expect(transferJoin).toMatchObject({ remoteUserId: "BBBBB" });
    await expect(
      t.query(api.callCompliance.status, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.respond, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
        consent: true,
      }),
    ).rejects.toThrow("录音同意请求已失效");
    expect(
      await t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toMatchObject({ peerCode: "BBBBB" });
    await t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      transferId,
    });
    await t.mutation(internal.callState.confirmTransferJoined, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      sourceIdentities: ["AAAAA-old-browser"],
    });
    expect(
      await t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).toBeNull();
    await expect(
      t.query(api.callCompliance.status, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).resolves.toBeNull();
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
    await expect(
      t.query(api.callCompliance.status, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      consentedCodes: [],
      status: "requested",
      translationEnabled: false,
      myConsent: false,
    });
    await t.mutation(api.callCompliance.respond, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
      consent: true,
    });
    await t.mutation(api.callCompliance.respond, {
      code: "CCCCC",
      deviceId: "device-c",
      callId: created.callId,
      consent: true,
    });
    await expect(
      t.query(api.callCompliance.status, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ status: "active", myConsent: true });
  });

  test("a call can be handed off to another device using the same authorization code", async () => {
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
    await t.run(async (ctx) => {
      await ctx.db.insert("call_compliance", {
        callId: created.callId,
        tenantId: "nyfbi",
        participantCodes: ["AAAAA", "BBBBB"],
        consentedCodes: ["AAAAA", "BBBBB"],
        declinedCodes: [],
        status: "active",
        requestedBy: "ADMIN",
        requestedAt: Date.now() - 1_000,
        activatedAt: Date.now() - 500,
        translationEnabled: true,
      });
    });

    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "AAAAA",
    });

    expect(
      await t.query(api.callState.pendingTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
      }),
    ).toBeNull();
    const pendingForTarget = await t.query(api.callState.pendingTransfer, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
    });
    expect(pendingForTarget).toMatchObject({
      _id: transferId,
      targetUserId: "AAAAA",
    });
    expect(pendingForTarget).not.toHaveProperty("fromDeviceId");
    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "AAAAA",
        deviceId: "device-a",
        transferId,
        accept: true,
      }),
    ).rejects.toThrow("不能在发起转移的设备上接收");
    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "AAAAA",
        deviceId: "device-a-mobile",
        transferId,
        accept: true,
      }),
    ).resolves.toMatchObject({ callId: created.callId });
    const outgoingForSource = await t.query(api.callState.myOutgoingTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    expect(outgoingForSource).not.toBeNull();
    expect(outgoingForSource).not.toHaveProperty("targetDeviceId");

    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
      transferId,
      targetIdentity: "AAAAA-new-mobile",
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      peerCode: "AAAAA",
      peerIdentity: "AAAAA-new-mobile",
      peerPublisherIdentities: ["AAAAA-new-mobile"],
    });
    await t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      transferId,
    });
    await t.mutation(internal.callState.confirmTransferJoined, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
      transferId,
      sourceIdentities: ["AAAAA-old-browser"],
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callState.markParticipantConnected, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).rejects.toThrow("已由另一台设备接手");
    await expect(
      t.mutation(api.callState.markParticipantConnected, {
        code: "AAAAA",
        deviceId: "device-a-mobile",
        callId: created.callId,
      }),
    ).resolves.toBeNull();

    // The old desktop is disconnected as part of the handoff. Its teardown
    // must not end the call that the same authorization code just continued
    // on the mobile device.
    await t.mutation(api.callState.endP2PCall, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a-mobile",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ status: "connected", peerCode: "BBBBB" });
    await expect(
      t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      status: "connected",
      peerCode: "AAAAA",
      peerIdentity: "AAAAA-new-mobile",
    });
    await expect(
      t.query(api.callCompliance.status, {
        code: "AAAAA",
        deviceId: "device-a-mobile",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({
      consentedCodes: ["AAAAA", "BBBBB"],
      status: "active",
      translationEnabled: true,
      myConsent: true,
    });

    // The newly bound mobile endpoint still owns its side of the call and can
    // end it normally.
    await t.mutation(api.callState.endP2PCall, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
      callId: created.callId,
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "BBBBB",
        deviceId: "device-b",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ status: "ended" });
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
