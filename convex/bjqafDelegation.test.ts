import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const oldFullCodes = [
  "NINWQ",
  "JKASQ",
  "IFQHT",
  "OYSMH",
  "WCBYQ",
  "TTYQI",
  "OJQML",
  "TQJGR",
  "WMOZP",
  "VMRVM",
] as const;

const oldLimitedCodes = [
  "QQQLJ",
  "KZUWY",
  "UFZYH",
  "XPHHV",
  "CEOFG",
  "TFTCT",
  "CLNST",
  "NMJIU",
  "EHQLF",
  "SNRYO",
  "YANET",
  "ABSMH",
  "GQDAP",
  "HBCLA",
  "MAGAQ",
  "VJSLX",
  "DYEMV",
  "GLXKN",
  "XZEEA",
  "TFJYW",
  "ROPXC",
  "HDPXT",
  "OLEOB",
  "LLPFW",
  "WJSGI",
  "PXCEX",
  "VNVLP",
  "TQYLU",
  "HASSQ",
  "SXVID",
  "JIBFC",
  "DVNHL",
  "ZKFLU",
  "MCWQJ",
  "LXNXY",
  "JVAKV",
  "AWGLT",
  "YFFGS",
  "MQKWX",
  "OIJNO",
  "ENJIZ",
  "SDIVJ",
  "NIBTH",
  "LWRFA",
  "INJWV",
  "TCWHR",
  "MVQVW",
  "AIEVY",
  "LZWKT",
  "WKIHD",
] as const;

const newFullCodes = [
  "DSSYY",
  "VBXAT",
  "NYTOB",
  "EIXMN",
  "GFOTB",
  "EXPKD",
  "UHYTR",
  "CGCUK",
  "ERGRU",
  "XLJPC",
] as const;

const newLimitedCodes = [
  "FRGOD",
  "MJPCW",
  "LXXKA",
  "RNGEC",
  "IXWMG",
  "CJFTZ",
  "NBAWY",
  "PFFOU",
  "ZCDAK",
  "MLTRX",
  "GHBTH",
  "WNIYI",
  "TQGRI",
  "SSUSM",
  "VRKKX",
  "IWDAJ",
  "VPMXQ",
  "CPGML",
  "EDSBZ",
  "OXUSC",
  "USIDB",
  "DBDLS",
  "LAREH",
  "AJFLC",
  "MFVIO",
  "FBROU",
  "XMOLQ",
  "BFZBI",
  "XPMDD",
  "JKMNT",
  "CQXLD",
  "MUWVR",
  "QUZFX",
  "RTYEY",
  "UUJCZ",
  "NGQBQ",
  "NHGTL",
  "LEESE",
  "SPCIF",
  "THJWE",
  "BDDYA",
  "IVYGH",
  "ULRTX",
  "NUZRP",
  "FYIBU",
  "MHRIH",
  "XIYHW",
  "WFWAL",
  "XASJV",
  "JRMHV",
] as const;

