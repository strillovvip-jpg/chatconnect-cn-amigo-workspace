import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { hashClaimSecret } from "./claimCredentials";

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

const limitedFeatures = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: true,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: true,
};

const makeCodes = (prefix: string) =>
  Array.from(
    { length: 50 },
    (_, index) => `${prefix}${String(index).padStart(4, "0")}`,
  );

const importedActivationSecret = "A".repeat(32);

async function claimSecretHashesFor(codes: string[]) {
  return await Promise.all(
    codes.map(async (code) => ({
      code,
      hash: await hashClaimSecret(code, importedActivationSecret),
    })),
  );
}

async function setup() {
  const t = convexTest({ schema, modules });
  const profileIds = await t.run(async (ctx) => ({
    full: await ctx.db.insert("license_profiles", {
      name: "高级授权码-全部功能",
      features: fullFeatures,
      createdBy: "ROOT1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    limited: await ctx.db.insert("license_profiles", {
      name: "高级授权码-无6、9及11",
      features: limitedFeatures,
      createdBy: "ROOT1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    legacyFull: await ctx.db.insert("license_profiles", {
      name: "标准授权",
      features: fullFeatures,
      createdBy: "ROOT1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  }));

  await t.run(async (ctx) => {
    await ctx.db.insert("allowed_codes", {
      code: "OLD01",
      role: "user",
      enabled: true,
      licenseProfileId: profileIds.full,
    });
    await ctx.db.insert("auth_codes", {
      code: "OLD01",
      deviceId: "old-device",
      name: "Old User",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("contacts", {
      ownerCode: "OLD01",
      targetCode: "FRIEND",
      targetName: "Friend",
      addedAt: new Date().toISOString(),
    });
    await ctx.db.insert("messages", {
      roomId: "FRIEND:OLD01",
      senderCode: "OLD01",
      senderName: "Old User",
      type: "text",
      text: "keep me",
      sentAt: new Date().toISOString(),
    });
  });

  return { t, profileIds };
}

describe("atomic authorization-code replacement", () => {
  beforeEach(() => {
    process.env.AUTH_CODE_IMPORT_SECRET = "replace-secret";
    delete process.env.SUPER_ADMIN_CODE;
    delete process.env.INITIAL_ADMIN_CODES;
  });

  afterEach(() => {
    delete process.env.AUTH_CODE_IMPORT_SECRET;
    delete process.env.SUPER_ADMIN_CODE;
    delete process.env.INITIAL_ADMIN_CODES;
  });

  test("replaces two 50-code tiers, expires old sessions, and preserves business data", async () => {
    const { t, profileIds } = await setup();
    const fullCodes = makeCodes("F");
    const limitedCodes = makeCodes("L");
    const administrators = [
      { code: "ROOT1", role: "super_admin" as const },
      {
        code: "RAVE1",
        role: "admin" as const,
        companyId: "RAVE1",
      },
    ];
    process.env.SUPER_ADMIN_CODE = "OLDROOT";
    process.env.INITIAL_ADMIN_CODES = "OLDADMIN";

    const result = await t.mutation(
      internal.authCodes.replaceAuthorizationCodes,
      {
        password: "replace-secret",
        fullCodes,
        limitedCodes,
        administrators,
        claimSecretHashes: await claimSecretHashesFor([
          ...fullCodes,
          ...limitedCodes,
          ...administrators.map(({ code }) => code),
        ]),
      },
    );

    expect(result).toEqual({
      full: 50,
      limited: 50,
      administrators: 2,
      revokedSessions: 1,
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      expect(allowed).toHaveLength(102);
      expect(await ctx.db.query("auth_codes").collect()).toHaveLength(0);

      const full = allowed.find((record) => record.code === "F0000");
      const limited = allowed.find((record) => record.code === "L0000");
      const root = allowed.find((record) => record.code === "ROOT1");
      const admin = allowed.find((record) => record.code === "RAVE1");
      expect(full).toMatchObject({
        role: "user",
        enabled: true,
        licenseProfileId: profileIds.full,
      });
      expect(limited).toMatchObject({
        role: "user",
        enabled: true,
        licenseProfileId: profileIds.limited,
      });
      expect(root).toMatchObject({ role: "super_admin", enabled: true });
      expect(admin).toMatchObject({
        role: "admin",
        companyId: "RAVE1",
        enabled: true,
      });
      expect(allowed.some((record) => record.code === "OLDROOT")).toBe(false);
      expect(allowed.some((record) => record.code === "OLDADMIN")).toBe(false);
      expect(
        allowed.every((record) =>
          /^[a-f0-9]{64}$/.test(record.claimSecretHash ?? ""),
        ),
      ).toBe(true);

      expect(await ctx.db.query("contacts").collect()).toHaveLength(1);
      expect(await ctx.db.query("messages").collect()).toHaveLength(1);
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `F0000.${importedActivationSecret}`,
        deviceId: "new-import-device",
        deviceType: "desktop",
        name: "Imported user",
      }),
    ).resolves.toMatchObject({ success: true, code: "F0000" });
  });

  test("rejects wrong counts and duplicates before changing any records", async () => {
    const { t } = await setup();
    const fullCodes = makeCodes("F");
    const limitedCodes = makeCodes("L");

    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes: fullCodes.slice(0, 49),
        limitedCodes,
        administrators: [{ code: "ROOT1", role: "super_admin" }],
        claimSecretHashes: await claimSecretHashesFor([
          ...fullCodes.slice(0, 49),
          ...limitedCodes,
          "ROOT1",
        ]),
      }),
    ).rejects.toThrow("50");

    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes,
        limitedCodes: [...limitedCodes.slice(0, 49), fullCodes[0]],
        administrators: [{ code: "ROOT1", role: "super_admin" }],
        claimSecretHashes: await claimSecretHashesFor([
          ...fullCodes,
          ...limitedCodes.slice(0, 49),
          fullCodes[0],
          "ROOT1",
        ]),
      }),
    ).rejects.toThrow("重复");

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).map((x) => x.code),
      ).toEqual(["OLD01"]);
      expect(await ctx.db.query("auth_codes").collect()).toHaveLength(1);
    });
  });

  test("requires the dedicated import secret before any destructive write", async () => {
    const { t } = await setup();

    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "wrong-secret",
        fullCodes: makeCodes("F"),
        limitedCodes: makeCodes("L"),
        administrators: [{ code: "ROOT1", role: "super_admin" }],
        claimSecretHashes: await claimSecretHashesFor([
          ...makeCodes("F"),
          ...makeCodes("L"),
          "ROOT1",
        ]),
      }),
    ).rejects.toThrow("验证失败");

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).map((x) => x.code),
      ).toEqual(["OLD01"]);
      expect(await ctx.db.query("auth_codes").collect()).toHaveLength(1);
    });
  });

  test("refuses to replace without both profiles or a recoverable super admin", async () => {
    const { t, profileIds } = await setup();
    const fullCodes = makeCodes("F");
    const limitedCodes = makeCodes("L");

    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes,
        limitedCodes,
        administrators: [],
        claimSecretHashes: await claimSecretHashesFor([
          ...fullCodes,
          ...limitedCodes,
        ]),
      }),
    ).rejects.toThrow("总管理员");

    await t.run(async (ctx) => {
      await ctx.db.delete(profileIds.limited);
    });
    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes,
        limitedCodes,
        administrators: [{ code: "ROOT1", role: "super_admin" }],
        claimSecretHashes: await claimSecretHashesFor([
          ...fullCodes,
          ...limitedCodes,
          "ROOT1",
        ]),
      }),
    ).rejects.toThrow("受限");

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).map((x) => x.code),
      ).toEqual(["OLD01"]);
      expect(await ctx.db.query("auth_codes").collect()).toHaveLength(1);
      expect(await ctx.db.query("contacts").collect()).toHaveLength(1);
      expect(await ctx.db.query("messages").collect()).toHaveLength(1);
    });
  });

  test("legacy bulk import stores only hashes and supports a compound first claim", async () => {
    const { t } = await setup();
    const codes = makeCodes("I");
    const records = await Promise.all(
      codes.map(async (code) => ({
        code,
        role: "user" as const,
        claimSecretHash: await hashClaimSecret(code, importedActivationSecret),
      })),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: codes[0],
        role: "user",
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code: codes[0],
        deviceId: "pre-import-device",
        name: "Pre-import user",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("push_subscriptions", {
        userId: codes[0],
        endpoint: "https://push.example/pre-import",
        p256dh: "pre-import-key",
        auth: "pre-import-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.authCodes.importAllowedCodes, {
      password: "replace-secret",
      codes: records,
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `${codes[0]}.${importedActivationSecret}`,
        deviceId: "bulk-import-device",
        deviceType: "mobile",
        name: "Bulk imported user",
      }),
    ).resolves.toMatchObject({ success: true, code: codes[0] });
    await t.run(async (ctx) => {
      const imported = await ctx.db.query("allowed_codes").collect();
      expect(imported).toHaveLength(50);
      expect(imported[0].claimSecretHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(imported)).not.toContain(importedActivationSecret);
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === codes[0],
        ),
      ).toBe(false);
      expect(
        await ctx.db
          .query("authorization_code_tombstones")
          .withIndex("by_code", (q) => q.eq("code", "OLD01"))
          .first(),
      ).toMatchObject({ code: "OLD01", reason: "bulk_import" });
    });

    const attemptedReuse = ["OLD01", ...codes.slice(1)];
    await expect(
      t.mutation(internal.authCodes.importAllowedCodes, {
        password: "replace-secret",
        codes: await Promise.all(
          attemptedReuse.map(async (code) => ({
            code,
            role: "user" as const,
            claimSecretHash: await hashClaimSecret(
              code,
              importedActivationSecret,
            ),
          })),
        ),
      }),
    ).rejects.toThrow("永久停用");
  });

  test("authorization-set replacement tombstones removed codes and cannot resurrect them", async () => {
    const { t } = await setup();
    const firstFullCodes = makeCodes("F");
    const firstLimitedCodes = makeCodes("L");
    const administrators = [{ code: "ROOT1", role: "super_admin" as const }];
    await t.mutation(internal.authCodes.replaceAuthorizationCodes, {
      password: "replace-secret",
      fullCodes: firstFullCodes,
      limitedCodes: firstLimitedCodes,
      administrators,
      claimSecretHashes: await claimSecretHashesFor([
        ...firstFullCodes,
        ...firstLimitedCodes,
        "ROOT1",
      ]),
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("authorization_code_tombstones")
          .withIndex("by_code", (q) => q.eq("code", "OLD01"))
          .first(),
      ).toMatchObject({ code: "OLD01", reason: "bulk_replace" });
    });

    const attemptedFullCodes = ["OLD01", ...makeCodes("N").slice(1)];
    const nextLimitedCodes = makeCodes("M");
    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes: attemptedFullCodes,
        limitedCodes: nextLimitedCodes,
        administrators,
        claimSecretHashes: await claimSecretHashesFor([
          ...attemptedFullCodes,
          ...nextLimitedCodes,
          "ROOT1",
        ]),
      }),
    ).rejects.toThrow("永久停用");
  });

  test("authorization-set replacement clears delivery state for retained codes whose credential rotates", async () => {
    const { t, profileIds } = await setup();
    const fullCodes = makeCodes("F");
    const limitedCodes = makeCodes("L");
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: fullCodes[0],
        role: "user",
        enabled: true,
        licenseProfileId: profileIds.full,
      });
      await ctx.db.insert("auth_codes", {
        code: fullCodes[0],
        deviceId: "retained-device",
        name: "Retained user",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("push_subscriptions", {
        userId: fullCodes[0],
        endpoint: "https://push.example/retained",
        p256dh: "retained-key",
        auth: "retained-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.authCodes.replaceAuthorizationCodes, {
      password: "replace-secret",
      fullCodes,
      limitedCodes,
      administrators: [{ code: "ROOT1", role: "super_admin" }],
      claimSecretHashes: await claimSecretHashesFor([
        ...fullCodes,
        ...limitedCodes,
        "ROOT1",
      ]),
    });

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === fullCodes[0],
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("auth_codes").collect()).some(
          (record) => record.code === fullCodes[0],
        ),
      ).toBe(false);
      expect(
        await ctx.db
          .query("authorization_code_tombstones")
          .withIndex("by_code", (q) => q.eq("code", fullCodes[0]))
          .first(),
      ).toBeNull();
    });
  });

  test("bulk import revokes sessions for authorization codes removed from the allowlist", async () => {
    const { t, profileIds } = await setup();
    const removedCode = "SAFE1";
    const removedSecret = "B".repeat(32);
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: removedCode,
        role: "user",
        enabled: true,
        claimSecretHash: await hashClaimSecret(removedCode, removedSecret),
        licenseProfileId: profileIds.full,
      });
      await ctx.db.insert("contacts", {
        ownerCode: removedCode,
        targetCode: "I0000",
        targetName: "Imported user",
        addedAt: new Date().toISOString(),
      });
    });
    await t.mutation(api.authCodes.claimCode, {
      code: `${removedCode}.${removedSecret}`,
      deviceId: "removed-device",
      deviceType: "desktop",
      deviceContext: "browser",
      name: "Removed User",
    });

    const codes = makeCodes("I");
    await t.mutation(internal.authCodes.importAllowedCodes, {
      password: "replace-secret",
      codes: await Promise.all(
        codes.map(async (code) => ({
          code,
          role: "user" as const,
          claimSecretHash: await hashClaimSecret(
            code,
            importedActivationSecret,
          ),
        })),
      ),
    });

    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: removedCode,
        deviceId: "removed-device",
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.messages.listMessages, {
        myCode: removedCode,
        theirCode: codes[0],
        deviceId: "removed-device",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow("有效的登录会话");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("auth_codes").collect()).some(
          (session) => session.code === removedCode,
        ),
      ).toBe(false);
    });
  });
});

