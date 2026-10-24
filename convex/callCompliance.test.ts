import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { saveRecording } from "./callCompliance";

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
  await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("license_profiles", {
      name: "Full recording test profile",
      features: fullFeatures,
      createdBy: "ROOT1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const [code, deviceId, name, role] of [
      ["ROOT1", "root-device", "总管理员", "super_admin"],
      ["ADMIN", "admin-device", "管理员", "admin"],
      ["ALICE", "alice-device", "Alice", "user"],
      ["BOBXX", "bob-device", "Bob", "user"],
      ["CAROL", "carol-device", "Carol", "user"],
    ] as const) {
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        mobileDeviceId: code === "ALICE" ? "alice-mobile" : undefined,
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
    await ctx.db.insert("live_calls", {
      callId: "call-1",
      roomName: "room-1",
      type: "audio",
      status: "connected",
      participantCodes: ["ALICE", "BOBXX"],
      createdByCode: "ALICE",
      callerUserId: "ALICE",
      callerDeviceId: "alice-device",
      callerCode: "ALICE",
      callerName: "Alice",
      calleeUserId: "BOBXX",
      calleeDeviceId: "bob-device",
      calleeCode: "BOBXX",
      calleeName: "Bob",
      createdAt: Date.now(),
    });
    for (const code of ["ALICE", "BOBXX", "CAROL"])
      await ctx.db.insert("user_presence", {
        userId: code,
        lastSeenAt: Date.now(),
        online: true,
        lastOnlineAt: Date.now(),
      });
  });
  return t;
}

async function storeRecordingFile(
  t: Awaited<ReturnType<typeof setup>>,
  contents = "recording",
  contentType = "audio/webm",
  size = contents.length,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([contents], { type: contentType }),
    );
    const testDb = ctx.db as unknown as {
      patch: (
        id: Id<"_storage">,
        value: { contentType: string; size: number },
      ) => Promise<void>;
    };
    await testDb.patch(storageId, { contentType, size });
    return storageId;
  });
}

async function completeRecordingSegment(
  t: Awaited<ReturnType<typeof setup>>,
  code: "ALICE" | "BOBXX",
  deviceId: "alice-device" | "bob-device",
  clientNonce: string,
) {
  const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
    code,
    deviceId,
    callId: "call-1",
    clientNonce,
  });
  await t.mutation(api.callCompliance.generateUploadUrl, {
    code,
    deviceId,
    callId: "call-1",
    segmentId: segment.segmentId,
  });
  const storageId = await storeRecordingFile(t, clientNonce);
  await t.mutation(internal.callCompliance.saveRecording, {
    code,
    deviceId,
    callId: "call-1",
    segmentId: segment.segmentId,
    storageId,
    mimeType: "audio/webm",
  });
  return segment;
}

async function activateRecording(
  t: Awaited<ReturnType<typeof setup>>,
  callId = "call-1",
) {
  await t.mutation(api.callCompliance.request, {
    password: "ADMIN:admin-device",
    callId,
  });
  await t.mutation(api.callCompliance.respond, {
    code: "ALICE",
    deviceId: "alice-device",
    callId,
    consent: true,
  });
  await t.mutation(api.callCompliance.respond, {
    code: "BOBXX",
    deviceId: "bob-device",
    callId,
    consent: true,
  });
}

async function finishStopDeadline(t: Awaited<ReturnType<typeof setup>>) {
  const epoch = await t.run(async (ctx) => {
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", "call-1"))
      .unique();
    await ctx.db.patch(item!._id, { stopDeadline: Date.now() - 1 });
    return item!.consentEpoch ?? item!.activatedAt ?? item!.requestedAt;
  });
  await t.mutation(internal.callCompliance.finalizeRecordingStop, {
    callId: "call-1",
    consentEpoch: epoch,
  });
}