const allFeatures = {
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

const limitedFeatures = {
  ...allFeatures,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

async function setup() {
  const t = convexTest({ schema, modules });
  const artifacts = await t.run(async (ctx) => {
    const now = Date.now();
    const oldFullProfile = await ctx.db.insert("license_profiles", {
      name: "Company 1 full",
      companyId: "nersp",
      features: allFeatures,
      createdBy: "NERSP",
      createdAt: now,
      updatedAt: now,
    });
    const oldLimitedProfile = await ctx.db.insert("license_profiles", {
      name: "Company 1 limited",
      companyId: "nersp",
      features: limitedFeatures,
      createdBy: "NERSP",
      createdAt: now,
      updatedAt: now,
    });
    const newFullProfile = await ctx.db.insert("license_profiles", {
      name: "Company 2 full",
      companyId: "bjqaf",
      features: allFeatures,
      createdBy: "BJQAF",
      createdAt: now,
      updatedAt: now,
    });
    const newLimitedProfile = await ctx.db.insert("license_profiles", {
      name: "Company 2 limited",
      companyId: "bjqaf",
      features: limitedFeatures,
      createdBy: "BJQAF",
      createdAt: now,
      updatedAt: now,
    });

    for (const [code, companyId, role, licenseProfileId] of [
      ["NERSP", "nersp", "admin", oldFullProfile],
      ["BJQAF", "bjqaf", "admin", newFullProfile],
    ] as const)
      await ctx.db.insert("allowed_codes", {
        code,
        companyId,
        role,
        enabled: true,
        licenseProfileId,
      });

    for (const [codes, companyId, licenseProfileId] of [
      [oldFullCodes, "nersp", oldFullProfile],
      [oldLimitedCodes, "nersp", oldLimitedProfile],
      [newFullCodes, "bjqaf", newFullProfile],
      [newLimitedCodes, "bjqaf", newLimitedProfile],
    ] as const)
      for (const code of codes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId,
          enabled: true,
          licenseProfileId,
        });

    // A later Company 1 full-access code is deliberately outside the exact
    // delegated cohort. The grant must not silently expand as codes are added.
    await ctx.db.insert("allowed_codes", {
      code: "NEXTR",
      role: "user",
      companyId: "nersp",
      enabled: true,
      licenseProfileId: oldFullProfile,
    });

    for (const [code, deviceId, name] of [
      ["NERSP", "nersp-admin-device", "Company 1 administrator"],
      ["BJQAF", "bjqaf-admin-device", "Company 2 administrator"],
      ["NINWQ", "old-full-device", "Old Line2 user"],
      ["NEXTR", "future-old-full-device", "Future old Line2 user"],
      ["QQQLJ", "old-client-device", "Old client"],
      ["DSSYY", "new-full-device", "New Line2 user"],
      ["VBXAT", "new-transfer-device", "New transfer receiver"],
      ["FRGOD", "new-client-device", "New client"],
    ] as const)
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        name,
        usedAt: new Date(now).toISOString(),
      });

    await ctx.db.insert("user_presence", {
      userId: "VBXAT",
      lastSeenAt: now,
      online: true,
    });

    const oldCase = await ctx.db.insert("cases", {
      tenantId: "nersp",
      caseNumber: "OLD-PRIVATE-CASE",
      title: "Company 1 private case",
      status: "open",
      priority: "medium",
      category: "private",
      description: "Must not be delegated with authorization-code management",
      assignedCode: "QQQLJ",
      assignedName: "Old client",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    const documentStorageId = await ctx.storage.store(
      new Blob(["Company 1 private document"]),
    );
    await ctx.db.insert("case_documents", {
      tenantId: "nersp",
      caseId: oldCase,
      caseNumber: "OLD-PRIVATE-CASE",
      fileName: "company-1-private.pdf",
      storageId: documentStorageId,
      uploadedByCode: "NERSP",
      uploadedByName: "Company 1 administrator",
      uploadedAt: new Date(now).toISOString(),
    });
    await ctx.db.insert("live_calls", {
      callId: "company-1-private-call",
      roomName: "company-1-private-room",
      type: "audio",
      status: "connected",
      participantCodes: ["KZUWY", "UFZYH"],
      createdByCode: "KZUWY",
      callerUserId: "KZUWY",
      calleeUserId: "UFZYH",
      createdAt: now,
      lastActivityAt: now,
    });
    await ctx.db.insert("call_compliance", {
      callId: "company-1-recorded-call",
      tenantId: "nersp",
      participantCodes: ["QQQLJ", "KZUWY"],
      consentedCodes: ["QQQLJ", "KZUWY"],
      declinedCodes: [],
      status: "active",
      requestedBy: "NERSP",
      requestedAt: now,
      activatedAt: now,
      translationEnabled: false,
    });
    const recordingStorageId = await ctx.storage.store(
      new Blob(["Company 1 private recording"]),
    );
    await ctx.db.insert("call_recordings", {
      callId: "company-1-recorded-call",
      tenantId: "nersp",
      participantCode: "QQQLJ",
      participantName: "Old client",
      storageId: recordingStorageId,
      mimeType: "audio/webm",
      createdAt: now,
    });
    return { oldCase };
  });
  return { t, artifacts };
}

async function acceptLatestRequest(
  t: Awaited<ReturnType<typeof setup>>["t"],
  targetCode: string,
  targetDeviceId: string,
) {
  const requestId = await t.run(async (ctx) => {
    const request = await ctx.db
      .query("friend_requests")
      .withIndex("by_target_status", (q) =>
        q.eq("targetUserId", targetCode).eq("status", "pending"),
      )
      .order("desc")
      .first();
    if (!request) throw new Error(`Missing friend request for ${targetCode}`);
    return request._id;
  });
  await t.mutation(api.contacts.respondFriendRequest, {
    code: targetCode,
    deviceId: targetDeviceId,
    requestId,
    accept: true,
  });
}

async function setupSameTenantCallWithCrossTenantTransfer() {
  const { t } = await setup();
  const prepared = await t.mutation(api.callState.prepareP2P, {
    code: "NINWQ",
    deviceId: "old-full-device",
    theirCode: "QQQLJ",
    callType: "video",
  });
  await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
    code: "QQQLJ",
    deviceId: "old-client-device",
    callId: prepared.callId,
  });
  await t.mutation(api.callState.markParticipantConnected, {
    code: "NINWQ",
    deviceId: "old-full-device",
    callId: prepared.callId,
  });
  await t.mutation(api.callState.markParticipantConnected, {
    code: "QQQLJ",
    deviceId: "old-client-device",
    callId: prepared.callId,
  });
  await t.mutation(internal.callState.recordParticipantIdentities, {
    code: "NINWQ",
    deviceId: "old-full-device",
    callId: prepared.callId,
    identities: ["NINWQ-source-browser"],
  });
  const transferId = await t.mutation(api.callState.initiateTransfer, {
    code: "NINWQ",
    deviceId: "old-full-device",
    callId: prepared.callId,
    targetCode: "VBXAT",
  });
  return { t, prepared, transferId };
}

