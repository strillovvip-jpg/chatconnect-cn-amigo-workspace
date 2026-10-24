import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { hashClaimSecret } from "./claimCredentials";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

const makeCodes = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const first = String.fromCharCode(65 + Math.floor(index / 26 ** 2));
    const second = String.fromCharCode(65 + (Math.floor(index / 26) % 26));
    const third = String.fromCharCode(65 + (index % 26));
    return `${prefix}${first}${second}${third}`;
  });

const activationSecret = "A".repeat(32);

async function withClaimSecretHashes<
  T extends {
    adminCode: string;
    fullCodes: string[];
    limitedCodes: string[];
  },
>(input: T) {
  const claimSecretHashes = await Promise.all(
    [input.adminCode, ...input.fullCodes, ...input.limitedCodes].map(
      async (code) => ({
        code,
        hash: await hashClaimSecret(code, activationSecret),
      }),
    ),
  );
  return { ...input, claimSecretHashes };
}

async function setupRoot() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("allowed_codes", {
      code: "ROOT1",
      role: "super_admin",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "ROOT1",
      deviceId: "root-device",
      name: "Global root",
      usedAt: new Date().toISOString(),
    });
  });
  return t;
}

async function provision(
  t: Awaited<ReturnType<typeof setupRoot>>,
  options: {
    adminCode: string;
    fullPrefix: string;
    limitedPrefix: string;
    companyName: string;
  },
) {
  const fullCodes = makeCodes(options.fullPrefix, 10);
  const limitedCodes = makeCodes(options.limitedPrefix, 50);
  const claimSecretHashes = (
    await withClaimSecretHashes({
      adminCode: options.adminCode,
      fullCodes,
      limitedCodes,
    })
  ).claimSecretHashes;
  const result = await t.mutation(api.roleManagement.provisionCompany, {
    password: "ROOT1:root-device",
    companyName: options.companyName,
    adminCode: options.adminCode,
    fullCodes,
    limitedCodes,
    claimSecretHashes,
  });
  return { result, fullCodes, limitedCodes };
}

async function setupUsaFilingRollout() {
  const t = await setupRoot();
  const nersp = await provision(t, {
    adminCode: "NERSP",
    fullPrefix: "NF",
    limitedPrefix: "NL",
    companyName: "USA Filing Company 1",
  });
  const bjqaf = await provision(t, {
    adminCode: "BJQAF",
    fullPrefix: "BF",
    limitedPrefix: "BL",
    companyName: "USA Filing Company 2",
  });
  return { t, nersp, bjqaf };
}

