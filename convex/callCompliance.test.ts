import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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
  await t.mutation(api.callCompliance.saveRecording, {
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
  await t.mutation(internal.callState.confirmTransferJoined, {
    code: "CAROL",
    deviceId: "carol-device",
    transferId,
    sourceIdentities: ["ALICE-browser"],
  });
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
  await t.mutation(internal.callState.confirmTransferJoined, {
    code: "ALICE",
    deviceId: "alice-mobile",
    transferId,
    sourceIdentities: ["ALICE-browser"],
  });
}

describe("consent-gated call recording", () => {
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

  test("a different-code transfer invalidates every old-epoch capability even after upload was authorized", async () => {
    const t = await setup();
    await activateRecording(t);
    const segment = await t.mutation(api.callCompliance.beginRecordingSegment, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      clientNonce: "source-generation-1",
    });
    const remoteSegment = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "remote-generation-1",
      },
    );
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      segmentId: remoteSegment.segmentId,
    });
    const oldRemoteStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["old remote segment"])),
    );

    await transferAliceToCarol(t);

    await expect(
      t.mutation(api.callCompliance.beginRecordingSegment, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        clientNonce: "remote-generation-after-transfer",
      }),
    ).rejects.toThrow("不允许录音");
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
      }),
    ).rejects.toThrow("不是此通话的参与者");
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: remoteSegment.segmentId,
        storageId: oldRemoteStorageId,
        mimeType: "audio/webm",
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
    expect(nextSegmentRecord?.consentEpoch).toBe(2);
    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: nextRemoteSegment.segmentId,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  test("a same-code device handoff rejects old-device capabilities and permits the new device", async () => {
    const t = await setup();
    await activateRecording(t);
    const pendingGenerate = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "old-device-generate",
      },
    );
    const pendingSave = await t.mutation(
      api.callCompliance.beginRecordingSegment,
      {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        clientNonce: "old-device-save",
      },
    );
    await t.mutation(api.callCompliance.generateUploadUrl, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      segmentId: pendingSave.segmentId,
    });
    const storageId = await storeRecordingFile(t, "old device recording");

    await transferAliceToOwnMobile(t);

    await expect(
      t.mutation(api.callCompliance.generateUploadUrl, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: pendingGenerate.segmentId,
      }),
    ).rejects.toThrow("另一台设备接手");
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: pendingSave.segmentId,
        storageId,
        mimeType: "audio/webm",
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
      t.mutation(api.callCompliance.saveRecording, {
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
    await t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: second.segmentId,
        storageId: secondStorageId,
        mimeType: "audio/webm",
      }),
    ).resolves.toBeNull();
  });

  test("re-requesting consent and stopping recording immediately invalidate unfinished capabilities", async () => {
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
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
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

    await expect(transferAliceToCarol(t)).resolves.toBeUndefined();
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
        code: "BOBXX",
        deviceId: "bob-device",
        callId: "call-1",
        segmentId: beforeTransfer.segmentId,
        storageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音同意已经失效");
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "wrong-call",
        segmentId: segment.segmentId,
        storageId: firstStorageId,
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("录音片段凭证无效");
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
        code: "ALICE",
        deviceId: "alice-device",
        callId: "call-1",
        segmentId: segment.segmentId,
        storageId: firstStorageId,
        mimeType: "audio/webm",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.saveRecording, {
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
    await t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
      t.mutation(api.callCompliance.saveRecording, {
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