describe("authorization session allowlist enforcement", () => {
  test("rejects an otherwise device-bound session when its allowlist record is missing", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "OLD01"))
        .unique();
      if (!allowed) throw new Error("test fixture allowlist record missing");
      await ctx.db.delete(allowed._id);
    });

    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "OLD01",
        deviceId: "old-device",
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.messages.listMessages, {
        myCode: "OLD01",
        theirCode: "FRIEND",
        deviceId: "old-device",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow("有效的登录会话");
  });
});

describe("authorization-code device slots", () => {
  const deviceActivationSecret = "A".repeat(32);

  test("a full-feature code allows any two devices and rejects a third", async () => {
    const { t, profileIds } = await setup();
    const claimSecretHash = await hashClaimSecret(
      "FULL3",
      deviceActivationSecret,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "FULL3",
        role: "user",
        enabled: true,
        claimSecretHash,
        licenseProfileId: profileIds.full,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: `FULL3.${deviceActivationSecret}`,
      deviceId: "mobile-1",
      deviceType: "mobile",
      deviceContext: "standalone",
      name: "Full User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `FULL3.${deviceActivationSecret}`,
        deviceId: "mobile-2",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Full User",
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `FULL3.${deviceActivationSecret}`,
        deviceId: "desktop-1",
        deviceType: "desktop",
        deviceContext: "browser",
        name: "Full User",
      }),
    ).rejects.toThrow("最多同时登录两台设备");

    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "FULL3",
        deviceId: "mobile-1",
      }),
    ).resolves.toMatchObject({ role: "user" });
    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "FULL3",
        deviceId: "mobile-2",
      }),
    ).resolves.toMatchObject({ role: "user" });
  });

  test("a full-feature code can bind one desktop and one mobile device", async () => {
    const { t, profileIds } = await setup();
    const claimSecretHash = await hashClaimSecret(
      "FULL2",
      deviceActivationSecret,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "FULL2",
        role: "user",
        enabled: true,
        claimSecretHash,
        licenseProfileId: profileIds.full,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: `FULL2.${deviceActivationSecret}`,
      deviceId: "desktop-1",
      deviceType: "desktop",
      deviceContext: "browser",
      name: "Full User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `FULL2.${deviceActivationSecret}`,
        deviceId: "mobile-1",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Full User",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  test("a limited code cannot bind a second device", async () => {
    const { t, profileIds } = await setup();
    const claimSecretHash = await hashClaimSecret(
      "LIMIT2",
      deviceActivationSecret,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LIMIT2",
        role: "user",
        enabled: true,
        claimSecretHash,
        licenseProfileId: profileIds.limited,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: `LIMIT2.${deviceActivationSecret}`,
      deviceId: "desktop-1",
      deviceType: "desktop",
      deviceContext: "browser",
      name: "Limited User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `LIMIT2.${deviceActivationSecret}`,
        deviceId: "mobile-1",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Limited User",
      }),
    ).rejects.toThrow("仅允许绑定一台设备");
  });
});

