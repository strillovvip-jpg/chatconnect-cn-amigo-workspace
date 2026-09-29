import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { makeFunctionReference } from "convex/server";
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

type Surface = "app" | "aichijp" | "nyfbi";

const claimCodeForSurface = makeFunctionReference<
  "mutation",
  {
    code: string;
    deviceId: string;
    deviceType: "mobile" | "desktop";
    deviceContext?: "browser" | "standalone";
    surface: Surface;
    name: string;
  },
  { success: true; role: "super_admin" | "admin" | "user"; name: string }
>("authCodes:claimCode");

const getSessionRoleForSurface = makeFunctionReference<
  "query",
  { code: string; deviceId: string; surface: Surface },
  {
    role: "super_admin" | "admin" | "user";
    code: string;
    name: string;
    expiresAt: number | null;
    licenseProfileId: string | null;
  } | null
>("authCodes:getSessionRole");

const replaceTenantAuthorizationCodes = makeFunctionReference<
  "mutation",
  {
    password: string;
    companyId: "aichijp" | "nyfbi";
    fullCodes: string[];
    limitedCodes: string[];
    administrators: Array<{
      code: string;
      role: "super_admin" | "admin";
      companyId: "aichijp" | "nyfbi";
      unlimitedDevices?: boolean;
    }>;
  },
  {
    full: number;
    limited: number;
    administrators: number;
    revokedSessions: number;
  }
>("authCodes:replaceAuthorizationCodes");

const configureAichijpDeviceLimits = makeFunctionReference<
  "mutation",
  { password: string },
  { full: number; limited: number; migratedSessions: number }
>("authCodes:configureAichijpDeviceLimits");

const assignAuthorizationCodeTenant = makeFunctionReference<
  "mutation",
  { password: string; code: string; companyId: "aichijp" | "nyfbi" },
  { code: string; companyId: string }
>("authCodes:assignAuthorizationCodeTenant");