async function insertActiveRecording(
  t: Awaited<ReturnType<typeof setup>>["t"],
  callId: string,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("call_compliance", {
      callId,
      tenantId: "nersp",
      participantCodes: ["NINWQ", "QQQLJ"],
      consentedCodes: ["NINWQ", "QQQLJ"],
      declinedCodes: [],
      status: "active",
      requestedBy: "NERSP",
      requestedAt: now,
      activatedAt: now,
      translationEnabled: false,
    });
  });
}

describe("administrator company isolation", () => {
  test("BJQAF can view and manage only Company 2 authorization codes", async () => {
    const { t } = await setup();
    const visible = await t.query(api.admin.getAllowedCodes, {
      password: "BJQAF:bjqaf-admin-device",
    });
    const visibleCodes = new Set(visible.map((record) => record.code));

    for (const code of [...newFullCodes, ...newLimitedCodes])
      expect(visibleCodes.has(code), code).toBe(true);
    for (const code of ["NERSP", ...oldFullCodes, ...oldLimitedCodes, "NEXTR"])
      expect(visibleCodes.has(code), code).toBe(false);
    expect(visibleCodes.size).toBe(60);

    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "BJQAF:bjqaf-admin-device",
        targetCode: "XPHHV",
        enabled: false,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "BJQAF:bjqaf-admin-device",
        targetCode: "NINWQ",
        enabled: false,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "BJQAF:bjqaf-admin-device",
        targetCode: "NEXTR",
        enabled: false,
      }),
    ).rejects.toThrow();
  });

  test("delegated code management does not expose Company 1 cases, documents, calls, or recordings", async () => {
    const { t } = await setup();
    const password = "BJQAF:bjqaf-admin-device";
    const [cases, documents, calls, compliance] = await Promise.all([
      t.query(api.admin.getAllCases, { password }),
      t.query(api.caseDocuments.listAll, { password }),
      t.query(api.admin.getActiveCalls, { password }),
      t.query(api.callCompliance.adminDashboard, { password }),
    ]);

    expect(cases.map((record) => record.caseNumber)).not.toContain(
      "OLD-PRIVATE-CASE",
    );
    expect(documents.map((record) => record.fileName)).not.toContain(
      "company-1-private.pdf",
    );
    expect(calls.map((record) => record.id)).not.toContain(
      "company-1-private-call",
    );
    expect(compliance.map((record) => record.callId)).not.toContain(
      "company-1-recorded-call",
    );
  });

  test.each([
    ["companyId", { companyId: "other-company" }],
    ["role", { role: "admin" as const }],
  ])(
    "an enumerated code loses communication and BJQAF management grants when its %s changes",
    async (_field, patch) => {
      const { t } = await setup();
      await t.run(async (ctx) => {
        const target = await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", "QQQLJ"))
          .unique();
        if (!target) throw new Error("Missing QQQLJ fixture");
        await ctx.db.patch(target._id, patch);
      });

      await expect(
        t.query(api.contacts.searchUser, {
          requesterCode: "DSSYY",
          deviceId: "new-full-device",
          query: "QQQLJ",
        }),
      ).resolves.toEqual([]);
      await expect(
        t.mutation(api.roleManagement.setEnabled, {
          password: "BJQAF:bjqaf-admin-device",
          targetCode: "QQQLJ",
          enabled: false,
        }),
      ).rejects.toThrow();
    },
  );
});

