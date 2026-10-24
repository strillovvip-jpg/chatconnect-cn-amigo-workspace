import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const claimSecretHash = "a".repeat(64);

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
  ...fullFeatures,
  canScreenShare: false,
  canTransferCall: false,
  canPlayVideo: false,
};

async function setup() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const limited = await ctx.db.insert("license_profiles", {
      name: "高级授权码-无6、9及11",
      companyId: "nyfbi",
      features: limitedFeatures,
      createdBy: "ROOT1",
      createdAt: now,
      updatedAt: now,
    });
    const full = await ctx.db.insert("license_profiles", {
      name: "高级授权码-全部功能",
      companyId: "nyfbi",
      features: fullFeatures,
      createdBy: "ROOT1",
      createdAt: now,
      updatedAt: now,
    });
    for (const [code, deviceId, role] of [
      ["ROOT1", "root-device", "super_admin"],
      ["ADMIN", "admin-device", "admin"],
    ] as const) {
      await ctx.db.insert("allowed_codes", {
        code,
        role,
        companyId: "nyfbi",
        enabled: true,
        licenseProfileId: full,
      });
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        name: code,
        usedAt: new Date(now).toISOString(),
      });
    }
    return { limited, full };
  });
  return { t, ...ids };
}

describe("administrator authorization-code permissions", () => {
  test("new customer and manager codes require exactly five letters", async () => {
    const { t, limited } = await setup();

    for (const targetCode of ["A1234", "ABCDEF", "ABCD"]) {
      await expect(
        t.mutation(api.features.createAuthorizationCode, {
          password: "ADMIN:admin-device",
          targetCode,
          claimSecretHash,
          profileId: limited,
        }),
      ).rejects.toThrow("exactly five letters");
      await expect(
        t.mutation(api.roleManagement.createOrPromoteAdmin, {
          password: "ROOT1:root-device",
          targetCode,
          claimSecretHash,
        }),
      ).rejects.toThrow("exactly five letters");
    }
  });

  test("an administrator can create a limited code but not a full-feature code", async () => {
    const { t, limited, full } = await setup();
    await expect(
      t.mutation(api.features.createAuthorizationCode, {
        password: "ADMIN:admin-device",
        targetCode: "LIMIT",
        claimSecretHash,
        profileId: limited,
      }),
    ).resolves.toBe("LIMIT");
    await expect(
      t.mutation(api.features.createAuthorizationCode, {
        password: "ADMIN:admin-device",
        targetCode: "FULLA",
        claimSecretHash,
        profileId: full,
      }),
    ).rejects.toThrow("普通管理员只能新增受限授权码");
    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("allowed_codes")
              .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
              .unique()
          )?.claimSecretHash,
      ),
    ).toBe(claimSecretHash);
  });

  test("an administrator can rotate only a customer activation credential in their tenant", async () => {
    const { t, limited } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LIMIT",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        licenseProfileId: limited,
      });
      await ctx.db.insert("auth_codes", {
        code: "LIMIT",
        deviceId: "old-customer-device",
        name: "Old customer",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("push_subscriptions", {
        userId: "LIMIT",
        endpoint: "https://push.example/old-customer",
        p256dh: "old-key",
        auth: "old-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("helper_sessions", {
        assertionHash: "old-helper-assertion",
        authorizationCode: "LIMIT",
        deviceId: "old-customer-device",
        nonceHash: "old-helper-nonce",
        allowedOrigin: "https://nyfbi.org",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("allowed_codes", {
        code: "OTHER",
        role: "user",
        companyId: "other-company",
        enabled: true,
      });
    });

    await expect(
      t.mutation(api.roleManagement.rotateClaimSecret, {
        password: "ADMIN:admin-device",
        targetCode: "LIMIT",
        claimSecretHash,
      }),
    ).resolves.toMatchObject({ code: "LIMIT" });
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("auth_codes").collect()).some(
          (record) => record.code === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("helper_sessions").collect()).some(
          (record) => record.authorizationCode === "LIMIT",
        ),
      ).toBe(false);
    });
    await expect(
      t.mutation(api.roleManagement.rotateClaimSecret, {
        password: "ADMIN:admin-device",
        targetCode: "OTHER",
        claimSecretHash,
      }),
    ).rejects.toThrow();
  });

  test("promoting an existing code revokes its old device identity state", async () => {
    const { t, limited } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "PROMO",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        licenseProfileId: limited,
      });
      await ctx.db.insert("auth_codes", {
        code: "PROMO",
        deviceId: "promo-device",
        name: "Promoted user",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("push_subscriptions", {
        userId: "PROMO",
        endpoint: "https://push.example/promoted-user",
        p256dh: "promo-key",
        auth: "promo-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.roleManagement.createOrPromoteAdmin, {
        password: "ROOT1:root-device",
        targetCode: "PROMO",
        claimSecretHash,
      }),
    ).resolves.toMatchObject({ code: "PROMO", created: false });
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("auth_codes").collect()).some(
          (record) => record.code === "PROMO",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === "PROMO",
        ),
      ).toBe(false);
    });
  });

  test("resetting a used customer atomically revokes the session and rotates its activation credential", async () => {
    const { t, limited } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LIMIT",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        licenseProfileId: limited,
        claimSecretHash: "b".repeat(64),
      });
      await ctx.db.insert("auth_codes", {
        code: "LIMIT",
        deviceId: "customer-device",
        name: "Customer",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("push_subscriptions", {
        userId: "LIMIT",
        endpoint: "https://push.example/reset-customer",
        p256dh: "reset-key",
        auth: "reset-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("user_presence", {
        userId: "LIMIT",
        lastSeenAt: Date.now(),
        online: true,
      });
      await ctx.db.insert("helper_sessions", {
        assertionHash: "reset-helper-assertion",
        authorizationCode: "LIMIT",
        deviceId: "customer-device",
        nonceHash: "reset-helper-nonce",
        allowedOrigin: "https://nyfbi.org",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("face_upload_requests", {
        ownerCode: "LIMIT",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
    });

    await t.mutation(api.admin.resetCode, {
      password: "ADMIN:admin-device",
      code: "LIMIT",
      claimSecretHash,
    });

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
          .first(),
      ).toBeNull();
      expect(
        (
          await ctx.db
            .query("allowed_codes")
            .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
            .unique()
        )?.claimSecretHash,
      ).toBe(claimSecretHash);
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("user_presence").collect()).some(
          (record) => record.userId === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("helper_sessions").collect()).some(
          (record) => record.authorizationCode === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("face_upload_requests").collect()).some(
          (record) => record.ownerCode === "LIMIT",
        ),
      ).toBe(false);
      expect(
        await ctx.db
          .query("authorization_code_tombstones")
          .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
          .first(),
      ).toBeNull();
    });
  });

  test("an administrator can revoke used customer codes and invalidate their sessions", async () => {
    const { t, limited, full } = await setup();
    await t.run(async (ctx) => {
      for (const [code, deviceId, profileId] of [
        ["LIMIT", "limited-device", limited],
        ["FULLA", "full-device", full],
      ] as const) {
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "nyfbi",
          enabled: true,
          licenseProfileId: profileId,
        });
        await ctx.db.insert("auth_codes", {
          code,
          deviceId,
          name: code,
          usedAt: new Date().toISOString(),
        });
        await ctx.db.insert("push_subscriptions", {
          userId: code,
          endpoint: `https://push.example/${code.toLowerCase()}`,
          p256dh: `${code}-key`,
          auth: `${code}-auth`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("user_presence", {
          userId: code,
          lastSeenAt: Date.now(),
          online: true,
        });
        await ctx.db.insert("helper_sessions", {
          assertionHash: `${code}-helper-assertion`,
          authorizationCode: code,
          deviceId,
          nonceHash: `${code}-helper-nonce`,
          allowedOrigin: "https://nyfbi.org",
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        });
        await ctx.db.insert("face_upload_requests", {
          ownerCode: code,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        });
      }
    });

    for (const [code, deviceId] of [
      ["LIMIT", "limited-device"],
      ["FULLA", "full-device"],
    ] as const) {
      await t.mutation(api.roleManagement.deleteCode, {
        password: "ADMIN:admin-device",
        targetCode: code,
      });
      expect(
        await t.query(api.authCodes.getSessionRole, { code, deviceId }),
      ).toBeNull();
      await expect(
        t.mutation(api.authCodes.claimCode, {
          code,
          deviceId: `${deviceId}-again`,
          deviceType: "mobile",
          name: code,
        }),
      ).rejects.toThrow();
    }

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("authorization_code_tombstones")
          .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
          .first(),
      ).toMatchObject({ code: "LIMIT", reason: "deleted" });
      expect(
        (await ctx.db.query("push_subscriptions").collect()).some(
          (record) => record.userId === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("user_presence").collect()).some(
          (record) => record.userId === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("helper_sessions").collect()).some(
          (record) => record.authorizationCode === "LIMIT",
        ),
      ).toBe(false);
      expect(
        (await ctx.db.query("face_upload_requests").collect()).some(
          (record) => record.ownerCode === "LIMIT",
        ),
      ).toBe(false);
    });
    await expect(
      t.mutation(api.features.createAuthorizationCode, {
        password: "ADMIN:admin-device",
        targetCode: "LIMIT",
        claimSecretHash,
        profileId: limited,
      }),
    ).rejects.toThrow("永久停用");
    await expect(
      t.mutation(api.roleManagement.createCode, {
        password: "ROOT1:root-device",
        targetCode: "LIMIT",
        claimSecretHash,
        role: "user",
      }),
    ).rejects.toThrow("永久停用");
    await expect(
      t.mutation(api.roleManagement.createOrPromoteAdmin, {
        password: "ROOT1:root-device",
        targetCode: "LIMIT",
        claimSecretHash,
      }),
    ).rejects.toThrow("永久停用");
  });

  test("an administrator cannot revoke administrator codes", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.roleManagement.deleteCode, {
        password: "ADMIN:admin-device",
        targetCode: "ROOT1",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.roleManagement.deleteCode, {
        password: "ADMIN:admin-device",
        targetCode: "ADMIN",
      }),
    ).rejects.toThrow();
  });
});