const makeCodes = (prefix: string, count: number) =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(3, "0")}`,
  );

async function insertProfiles(
  t: ReturnType<typeof convexTest>,
  createdBy = "RAVE1",
) {
  return await t.run(async (ctx) => ({
    full: await ctx.db.insert("license_profiles", {
      name: "Aichijp full fixture",
      features: fullFeatures,
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    limited: await ctx.db.insert("license_profiles", {
      name: "Aichijp limited fixture",
      features: limitedFeatures,
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  }));
}

async function setupTenantUsers() {
  const t = convexTest({ schema, modules });
  const profiles = await insertProfiles(t);
  await t.run(async (ctx) => {
    for (const user of [
      {
        code: "AIF01",
        deviceId: "device-ai-full",
        name: "Aichijp Full",
        companyId: "aichijp",
        licenseProfileId: profiles.full,
      },
      {
        code: "AIL01",
        deviceId: "device-ai-limited",
        name: "Aichijp Limited",
        companyId: "aichijp",
        licenseProfileId: profiles.limited,
      },
      {
        code: "NYF01",
        deviceId: "device-ny-full",
        name: "Nyfbi Full",
        companyId: "nyfbi",
        licenseProfileId: profiles.full,
      },
    ] as const) {
      await ctx.db.insert("allowed_codes", {
        code: user.code,
        role: "user",
        enabled: true,
        companyId: user.companyId,
        licenseProfileId: user.licenseProfileId,
      });
      await ctx.db.insert("auth_codes", {
        code: user.code,
        deviceId: user.deviceId,
        name: user.name,
        usedAt: new Date().toISOString(),
      });
    }
  });
  return t;
}

describe("aichijp tenant authorization import", () => {
  beforeEach(() => {
    process.env.AUTH_CODE_IMPORT_SECRET = "tenant-import-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_CODE_IMPORT_SECRET;
  });

  test("replaces exactly 20 full and 50 limited aichijp codes without deleting nyfbi", async () => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "RAVE",
        role: "super_admin",
        enabled: true,
        companyId: "nyfbi",
      });
      await ctx.db.insert("allowed_codes", {
        code: "NY001",
        role: "user",
        enabled: true,
        companyId: "nyfbi",
        licenseProfileId: profiles.full,
      });
      await ctx.db.insert("allowed_codes", {
        code: "AIOLD",
        role: "user",
        enabled: true,
        companyId: "aichijp",
        licenseProfileId: profiles.full,
      });
      await ctx.db.insert("auth_codes", {
        code: "NY001",
        deviceId: "ny-device",
        name: "Nyfbi fixture",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("auth_codes", {
        code: "AIOLD",
        deviceId: "old-ai-device",
        name: "Old aichijp fixture",
        usedAt: new Date().toISOString(),
      });
    });

    const result = await t.mutation(replaceTenantAuthorizationCodes, {
      password: "tenant-import-secret",
      companyId: "aichijp",
      fullCodes: makeCodes("AF", 20),
      limitedCodes: makeCodes("AL", 50),
      administrators: [
        {
          code: "RAVE1",
          role: "super_admin",
          companyId: "aichijp",
          unlimitedDevices: true,
        },
      ],
    });

    expect(result).toMatchObject({
      full: 20,
      limited: 50,
      administrators: 1,
      revokedSessions: 1,
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      const aichijp = allowed.filter(
        (record) => record.companyId === "aichijp",
      );
      expect(aichijp).toHaveLength(71);
      expect(aichijp.every((record) => record.companyId === "aichijp")).toBe(
        true,
      );
      expect(aichijp.find((record) => record.code === "RAVE1")).toMatchObject({
        role: "super_admin",
        unlimitedDevices: true,
      });
      expect(aichijp.find((record) => record.code === "AF000")).toMatchObject({
        role: "user",
        maxDevices: 2,
      });
      expect(aichijp.find((record) => record.code === "AL000")).toMatchObject({
        role: "user",
        maxDevices: 1,
      });
      expect(aichijp.some((record) => record.code === "AIOLD")).toBe(false);
      expect(allowed.find((record) => record.code === "RAVE")).toMatchObject({
        role: "super_admin",
        companyId: "nyfbi",
      });
      expect(allowed.find((record) => record.code === "NY001")).toMatchObject({
        role: "user",
        companyId: "nyfbi",
      });

      const sessions = await ctx.db.query("auth_codes").collect();
      expect(sessions.map((session) => session.code)).toEqual(["NY001"]);
    });
  });

  test("assigns the existing nyfbi administrator without replacing either tenant", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "RAVE",
        role: "super_admin",
        enabled: true,
      });
      await ctx.db.insert("allowed_codes", {
        code: "AI001",
        role: "user",
        enabled: true,
        companyId: "aichijp",
      });
    });

    await expect(
      t.mutation(assignAuthorizationCodeTenant, {
        password: "tenant-import-secret",
        code: "RAVE",
        companyId: "nyfbi",
      }),
    ).resolves.toEqual({ code: "RAVE", companyId: "nyfbi" });

    await t.run(async (ctx) => {
      const records = await ctx.db.query("allowed_codes").collect();
      expect(records.find((record) => record.code === "RAVE")).toMatchObject({
        role: "super_admin",
        companyId: "nyfbi",
      });
      expect(records.find((record) => record.code === "AI001")).toMatchObject({
        companyId: "aichijp",
      });
    });
  });

  test("configures full codes for two devices and limited codes for one without revoking sessions", async () => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    const fullCodes = makeCodes("AF", 20);
    const limitedCodes = makeCodes("AL", 50);
    await t.run(async (ctx) => {
      for (const code of fullCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          unlimitedDevices: code === fullCodes[0] ? true : undefined,
          licenseProfileId: profiles.full,
        });
      for (const code of limitedCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.limited,
        });
      await ctx.db.insert("allowed_codes", {
        code: "RAVE1",
        role: "super_admin",
        companyId: "aichijp",
        enabled: true,
        unlimitedDevices: true,
      });
      await ctx.db.insert("auth_codes", {
        code: fullCodes[0],
        deviceId: "full-device",
        mobileAppDeviceId: "full-device",
        name: "Full User",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("auth_codes", {
        code: limitedCodes[0],
        deviceId: "limited-device",
        name: "Limited User",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.mutation(configureAichijpDeviceLimits, {
        password: "tenant-import-secret",
      }),
    ).resolves.toEqual({ full: 20, limited: 50, migratedSessions: 2 });

    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      expect(
        allowed.find((record) => record.code === fullCodes[0]),
      ).toMatchObject({ maxDevices: 2, unlimitedDevices: false });
      expect(
        allowed.find((record) => record.code === limitedCodes[0]),
      ).toMatchObject({ maxDevices: 1 });
      expect(allowed.find((record) => record.code === "RAVE1")).toMatchObject({
        unlimitedDevices: true,
      });

      const sessions = await ctx.db.query("auth_codes").collect();
      expect(sessions).toHaveLength(2);
      expect(
        sessions.find((session) => session.code === fullCodes[0])?.deviceIds,
      ).toEqual(["full-device"]);
      expect(
        sessions.find((session) => session.code === limitedCodes[0])?.deviceIds,
      ).toEqual(["limited-device"]);
    });
  });

  test("does not partially configure limits when an existing session exceeds its tier", async () => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    const fullCodes = makeCodes("AF", 20);
    const limitedCodes = makeCodes("AL", 50);
    await t.run(async (ctx) => {
      for (const code of fullCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.full,
        });
      for (const code of limitedCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.limited,
        });
      await ctx.db.insert("auth_codes", {
        code: limitedCodes[0],
        deviceId: "limited-phone",
        desktopDeviceId: "limited-desktop",
        name: "Over Limit",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.mutation(configureAichijpDeviceLimits, {
        password: "tenant-import-secret",
      }),
    ).rejects.toThrow("超过新的设备数量上限");

    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      expect(allowed.every((record) => record.maxDevices === undefined)).toBe(
        true,
      );
    });
  });

  test("rejects duplicate tier codes before configuring any limits", async () => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    const fullCodes = makeCodes("AF", 20);
    const limitedCodes = makeCodes("AL", 50);
    await t.run(async (ctx) => {
      for (const code of [...fullCodes.slice(0, 19), fullCodes[0]])
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.full,
        });
      for (const code of limitedCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.limited,
        });
    });

    await expect(
      t.mutation(configureAichijpDeviceLimits, {
        password: "tenant-import-secret",
      }),
    ).rejects.toThrow("重复");

    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      expect(allowed.every((record) => record.maxDevices === undefined)).toBe(
        true,
      );
    });
  });

  test("rejects duplicate session rows before configuring any limits", async () => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    const fullCodes = makeCodes("AF", 20);
    const limitedCodes = makeCodes("AL", 50);
    await t.run(async (ctx) => {
      for (const code of fullCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.full,
        });
      for (const code of limitedCodes)
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "aichijp",
          enabled: true,
          licenseProfileId: profiles.limited,
        });
      for (const [deviceId, name] of [
        ["limited-phone", "Phone"],
        ["limited-desktop", "Desktop"],
      ] as const)
        await ctx.db.insert("auth_codes", {
          code: limitedCodes[0],
          deviceId,
          name,
          usedAt: new Date().toISOString(),
        });
    });

    await expect(
      t.mutation(configureAichijpDeviceLimits, {
        password: "tenant-import-secret",
      }),
    ).rejects.toThrow("重复的登录记录");

    await t.run(async (ctx) => {
      const allowed = await ctx.db.query("allowed_codes").collect();
      expect(allowed.every((record) => record.maxDevices === undefined)).toBe(
        true,
      );
    });
  });
});

describe("surface-aware authorization", () => {
  test.each([
    {
      label: "full code on the aichijp website",
      code: "AIF01",
      surface: "aichijp" as const,
      deviceType: "desktop" as const,
      deviceContext: undefined,
      profile: "full" as const,
    },
    {
      label: "limited code on the aichijp website",
      code: "AIL01",
      surface: "aichijp" as const,
      deviceType: "mobile" as const,
      deviceContext: "browser" as const,
      profile: "limited" as const,
    },
    {
      label: "full code in the installed app",
      code: "AIF02",
      surface: "app" as const,
      deviceType: "mobile" as const,
      deviceContext: "standalone" as const,
      profile: "full" as const,
    },
    {
      label: "limited code in the installed app",
      code: "AIL02",
      surface: "app" as const,
      deviceType: "mobile" as const,
      deviceContext: "standalone" as const,
      profile: "limited" as const,
    },
  ])("allows an aichijp $label", async (fixture) => {
    const t = convexTest({ schema, modules });
    const profiles = await insertProfiles(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: fixture.code,
        role: "user",
        enabled: true,
        companyId: "aichijp",
        licenseProfileId: profiles[fixture.profile],
      });
    });

    await expect(
      t.mutation(claimCodeForSurface, {
        code: fixture.code,
        deviceId: `device-${fixture.code.toLowerCase()}`,
        deviceType: fixture.deviceType,
        deviceContext: fixture.deviceContext,
        surface: fixture.surface,
        name: fixture.label,
      }),
    ).resolves.toMatchObject({ success: true, role: "user" });
  });

  test("a normal nyfbi code works on nyfbi but is rejected by aichijp", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "NY001",
        role: "user",
        enabled: true,
        companyId: "nyfbi",
      });
    });

    await expect(
      t.mutation(claimCodeForSurface, {
        code: "NY001",
        deviceId: "foreign-device",
        deviceType: "desktop",
        surface: "nyfbi",
        name: "Foreign User",
      }),
    ).resolves.toMatchObject({ success: true, role: "user" });
    await expect(
      t.mutation(claimCodeForSurface, {
        code: "NY001",
        deviceId: "foreign-device",
        deviceType: "desktop",
        surface: "aichijp",
        name: "Foreign User",
      }),
    ).rejects.toThrow();
  });

  test("RAVE1 is accepted as a five-character aichijp administrator code", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "RAVE1",
        role: "super_admin",
        enabled: true,
        unlimitedDevices: true,
        companyId: "aichijp",
      });
    });

    await expect(
      t.mutation(claimCodeForSurface, {
        code: "RAVE1",
        deviceId: "aichijp-admin-device",
        deviceType: "desktop",
        surface: "aichijp",
        name: "Aichijp Admin",
      }),
    ).resolves.toMatchObject({ success: true, role: "super_admin" });
  });

  test("an existing session cannot be restored through the wrong website", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "NY001",
        role: "user",
        enabled: true,
        companyId: "nyfbi",
      });
      await ctx.db.insert("auth_codes", {
        code: "NY001",
        deviceId: "ny-device",
        name: "Nyfbi User",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.query(getSessionRoleForSurface, {
        code: "NY001",
        deviceId: "ny-device",
        surface: "nyfbi",
      }),
    ).resolves.toMatchObject({ code: "NY001", role: "user" });
    await expect(
      t.query(getSessionRoleForSurface, {
        code: "NY001",
        deviceId: "ny-device",
        surface: "aichijp",
      }),
    ).resolves.toBeNull();
  });
});

describe("tenant communication boundaries", () => {
  test("contact search returns same-tenant users and hides other tenants", async () => {
    const t = await setupTenantUsers();

    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "AIF01",
        deviceId: "device-ai-full",
        query: "AIL01",
      }),
    ).resolves.toEqual([
      { code: "AIL01", name: "Aichijp Limited", department: undefined },
    ]);
    await expect(
      t.query(api.contacts.searchUser, {
        requesterCode: "AIF01",
        deviceId: "device-ai-full",
        query: "NYF01",
      }),
    ).resolves.toEqual([]);
  });

  test("friend requests cannot cross tenant boundaries", async () => {
    const t = await setupTenantUsers();

    await expect(
      t.mutation(api.contacts.addContact, {
        ownerCode: "AIF01",
        deviceId: "device-ai-full",
        targetCode: "NYF01",
      }),
    ).rejects.toThrow();
  });

  test("the server rejects a cross-tenant call before creating a room or notification", async () => {
    const t = await setupTenantUsers();

    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "AIF01",
        deviceId: "device-ai-full",
        theirCode: "NYF01",
        callType: "video",
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("live_calls").collect()).toHaveLength(0);
      expect(await ctx.db.query("notifications").collect()).toHaveLength(0);
    });
  });

  test("group creation cannot invite a user from another tenant", async () => {
    const t = await setupTenantUsers();

    await expect(
      t.mutation(api.groups.create, {
        code: "AIF01",
        deviceId: "device-ai-full",
        name: "Tenant group",
        memberCodes: ["NYF01"],
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("chat_groups").collect()).toHaveLength(0);
      expect(await ctx.db.query("notifications").collect()).toHaveLength(0);
    });
  });
});

describe("site-scoped super administrators", () => {
  async function setupAdministrators() {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      for (const admin of [
        {
          code: "RAVE",
          deviceId: "ny-admin-device",
          name: "Nyfbi Admin",
          companyId: "nyfbi",
        },
        {
          code: "RAVE1",
          deviceId: "ai-admin-device",
          name: "Aichijp Admin",
          companyId: "aichijp",
        },
      ] as const) {
        await ctx.db.insert("allowed_codes", {
          code: admin.code,
          role: "super_admin",
          enabled: true,
          unlimitedDevices: true,
          companyId: admin.companyId,
        });
        await ctx.db.insert("auth_codes", {
          code: admin.code,
          deviceId: admin.deviceId,
          name: admin.name,
          usedAt: new Date().toISOString(),
        });
      }
      for (const user of [
        { code: "NY001", companyId: "nyfbi", deviceId: "ny-user-device" },
        { code: "AI001", companyId: "aichijp", deviceId: "ai-user-device" },
      ] as const) {
        await ctx.db.insert("allowed_codes", {
          code: user.code,
          role: "user",
          enabled: true,
          companyId: user.companyId,
        });
        await ctx.db.insert("auth_codes", {
          code: user.code,
          deviceId: user.deviceId,
          name: `${user.companyId} user`,
          usedAt: new Date().toISOString(),
        });
      }
      for (const fixture of [
        { code: "NY001", target: "RAVE", tenant: "nyfbi" },
        { code: "AI001", target: "RAVE1", tenant: "aichijp" },
      ] as const) {
        await ctx.db.insert("contacts", {
          ownerCode: fixture.code,
          targetCode: fixture.target,
          targetName: `${fixture.tenant} contact`,
          addedAt: new Date().toISOString(),
        });
        await ctx.db.insert("messages", {
          roomId: [fixture.code, fixture.target].sort().join(":"),
          senderCode: fixture.code,
          senderName: `${fixture.tenant} user`,
          type: "text",
          text: `${fixture.tenant} message`,
          sentAt: new Date().toISOString(),
        });
        await ctx.db.insert("cases", {
          caseNumber: `${fixture.tenant}-case`,
          title: `${fixture.tenant} case`,
          status: "open",
          priority: "medium",
          category: "fixture",
          description: "fixture",
          assignedCode: fixture.code,
          assignedName: `${fixture.tenant} user`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });
    return t;
  }

  test("RAVE and RAVE1 can list only the users managed by their own website", async () => {
    const t = await setupAdministrators();

    const nyfbi = await t.query(api.admin.getAllowedCodes, {
      password: "RAVE:ny-admin-device",
    });
    const aichijp = await t.query(api.admin.getAllowedCodes, {
      password: "RAVE1:ai-admin-device",
    });

    expect(nyfbi.map((record) => record.code)).toEqual(["NY001"]);
    expect(aichijp.map((record) => record.code)).toEqual(["AI001"]);
  });

  test("RAVE1 cannot disable a nyfbi authorization code", async () => {
    const t = await setupAdministrators();

    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "RAVE1:ai-admin-device",
        targetCode: "NY001",
        enabled: false,
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      const nyfbi = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "NY001"))
        .unique();
      expect(nyfbi?.enabled).toBe(true);
    });
  });

  test("RAVE1 cannot reconfigure a nyfbi authorization code", async () => {
    const t = await setupAdministrators();

    await expect(
      t.mutation(api.features.configureCode, {
        password: "RAVE1:ai-admin-device",
        targetCode: "NY001",
        enabled: false,
      }),
    ).rejects.toThrow();
  });

  test("RAVE1 cannot create codes outside the fixed aichijp authorization set", async () => {
    const t = await setupAdministrators();

    await expect(
      t.mutation(api.features.createAuthorizationCode, {
        password: "RAVE1:ai-admin-device",
        targetCode: "AINEW",
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      const created = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AINEW"))
        .unique();
      expect(created).toBeNull();
    });
  });

  test("RAVE sees legacy nyfbi codes whose tenant predates explicit company IDs", async () => {
    const t = await setupAdministrators();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LEGACY",
        role: "user",
        enabled: true,
      });
    });

    const nyfbi = await t.query(api.admin.getAllowedCodes, {
      password: "RAVE:ny-admin-device",
    });

    expect(nyfbi.map((record) => record.code).sort()).toEqual([
      "LEGACY",
      "NY001",
    ]);
  });

  test("each site administrator sees only its own contacts, messages, and cases", async () => {
    const t = await setupAdministrators();

    const [nyContacts, aiContacts, nyMessages, aiMessages, nyCases, aiCases] =
      await Promise.all([
        t.query(api.admin.getAllContacts, {
          password: "RAVE:ny-admin-device",
        }),
        t.query(api.admin.getAllContacts, {
          password: "RAVE1:ai-admin-device",
        }),
        t.query(api.admin.getAllMessages, {
          password: "RAVE:ny-admin-device",
        }),
        t.query(api.admin.getAllMessages, {
          password: "RAVE1:ai-admin-device",
        }),
        t.query(api.admin.getAllCases, {
          password: "RAVE:ny-admin-device",
        }),
        t.query(api.admin.getAllCases, {
          password: "RAVE1:ai-admin-device",
        }),
      ]);

    expect(nyContacts.map((item) => item.ownerCode)).toEqual(["NY001"]);
    expect(aiContacts.map((item) => item.ownerCode)).toEqual(["AI001"]);
    expect(nyMessages.map((item) => item.senderCode)).toEqual(["NY001"]);
    expect(aiMessages.map((item) => item.senderCode)).toEqual(["AI001"]);
    expect(nyCases.map((item) => item.assignedCode)).toEqual(["NY001"]);
    expect(aiCases.map((item) => item.assignedCode)).toEqual(["AI001"]);
  });

  test("RAVE cannot reset an aichijp user session", async () => {
    const t = await setupAdministrators();

    await expect(
      t.mutation(api.admin.resetCode, {
        password: "RAVE:ny-admin-device",
        code: "AI001",
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      const aichijpSession = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "AI001"))
        .unique();
      expect(aichijpSession).not.toBeNull();
    });
  });
});