async function transferAliceToCarol(t: Awaited<ReturnType<typeof setup>>) {
  const transferId = await t.mutation(api.callState.initiateTransfer, {
    code: "ALICE",
    deviceId: "alice-device",
    callId: "call-1",
    targetCode: "CAROL",
  });
  await t.mutation(api.callState.respondTransfer, {
    code: "CAROL",
    deviceId: "carol-device",
    transferId,
    accept: true,
  });
  await t.mutation(internal.callState.authorizeTransferJoin, {
    code: "CAROL",
    deviceId: "carol-device",
    transferId,
    targetIdentity: "CAROL-browser",
  });
  await t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
    code: "ALICE",
    deviceId: "alice-device",
    callId: "call-1",
    transferId,
  });
  await t.mutation(internal.callState.confirmTransferJoined, {
    code: "CAROL",
    deviceId: "carol-device",
    transferId,
    sourceIdentities: ["ALICE-browser"],
  });
  return transferId;
}

async function transferAliceToOwnMobile(t: Awaited<ReturnType<typeof setup>>) {
  const transferId = await t.mutation(api.callState.initiateTransfer, {
    code: "ALICE",
    deviceId: "alice-device",
    callId: "call-1",
    targetCode: "ALICE",
  });
  await t.mutation(api.callState.respondTransfer, {
    code: "ALICE",
    deviceId: "alice-mobile",
    transferId,
    accept: true,
  });
  await t.mutation(internal.callState.authorizeTransferJoin, {
    code: "ALICE",
    deviceId: "alice-mobile",
    transferId,
    targetIdentity: "ALICE-mobile",
  });
  await t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
    code: "ALICE",
    deviceId: "alice-device",
    callId: "call-1",
    transferId,
  });
  await t.mutation(internal.callState.confirmTransferJoined, {
    code: "ALICE",
    deviceId: "alice-mobile",
    transferId,
    sourceIdentities: ["ALICE-browser"],
  });
}

async function stageAliceTransfer(
  t: Awaited<ReturnType<typeof setup>>,
  targetCode: "ALICE" | "CAROL",
  targetDeviceId: "alice-mobile" | "carol-device",
  targetIdentity: string,
) {
  const transferId = await t.mutation(api.callState.initiateTransfer, {
    code: "ALICE",
    deviceId: "alice-device",
    callId: "call-1",
    targetCode,
  });
  await t.mutation(api.callState.respondTransfer, {
    code: targetCode,
    deviceId: targetDeviceId,
    transferId,
    accept: true,
  });
  await t.mutation(internal.callState.authorizeTransferJoin, {
    code: targetCode,
    deviceId: targetDeviceId,
    transferId,
    targetIdentity,
  });
  return transferId;
}

