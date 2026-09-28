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

const nyfbiLegacyLimitedFeatures = {
  ...fullFeatures,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

const aichijpLimitedFeatures = nyfbiLegacyLimitedFeatures;

async function setupTenantProfiles() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    for (const admin of [
      { code: "RAVE", companyId: "nyfbi", deviceId: "ny-admin" },
      { code: "RAVE1", companyId: "aichijp", deviceId: "ai-admin" },
    ]) {
      await ctx.db.insert("allowed_codes", {
        code: admin.code,
        role: "super_admin",
        companyId: admin.companyId,
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code: admin.code,
        deviceId: admin.deviceId,
        name: admin.code,
        usedAt: new Date().toISOString(),
      });
    }
    await ctx.db.insert("allowed_codes", {
      code: "AIUSER",
      role: "user",
      companyId: "aichijp",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "AIUSER",
      deviceId: "ai-user-device",
      name: "Aichijp user",
      usedAt: new Date().toISOString(),
    });
    const nyfbi = await ctx.db.insert("license_profiles", {
      name: "Nyfbi legacy profile",
      features: nyfbiLegacyLimitedFeatures,
      createdBy: "RAVE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const aichijp = await ctx.db.insert("license_profiles", {
      name: "Aichijp legacy profile",
      features: aichijpLimitedFeatures,
      createdBy: "RAVE1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { nyfbi, aichijp };
  });
  return { t, ids };
}

describe("tenant-scoped feature profiles", () => {
  test("RAVE and RAVE1 list only profiles owned by their tenant", async () => {
    const { t, ids } = await setupTenantProfiles();

    await expect(
      t.query(api.features.listProfiles, { password: "RAVE:ny-admin" }),
    ).resolves.toEqual([
      expect.objectContaining({ _id: ids.nyfbi, name: "Nyfbi legacy profile" }),
    ]);
    await expect(
      t.query(api.features.listProfiles, { password: "RAVE1:ai-admin" }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: ids.aichijp,
        name: "Aichijp legacy profile",
      }),
    ]);
  });

  test("the same profile name can exist independently in both tenants", async () => {
    const { t } = await setupTenantProfiles();

    await expect(
      t.mutation(api.features.createProfile, {
        password: "RAVE:ny-admin",
        name: "Shared profile name",
        features: fullFeatures,
      }),
    ).resolves.toBeDefined();
    await expect(
      t.mutation(api.features.createProfile, {
        password: "RAVE1:ai-admin",
        name: "Shared profile name",
        features: aichijpLimitedFeatures,
      }),
    ).resolves.toBeDefined();
  });

  test("RAVE1 cannot update a nyfbi profile", async () => {
    const { t, ids } = await setupTenantProfiles();

    await expect(
      t.mutation(api.features.updateProfile, {
        password: "RAVE1:ai-admin",
        profileId: ids.nyfbi,
        name: "Cross-tenant overwrite",
        features: fullFeatures,
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.nyfbi))?.name).toBe("Nyfbi legacy profile");
    });
  });

  test("RAVE1 cannot assign a nyfbi profile to an aichijp code", async () => {
    const { t, ids } = await setupTenantProfiles();

    await expect(
      t.mutation(api.features.configureCode, {
        password: "RAVE1:ai-admin",
        targetCode: "AIUSER",
        profileId: ids.nyfbi,
        enabled: true,
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      const code = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AIUSER"))
        .unique();
      expect(code?.licenseProfileId).toBeUndefined();
    });
  });

  test("an existing cross-tenant assignment falls back instead of granting foreign profile features", async () => {
    const { t, ids } = await setupTenantProfiles();
    await t.run(async (ctx) => {
      const code = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AIUSER"))
        .unique();
      if (!code) throw new Error("missing fixture");
      await ctx.db.patch(code._id, { licenseProfileId: ids.nyfbi });
    });

    await expect(
      t.query(api.features.current, {
        code: "AIUSER",
        deviceId: "ai-user-device",
      }),
    ).resolves.toMatchObject({
      profileId: null,
      profileName: "标准",
      features: expect.objectContaining({
        canVideoSource: false,
        canRecord: false,
      }),
    });
  });
});

describe("tenant-safe authorization import", () => {
  beforeEach(() => {
    process.env.AUTH_CODE_IMPORT_SECRET = "tenant-profile-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_CODE_IMPORT_SECRET;
  });

  test("aichijp import creates a tenant-owned #6/#9/#11 limited profile without changing nyfbi legacy data", async () => {
    const t = convexTest({ schema, modules });
    const legacyLimitedId = await t.run(async (ctx) => {
      await ctx.db.insert("license_profiles", {
        name: "Legacy full",
        features: fullFeatures,
        createdBy: "RAVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const limited = await ctx.db.insert("license_profiles", {
        name: "高级授权码-无6、9及11",
        features: nyfbiLegacyLimitedFeatures,
        createdBy: "RAVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "RAVE",
        role: "super_admin",
        companyId: "nyfbi",
        enabled: true,
      });
      await ctx.db.insert("allowed_codes", {
        code: "NYLIMIT",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        licenseProfileId: limited,
      });
      return limited;
    });

    await t.mutation(internal.authCodes.replaceAuthorizationCodes, {
      password: "tenant-profile-secret",
      companyId: "aichijp",
      fullCodes: Array.from(
        { length: 20 },
        (_, index) => `AF${index.toString().padStart(3, "0")}`,
      ),
      limitedCodes: Array.from(
        { length: 50 },
        (_, index) => `AL${index.toString().padStart(3, "0")}`,
      ),
      administrators: [
        {
          code: "RAVE1",
          role: "super_admin",
          companyId: "aichijp",
          unlimitedDevices: true,
        },
      ],
    });

    await t.run(async (ctx) => {
      const importedCode = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AL000"))
        .unique();
      const importedProfile = importedCode?.licenseProfileId
        ? await ctx.db.get(importedCode.licenseProfileId)
        : null;
      expect(importedProfile).toMatchObject({
        companyId: "aichijp",
        features: aichijpLimitedFeatures,
      });

      const nyfbiCode = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "NYLIMIT"))
        .unique();
      expect(nyfbiCode?.licenseProfileId).toBe(legacyLimitedId);
      expect(await ctx.db.get(legacyLimitedId)).toMatchObject({
        features: nyfbiLegacyLimitedFeatures,
      });
    });
  });
});
