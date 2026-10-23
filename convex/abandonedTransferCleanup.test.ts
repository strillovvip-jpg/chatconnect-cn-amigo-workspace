import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { RoomServiceClient } from "livekit-server-sdk";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { runTransferCleanupAttempt } from "./calls";
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

async function setupTransfer(options: { joined?: boolean } = {}) {
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
      { code: "CCCCC", deviceId: "device-c", name: "Receiver C" },
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
      await ctx.db.insert("user_presence", {
        userId: user.code,
        lastSeenAt: Date.now(),
        online: true,
        lastOnlineAt: Date.now(),
      });
    }
  });
  const call = await t.mutation(api.callState.prepareP2P, {
    code: "AAAAA",
    deviceId: "device-a",
    theirCode: "BBBBB",
    callType: "video",
  });
  await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
    code: "BBBBB",
    deviceId: "device-b",
    callId: call.callId,
  });
  await t.mutation(api.callState.markParticipantConnected, {
    code: "AAAAA",
    deviceId: "device-a",
    callId: call.callId,
  });
  await t.mutation(api.callState.markParticipantConnected, {
    code: "BBBBB",
    deviceId: "device-b",
    callId: call.callId,
  });
  const transferId = await t.mutation(api.callState.initiateTransfer, {
    code: "AAAAA",
    deviceId: "device-a",
    callId: call.callId,
    targetCode: "CCCCC",
  });
  if (options.joined) {
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
      targetIdentity: "CCCCC-new-receiver",
    });
  }
  return { t, call, transferId };
}

async function transferCleanupJobs(
  t: Awaited<ReturnType<typeof setupTransfer>>["t"],
) {
  return t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter(
      (job) =>
        job.name === "calls:retryTransferCleanup" &&
        job.state.kind === "pending",
    );
  });
}

function scheduledAttempts(
  jobs: Awaited<ReturnType<typeof transferCleanupJobs>>,
) {
  return jobs
    .map((job) => (job.args[0] as { attempt: number }).attempt)
    .sort((left, right) => left - right);
}

