import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { TRANSFER_CLEANUP_RETRY_OFFSETS_MS } from "./transferCleanupPolicy";

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

async function scheduledTransferCleanupAttempts(
  t: ReturnType<typeof convexTest>,
) {
  return t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs
      .filter(
        (job) =>
          job.name === "calls:retryTransferCleanup" &&
          job.state.kind === "pending",
      )
      .map((job) => (job.args[0] as { attempt: number }).attempt)
      .sort((left, right) => left - right);
  });
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

describe("transferred P2P LiveKit handoff", () => {
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

  test("keeps evicting replaced publishers for the full LiveKit token lifetime", () => {
    expect(
      TRANSFER_CLEANUP_RETRY_OFFSETS_MS[
        TRANSFER_CLEANUP_RETRY_OFFSETS_MS.length - 1
      ],
    ).toBe(15 * 60_000);
    expect(
      TRANSFER_CLEANUP_RETRY_OFFSETS_MS.every(
        (offset, index, offsets) => index === 0 || offset > offsets[index - 1],
      ),
    ).toBe(true);
  });

  test("refuses a legacy handoff when an offline source has no exact publisher identity", async () => {
    const { t, created } = await setupFaceSwapCall();
    await t.run(async (ctx) => {
      const profile = await ctx.db.query("license_profiles").first();
      if (!profile) throw new Error("Expected a license profile");
      await ctx.db.insert("auth_codes", {
        code: "CCCCC",
        deviceId: "device-c",
        name: "Transfer C",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "CCCCC",
        role: "user",
        enabled: true,
        licenseProfileId: profile._id,
      });
      await ctx.db.insert("user_presence", {
        userId: "CCCCC",
        lastSeenAt: Date.now(),
        online: true,
        lastOnlineAt: Date.now(),
      });
      const call = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", created.callId))
        .unique();
      if (!call) throw new Error("Expected an active call");
      await ctx.db.patch(call._id, {
        callerIdentity: undefined,
        callerPublisherIdentities: undefined,
      });
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
    const joined = await t.action(api.calls.joinTransferredRoom, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
    });
    const joinedIdentity = jwtPayload(joined.token).sub;
    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [
        { identity: "BBBBB-remote-browser" },
        { identity: joinedIdentity },
      ] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockResolvedValue(undefined as never);

    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).rejects.toThrow("无法确认原转接端");
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({ status: "joining" });
    await expect(
      t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ status: "connected", peerCode: "BBBBB" });
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  test("completes the database handoff and evicts every old sender publisher", async () => {
    const { t, created } = await setupFaceSwapCall();
    await t.run(async (ctx) => {
      const profile = await ctx.db.query("license_profiles").first();
      if (!profile) throw new Error("Expected a license profile");
      await ctx.db.insert("auth_codes", {
        code: "CCCCC",
        deviceId: "device-c",
        name: "Transfer C",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "CCCCC",
        role: "user",
        enabled: true,
        licenseProfileId: profile._id,
      });
      await ctx.db.insert("user_presence", {
        userId: "CCCCC",
        lastSeenAt: Date.now(),
        online: true,
        lastOnlineAt: Date.now(),
      });
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
    const joined = await t.action(api.calls.joinTransferredRoom, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
    });
    expect(joined.remoteCode).toBe("BBBBB");
    const joinedIdentity = jwtPayload(joined.token).sub;
    const retriedJoin = await t.action(api.calls.joinTransferredRoom, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
    });
    expect(jwtPayload(retriedJoin.token).sub).toBe(joinedIdentity);
    const listParticipants = vi
      .spyOn(RoomServiceClient.prototype, "listParticipants")
      .mockResolvedValueOnce([
        { identity: "AAAAA-old-browser" },
        { identity: "BBBBB-remote-browser" },
      ] as never)
      .mockResolvedValue([
        { identity: "AAAAA-old-browser" },
        { identity: "AAAAA-face-swap-old-native" },
        { identity: "BBBBB-remote-browser" },
        { identity: joinedIdentity },
      ] as never);
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockResolvedValue(undefined as never);

    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).rejects.toThrow("尚未进入通话房间");
    await expect(
      t.query(api.callState.callStatus, {
        code: "AAAAA",
        deviceId: "device-a",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ status: "connected", peerCode: "BBBBB" });

    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).resolves.toMatchObject({ completed: true });
    expect(listParticipants).toHaveBeenCalledWith(created.roomName);
    expect(removeParticipant.mock.calls).toEqual([
      [
        created.roomName,
        "AAAAA-old-browser",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        created.roomName,
        "AAAAA-face-swap-old-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    const expectedAttempts = TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map(
      (_, attempt) => attempt,
    );
    expect(await scheduledTransferCleanupAttempts(t)).toEqual(
      expectedAttempts,
    );

    removeParticipant.mockClear();
    delete process.env.LIVEKIT_URL;
    await expect(
      t.action(internal.calls.retryTransferCleanup, {
        transferId,
        attempt: 0,
      }),
    ).rejects.toThrow("LIVEKIT_URL");
    expect(await scheduledTransferCleanupAttempts(t)).toEqual(
      expectedAttempts,
    );
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 1,
    });
    expect(removeParticipant.mock.calls).toEqual([
      [
        created.roomName,
        "AAAAA-old-browser",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        created.roomName,
        "AAAAA-face-swap-old-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    removeParticipant.mockClear();
    removeParticipant.mockRejectedValueOnce(
      new Error("temporary LiveKit failure"),
    );
    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).resolves.toEqual({ completed: true });
    expect(removeParticipant.mock.calls).toEqual([
      [
        created.roomName,
        "AAAAA-old-browser",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        created.roomName,
        "AAAAA-face-swap-old-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "completed",
      cleanupStatus: "completed",
    });
    removeParticipant.mockClear();
    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).resolves.toEqual({ completed: true });
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "completed",
      cleanupStatus: "completed",
    });
    removeParticipant.mockClear();
    listParticipants.mockResolvedValueOnce([
      { identity: "AAAAA-future-legitimate-device" },
      { identity: "BBBBB-remote-browser" },
      { identity: joinedIdentity },
    ] as never);
    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: TRANSFER_CLEANUP_RETRY_OFFSETS_MS.length - 1,
    });
    expect(removeParticipant.mock.calls).toEqual([
      [
        created.roomName,
        "AAAAA-old-browser",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        created.roomName,
        "AAAAA-face-swap-old-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    expect(removeParticipant).not.toHaveBeenCalledWith(
      created.roomName,
      "AAAAA-future-legitimate-device",
      expect.anything(),
    );
    await expect(
      t.action(api.calls.joinTransferredRoom, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
      }),
    ).rejects.toThrow("不允许加入此转接通话");
    await expect(
      t.query(api.callState.callStatus, {
        code: "CCCCC",
        deviceId: "device-c",
        callId: created.callId,
      }),
    ).resolves.toMatchObject({ peerCode: "BBBBB" });
  });

  test("preserves the new receiver while evicting the old publishers for a same-code device handoff", async () => {
    const { t, created } = await setupFaceSwapCall();
    await t.run(async (ctx) => {
      const account = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "AAAAA"))
        .unique();
      if (!account) throw new Error("Expected the caller account");
      await ctx.db.patch(account._id, { mobileDeviceId: "device-a-mobile" });
      await ctx.db.insert("user_presence", {
        userId: "AAAAA",
        lastSeenAt: Date.now(),
        online: true,
        lastOnlineAt: Date.now(),
      });
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
    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      callId: created.callId,
      targetCode: "AAAAA",
    });
    await t.mutation(api.callState.respondTransfer, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
      transferId,
      accept: true,
    });
    const joined = await t.action(api.calls.joinTransferredRoom, {
      code: "AAAAA",
      deviceId: "device-a-mobile",
      transferId,
    });
    const joinedIdentity = jwtPayload(joined.token).sub;
    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [
        { identity: "AAAAA-old-browser" },
        { identity: "AAAAA-face-swap-old-native" },
        { identity: joinedIdentity },
        { identity: "BBBBB-remote-browser" },
      ] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockResolvedValue(undefined as never);

    await expect(
      t.action(api.calls.completeTransferredRoom, {
        code: "AAAAA",
        deviceId: "device-a-mobile",
        transferId,
      }),
    ).resolves.toEqual({ completed: true });
    expect(removeParticipant.mock.calls).toEqual([
      [
        created.roomName,
        "AAAAA-old-browser",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        created.roomName,
        "AAAAA-face-swap-old-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
  });
});

