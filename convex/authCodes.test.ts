import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
    process.env.SUPER_ADMIN_CODE = "OLDROOT";
    process.env.INITIAL_ADMIN_CODES = "OLDADMIN";

    const result = await t.mutation(
      internal.authCodes.replaceAuthorizationCodes,
      {
        password: "replace-secret",
        fullCodes,
        limitedCodes,
        administrators: [
          { code: "ROOT1", role: "super_admin" },
          { code: "RAVE1", role: "admin", companyId: "RAVE1" },
        ],
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

      expect(await ctx.db.query("contacts").collect()).toHaveLength(1);
      expect(await ctx.db.query("messages").collect()).toHaveLength(1);
    });
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
      }),
    ).rejects.toThrow("50");

    await expect(
      t.mutation(internal.authCodes.replaceAuthorizationCodes, {
        password: "replace-secret",
        fullCodes,
        limitedCodes: [...limitedCodes.slice(0, 49), fullCodes[0]],
        administrators: [{ code: "ROOT1", role: "super_admin" }],
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
});

describe("authorization-code device slots", () => {
  test("a full-feature code can bind one desktop and one mobile device", async () => {
    const { t, profileIds } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "FULL2",
        role: "user",
        enabled: true,
        licenseProfileId: profileIds.full,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: "FULL2",
      deviceId: "desktop-1",
      deviceType: "desktop",
      deviceContext: "browser",
      name: "Full User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "FULL2",
        deviceId: "mobile-1",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Full User",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  test("a limited code cannot bind a second device", async () => {
    const { t, profileIds } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LIMIT2",
        role: "user",
        enabled: true,
        licenseProfileId: profileIds.limited,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: "LIMIT2",
      deviceId: "desktop-1",
      deviceType: "desktop",
      deviceContext: "browser",
      name: "Limited User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "LIMIT2",
        deviceId: "mobile-1",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Limited User",
      }),
    ).rejects.toThrow("仅允许绑定一台设备");
  });
});