describe("exact cross-company communication grants", () => {
  test("a Company 2 full code can add, message, and call an old Company 1 customer", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "DSSYY",
        deviceId: "new-full-device",
        query: "qqqlj",
      }),
    ).resolves.toEqual([
      { code: "QQQLJ", name: "Old client", department: undefined },
    ]);
    await expect(
      t.mutation(api.contacts.addContact, {
        ownerCode: "DSSYY",
        deviceId: "new-full-device",
        targetCode: "QQQLJ",
      }),
    ).resolves.toMatchObject({ name: "Old client", pending: true });
    await acceptLatestRequest(t, "QQQLJ", "old-client-device");

    await expect(
      t.query(api.contacts.getContacts, {
        ownerCode: "DSSYY",
        deviceId: "new-full-device",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ ownerCode: "DSSYY", targetCode: "QQQLJ" }),
    ]);
    await expect(
      t.mutation(api.messages.sendText, {
        myCode: "DSSYY",
        myName: "Ignored client name",
        theirCode: "QQQLJ",
        deviceId: "new-full-device",
        text: "Granted cross-company message",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "DSSYY",
        deviceId: "new-full-device",
        theirCode: "QQQLJ",
        callType: "video",
      }),
    ).resolves.toMatchObject({ peerCode: "QQQLJ" });
  });

  test("an old Company 1 full code can add a Company 2 customer and the accepted relationship works both ways", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "NINWQ",
        deviceId: "old-full-device",
        query: "frgod",
      }),
    ).resolves.toEqual([
      { code: "FRGOD", name: "New client", department: undefined },
    ]);
    await t.mutation(api.contacts.addContact, {
      ownerCode: "NINWQ",
      deviceId: "old-full-device",
      targetCode: "FRGOD",
    });
    await acceptLatestRequest(t, "FRGOD", "new-client-device");

    await expect(
      t.query(api.contacts.getContacts, {
        ownerCode: "FRGOD",
        deviceId: "new-client-device",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ ownerCode: "FRGOD", targetCode: "NINWQ" }),
    ]);
    await expect(
      t.mutation(api.messages.sendText, {
        myCode: "FRGOD",
        myName: "Ignored client name",
        theirCode: "NINWQ",
        deviceId: "new-client-device",
        text: "Accepted contacts can reply",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "NINWQ",
        deviceId: "old-full-device",
        theirCode: "FRGOD",
        callType: "video",
      }),
    ).resolves.toMatchObject({ peerCode: "FRGOD" });
  });

  test("an old Company 1 full code can also communicate with a Company 2 full code", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "NINWQ",
        deviceId: "old-full-device",
        query: "DSSYY",
      }),
    ).resolves.toEqual([
      { code: "DSSYY", name: "New Line2 user", department: undefined },
    ]);
    await t.mutation(api.contacts.addContact, {
      ownerCode: "NINWQ",
      deviceId: "old-full-device",
      targetCode: "DSSYY",
    });
    await acceptLatestRequest(t, "DSSYY", "new-full-device");

    await expect(
      t.mutation(api.messages.sendText, {
        myCode: "DSSYY",
        myName: "Ignored client name",
        theirCode: "NINWQ",
        deviceId: "new-full-device",
        text: "The full-access pairing is reciprocal",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "NINWQ",
        deviceId: "old-full-device",
        theirCode: "DSSYY",
        callType: "video",
      }),
    ).resolves.toMatchObject({ peerCode: "DSSYY" });
  });

  test("a granted cross-company call can transfer to another Company 2 full code", async () => {
    const { t } = await setup();
    const prepared = await t.mutation(api.callState.prepareP2P, {
      code: "DSSYY",
      deviceId: "new-full-device",
      theirCode: "QQQLJ",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "QQQLJ",
      deviceId: "old-client-device",
      callId: prepared.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "DSSYY",
      deviceId: "new-full-device",
      callId: prepared.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "QQQLJ",
      deviceId: "old-client-device",
      callId: prepared.callId,
    });
    await t.mutation(internal.callState.recordParticipantIdentities, {
      code: "DSSYY",
      deviceId: "new-full-device",
      callId: prepared.callId,
      identities: ["DSSYY-source-browser"],
    });

    const transferId = await t.mutation(api.callState.initiateTransfer, {
      code: "DSSYY",
      deviceId: "new-full-device",
      callId: prepared.callId,
      targetCode: "VBXAT",
    });
    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        accept: true,
      }),
    ).resolves.toMatchObject({ callId: prepared.callId });
    await expect(
      t.mutation(internal.callState.authorizeTransferJoin, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        targetIdentity: "VBXAT-target-mobile",
      }),
    ).resolves.toMatchObject({
      callId: prepared.callId,
      remoteUserId: "QQQLJ",
    });
    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        sourceIdentities: ["DSSYY-source-browser"],
      }),
    ).resolves.toMatchObject({
      completed: true,
      fromUserId: "DSSYY",
      targetUserId: "VBXAT",
      sourceIdentities: ["DSSYY-source-browser"],
    });

    await expect(
      t.query(api.callState.callStatus, {
        code: "DSSYY",
        deviceId: "new-full-device",
        callId: prepared.callId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.callState.callStatus, {
        code: "QQQLJ",
        deviceId: "old-client-device",
        callId: prepared.callId,
      }),
    ).resolves.toMatchObject({
      status: "connected",
      peerCode: "VBXAT",
      peerIdentity: "VBXAT-target-mobile",
    });
    await expect(
      t.query(api.callState.callStatus, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        callId: prepared.callId,
      }),
    ).resolves.toMatchObject({ status: "connected", peerCode: "QQQLJ" });

    await t.run(async (ctx) => {
      const [call, transfer] = await Promise.all([
        ctx.db
          .query("live_calls")
          .withIndex("by_call_id", (q) => q.eq("callId", prepared.callId))
          .unique(),
        ctx.db.get(transferId),
      ]);
      expect(call).toMatchObject({
        participantCodes: ["QQQLJ", "VBXAT"],
        callerUserId: "QQQLJ",
        calleeUserId: "VBXAT",
        calleeDeviceId: "new-transfer-device",
        calleeIdentity: "VBXAT-target-mobile",
      });
      expect(transfer).toMatchObject({
        status: "completed",
        cleanupStatus: "pending",
        sourceIdentities: ["DSSYY-source-browser"],
      });
      expect(
        (await ctx.db.system.query("_scheduled_functions").collect()).some(
          (job) =>
            job.name === "calls:retryTransferCleanup" &&
            job.state.kind === "pending",
        ),
      ).toBe(true);
    });
    await expect(
      t.query(internal.callState.transferCleanupDetails, { transferId }),
    ).resolves.toMatchObject({
      participantIdentities: ["DSSYY-source-browser"],
    });
  });

  test("a mixed-tenant transfer refuses to cross while recording is active", async () => {
    const { t } = await setup();
    const prepared = await t.mutation(api.callState.prepareP2P, {
      code: "DSSYY",
      deviceId: "new-full-device",
      theirCode: "QQQLJ",
      callType: "video",
    });
    await t.mutation(api.callState.acceptAndAuthorizeIncomingJoin, {
      code: "QQQLJ",
      deviceId: "old-client-device",
      callId: prepared.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "DSSYY",
      deviceId: "new-full-device",
      callId: prepared.callId,
    });
    await t.mutation(api.callState.markParticipantConnected, {
      code: "QQQLJ",
      deviceId: "old-client-device",
      callId: prepared.callId,
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("call_compliance", {
        callId: prepared.callId,
        tenantId: "bjqaf",
        participantCodes: ["DSSYY", "QQQLJ"],
        consentedCodes: ["DSSYY", "QQQLJ"],
        declinedCodes: [],
        status: "active",
        requestedBy: "BJQAF",
        requestedAt: now,
        activatedAt: now,
        translationEnabled: false,
      });
    });

    await expect(
      t.mutation(api.callState.initiateTransfer, {
        code: "DSSYY",
        deviceId: "new-full-device",
        callId: prepared.callId,
        targetCode: "VBXAT",
      }),
    ).rejects.toThrow("必须先停止并保存通话录音");
  });

  test("recording cannot be requested after a same-tenant call starts a cross-tenant transfer", async () => {
    const { t, prepared } = await setupSameTenantCallWithCrossTenantTransfer();

    await expect(
      t.mutation(api.callCompliance.request, {
        password: "NERSP:nersp-admin-device",
        callId: prepared.callId,
      }),
    ).rejects.toThrow();
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("call_compliance")
          .withIndex("by_call", (q) => q.eq("callId", prepared.callId))
          .unique(),
      ),
    ).resolves.toBeNull();
  });

  test("transfer response rechecks that recording did not start after initiation", async () => {
    const { t, prepared, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await insertActiveRecording(t, prepared.callId);

    await expect(
      t.mutation(api.callState.respondTransfer, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        accept: true,
      }),
    ).rejects.toThrow("必须先停止并保存通话录音");
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({ status: "pending" });
  });

  test("transfer join authorization rechecks that recording did not start after response", async () => {
    const { t, prepared, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await t.mutation(api.callState.respondTransfer, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      accept: true,
    });
    await insertActiveRecording(t, prepared.callId);

    await expect(
      t.mutation(internal.callState.authorizeTransferJoin, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        targetIdentity: "VBXAT-target-mobile",
      }),
    ).rejects.toThrow("必须先停止并保存通话录音");
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({ status: "accepted" });
  });

  test("transfer completion rechecks that recording did not start after join authorization", async () => {
    const { t, prepared, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await t.mutation(api.callState.respondTransfer, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      accept: true,
    });
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await insertActiveRecording(t, prepared.callId);

    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        sourceIdentities: ["NINWQ-source-browser"],
      }),
    ).rejects.toThrow("必须先停止并保存通话录音");
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({ status: "joining" });
  });

  test("a cancelled transfer cannot finalize and return a newly signed join token", async () => {
    const { t, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await t.mutation(api.callState.respondTransfer, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      accept: true,
    });
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await t.mutation(api.callState.cancelTransfer, {
      code: "NINWQ",
      deviceId: "old-full-device",
      transferId,
    });

    await expect(
      t.mutation(internal.callState.finalizeTransferJoinToken, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        targetIdentity: "VBXAT-target-mobile",
      }),
    ).rejects.toThrow();
  });

  test("recording stays blocked after transfer cancellation until the issued token expires and cleanup succeeds afterward", async () => {
    const { t, prepared, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await t.mutation(api.callState.respondTransfer, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      accept: true,
    });
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await t.mutation(internal.callState.finalizeTransferJoinToken, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await t.mutation(api.callState.cancelTransfer, {
      code: "NINWQ",
      deviceId: "old-full-device",
      transferId,
    });

    await expect(
      t.mutation(api.callCompliance.request, {
        password: "NERSP:nersp-admin-device",
        callId: prepared.callId,
      }),
    ).rejects.toThrow("转接接收端清理完成");

    await t.run(async (ctx) => {
      await ctx.db.patch(transferId, {
        cleanupStatus: "completed",
        targetTokenExpiresAt: Date.now() - 2,
        cleanupLastSucceededAt: Date.now() - 1,
      });
    });
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "NERSP:nersp-admin-device",
        callId: prepared.callId,
      }),
    ).resolves.toBeNull();
  });

  test("final transfer confirmation fails closed when the join deadline passes during the room check", async () => {
    const { t, transferId } =
      await setupSameTenantCallWithCrossTenantTransfer();
    await t.mutation(api.callState.respondTransfer, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      accept: true,
    });
    await t.mutation(internal.callState.authorizeTransferJoin, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await t.mutation(internal.callState.finalizeTransferJoinToken, {
      code: "VBXAT",
      deviceId: "new-transfer-device",
      transferId,
      targetIdentity: "VBXAT-target-mobile",
    });
    await expect(
      t.query(internal.callState.authorizeTransferCompletion, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
      }),
    ).resolves.toMatchObject({ transferStatus: "joining" });
    await t.run(async (ctx) => {
      await ctx.db.patch(transferId, { expiresAt: Date.now() - 1 });
    });

    await expect(
      t.mutation(internal.callState.confirmTransferJoined, {
        code: "VBXAT",
        deviceId: "new-transfer-device",
        transferId,
        sourceIdentities: ["NINWQ-source-browser"],
      }),
    ).resolves.toEqual({
      completed: false,
      failureReason: "通话转接加入期限已过。",
    });
    await expect(
      t.run(async (ctx) => ctx.db.get(transferId)),
    ).resolves.toMatchObject({
      status: "failed",
      cleanupStatus: "pending",
      failureReason: "接收端加入超时",
    });
  });

  test("a Company 2 limited code receives no general access to old Company 1 customers", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "FRGOD",
        deviceId: "new-client-device",
        query: "QQQLJ",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.mutation(api.contacts.addContact, {
        ownerCode: "FRGOD",
        deviceId: "new-client-device",
        targetCode: "QQQLJ",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "FRGOD",
        deviceId: "new-client-device",
        theirCode: "QQQLJ",
        callType: "video",
      }),
    ).rejects.toThrow();
  });

  test("the communication grant does not expand to future Company 1 full codes", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "NEXTR",
        deviceId: "future-old-full-device",
        query: "FRGOD",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.mutation(api.contacts.addContact, {
        ownerCode: "NEXTR",
        deviceId: "future-old-full-device",
        targetCode: "FRGOD",
      }),
    ).rejects.toThrow();
  });

  test("contact discovery never returns partial matches", async () => {
    const { t } = await setup();

    for (const query of ["Q", "QQQ", "QQQL"])
      await expect(
        t.query(api.contacts.searchUser, {
          requesterCode: "DSSYY",
          deviceId: "new-full-device",
          query,
        }),
      ).resolves.toEqual([]);
  });

  test("an explicitly granted but unclaimed old customer can be found and added with a non-sensitive placeholder identity", async () => {
    const { t } = await setup();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "DSSYY",
        deviceId: "new-full-device",
        query: "KZUWY",
      }),
    ).resolves.toEqual([{ code: "KZUWY", name: "KZUWY" }]);
    await expect(
      t.mutation(api.contacts.addContact, {
        ownerCode: "DSSYY",
        deviceId: "new-full-device",
        targetCode: "KZUWY",
      }),
    ).resolves.toEqual({ name: "KZUWY", pending: true });

    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("friend_requests")
          .withIndex("by_pair", (q) =>
            q.eq("requesterUserId", "DSSYY").eq("targetUserId", "KZUWY"),
          )
          .unique(),
      ),
    ).resolves.toMatchObject({ status: "pending" });
  });
});