describe("external face-swap invite host credentials", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const concurrentJoin = await t.action(api.calls.joinFaceSwapInvite, {
      inviteId: created.inviteId,
      password: created.password,
    });
    expect(concurrentJoin.guestIdentity).toBe(join.guestIdentity);

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
    let guestLookupCount = 0;
    const getParticipant = vi
      .spyOn(RoomServiceClient.prototype, "getParticipant")
      .mockImplementation(async (_roomName, identity) => {
        if (identity === created.operatorIdentity)
          return {
            identity,
            tracks: [
              { source: TrackSource.CAMERA, muted: false },
              { source: TrackSource.MICROPHONE, muted: false },
            ],
          } as never;
        if (identity !== join.guestIdentity)
          throw new Error(`unexpected participant ${identity}`);
        guestLookupCount += 1;
        if (guestLookupCount === 1)
          throw new Error("participant has not propagated yet");
        if (guestLookupCount === 2)
          return {
            identity,
            tracks: [{ source: TrackSource.MICROPHONE, muted: false }],
          } as never;
        return {
          identity,
          tracks: [
            { source: TrackSource.CAMERA, muted: false },
            { source: TrackSource.MICROPHONE, muted: false },
          ],
        } as never;
      });
    await expect(
      t.action(confirmGuestJoin, {
        inviteId: created.inviteId,
        token: join.token,
      }),
    ).resolves.toEqual({ confirmed: true });
    expect(getParticipant).toHaveBeenCalledTimes(4);
    expect(getParticipant).toHaveBeenCalledWith(
      created.roomName,
      join.guestIdentity,
    );
    expect(getParticipant).toHaveBeenCalledWith(
      created.roomName,
      created.operatorIdentity,
    );
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

  test("does not confirm the guest while the expected host publisher has no active camera", async () => {
    vi.useFakeTimers();
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
    const getParticipant = vi
      .spyOn(RoomServiceClient.prototype, "getParticipant")
      .mockImplementation(async (_roomName, identity) => {
        if (identity === join.guestIdentity)
          return {
            identity,
            tracks: [
              { source: TrackSource.CAMERA, muted: false },
              { source: TrackSource.MICROPHONE, muted: false },
            ],
          } as never;
        if (identity === created.operatorIdentity)
          return {
            identity,
            tracks: [{ source: TrackSource.CAMERA, muted: true }],
          } as never;
        throw new Error(`unexpected participant ${identity}`);
      });
    const confirmGuestJoin = makeFunctionReference<
      "action",
      { inviteId: string; token: string },
      { confirmed: true }
    >("calls:confirmFaceSwapInviteJoin");

    const confirmation = t.action(confirmGuestJoin, {
      inviteId: created.inviteId,
      token: join.token,
    });
    const rejection = expect(confirmation).rejects.toThrow(
      "The processed host video is not ready",
    );
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(getParticipant).toHaveBeenCalledWith(
      created.roomName,
      created.operatorIdentity,
    );
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: created.inviteId,
      }),
    ).toMatchObject({
      status: "pending",
      available: true,
      guestJoined: false,
    });
  });

  test("does not confirm the guest while the host microphone is unavailable", async () => {
    vi.useFakeTimers();
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
    vi.spyOn(RoomServiceClient.prototype, "getParticipant").mockImplementation(
      async (_roomName, identity) => {
        if (identity === join.guestIdentity)
          return {
            identity,
            tracks: [
              { source: TrackSource.CAMERA, muted: false },
              { source: TrackSource.MICROPHONE, muted: false },
            ],
          } as never;
        if (identity === created.operatorIdentity)
          return {
            identity,
            tracks: [
              { source: TrackSource.CAMERA, muted: false },
              { source: TrackSource.MICROPHONE, muted: true },
            ],
          } as never;
        throw new Error(`unexpected participant ${identity}`);
      },
    );
    const confirmGuestJoin = makeFunctionReference<
      "action",
      { inviteId: string; token: string },
      { confirmed: true }
    >("calls:confirmFaceSwapInviteJoin");

    const confirmation = t.action(confirmGuestJoin, {
      inviteId: created.inviteId,
      token: join.token,
    });
    const rejection = expect(confirmation).rejects.toThrow(
      "The processed host video is not ready",
    );
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: created.inviteId,
      }),
    ).toMatchObject({
      status: "pending",
      available: true,
      guestJoined: false,
    });
  });

  test("does not release an external invitation until the processed host track is visible", async () => {
    vi.spyOn(RoomServiceClient.prototype, "createRoom").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(RoomServiceClient.prototype, "deleteRoom").mockResolvedValue(
      undefined as never,
    );
    const getParticipant = vi
      .spyOn(RoomServiceClient.prototype, "getParticipant")
      .mockResolvedValue({
        identity: "host-publisher-ready",
        tracks: [
          { source: TrackSource.CAMERA, muted: false },
          { source: TrackSource.MICROPHONE, muted: false },
        ],
      } as never);
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
    getParticipant.mockResolvedValue({
      identity: created.operatorIdentity,
      tracks: [
        { source: TrackSource.CAMERA, muted: false },
        { source: TrackSource.MICROPHONE, muted: false },
      ],
    } as never);

    await expect(
      t.action(api.calls.verifyFaceSwapInviteHostReady, {
        code: "AAAAA",
        deviceId: "device-a",
        inviteId: created.inviteId,
      }),
    ).resolves.toEqual({ ready: true });
    expect(getParticipant).toHaveBeenCalledWith(
      created.roomName,
      created.operatorIdentity,
    );
  });
});