describe("consent-gated call recording", () => {
  test("raw-storage recording finalization is not a public client mutation", () => {
    expect(
      (saveRecording as unknown as { isInternal?: boolean }).isInternal,
    ).toBe(true);
  });

  test("admin Stop flushes an existing short segment, forbids new capture, and then stops", async () => {
    const t = await setup();
    await activateRecording(t);
    const auth = { code: "ALICE", deviceId: "alice-device", callId: "call-1" };
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      ...auth,
      clientNonce: "short-admin-stop",
    });
    await t.mutation(api.callCompliance.stop, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    expect((await t.query(api.callCompliance.status, auth))?.status).toBe(
      "stopping",
    );
    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        ...auth,
        clientNonce: "after-stop",
      }),
    ).rejects.toThrow();
    const ticket = await t.mutation(api.callCompliance.generateUploadUrl, {
      ...auth,
      segmentId: segment.segmentId,
    });
    const response = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": auth.code,
        "X-Device-Id": auth.deviceId,
        "X-Call-Id": auth.callId,
        "X-Recording-Segment-Id": segment.segmentId,
        "X-Recording-Upload-Token": ticket.uploadToken,
      },
      body: new Blob(["final short segment"], { type: "audio/webm" }),
    });
    expect(response.status).toBe(200);
    expect((await t.query(api.callCompliance.status, auth))?.status).toBe(
      "stopped",
    );
    expect(
      await t.run((ctx) => ctx.db.query("call_recordings").collect()),
    ).toHaveLength(1);
  });

  test("admin Stop finalization never permits a revoked device", async () => {
    const t = await setup();
    await activateRecording(t);
    const auth = { code: "ALICE", deviceId: "alice-device", callId: "call-1" };
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      ...auth,
      clientNonce: "revoked-during-flush",
    });
    const ticket = await t.mutation(api.callCompliance.generateUploadUrl, {
      ...auth,
      segmentId: segment.segmentId,
    });
    await t.mutation(api.callCompliance.stop, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await t.mutation(api.roleManagement.setEnabled, {
      password: "ADMIN:admin-device",
      targetCode: "ALICE",
      enabled: false,
    });
    const response = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": auth.code,
        "X-Device-Id": auth.deviceId,
        "X-Call-Id": auth.callId,
        "X-Recording-Segment-Id": segment.segmentId,
        "X-Recording-Upload-Token": ticket.uploadToken,
      },
      body: new Blob(["must not save"], { type: "audio/webm" }),
    });
    expect(response.status).toBe(403);
    expect(
      await t.run((ctx) => ctx.db.query("call_recordings").collect()),
    ).toHaveLength(0);
  });

  test("an administrator can request and every participant must consent", async () => {
    const t = await setup();
    await t.mutation(api.callCompliance.request, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await t.mutation(api.callCompliance.respond, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      consent: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("requested");
    await t.mutation(api.callCompliance.respond, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      consent: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("active");
    await t.mutation(api.callCompliance.setTranslation, {
      password: "ADMIN:admin-device",
      callId: "call-1",
      enabled: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.translationEnabled,
    ).toBe(true);
  });

  test("participant status exposes only fields required by the in-call consent UI", async () => {
    const t = await setup();
    await activateRecording(t);

    const status = await t.query(api.callCompliance.status, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
    });

    expect(status).toEqual({
      status: "active",
      consentedCodes: ["ALICE", "BOBXX"],
      translationEnabled: false,
      myConsent: true,
      myDecline: false,
    });
    expect(status).not.toHaveProperty("consentEpoch");
    expect(status).not.toHaveProperty("requestedBy");
    expect(status).not.toHaveProperty("_id");
  });

  test("a participant can decline", async () => {
    const t = await setup();
    await t.mutation(api.callCompliance.request, {
      password: "ROOT1:root-device",
      callId: "call-1",
    });
    await t.mutation(api.callCompliance.respond, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      consent: false,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("declined");
  });

  test("a cross-code transfer cannot replace the source until its current recording segment is saved and acknowledged", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "cross-code-final-segment",
    });
    const transferId = await stageAliceTransfer(
      t,
      "CAROL",
      "carol-device",
      "CAROL-browser",
    );

    await expect(
      t.query(internal.callState.authorizeTransferCompletion, {
        code: "CAROL",
        deviceId: "carol-device",
        transferId,
      }),
    ).rejects.toThrow("录音");
    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "CAROL",
        deviceId: "carol-device",
        transferId,
        sourceIdentities: ["ALICE-browser"],
      }),
    ).rejects.toThrow("录音");
    expect(
      await t.run(async (ctx) => {
        const call = await ctx.db
          .query("live_calls")
          .withIndex("by_call_id", (q) => q.eq("callId", "call-1"))
          .unique();
        return call?.participantCodes;
      }),
    ).toEqual(["ALICE", "BOBXX"]);
    await expect(
      t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
        code: "CAROL",
        deviceId: "carol-device",
        callId: "call-1",
        transferId,
      }),
    ).rejects.toThrow("来源装置");
    await expect(
      t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        transferId,
      }),
    ).rejects.toThrow("录音");

    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: segment.segmentId,
    });
    const storageId = await storeRecordingFile(t, "cross-code-final-audio");
    await t.mutation(internal.callCompliance.saveRecording, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: segment.segmentId,
      storageId,
      mimeType: "audio/webm",
    });
    await expect(
      t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        transferId,
      }),
    ).resolves.toMatchObject({ acknowledged: true });
    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "CAROL",
        deviceId: "carol-device",
        transferId,
        sourceIdentities: ["ALICE-browser"],
      }),
    ).resolves.toMatchObject({ completed: true });
  });

  test("a same-code handoff freezes only the old recorder after its drain acknowledgement", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await completeRecordingSegment(
      t,
      "ALICE",
      "alice-device",
      "same-code-final-segment",
    );
    const transferId = await stageAliceTransfer(
      t,
      "ALICE",
      "alice-mobile",
      "ALICE-mobile",
    );

    await expect(
      t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        transferId,
      }),
    ).resolves.toMatchObject({ acknowledged: true });
    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "old-device-after-ack",
      }),
    ).rejects.toThrow("转接");
    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "ALICE",
        deviceId: "alice-mobile",
        transferId,
        sourceIdentities: ["ALICE-browser"],
      }),
    ).resolves.toMatchObject({ completed: true });
    expect(
      (await t.run((ctx) => ctx.db.get(segment.segmentId)))?.consumedAt,
    ).toEqual(expect.any(Number));
  });

  test("a recording-drain acknowledgement cannot carry into a replacement transfer attempt", async () => {
    const t = await setup();
    await activateRecording(t);
    const firstTransferId = await stageAliceTransfer(
      t,
      "CAROL",
      "carol-device",
      "CAROL-first",
    );
    await t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      transferId: firstTransferId,
    });
    await t.mutation(api.callState.cancelTransfer, {
      code: "ALICE",
      deviceId: "alice-device",
      transferId: firstTransferId,
    });
    await expect(
      t.mutation(api.callCompliance.acknowledgeTransferRecordingDrain, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        transferId: firstTransferId,
      }),
    ).rejects.toThrow("状态");

    const secondTransferId = await stageAliceTransfer(
      t,
      "CAROL",
      "carol-device",
      "CAROL-second",
    );
    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "CAROL",
        deviceId: "carol-device",
        transferId: secondTransferId,
        sourceIdentities: ["ALICE-browser"],
      }),
    ).rejects.toThrow("录音");
  });

  test("a different-code transfer grants only the remaining peer's already-open segments a short old-epoch drain", async () => {
    const t = await setup();
    await activateRecording(t);
    const [remoteSegment, expiringSegment, resetSegment] = await Promise.all(
      [
        "remote-generation-1",
        "remote-generation-expiring",
        "remote-generation-reset",
      ].map((clientNonce) =>
        t.mutation(api.callCompliance.beginRecordingSegment, {
          code: "BOBXX",
          deviceId: "bob-device",
          callId: "call-1",
          clientNonce,
        }),
      ),
    );
    const uploadTokens = new Map<string, string>();
    for (const segment of [remoteSegment, expiringSegment, resetSegment]) {
      const ticket = await t.mutation(api.callCompliance.generateUploadUrl, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: segment.segmentId,
      });
      uploadTokens.set(segment.segmentId, ticket.uploadToken);
    }
    const wrongDeviceSegmentId = await t.run((ctx) =>
      ctx.db.insert("call_recording_segments", {
        callId: "call-1",
        tenantId: "nyfbi",
        participantCode: "BOBXX",
        deviceId: "bob-old-device",
        consentEpoch: 1,
        clientNonce: "wrong-device-old-epoch",
        startedAt: Date.now(),
        expiresAt: Date.now() + 600_000,
      }),
    );
    const transferId = await transferAliceToCarol(t);
    const graceDeadline = (
      await t.run((ctx) => ctx.db.get(remoteSegment.segmentId))
    )?.transferDrainDeadline;
    expect(
      await t.run((ctx) => ctx.db.get(remoteSegment.segmentId)),
    ).toMatchObject({
      transferDrainTransferId: transferId,
      transferDrainDeadline: expect.any(Number),
      participantCode: "BOBXX",
      deviceId: "bob-device",
      consentEpoch: 1,
    });
    expect(graceDeadline).toBeGreaterThan(Date.now());
    expect(graceDeadline).toBeLessThanOrEqual(Date.now() + 15_000);
    expect(
      await t.run((ctx) => ctx.db.get(wrongDeviceSegmentId)),
    ).not.toHaveProperty("transferDrainTransferId");

    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "remote-generation-after-transfer",
      }),
    ).rejects.toThrow("不允许录音");
    await t.mutation(api.callCompliance.respond, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      consent: true,
    });
    await t.mutation(api.callCompliance.respond, {
      code: "CAROL",
      deviceId: "carol-device",
      callId: "call-1",
      consent: true,
    });
    await expect(
      t.query(api.callCompliance.recordingSegmentUploadStatus, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: remoteSegment.segmentId,
      }),
    ).resolves.toEqual({ consumed: false, uploadable: true });
    const graceUpload = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": "BOBXX",
        "X-Device-Id": "bob-device",
        "X-Call-Id": "call-1",
        "X-Recording-Segment-Id": remoteSegment.segmentId,
        "X-Recording-Upload-Token": uploadTokens.get(remoteSegment.segmentId)!,
      },
      body: new Blob(["old remote segment"], { type: "audio/webm" }),
    });
    expect(graceUpload.status).toBe(200);
    await expect(
      t.query(api.callCompliance.recordingSegmentUploadStatus, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: remoteSegment.segmentId,
      }),
    ).resolves.toEqual({ consumed: true, uploadable: false });

    await t.run((ctx) =>
      ctx.db.patch(expiringSegment.segmentId, {
        transferDrainDeadline: Date.now() - 1,
      }),
    );
    await expect(
      t.query(api.callCompliance.recordingSegmentUploadStatus, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: expiringSegment.segmentId,
      }),
    ).resolves.toEqual({ consumed: false, uploadable: false });
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: expiringSegment.segmentId,
      }),
    ).rejects.toThrow("录音同意已经失效");
    const expiredUpload = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": "BOBXX",
        "X-Device-Id": "bob-device",
        "X-Call-Id": "call-1",
        "X-Recording-Segment-Id": expiringSegment.segmentId,
        "X-Recording-Upload-Token": uploadTokens.get(
          expiringSegment.segmentId,
        )!,
      },
      body: new Blob(["expired remote segment"], { type: "audio/webm" }),
    });
    expect(expiredUpload.status).toBe(403);

    await t.mutation(api.callCompliance.request, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: resetSegment.segmentId,
      }),
    ).rejects.toThrow("录音同意已经失效");

    await t.mutation(api.callCompliance.respond, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      consent: true,
    });
    await t.mutation(api.callCompliance.respond, {
      code: "CAROL",
      deviceId: "carol-device",
      callId: "call-1",
      consent: true,
    });
    const nextRemoteSegment = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "remote-generation-2",
      },
    );
    expect(nextRemoteSegment.segmentId).not.toBe(remoteSegment.segmentId);
    const [oldSegmentRecord, nextSegmentRecord] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(remoteSegment.segmentId),
        ctx.db.get(nextRemoteSegment.segmentId),
      ]),
    );
    expect(oldSegmentRecord?.consentEpoch).toBe(1);
    expect(nextSegmentRecord?.consentEpoch).toBe(3);
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: nextRemoteSegment.segmentId,
      }),
    ).resolves.toEqual({
      uploadToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("authorization revocation or call cleanup cancels a transfer drain grace", async () => {
    const t = await setup();
    await activateRecording(t);
    const [revokedSegment, cleanedSegment] = await Promise.all(
      ["remote-revoked", "remote-cleaned"].map((clientNonce) =>
        t.mutation(api.callCompliance.beginRecordingSegment, {
          code: "BOBXX",
          deviceId: "bob-device",
          callId: "call-1",
          clientNonce,
        }),
      ),
    );
    await transferAliceToCarol(t);

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "BOBXX"))
        .unique();
      await ctx.db.patch(allowed!._id, { enabled: false });
    });
    await expect(
      t.query(api.callCompliance.recordingSegmentUploadStatus, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: revokedSegment.segmentId,
      }),
    ).rejects.toThrow("停用");

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "BOBXX"))
        .unique();
      const call = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", "call-1"))
        .unique();
      await ctx.db.patch(allowed!._id, { enabled: true });
      await ctx.db.patch(call!._id, { status: "ended", endedAt: Date.now() });
    });
    await expect(
      t.query(api.callCompliance.recordingSegmentUploadStatus, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: cleanedSegment.segmentId,
      }),
    ).rejects.toThrow("不是此通话的参与者");
  });

  test("recording upload authorization never exposes a raw storage URL and expires after the Stop drain deadline", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "http-proxy-ticket",
    });
    const ticket = await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: segment.segmentId,
    });
    const storedSegment = await t.run((ctx) => ctx.db.get(segment.segmentId));
    expect(storedSegment?.uploadUrl).toBeUndefined();
    expect(storedSegment?.uploadTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedSegment?.uploadTokenHash).not.toBe(ticket.uploadToken);
    await expect(
      t.query(internal.callCompliance.authorizeRecordingHttpUpload, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        uploadToken: ticket.uploadToken,
      }),
    ).resolves.toEqual({ authorized: true });

    await t.mutation(api.callCompliance.stop, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await finishStopDeadline(t);
    await expect(
      t.query(internal.callCompliance.authorizeRecordingHttpUpload, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("录音同意已经失效");
    const storageBefore = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    const rejectedUpload = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": "ALICE",
        "X-Device-Id": "alice-device",
        "X-Call-Id": "call-1",
        "X-Recording-Segment-Id": segment.segmentId,
        "X-Recording-Upload-Token": ticket.uploadToken,
      },
      body: new Blob(["must not be stored"], { type: "audio/webm" }),
    });
    expect(rejectedUpload.status).toBe(403);
    const storageAfter = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(storageAfter).toHaveLength(storageBefore.length);
  });

  test("the guarded HTTP endpoint stores and finalizes one authorized audio segment", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "http-proxy-success",
    });
    const ticket = await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: segment.segmentId,
    });
    const response = await t.fetch("/api/call-recordings/upload", {
      method: "POST",
      headers: {
        "Content-Type": "audio/webm",
        "X-Authorization-Code": "ALICE",
        "X-Device-Id": "alice-device",
        "X-Call-Id": "call-1",
        "X-Recording-Segment-Id": segment.segmentId,
        "X-Recording-Upload-Token": ticket.uploadToken,
      },
      body: new Blob(["authorized audio"], { type: "audio/webm" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { storageId?: string };
    expect(payload.storageId).toEqual(expect.any(String));
    const [storedSegment, recordings] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(segment.segmentId),
        ctx.db
          .query("call_recordings")
          .withIndex("by_call", (q) => q.eq("callId", "call-1"))
          .collect(),
      ]),
    );
    expect(storedSegment?.consumedAt).toEqual(expect.any(Number));
    expect(storedSegment?.uploadTokenHash).toBeUndefined();
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({
      tenantId: "nyfbi",
      participantCode: "ALICE",
      storageId: payload.storageId,
    });
  });

  test("a same-code device handoff rejects the old recorder and permits the new device", async () => {
    const t = await setup();
    await activateRecording(t);

    await transferAliceToOwnMobile(t);

    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "old-device-after-handoff",
      }),
    ).rejects.toThrow("另一台设备接手");
    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "ALICE",
        deviceId: "alice-mobile",
        callId: "call-1",
        clientNonce: "new-device-segment",
      }),
    ).resolves.toMatchObject({ segmentId: expect.any(String) });
  });

  test("an in-flight translation cannot be stored after a same-code device handoff", async () => {
    const t = await setup();
    await activateRecording(t);
    await t.mutation(api.callCompliance.setTranslation, {
      password: "ADMIN:admin-device",
      callId: "call-1",
      enabled: true,
    });
    const capability = (await t.query(
      internal.callCompliance.authorizeTranslation,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
      },
    )) as {
      speakerCode: string;
      deviceId: string;
      consentEpoch: number;
    };

    await transferAliceToOwnMobile(t);

    await expect(
      t.mutation(internal.callCompliance.storeTranslation, {
        callId: "call-1",
        speakerCode: capability.speakerCode,
        deviceId: capability.deviceId,
        consentEpoch: capability.consentEpoch,
        text: "old device translation",
        originalText: "old device translation",
        sourceLanguage: "en",
        translated: false,
      }),
    ).rejects.toThrow("另一台设备接手");
    const transcripts = await t.run((ctx) =>
      ctx.db.query("call_transcripts").collect(),
    );
    expect(transcripts).toHaveLength(0);
  });

  test("an in-flight translation cannot cross a revoked and renewed consent epoch", async () => {
    const t = await setup();
    await activateRecording(t);
    await t.mutation(api.callCompliance.setTranslation, {
      password: "ADMIN:admin-device",
      callId: "call-1",
      enabled: true,
    });
    const capability = (await t.query(
      internal.callCompliance.authorizeTranslation,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
      },
    )) as {
      speakerCode: string;
      deviceId: string;
      consentEpoch: number;
    };

    await t.mutation(api.callCompliance.stop, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await activateRecording(t);
    await t.mutation(api.callCompliance.setTranslation, {
      password: "ADMIN:admin-device",
      callId: "call-1",
      enabled: true,
    });

    await expect(
      t.mutation(internal.callCompliance.storeTranslation, {
        callId: "call-1",
        speakerCode: capability.speakerCode,
        deviceId: capability.deviceId,
        consentEpoch: capability.consentEpoch,
        text: "old epoch translation",
        originalText: "old epoch translation",
        sourceLanguage: "en",
        translated: false,
      }),
    ).rejects.toThrow("翻译同意已经失效");
    const transcripts = await t.run((ctx) =>
      ctx.db.query("call_transcripts").collect(),
    );
    expect(transcripts).toHaveLength(0);
  });

  test("ended calls reject new and previously authorized recording capabilities", async () => {
    const t = await setup();
    await activateRecording(t);
    const pendingGenerate = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "ended-generate",
      },
    );
    const pendingSave = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "ended-save",
      },
    );
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: pendingSave.segmentId,
    });
    const storageId = await storeRecordingFile(t, "ended call recording");
    await t.run(async (ctx) => {
      const call = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", "call-1"))
        .unique();
      if (!call) throw new Error("missing test call");
      await ctx.db.patch(call._id, { status: "ended", endedAt: Date.now() });
    });

    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "after-call-ended",
      }),
    ).rejects.toThrow("不是此通话的参与者");
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: pendingGenerate.segmentId,
      }),
    ).rejects.toThrow("不是此通话的参与者");
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: pendingSave.segmentId,
        storageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("不是此通话的参与者");
  });

  test("same recorder nonce is idempotent while different recorder generations get independent capabilities", async () => {
    const t = await setup();
    await activateRecording(t);

    const first = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "generation-one",
    });
    const firstRetry = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "generation-one",
      },
    );
    const second = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "generation-two",
    });

    expect(firstRetry.segmentId).toBe(first.segmentId);
    expect(second.segmentId).not.toBe(first.segmentId);
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: first.segmentId,
    });
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: second.segmentId,
    });
    const [firstStorageId, secondStorageId] = await Promise.all([
      storeRecordingFile(t, "old recorder"),
      storeRecordingFile(t, "new recorder"),
    ]);
    await t.mutation(internal.callCompliance.saveRecording, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: first.segmentId,
      storageId: firstStorageId,
      mimeType: "audio/webm",
    });
    const untouchedSecondSegment = await t.run((ctx) =>
      ctx.db.get(second.segmentId),
    );
    expect(untouchedSecondSegment).not.toHaveProperty("consumedAt");
    expect(untouchedSecondSegment).not.toHaveProperty("storageId");
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: second.segmentId,
        storageId: secondStorageId,
        mimeType: "audio/webm",
      }),
    ).resolves.toBeNull();
  });

  test("re-requesting consent immediately invalidates capabilities and Stop invalidates them after its drain deadline", async () => {
    const t = await setup();
    await activateRecording(t);
    const beforeRequestReset = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "before-request-reset",
      },
    );
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: beforeRequestReset.segmentId,
    });

    await t.mutation(api.callCompliance.request, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: beforeRequestReset.segmentId,
      }),
    ).rejects.toThrow("录音同意已经失效");

    await t.mutation(api.callCompliance.respond, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      consent: true,
    });
    await t.mutation(api.callCompliance.respond, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      consent: true,
    });
    const beforeStop = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "before-stop",
      },
    );
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: beforeStop.segmentId,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["must not survive stop"])),
    );

    await t.mutation(api.callCompliance.stop, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await finishStopDeadline(t);
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: beforeStop.segmentId,
        storageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音同意已经失效");
  });

  test("unique nonce spam is bounded and cannot block stop or a different-code transfer", async () => {
    const t = await setup();
    await activateRecording(t);

    for (let index = 0; index < 3; index += 1)
      await completeRecordingSegment(
        t,
        "ALICE",
        "alice-device",
        `stop-spam-completed-${index}`,
      );
    const beforeStop = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "stop-spam-pending",
      },
    );
    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "stop-spam-over-limit",
      }),
    ).rejects.toThrow("RATE_LIMITED");

    await expect(
      t.mutation(api.callCompliance.stop, {
        password: "ADMIN:admin-device",
        callId: "call-1",
      }),
    ).resolves.toBeNull();
    await finishStopDeadline(t);
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: beforeStop.segmentId,
      }),
    ).rejects.toThrow("录音同意已经失效");

    await activateRecording(t);
    for (let index = 0; index < 3; index += 1)
      await completeRecordingSegment(
        t,
        "BOBXX",
        "bob-device",
        `transfer-spam-completed-${index}`,
      );
    const beforeTransfer = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "transfer-spam-pending",
      },
    );
    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "transfer-spam-over-limit",
      }),
    ).rejects.toThrow("RATE_LIMITED");
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      segmentId: beforeTransfer.segmentId,
    });
    const storageId = await storeRecordingFile(t, "old epoch recording");

    await expect(transferAliceToCarol(t)).resolves.toEqual(expect.any(String));
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: beforeTransfer.segmentId,
        storageId,
        mimeType: "audio/webm",
      }),
    ).resolves.toBeNull();
  });

  test("a segment capability is bound to call and device, requires an upload grant, and is single use", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "binding-test-generation",
    });
    const firstStorageId = await storeRecordingFile(t, "first segment");
    const otherStorageId = await storeRecordingFile(t, "other segment");

    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-mobile",
        callId: "call-1",
        segmentId: segment.segmentId,
      }),
    ).rejects.toThrow("录音片段凭证无效");
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        storageId: firstStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("尚未取得上传权限");

    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: segment.segmentId,
    });
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "wrong-call",
        segmentId: segment.segmentId,
        storageId: firstStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音片段凭证无效");
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        storageId: firstStorageId,
        mimeType: "audio/webm",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        storageId: otherStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("已经保存");
  });

  test("a stored recording can be consumed only once across segments and legacy recordings", async () => {
    const t = await setup();
    await activateRecording(t);
    const first = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "storage-owner",
    });
    const second = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "storage-reuser",
    });
    for (const segment of [first, second])
      await t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
      });
    const sharedStorageId = await storeRecordingFile(t, "shared recording");
    await t.mutation(internal.callCompliance.saveRecording, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: first.segmentId,
      storageId: sharedStorageId,
      mimeType: "audio/webm",
    });
    await t.run(async (ctx) => {
      const recording = await ctx.db
        .query("call_recordings")
        .withIndex("by_storage_id", (q) => q.eq("storageId", sharedStorageId))
        .unique();
      if (!recording) throw new Error("missing saved recording fixture");
      await ctx.db.delete(recording._id);
    });
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: second.segmentId,
        storageId: sharedStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音文件已经使用");

    const legacyStorageId = await storeRecordingFile(t, "legacy recording");
    await t.run((ctx) =>
      ctx.db.insert("call_recordings", {
        callId: "legacy-call",
        participantCode: "ALICE",
        participantName: "Alice",
        storageId: legacyStorageId,
        mimeType: "audio/webm",
        createdAt: Date.now(),
      }),
    );
    const third = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "legacy-storage-reuser",
    });
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: third.segmentId,
    });
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: third.segmentId,
        storageId: legacyStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音文件已经使用");
  });

  test("recording saves reject non-audio, mismatched, and oversized uploads", async () => {
    const t = await setup();
    await activateRecording(t);
    const segmentIds = [];
    for (const clientNonce of ["wrong-type", "mismatch", "oversized"]) {
      const segment = await t.mutation(
        api.callCompliance.beginRecordingSegment,
        {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
          clientNonce,
        },
      );
      await t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
      });
      segmentIds.push(segment.segmentId);
    }

    const imageStorageId = await storeRecordingFile(
      t,
      "not audio",
      "image/png",
    );
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segmentIds[0],
        storageId: imageStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("仅允许上传音频");

    const mismatchedStorageId = await storeRecordingFile(
      t,
      "mismatch",
      "audio/ogg",
    );
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segmentIds[1],
        storageId: mismatchedStorageId,
        mimeType: "audio/webm;codecs=opus",
      }),
    ).rejects.toThrow("录音文件类型不一致");

    const oversizedStorageId = await storeRecordingFile(
      t,
      "small fixture",
      "audio/webm",
      100 * 1024 * 1024,
    );
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segmentIds[2],
        storageId: oversizedStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音文件过大");
  });

  test("an expired recording segment cannot obtain an upload URL or be saved", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "expiry-test-generation",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(segment.segmentId, { expiresAt: Date.now() - 1 });
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["expired segment"])),
    );

    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
      }),
    ).rejects.toThrow("已经过期");
    await expect(
      t.mutation(internal.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        storageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("已经过期");
  });
});