describe("authorization-code claim credentials", () => {
  const activationSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEH";
  const activationSecretHash =
    "048bf04ff0ba4d27c7a3ceebf3297c7435b54d95139d3597845a13519448e7e1";

  test("an unclaimed public code cannot be claimed by rotating client-controlled device ids", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: true,
        claimSecretHash: activationSecretHash,
      });
    });

    for (const deviceId of ["forged-device-1", "forged-device-2"]) {
      await expect(
        t.mutation(api.authCodes.claimCode, {
          code: "SAFE1",
          deviceId,
          deviceType: "desktop",
          deviceContext: "browser",
          name: "Attacker",
        }),
      ).rejects.toThrow("授权凭证无效");
    }

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("auth_codes").collect()).filter(
          (record) => record.code === "SAFE1",
        ),
      ).toHaveLength(0);
    });
  });

  test("a correct high-entropy claim credential binds a device without storing the raw secret", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: true,
        maxDevices: 2,
        claimSecretHash: activationSecretHash,
      });
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `SAFE1.${activationSecret}`,
        deviceId: "legitimate-device",
        deviceType: "desktop",
        deviceContext: "browser",
        name: "Legitimate User",
      }),
    ).resolves.toMatchObject({ success: true, code: "SAFE1" });

    await t.run(async (ctx) => {
      const stored = JSON.stringify({
        allowed: await ctx.db.query("allowed_codes").collect(),
        sessions: await ctx.db.query("auth_codes").collect(),
      });
      expect(stored).not.toContain(activationSecret);
      expect(
        (await ctx.db.query("auth_codes").collect()).filter(
          (record) => record.code === "SAFE1",
        ),
      ).toEqual([
        expect.objectContaining({
          code: "SAFE1",
          deviceIds: ["legitimate-device"],
        }),
      ]);
    });
  });

  test("new devices still require the secret while an already-bound legacy device remains compatible", async () => {
    const { t, profileIds } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: true,
        maxDevices: 2,
        licenseProfileId: profileIds.full,
        claimSecretHash: activationSecretHash,
      });
      await ctx.db.insert("auth_codes", {
        code: "SAFE1",
        deviceId: "bound-device",
        deviceIds: ["bound-device"],
        name: "Existing User",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "SAFE1",
        deviceId: "bound-device",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Existing User",
      }),
    ).resolves.toMatchObject({ success: true, code: "SAFE1" });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "SAFE1",
        deviceId: "new-device",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Existing User",
      }),
    ).rejects.toThrow("授权凭证无效");
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `SAFE1.${activationSecret}`,
        deviceId: "new-device",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Existing User",
      }),
    ).resolves.toMatchObject({ success: true, code: "SAFE1" });
  });

  test("unknown codes and wrong claim secrets expose the same public error", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: true,
        claimSecretHash: activationSecretHash,
      });
    });
    const attempt = (credential: string) =>
      t.mutation(api.authCodes.claimCode, {
        code: credential,
        deviceId: "new-device",
        deviceType: "desktop",
        deviceContext: "browser",
        name: "User",
      });

    await expect(attempt("SAFE1.AAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(
      "授权凭证无效",
    );
    await expect(attempt("NOPE1.AAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(
      "授权凭证无效",
    );
  });

  test("a disabled code cannot create a fresh session with its valid activation secret", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: false,
        claimSecretHash: activationSecretHash,
      });
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `SAFE1.${activationSecret}`,
        deviceId: "fresh-device",
        deviceType: "desktop",
        deviceContext: "browser",
        name: "Disabled User",
      }),
    ).rejects.toThrow("此授权码已停用");
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", "SAFE1"))
          .first(),
      ).toBeNull();
    });
  });

  test("authorization-code usage status requires that code's bound device session", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "SAFE1",
        role: "user",
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code: "SAFE1",
        deviceId: "bound-device",
        deviceIds: ["bound-device"],
        name: "Protected User",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.query(api.authCodes.getCodeStatus, { code: "SAFE1" } as never),
    ).rejects.toThrow();
    await expect(
      t.query(api.authCodes.getCodeStatus, {
        code: "SAFE1",
        deviceId: "wrong-device",
      } as never),
    ).rejects.toThrow();
    await expect(
      t.query(api.authCodes.getCodeStatus, {
        code: "SAFE1",
        deviceId: "bound-device",
      } as never),
    ).resolves.toEqual({ used: true });
  });
});