describe("abandoned transfer receiver cleanup", () => {
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

  test("an expired joining transfer revokes only its exact receiver identity", async () => {
    const { t, call, transferId } = await setupTransfer({ joined: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(transferId, { expiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.callState.expireTransfer, { transferId });

    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "failed",
      cleanupStatus: "pending",
      cleanupAttempts: 0,
    });
    expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
      TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map((_, attempt) => attempt),
    );

    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [
        { identity: "AAAAA-original-browser" },
        { identity: "BBBBB-remote-browser" },
        { identity: "CCCCC-new-receiver" },
      ] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockResolvedValue(undefined as never);

    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 0,
    });

    expect(removeParticipant.mock.calls).toEqual([
      [
        call.roomName,
        "CCCCC-new-receiver",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    expect(removeParticipant).not.toHaveBeenCalledWith(
      call.roomName,
      "AAAAA-original-browser",
      expect.anything(),
    );
    expect(removeParticipant).not.toHaveBeenCalledWith(
      call.roomName,
      "BBBBB-remote-browser",
      expect.anything(),
    );
  });

  test.each(["fail", "cancel"] as const)(
    "%s after the receiver joins schedules exact-identity cleanup",
    async (terminalAction) => {
      const { t, transferId } = await setupTransfer({ joined: true });
      if (terminalAction === "fail") {
        await t.mutation(api.callState.failTransferJoin, {
          code: "CCCCC",
          deviceId: "device-c",
          transferId,
          reason: "media timeout",
        });
      } else {
        await t.mutation(api.callState.cancelTransfer, {
          code: "AAAAA",
          deviceId: "device-a",
          transferId,
        });
      }

      await expect(
        t.run(async (ctx) => ctx.db.get(transferId)),
      ).resolves.toMatchObject({
        status: terminalAction === "fail" ? "failed" : "cancelled",
        cleanupStatus: "pending",
        cleanupAttempts: 0,
      });
      expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
        TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map((_, attempt) => attempt),
      );
    },
  );

  test("a pending receiver with no LiveKit identity does not schedule cleanup", async () => {
    const { t, transferId } = await setupTransfer();
    await t.mutation(api.callState.cancelTransfer, {
      code: "AAAAA",
      deviceId: "device-a",
      transferId,
    });

    const transfer = await t.run(async (ctx) => ctx.db.get(transferId));
    expect(transfer).toMatchObject({ status: "cancelled" });
    expect(transfer).not.toHaveProperty("targetIdentity");
    expect(transfer).not.toHaveProperty("cleanupStatus");
    expect(await transferCleanupJobs(t)).toHaveLength(0);
  });

  test("a failed LiveKit eviction cannot strand later independent retries", async () => {
    const { t, transferId } = await setupTransfer({ joined: true });
    await t.mutation(api.callState.failTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      reason: "media timeout",
    });
    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockRejectedValueOnce(new Error("temporary LiveKit failure"))
      .mockResolvedValue(undefined as never);

    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 0,
    });
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      cleanupStatus: "failed",
      cleanupAttempts: 1,
      cleanupError: expect.stringContaining("Failed to evict"),
    });
    expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
      TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map((_, attempt) => attempt),
    );

    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 1,
    });
    const cleanedTransfer = await t.run(async (ctx) => ctx.db.get(transferId));
    expect(cleanedTransfer).toMatchObject({
      cleanupStatus: "completed",
      cleanupAttempts: 2,
    });
    expect(cleanedTransfer).not.toHaveProperty("cleanupError");
    expect(removeParticipant).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "CCCCC-new-receiver",
      { revokeTokenTs: expect.any(BigInt) },
    );

    removeParticipant.mockRejectedValueOnce(
      new Error("later transient LiveKit failure"),
    );
    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 2,
    });
    const laterFailure = await t.run(async (ctx) => ctx.db.get(transferId));
    expect(laterFailure).toMatchObject({
      cleanupStatus: "completed",
      cleanupAttempts: 3,
    });
    expect(laterFailure).not.toHaveProperty("cleanupError");
  });

  test("a transient first-action config failure leaves a later exact-identity cleanup independently runnable", async () => {
    const { t, call, transferId } = await setupTransfer({ joined: true });
    await t.mutation(api.callState.failTransferJoin, {
      code: "CCCCC",
      deviceId: "device-c",
      transferId,
      reason: "media timeout",
    });
    const expectedAttempts = TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map(
      (_, attempt) => attempt,
    );
    expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
      expectedAttempts,
    );

    delete process.env.LIVEKIT_URL;
    await expect(
      t.action(internal.calls.retryTransferCleanup, {
        transferId,
        attempt: 0,
      }),
    ).rejects.toThrow("LIVEKIT_URL");
    expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
      expectedAttempts,
    );

    process.env.LIVEKIT_URL = "https://livekit.example.test";
    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockResolvedValue(undefined as never);
    await t.action(internal.calls.retryTransferCleanup, {
      transferId,
      attempt: 1,
    });

    expect(removeParticipant.mock.calls).toEqual([
      [
        call.roomName,
        "CCCCC-new-receiver",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
  });

  test("a cleanup-status write failure cannot terminate the retry chain", async () => {
    const events: string[] = [];
    const cleanup = vi
      .fn()
      .mockImplementation(async () => {
        events.push("cleanup");
        throw new Error("temporary LiveKit failure");
      });
    const record = vi
      .fn()
      .mockImplementation(async () => {
        events.push("record");
        throw new Error("temporary database failure");
      });

    await expect(
      runTransferCleanupAttempt({ cleanup, record }),
    ).resolves.toMatchObject({ success: false });
    expect(events).toEqual(["cleanup", "record"]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      success: false,
      error: "temporary LiveKit failure",
    });
  });

  test("a confirmation race that finds the original call ended persists failure and cleanup", async () => {
    const { t, call, transferId } = await setupTransfer({ joined: true });
    await t.run(async (ctx) => {
      const liveCall = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", call.callId))
        .unique();
      if (!liveCall) throw new Error("Expected live call");
      await ctx.db.patch(liveCall._id, { status: "ended" });
    });

    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "CCCCC",
        deviceId: "device-c",
        transferId,
        sourceIdentities: ["AAAAA-original-browser"],
      }),
    ).resolves.toMatchObject({ completed: false });
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "failed",
      cleanupStatus: "pending",
    });
    expect(scheduledAttempts(await transferCleanupJobs(t))).toEqual(
      TRANSFER_CLEANUP_RETRY_OFFSETS_MS.map((_, attempt) => attempt),
    );
  });
});