async function uploadDocument(
  t: Awaited<ReturnType<typeof setupRoot>>,
  password: string,
) {
  const previousSite = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  try {
    const url = new URL(
      await t.mutation(api.caseDocuments.generateUploadUrl, { password }),
    );
    const response = await t.fetch(`${url.pathname}${url.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: new Blob(["company document"], { type: "application/pdf" }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).storageId as Id<"_storage">;
  } finally {
    if (previousSite === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousSite;
  }
}

describe("company authorization provisioning", () => {
  test("new company codes must be exactly five English letters", async () => {
    const t = await setupRoot();
    const validFullCodes = makeCodes("VF", 10);
    const validLimitedCodes = makeCodes("VL", 50);

    for (const invalid of [
      {
        adminCode: "A1234",
        fullCodes: validFullCodes,
        limitedCodes: validLimitedCodes,
      },
      {
        adminCode: "ABCDE",
        fullCodes: ["F1234", ...validFullCodes.slice(1)],
        limitedCodes: validLimitedCodes,
      },
      {
        adminCode: "ABCDE",
        fullCodes: validFullCodes,
        limitedCodes: ["ABCDEF", ...validLimitedCodes.slice(1)],
      },
    ]) {
      await expect(
        t.mutation(
          api.roleManagement.provisionCompany,
          await withClaimSecretHashes({
            password: "ROOT1:root-device",
            companyName: "Invalid codes",
            ...invalid,
          }),
        ),
      ).rejects.toThrow("exactly five letters");
    }
  });

  test("a global super administrator atomically creates one company administrator, 10 full codes, and 50 limited codes", async () => {
    const t = await setupRoot();
    const { result, fullCodes, limitedCodes } = await provision(t, {
      adminCode: "ACADM",
      fullPrefix: "AF",
      limitedPrefix: "AL",
      companyName: "Acme Filing",
    });

    expect(result).toEqual({
      companyId: "acadm",
      companyName: "Acme Filing",
      adminCode: "ACADM",
      fullCodes,
      limitedCodes,
    });

    await t.run(async (ctx) => {
      const companyCodes = (
        await ctx.db.query("allowed_codes").collect()
      ).filter((record) => record.companyId === "acadm");
      expect(companyCodes).toHaveLength(61);
      expect(companyCodes.filter((record) => record.role === "admin")).toEqual([
        expect.objectContaining({
          code: "ACADM",
          enabled: true,
          claimSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      expect(
        companyCodes.every((record) =>
          /^[a-f0-9]{64}$/.test(record.claimSecretHash ?? ""),
        ),
      ).toBe(true);
      expect(
        companyCodes.every(
          (record) => record.allowCodeOnlyDeviceClaim !== true,
        ),
      ).toBe(true);

      const fullCode = companyCodes.find(
        (record) => record.code === fullCodes[0],
      );
      const limitedCode = companyCodes.find(
        (record) => record.code === limitedCodes[0],
      );
      const fullProfile = fullCode?.licenseProfileId
        ? await ctx.db.get(fullCode.licenseProfileId)
        : null;
      const limitedProfile = limitedCode?.licenseProfileId
        ? await ctx.db.get(limitedCode.licenseProfileId)
        : null;
      expect(fullProfile).toMatchObject({
        companyId: "acadm",
        features: {
          canPlayVideo: true,
          canScreenShare: true,
          canTransferCall: true,
        },
      });
      expect(limitedProfile).toMatchObject({
        companyId: "acadm",
        features: {
          canPlayVideo: false,
          canScreenShare: false,
          canTransferCall: false,
        },
      });
      expect(
        companyCodes.filter(
          (record) => record.licenseProfileId === fullProfile?._id,
        ),
      ).toHaveLength(10);
      expect(
        companyCodes.filter(
          (record) => record.licenseProfileId === limitedProfile?._id,
        ),
      ).toHaveLength(50);
    });
  });

  test("the internal USA Filing rollout updates exactly 122 validated codes and can revoke them on rollback", async () => {
    const { t, nersp, bjqaf } = await setupUsaFilingRollout();
    const originalClaimSecretHashes = await t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("allowed_codes").collect())
          .filter((record) =>
            ["nersp", "bjqaf"].includes(record.companyId ?? ""),
          )
          .map((record) => [record.code, record.claimSecretHash]),
      ),
    );
    process.env.AUTH_CODE_IMPORT_SECRET = "rollout-secret";
    try {
      await t.run(async (ctx) => {
        for (const code of [
          "NERSP",
          nersp.fullCodes[0],
          nersp.limitedCodes[0],
          "BJQAF",
          bjqaf.fullCodes[0],
          bjqaf.limitedCodes[0],
        ])
          await ctx.db.insert("auth_codes", {
            code,
            deviceId: `${code}-device`,
            deviceIds: [`${code}-device`],
            name: code,
            usedAt: new Date().toISOString(),
          });
      });

      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          {
            password: "rollout-secret",
            enabled: true,
          },
        ),
      ).resolves.toMatchObject({ enabled: true, updated: 122 });

      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(records).toHaveLength(122);
        expect(
          records.every(
            (record) =>
              record.allowCodeOnlyDeviceClaim === true &&
              record.maxDevices === 2,
          ),
        ).toBe(true);
        expect(
          Object.fromEntries(
            records.map((record) => [record.code, record.claimSecretHash]),
          ),
        ).toEqual(originalClaimSecretHashes);
      });

      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          {
            password: "rollout-secret",
            enabled: false,
          },
        ),
      ).resolves.toMatchObject({
        enabled: false,
        updated: 122,
        revokedSessions: true,
      });

      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(records.every((record) => record.maxDevices === 2)).toBe(false);
        expect(
          records.every(
            (record) => record.allowCodeOnlyDeviceClaim === undefined,
          ),
        ).toBe(true);
        expect(
          Object.fromEntries(
            records.map((record) => [record.code, record.claimSecretHash]),
          ),
        ).toEqual(originalClaimSecretHashes);
        const sessions = await ctx.db.query("auth_codes").collect();
        expect(
          sessions.some((session) =>
            records.some((record) => record.code === session.code),
          ),
        ).toBe(false);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("rollback remains available after a manager creates another customer code and always revokes sessions", async () => {
    const { t } = await setupUsaFilingRollout();
    process.env.AUTH_CODE_IMPORT_SECRET = "rollout-secret";
    try {
      await t.mutation(
        internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
        { password: "rollout-secret", enabled: true },
      );
      const limitedProfileId = await t.run(async (ctx) => {
        const profile = (await ctx.db.query("license_profiles").collect()).find(
          (candidate) =>
            candidate.companyId === "nersp" &&
            !candidate.features.canPlayVideo &&
            !candidate.features.canScreenShare &&
            !candidate.features.canTransferCall,
        );
        if (!profile) throw new Error("missing nersp limited profile");
        await ctx.db.insert("auth_codes", {
          code: "NERSP",
          deviceId: "nersp-admin-device",
          deviceIds: ["nersp-admin-device"],
          name: "NERSP",
          usedAt: new Date().toISOString(),
        });
        return profile._id;
      });
      await t.mutation(api.features.createAuthorizationCode, {
        password: "NERSP:nersp-admin-device",
        targetCode: "NEWCU",
        claimSecretHash: await hashClaimSecret("NEWCU", activationSecret),
        profileId: limitedProfileId,
      });
      await t.mutation(api.authCodes.claimCode, {
        code: "NEWCU",
        deviceId: "new-customer-device",
        deviceType: "mobile",
        deviceContext: "standalone",
        surface: "nyfbi",
        name: "New customer",
      });

      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          { password: "rollout-secret", enabled: false },
        ),
      ).resolves.toMatchObject({
        enabled: false,
        updated: 123,
        revokedSessions: true,
      });

      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(records).toHaveLength(123);
        expect(
          records.every(
            (record) => record.allowCodeOnlyDeviceClaim === undefined,
          ),
        ).toBe(true);
        const sessions = await ctx.db.query("auth_codes").collect();
        expect(
          sessions.some((session) =>
            records.some((record) => record.code === session.code),
          ),
        ).toBe(false);
      });

      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          { password: "rollout-secret", enabled: true },
        ),
      ).resolves.toMatchObject({
        enabled: true,
        updated: 123,
        revokedSessions: false,
      });
      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(records).toHaveLength(123);
        expect(
          records.every(
            (record) =>
              record.allowCodeOnlyDeviceClaim === true &&
              record.maxDevices === 2,
          ),
        ).toBe(true);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("the internal USA Filing rollout rejects a wrong import secret without writes", async () => {
    const { t } = await setupUsaFilingRollout();
    process.env.AUTH_CODE_IMPORT_SECRET = "rollout-secret";
    try {
      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          { password: "wrong-secret", enabled: true },
        ),
      ).rejects.toThrow("切换验证失败");
      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(records).toHaveLength(122);
        expect(
          records.every(
            (record) => record.allowCodeOnlyDeviceClaim === undefined,
          ),
        ).toBe(true);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test.each([
    {
      name: "record count",
      corrupt: async (
        t: Awaited<ReturnType<typeof setupRoot>>,
        limitedCode: string,
      ) =>
        t.run(async (ctx) => {
          const record = await ctx.db
            .query("allowed_codes")
            .withIndex("by_code", (q) => q.eq("code", limitedCode))
            .unique();
          if (!record) throw new Error("missing limited-code fixture");
          await ctx.db.delete(record._id);
        }),
      error: "必须正好包含 61 个授权码",
    },
    {
      name: "administrator identity",
      corrupt: async (t: Awaited<ReturnType<typeof setupRoot>>) =>
        t.run(async (ctx) => {
          const record = await ctx.db
            .query("allowed_codes")
            .withIndex("by_code", (q) => q.eq("code", "NERSP"))
            .unique();
          if (!record) throw new Error("missing administrator fixture");
          await ctx.db.patch(record._id, { role: "user" });
        }),
      error: "管理员授权码",
    },
    {
      name: "claim-secret hash",
      corrupt: async (
        t: Awaited<ReturnType<typeof setupRoot>>,
        limitedCode: string,
      ) =>
        t.run(async (ctx) => {
          const record = await ctx.db
            .query("allowed_codes")
            .withIndex("by_code", (q) => q.eq("code", limitedCode))
            .unique();
          if (!record) throw new Error("missing limited-code fixture");
          await ctx.db.patch(record._id, { claimSecretHash: undefined });
        }),
      error: "设备启用密钥摘要",
    },
  ])(
    "the internal USA Filing rollout rejects an invalid $name without partial writes",
    async ({ corrupt, error }) => {
      const { t, nersp } = await setupUsaFilingRollout();
      await corrupt(t, nersp.limitedCodes[0]);
      process.env.AUTH_CODE_IMPORT_SECRET = "rollout-secret";
      try {
        await expect(
          t.mutation(
            internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
            {
              password: "rollout-secret",
              enabled: true,
            },
          ),
        ).rejects.toThrow(error);
        await t.run(async (ctx) => {
          const records = (
            await ctx.db.query("allowed_codes").collect()
          ).filter((record) =>
            ["nersp", "bjqaf"].includes(record.companyId ?? ""),
          );
          expect(
            records.every((record) => record.allowCodeOnlyDeviceClaim !== true),
          ).toBe(true);
        });
      } finally {
        delete process.env.AUTH_CODE_IMPORT_SECRET;
      }
    },
  );

  test("the internal USA Filing rollout validates both tenants before writing either one", async () => {
    const { t, bjqaf } = await setupUsaFilingRollout();
    await t.run(async (ctx) => {
      const record = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", bjqaf.limitedCodes[0]))
        .unique();
      const profile = record?.licenseProfileId
        ? await ctx.db.get(record.licenseProfileId)
        : null;
      if (!profile) throw new Error("missing limited profile fixture");
      await ctx.db.patch(profile._id, {
        features: { ...profile.features, canPlayVideo: true },
      });
    });
    process.env.AUTH_CODE_IMPORT_SECRET = "rollout-secret";
    try {
      await expect(
        t.mutation(
          internal.roleManagement.rolloutUsaFilingCodeOnlyDeviceClaims,
          { password: "rollout-secret", enabled: true },
        ),
      ).rejects.toThrow("受限授权配置");
      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["nersp", "bjqaf"].includes(record.companyId ?? ""),
        );
        expect(
          records.every((record) => record.allowCodeOnlyDeviceClaim !== true),
        ).toBe(true);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("company administrators can see only their own codes, documents, and recording controls", async () => {
    const t = await setupRoot();
    const acme = await provision(t, {
      adminCode: "ACADM",
      fullPrefix: "AF",
      limitedPrefix: "AL",
      companyName: "Acme Filing",
    });
    const beta = await provision(t, {
      adminCode: "BTADM",
      fullPrefix: "BF",
      limitedPrefix: "BL",
      companyName: "Beta Filing",
    });

    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      for (const [code, deviceId] of [
        ["ACADM", "acme-admin-device"],
        ["BTADM", "beta-admin-device"],
        [acme.fullCodes[0], "acme-user-one"],
        [acme.fullCodes[1], "acme-user-two"],
        [beta.fullCodes[0], "beta-user-one"],
        [beta.fullCodes[1], "beta-user-two"],
      ] as const) {
        await ctx.db.insert("auth_codes", {
          code,
          deviceId,
          name: code,
          usedAt: new Date(now).toISOString(),
        });
      }
      const acmeStorage = await ctx.storage.store(new Blob(["acme document"]));
      const betaStorage = await ctx.storage.store(new Blob(["beta document"]));
      const acmeCase = await ctx.db.insert("cases", {
        tenantId: "acadm",
        caseNumber: "ACME-1",
        title: "Acme document case",
        status: "open",
        priority: "medium",
        category: "private",
        description: "Acme only",
        assignedCode: "ACADM",
        assignedName: "Acme admin",
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
      const betaCase = await ctx.db.insert("cases", {
        tenantId: "btadm",
        caseNumber: "BETA-1",
        title: "Beta document case",
        status: "open",
        priority: "medium",
        category: "private",
        description: "Beta only",
        assignedCode: "BTADM",
        assignedName: "Beta admin",
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
      const acmeDocument = await ctx.db.insert("case_documents", {
        tenantId: "acadm",
        caseId: acmeCase,
        caseNumber: "ACME-1",
        fileName: "acme.pdf",
        storageId: acmeStorage,
        uploadedByCode: "ACADM",
        uploadedByName: "Acme admin",
        uploadedAt: new Date(now).toISOString(),
      });
      const betaDocument = await ctx.db.insert("case_documents", {
        tenantId: "btadm",
        caseId: betaCase,
        caseNumber: "BETA-1",
        fileName: "beta.pdf",
        storageId: betaStorage,
        uploadedByCode: "BTADM",
        uploadedByName: "Beta admin",
        uploadedAt: new Date(now).toISOString(),
      });
      await ctx.db.insert("cases", {
        tenantId: "btadm",
        caseNumber: "BETA-SECRET",
        title: "Beta private case",
        status: "open",
        priority: "medium",
        category: "private",
        description: "Beta only",
        assignedCode: beta.fullCodes[0],
        assignedName: beta.fullCodes[0],
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
      const crossUploadStorage = await ctx.storage.store(
        new Blob(["must not attach"]),
      );
      for (const [callId, caller, callee] of [
        ["acme-call", acme.fullCodes[0], acme.fullCodes[1]],
        ["beta-call", beta.fullCodes[0], beta.fullCodes[1]],
      ] as const) {
        await ctx.db.insert("live_calls", {
          callId,
          roomName: `${callId}-room`,
          type: "audio",
          status: "connected",
          participantCodes: [caller, callee],
          createdByCode: caller,
          callerUserId: caller,
          calleeUserId: callee,
          createdAt: now,
        });
      }
      return { acmeDocument, betaDocument, crossUploadStorage };
    });

    const [acmeCodes, betaCodes, acmeDocuments, betaDocuments] =
      await Promise.all([
        t.query(api.admin.getAllowedCodes, {
          password: "ACADM:acme-admin-device",
        }),
        t.query(api.admin.getAllowedCodes, {
          password: "BTADM:beta-admin-device",
        }),
        t.query(api.caseDocuments.listAll, {
          password: "ACADM:acme-admin-device",
        }),
        t.query(api.caseDocuments.listAll, {
          password: "BTADM:beta-admin-device",
        }),
      ]);

    expect(acmeCodes.map((record) => record.code).sort()).toEqual(
      [...acme.fullCodes, ...acme.limitedCodes].sort(),
    );
    expect(betaCodes.map((record) => record.code).sort()).toEqual(
      [...beta.fullCodes, ...beta.limitedCodes].sort(),
    );
    expect(acmeDocuments.map((record) => record.fileName)).toEqual([
      "acme.pdf",
    ]);
    expect(betaDocuments.map((record) => record.fileName)).toEqual([
      "beta.pdf",
    ]);

    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "ACADM:acme-admin-device",
        targetCode: acme.limitedCodes[0],
        enabled: false,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "BTADM:beta-admin-device",
        targetCode: acme.limitedCodes[0],
        enabled: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "ACADM:acme-admin-device",
        targetCode: "ACADM",
        enabled: false,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.deleteCode, {
        password: "ACADM:acme-admin-device",
        targetCode: acme.limitedCodes[1],
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.roleManagement.deleteCode, {
        password: "BTADM:beta-admin-device",
        targetCode: acme.limitedCodes[2],
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(api.caseDocuments.deleteDocument, {
        password: "ACADM:acme-admin-device",
        documentId: ids.betaDocument,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.caseDocuments.saveDocument, {
        password: "ACADM:acme-admin-device",
        caseNumber: "BETA-SECRET",
        idNumber: "BETA-ID",
        name: "Acme same-number case",
        caseName: "Acme same-number case",
        fileName: "acme-same-number.pdf",
        storageId: await uploadDocument(t, "ACADM:acme-admin-device"),
      }),
    ).resolves.toBeDefined();
    await t.run(async (ctx) => {
      const acmeCase = await ctx.db
        .query("cases")
        .withIndex("by_tenant_case_number", (q) =>
          q.eq("tenantId", "acadm").eq("caseNumber", "BETA-SECRET"),
        )
        .unique();
      const betaCase = await ctx.db
        .query("cases")
        .withIndex("by_tenant_case_number", (q) =>
          q.eq("tenantId", "btadm").eq("caseNumber", "BETA-SECRET"),
        )
        .unique();
      expect(acmeCase?.title).toBe("Acme same-number case");
      expect(betaCase?.title).toBe("Beta private case");
    });
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "ACADM:acme-admin-device",
        callId: "beta-call",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "ACADM:acme-admin-device",
        callId: "acme-call",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.callCompliance.request, {
        password: "BTADM:beta-admin-device",
        callId: "beta-call",
      }),
    ).resolves.toBeNull();

    const [acmeRecording, betaRecording] = await Promise.all([
      t.query(api.callCompliance.adminDashboard, {
        password: "ACADM:acme-admin-device",
      }),
      t.query(api.callCompliance.adminDashboard, {
        password: "BTADM:beta-admin-device",
      }),
    ]);
    expect(acmeRecording.map((record) => record.callId)).toEqual(["acme-call"]);
    expect(betaRecording.map((record) => record.callId)).toEqual(["beta-call"]);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.acmeDocument)).not.toBeNull();
      expect(await ctx.db.get(ids.betaDocument)).not.toBeNull();
      expect(
        await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", acme.limitedCodes[0]))
          .unique(),
      ).toMatchObject({ enabled: false, companyId: "acadm" });
      expect(
        await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", acme.limitedCodes[1]))
          .unique(),
      ).toBeNull();
    });
  });

  test("company-scoped codes can sign in on nyfbi but not the aichijp surface", async () => {
    const t = await setupRoot();
    const company = await provision(t, {
      adminCode: "WEBAD",
      fullPrefix: "WF",
      limitedPrefix: "WL",
      companyName: "Web Filing",
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `${company.fullCodes[0]}.${activationSecret}`,
        deviceId: "company-web-device",
        deviceType: "desktop",
        surface: "nyfbi",
        name: "Company user",
      }),
    ).resolves.toMatchObject({ success: true, role: "user" });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `${company.fullCodes[1]}.${activationSecret}`,
        deviceId: "wrong-surface-device",
        deviceType: "desktop",
        surface: "aichijp",
        name: "Wrong surface",
      }),
    ).rejects.toThrow("不能使用这个网站");
  });

  test("ordinary and company-scoped administrators cannot provision another company", async () => {
    const t = await setupRoot();
    await t.run(async (ctx) => {
      for (const item of [
        { code: "ADMIN", role: "admin" as const },
        { code: "SCROOT", role: "super_admin" as const },
      ]) {
        await ctx.db.insert("allowed_codes", {
          ...item,
          companyId: "existing-company",
          enabled: true,
        });
        await ctx.db.insert("auth_codes", {
          code: item.code,
          deviceId: `${item.code}-device`,
          name: item.code,
          usedAt: new Date().toISOString(),
        });
      }
    });
    const payload = await withClaimSecretHashes({
      companyName: "Forbidden Filing",
      adminCode: "NOADM",
      fullCodes: makeCodes("NF", 10),
      limitedCodes: makeCodes("NL", 50),
    });

    await expect(
      t.mutation(api.roleManagement.provisionCompany, {
        ...payload,
        password: "ADMIN:ADMIN-device",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.provisionCompany, {
        ...payload,
        password: "SCROOT:SCROOT-device",
      }),
    ).rejects.toThrow();
  });

  test("wrong counts and duplicate or existing codes roll back without partial company data", async () => {
    const t = await setupRoot();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "USEDA",
        role: "user",
        enabled: true,
      });
    });

    await expect(
      t.mutation(
        api.roleManagement.provisionCompany,
        await withClaimSecretHashes({
          password: "ROOT1:root-device",
          companyName: "Short Filing",
          adminCode: "SHADM",
          fullCodes: makeCodes("SF", 9),
          limitedCodes: makeCodes("SL", 50),
        }),
      ),
    ).rejects.toThrow("10");
    await expect(
      t.mutation(
        api.roleManagement.provisionCompany,
        await withClaimSecretHashes({
          password: "ROOT1:root-device",
          companyName: "Collision Filing",
          adminCode: "COADM",
          fullCodes: ["USEDA", ...makeCodes("CF", 9)],
          limitedCodes: makeCodes("CL", 50),
        }),
      ),
    ).rejects.toThrow("已注册");

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).filter((record) =>
          ["shadm", "coadm"].includes(record.companyId ?? ""),
        ),
      ).toEqual([]);
      expect(
        (await ctx.db.query("license_profiles").collect()).filter((record) =>
          ["shadm", "coadm"].includes(record.companyId ?? ""),
        ),
      ).toEqual([]);
    });
  });

  test("cannot provision a company with a permanently retired authorization code", async () => {
    const t = await setupRoot();
    const payload = await withClaimSecretHashes({
      password: "ROOT1:root-device",
      companyName: "Retired Code Filing",
      adminCode: "RTADM",
      fullCodes: makeCodes("RF", 10),
      limitedCodes: makeCodes("RL", 50),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("authorization_code_tombstones", {
        code: payload.fullCodes[0],
        reason: "deleted",
        retiredBy: "ROOT1",
        retiredAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.roleManagement.provisionCompany, payload),
    ).rejects.toThrow("永久停用");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => record.companyId === "rtadm",
        ),
      ).toHaveLength(0);
      expect(
        (await ctx.db.query("license_profiles").collect()).filter(
          (record) => record.companyId === "rtadm",
        ),
      ).toHaveLength(0);
    });
  });

  test.each(["NYFBI", "AICHIJP"])(
    "reserved system tenant code %s cannot become a company administrator",
    async (adminCode) => {
      const t = await setupRoot();
      await expect(
        t.mutation(
          api.roleManagement.provisionCompany,
          await withClaimSecretHashes({
            password: "ROOT1:root-device",
            companyName: "Must Stay Isolated",
            adminCode,
            fullCodes: makeCodes("RF", 10),
            limitedCodes: makeCodes("RL", 50),
          }),
        ),
      ).rejects.toThrow("保留");

      await t.run(async (ctx) => {
        expect(
          (await ctx.db.query("allowed_codes").collect()).map(
            (record) => record.code,
          ),
        ).toEqual(["ROOT1"]);
        expect(await ctx.db.query("license_profiles").collect()).toEqual([]);
      });
    },
  );

  test("an orphaned profile still reserves its company tenant id", async () => {
    const t = await setupRoot();
    await t.run(async (ctx) => {
      await ctx.db.insert("license_profiles", {
        name: "Existing orphaned company profile",
        companyId: "taken",
        features: {
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
        },
        createdBy: "ROOT1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(
        api.roleManagement.provisionCompany,
        await withClaimSecretHashes({
          password: "ROOT1:root-device",
          companyName: "Collision Filing",
          adminCode: "TAKEN",
          fullCodes: makeCodes("TF", 10),
          limitedCodes: makeCodes("TL", 50),
        }),
      ),
    ).rejects.toThrow("已经建立");
  });

  test("the import-secret batch mutation provisions two companies without sharing any codes", async () => {
    const t = await setupRoot();
    process.env.AUTH_CODE_IMPORT_SECRET = "company-import-secret";
    const companies = await Promise.all(
      [
        {
          companyName: "Imported Alpha",
          adminCode: "IAADM",
          fullCodes: makeCodes("IF", 10),
          limitedCodes: makeCodes("IL", 50),
        },
        {
          companyName: "Imported Beta",
          adminCode: "IBADM",
          fullCodes: makeCodes("JF", 10),
          limitedCodes: makeCodes("JL", 50),
        },
      ].map((company) => withClaimSecretHashes(company)),
    );
    try {
      const result = await t.mutation(
        api.roleManagement.provisionCompaniesWithImportSecret,
        { password: "company-import-secret", companies },
      );
      expect(result).toHaveLength(2);
      expect(result.map((item) => item.companyId)).toEqual(["iaadm", "ibadm"]);
      await t.run(async (ctx) => {
        const records = (await ctx.db.query("allowed_codes").collect()).filter(
          (record) => ["iaadm", "ibadm"].includes(record.companyId ?? ""),
        );
        expect(records).toHaveLength(122);
        expect(new Set(records.map((record) => record.code))).toHaveLength(122);
        const auditLogs = await ctx.db.query("audit_logs").collect();
        expect(JSON.stringify(auditLogs)).not.toContain(
          "company-import-secret",
        );
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("a wrong import secret performs no company writes", async () => {
    const t = await setupRoot();
    process.env.AUTH_CODE_IMPORT_SECRET = "company-import-secret";
    try {
      await expect(
        t.mutation(api.roleManagement.provisionCompaniesWithImportSecret, {
          password: "wrong-secret",
          companies: await Promise.all(
            [
              {
                companyName: "Must Not Exist",
                adminCode: "NOADM",
                fullCodes: makeCodes("NF", 10),
                limitedCodes: makeCodes("NL", 50),
              },
              {
                companyName: "Also Must Not Exist",
                adminCode: "NXADM",
                fullCodes: makeCodes("XF", 10),
                limitedCodes: makeCodes("XL", 50),
              },
            ].map((company) => withClaimSecretHashes(company)),
          ),
        }),
      ).rejects.toThrow("验证失败");

      await t.run(async (ctx) => {
        expect(await ctx.db.query("license_profiles").collect()).toEqual([]);
        expect(
          (await ctx.db.query("allowed_codes").collect()).map(
            (record) => record.code,
          ),
        ).toEqual(["ROOT1"]);
        expect(await ctx.db.query("audit_logs").collect()).toEqual([]);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("a collision between the two imported companies rolls the whole batch back", async () => {
    const t = await setupRoot();
    process.env.AUTH_CODE_IMPORT_SECRET = "company-import-secret";
    try {
      await expect(
        t.mutation(api.roleManagement.provisionCompaniesWithImportSecret, {
          password: "company-import-secret",
          companies: await Promise.all(
            [
              {
                companyName: "First Company",
                adminCode: "FCADM",
                fullCodes: makeCodes("FF", 10),
                limitedCodes: makeCodes("FL", 50),
              },
              {
                companyName: "Second Company",
                adminCode: "SCADM",
                fullCodes: ["FCADM", ...makeCodes("SF", 9)],
                limitedCodes: makeCodes("SL", 50),
              },
            ].map((company) => withClaimSecretHashes(company)),
          ),
        }),
      ).rejects.toThrow("已注册");
      await t.run(async (ctx) => {
        expect(await ctx.db.query("license_profiles").collect()).toEqual([]);
        expect(
          (await ctx.db.query("allowed_codes").collect()).map(
            (record) => record.code,
          ),
        ).toEqual(["ROOT1"]);
        expect(await ctx.db.query("audit_logs").collect()).toEqual([]);
      });
    } finally {
      delete process.env.AUTH_CODE_IMPORT_SECRET;
    }
  });

  test("an unscoped legacy administrator is limited to the default company instead of receiving global access", async () => {
    const t = await setupRoot();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LEGAD",
        role: "admin",
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code: "LEGAD",
        deviceId: "legacy-admin-device",
        name: "Legacy admin",
        usedAt: new Date().toISOString(),
      });
      for (const item of [
        { code: "NY001", companyId: undefined },
        { code: "OT001", companyId: "other-company" },
      ])
        await ctx.db.insert("allowed_codes", {
          ...item,
          role: "user",
          enabled: true,
        });
    });

    const visible = await t.query(api.admin.getAllowedCodes, {
      password: "LEGAD:legacy-admin-device",
    });
    expect(visible.map((record) => record.code).sort()).toEqual(["NY001"]);
  });
});
