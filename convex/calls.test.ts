import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { RoomServiceClient } from "livekit-server-sdk";
import { makeFunctionReference } from "convex/server";
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

function jwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Token has no JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
    name?: string;
    video: {
      roomJoin: boolean;
      room: string;
      canPublish: boolean;
      canSubscribe: boolean;
      canPublishSources?: string[];
    };
  };
}

async function setupFaceSwapCall() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("license_profiles", {
      name: "Full",
      features: fullFeatures,
      createdBy: "AAAAA",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const user of [
      { code: "AAAAA", deviceId: "device-a", name: "Caller A" },
      { code: "BBBBB", deviceId: "device-b", name: "Callee B" },
    ]) {
      await ctx.db.insert("auth_codes", {
        ...user,
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: user.code,
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
      });
    }
    await ctx.db.insert("contacts", {
      ownerCode: "AAAAA",
      targetCode: "BBBBB",
      targetName: "Callee B",
      addedAt: new Date().toISOString(),
    });
  });

  const created = await t.action(api.calls.getOrCreateRoom, {
    myCode: "AAAAA",
    theirCode: "BBBBB",
    myName: "Caller A",
    deviceId: "device-a",
    callType: "video",
    callerMediaMode: "face-swap",
  });
  await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
    code: "BBBBB",
    deviceId: "device-b",
    callId: created.callId,
  });
  return { t, created };
}

describe("P2P face-swap LiveKit credentials", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  test("face-swap caller receives separate microphone and camera publisher tokens", async () => {
    const { t, created } = await setupFaceSwapCall();
    expect(created).toMatchObject({
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
    });

    const joined = await t.action(api.calls.joinAcceptedOutgoingCall, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
    });
    expect(joined).toMatchObject({
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
    });
    expect(joined.nativeVideoToken).toEqual(expect.any(String));
    expect(joined.nativeVideoIdentity).toEqual(expect.any(String));

    const browser = jwtPayload(joined.token);
    const nativeVideo = jwtPayload(joined.nativeVideoToken!);
    expect(browser.video).toMatchObject({
      roomJoin: true,
      room: created.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishSources: ["microphone"],
    });
    expect(nativeVideo.video).toMatchObject({
      roomJoin: true,
      room: created.roomName,
      canPublish: true,
      canSubscribe: false,
      canPublishSources: ["camera"],
    });
    expect(nativeVideo.sub).toBe(joined.nativeVideoIdentity);
    expect(nativeVideo.sub).not.toBe(browser.sub);
  });

  test("face-swap callee remains a normal camera participant", async () => {
    const { t, created } = await setupFaceSwapCall();
    const joined = await t.action(api.calls.acceptIncomingCall, {
      code: "BBBBB",
      deviceId: "device-b",
      callId: created.callId,
    });

    expect(joined).toMatchObject({
      localMediaMode: "camera",
      remoteMediaMode: "face-swap",
    });
    expect("nativeVideoToken" in joined).toBe(false);
    const token = jwtPayload(joined.token);
    expect(token.video.canSubscribe).toBe(true);
    expect(token.video.canPublishSources).toBeUndefined();
  });
});

describe("external face-swap invite host credentials", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  test("issues distinct processed publisher and browser viewer credentials", async () => {
    const createRoom = vi
      .spyOn(RoomServiceClient.prototype, "createRoom")
      .mockResolvedValue({} as never);
    vi.spyOn(RoomServiceClient.prototype, "deleteRoom").mockResolvedValue(
      undefined as never,
    );
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const profileId = await ctx.db.insert("license_profiles", {
        name: "Full",
        features: fullFeatures,
        createdBy: "AAAAA",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("auth_codes", {
        code: "AAAAA",
        deviceId: "device-a",
        name: "Caller A",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "AAAAA",
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
      });
    });

    const created = await t.action(api.calls.createFaceSwapInvite, {
      code: "AAAAA",
      deviceId: "device-a",
      origin: "capacitor://localhost",
    });

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ maxParticipants: 3 }),
    );
    expect(created.operatorViewerToken).toEqual(expect.any(String));
    expect(created.operatorViewerIdentity).toEqual(expect.any(String));
    const publisher = jwtPayload(created.operatorToken);
    const viewer = jwtPayload(created.operatorViewerToken);
    expect(publisher.sub).not.toBe(viewer.sub);
    expect(publisher.sub).not.toContain("AAAAA");
    expect(viewer.sub).not.toContain("AAAAA");
    expect(publisher.name).toBe("Host");
    expect(viewer.name).toBe("Host Viewer");
    expect(publisher.video).toMatchObject({
      canPublish: true,
      canSubscribe: false,
      canPublishSources: ["camera", "microphone"],
    });
    expect(viewer.video).toMatchObject({
      canPublish: false,
      canSubscribe: true,
    });
  });

  test("consumes the invite only after the guest confirms a connected room", async () => {
    vi.spyOn(RoomServiceClient.prototype, "createRoom").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(RoomServiceClient.prototype, "deleteRoom").mockResolvedValue(
      undefined as never,
    );
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const profileId = await ctx.db.insert("license_profiles", {
        name: "Full",
        features: fullFeatures,
        createdBy: "AAAAA",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("auth_codes", {
        code: "AAAAA",
        deviceId: "device-a",
        name: "Caller A",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "AAAAA",
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
      });
    });

    const created = await t.action(api.calls.createFaceSwapInvite, {
      code: "AAAAA",
      deviceId: "device-a",
      origin: "capacitor://localhost",
    });
    const join = await t.action(api.calls.joinFaceSwapInvite, {
      inviteId: created.inviteId,
      password: created.password,
    });

    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: created.inviteId,
      }),
    ).toMatchObject({
      status: "pending",
      available: true,
      guestJoined: false,
    });

    const confirmGuestJoin = makeFunctionReference<
      "action",
      { inviteId: string; token: string },
      { confirmed: true }
    >("calls:confirmFaceSwapInviteJoin");
    await expect(
      t.action(confirmGuestJoin, {
        inviteId: created.inviteId,
        token: `${join.token}tampered`,
      }),
    ).rejects.toThrow("来宾通话凭证无效");
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: created.inviteId,
      }),
    ).toMatchObject({
      status: "pending",
      available: true,
      guestJoined: false,
    });
    await expect(
      t.action(confirmGuestJoin, {
        inviteId: created.inviteId,
        token: join.token,
      }),
    ).resolves.toEqual({ confirmed: true });
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: created.inviteId,
      }),
    ).toMatchObject({
      status: "active",
      available: false,
      guestJoined: true,
    });
    await expect(
      t.action(api.calls.joinFaceSwapInvite, {
        inviteId: created.inviteId,
        password: created.password,
      }),
    ).rejects.toThrow("该视讯邀请已被使用");
  });
});
