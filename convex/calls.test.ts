import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

function jwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Token has no JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
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
