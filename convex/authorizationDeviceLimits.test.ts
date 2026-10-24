import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { hashClaimSecret } from "./claimCredentials";
import schema from "./schema";

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
  ...fullFeatures,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const full = await ctx.db.insert("license_profiles", {
      name: "Full",
      companyId: "nyfbi",
      features: fullFeatures,
      createdBy: "ROOTA",
      createdAt: now,
      updatedAt: now,
    });
    const limited = await ctx.db.insert("license_profiles", {
      name: "Limited",
      companyId: "nyfbi",
      features: limitedFeatures,
      createdBy: "ROOTA",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("allowed_codes", {
      code: "ROOTA",
      role: "super_admin",
      companyId: "nyfbi",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "ROOTA",
      deviceId: "root-device",
      deviceIds: ["root-device"],
      name: "Root",
      usedAt: new Date(now).toISOString(),
    });
    return { full, limited };
  });
  return { t, ...ids };
}

describe("authorization-code device limits", () => {
  test("current role and profile override stale maxDevices and unlimitedDevices", async () => {
    const { t, full, limited } = await setup();
    const secret = "A".repeat(32);
    await t.run(async (ctx) => {
      for (const [code, role, profileId] of [
        ["ADMIN", "admin", undefined],
        ["FULLA", "user", full],
        ["LIMIT", "user", limited],
      ] as const) {
        await ctx.db.insert("allowed_codes", {
          code,
          role,
          companyId: "nyfbi",
          enabled: true,
          unlimitedDevices: true,
          maxDevices: 99,
          claimSecretHash: await hashClaimSecret(code, secret),
          licenseProfileId: profileId,
        });
        await ctx.db.insert("auth_codes", {
          code,
          deviceId: `${code}-one`,
          deviceIds: [`${code}-one`],
          name: code,
          usedAt: new Date().toISOString(),
        });
      }
    });

    for (const code of ["ADMIN", "FULLA"])
      await expect(
        t.mutation(api.authCodes.claimCode, {
          code: `${code}.${secret}`,
          deviceId: `${code}-two`,
          deviceType: "mobile",
          name: code,
        }),
      ).resolves.toMatchObject({ success: true });

    for (const code of ["ADMIN", "FULLA"])
      await expect(
        t.mutation(api.authCodes.claimCode, {
          code: `${code}.${secret}`,
          deviceId: `${code}-three`,
          deviceType: "desktop",
          name: code,
        }),
      ).rejects.toThrow("最多同时登录两台设备");

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `LIMIT.${secret}`,
        deviceId: "LIMIT-two",
        deviceType: "mobile",
        name: "LIMIT",
      }),
    ).rejects.toThrow("仅允许绑定一台设备");
  });

  test("downgrading a code retains its most recently used device and revokes only removed-device media", async () => {
    const { t, full, limited } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "TARGET",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        unlimitedDevices: true,
        maxDevices: 99,
        licenseProfileId: full,
      });
      await ctx.db.insert("auth_codes", {
        code: "TARGET",
        deviceId: "device-old",
        deviceIds: ["device-old", "device-new"],
        desktopDeviceId: "device-old",
        mobileAppDeviceId: "device-new",
        name: "Target",
        usedAt: new Date().toISOString(),
        lastLoginAt: Date.now() - 1_000,
      });
      for (const deviceId of ["device-old", "device-new"])
        await ctx.db.insert("helper_sessions", {
          assertionHash: `assertion-${deviceId}`,
          authorizationCode: "TARGET",
          deviceId,
          nonceHash: `nonce-${deviceId}`,
          allowedOrigin: "https://nyfbi.org",
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        });
      await ctx.db.insert("push_subscriptions", {
        userId: "TARGET",
        endpoint: "https://push.example/target",
        p256dh: "target-key",
        auth: "target-auth",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("user_presence", {
        userId: "TARGET",
        lastSeenAt: Date.now(),
        online: true,
      });
      for (const [suffix, deviceId] of [
        ["old", "device-old"],
        ["new", "device-new"],
      ] as const)
        await ctx.db.insert("live_calls", {
          callId: `call-${suffix}`,
          roomName: `room-${suffix}`,
          type: "video",
          status: "active",
          participantCodes: ["TARGET", `PEER${suffix.toUpperCase()}`],
          createdByCode: "TARGET",
          callerUserId: "TARGET",
          callerDeviceId: deviceId,
          callerIdentity: `TARGET-${suffix}-identity`,
          calleeUserId: `PEER${suffix.toUpperCase()}`,
          createdAt: Date.now(),
        });
    });

    // Refresh the older binding so it becomes the deterministic most-recent
    // device before the tier is reduced.
    await t.mutation(api.authCodes.claimCode, {
      code: "TARGET",
      deviceId: "device-old",
      deviceType: "desktop",
      name: "Target",
    });
    await t.mutation(api.features.configureCode, {
      password: "ROOTA:root-device",
      targetCode: "TARGET",
      profileId: limited,
      enabled: true,
    });

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "TARGET"))
        .unique();
      expect(allowed).toMatchObject({
        licenseProfileId: limited,
        maxDevices: 1,
      });
      expect(allowed?.unlimitedDevices).not.toBe(true);

      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "TARGET"))
        .unique();
      expect(session).toMatchObject({
        deviceId: "device-old",
        deviceIds: ["device-old"],
        desktopDeviceId: "device-old",
      });
      expect(session?.mobileAppDeviceId).toBeUndefined();

      expect(
        (await ctx.db.query("helper_sessions").collect()).map(
          (record) => record.deviceId,
        ),
      ).toEqual(["device-old"]);
      expect(await ctx.db.query("push_subscriptions").collect()).toEqual([]);
      expect(await ctx.db.query("user_presence").collect()).toEqual([]);

      const calls = await ctx.db.query("live_calls").collect();
      expect(calls.find((call) => call.callId === "call-old")?.status).toBe(
        "active",
      );
      expect(calls.find((call) => call.callId === "call-new")).toMatchObject({
        status: "ended",
        failureReason: "authorization_revoked",
      });
      expect(
        (await ctx.db.query("audit_logs").collect()).some(
          (record) =>
            record.action === "authorization.livekit_revoke" &&
            (
              record.details as { participantIdentities?: string[] }
            ).participantIdentities?.includes("TARGET-new-identity"),
        ),
      ).toBe(true);
    });

    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "TARGET",
        deviceId: "device-new",
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "TARGET",
        deviceId: "device-old",
      }),
    ).resolves.toMatchObject({ code: "TARGET" });
  });

  test("changing a shared full profile to limited reconciles every assigned code", async () => {
    const { t, full } = await setup();
    await t.run(async (ctx) => {
      for (const code of ["FIRST", "SECOND"])
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          companyId: "nyfbi",
          enabled: true,
          maxDevices: 2,
          licenseProfileId: full,
        });
      for (const code of ["FIRST", "SECOND"])
        await ctx.db.insert("auth_codes", {
          code,
          deviceId: `${code}-old`,
          deviceIds: [`${code}-old`, `${code}-new`],
          name: code,
          usedAt: new Date().toISOString(),
        });
    });

    await t.mutation(api.features.updateProfile, {
      password: "ROOTA:root-device",
      profileId: full,
      name: "Now limited",
      features: limitedFeatures,
    });

    await t.run(async (ctx) => {
      const allowed = (await ctx.db.query("allowed_codes").collect()).filter(
        (record) => ["FIRST", "SECOND"].includes(record.code),
      );
      expect(allowed.map((record) => record.maxDevices)).toEqual([1, 1]);
      const sessions = (await ctx.db.query("auth_codes").collect()).filter(
        (record) => ["FIRST", "SECOND"].includes(record.code),
      );
      expect(sessions.map((record) => record.deviceIds)).toEqual([
        ["FIRST-new"],
        ["SECOND-new"],
      ]);
    });
  });

  test("configuring an opted-in code preserves its two-device override", async () => {
    const { t, full, limited } = await setup();
    await t.run(async (ctx) => {
      for (const profileId of [full, limited])
        await ctx.db.patch(profileId, { companyId: "nersp" });
      const root = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ROOTA"))
        .unique();
      if (!root) throw new Error("missing root fixture");
      await ctx.db.patch(root._id, { companyId: "nersp" });
      await ctx.db.insert("allowed_codes", {
        code: "OPTIN",
        role: "user",
        companyId: "nersp",
        enabled: true,
        allowCodeOnlyDeviceClaim: true,
        maxDevices: 2,
        licenseProfileId: full,
      });
      await ctx.db.insert("auth_codes", {
        code: "OPTIN",
        deviceId: "optin-old",
        deviceIds: ["optin-old", "optin-new"],
        name: "Opted in",
        usedAt: new Date().toISOString(),
      });
    });

    await t.mutation(api.features.configureCode, {
      password: "ROOTA:root-device",
      targetCode: "OPTIN",
      profileId: limited,
      enabled: true,
    });

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "OPTIN"))
        .unique();
      expect(allowed).toMatchObject({
        allowCodeOnlyDeviceClaim: true,
        licenseProfileId: limited,
        maxDevices: 2,
      });
      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "OPTIN"))
        .unique();
      expect(session?.deviceIds).toEqual(["optin-old", "optin-new"]);
    });
  });

  test("editing an assigned profile preserves opted-in codes at two devices", async () => {
    const { t, full } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(full, { companyId: "nersp" });
      const root = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ROOTA"))
        .unique();
      if (!root) throw new Error("missing root fixture");
      await ctx.db.patch(root._id, { companyId: "nersp" });
      await ctx.db.insert("allowed_codes", {
        code: "OPTIN",
        role: "user",
        companyId: "nersp",
        enabled: true,
        allowCodeOnlyDeviceClaim: true,
        maxDevices: 2,
        licenseProfileId: full,
      });
      await ctx.db.insert("auth_codes", {
        code: "OPTIN",
        deviceId: "optin-old",
        deviceIds: ["optin-old", "optin-new"],
        name: "Opted in",
        usedAt: new Date().toISOString(),
      });
    });

    await t.mutation(api.features.updateProfile, {
      password: "ROOTA:root-device",
      profileId: full,
      name: "Now limited",
      features: limitedFeatures,
    });

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "OPTIN"))
        .unique();
      expect(allowed).toMatchObject({
        allowCodeOnlyDeviceClaim: true,
        maxDevices: 2,
      });
      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "OPTIN"))
        .unique();
      expect(session?.deviceIds).toEqual(["optin-old", "optin-new"]);
    });
  });

  test("demoting a profileless administrator to user applies the limited tier immediately", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "ADMIN",
        role: "admin",
        companyId: "nyfbi",
        enabled: true,
        unlimitedDevices: true,
        maxDevices: 99,
      });
      await ctx.db.insert("auth_codes", {
        code: "ADMIN",
        deviceId: "admin-old",
        deviceIds: ["admin-old", "admin-new"],
        name: "Admin",
        usedAt: new Date().toISOString(),
      });
    });

    await t.mutation(api.roleManagement.setRole, {
      password: "ROOTA:root-device",
      targetCode: "ADMIN",
      role: "user",
    });

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ADMIN"))
        .unique();
      expect(allowed).toMatchObject({ role: "user", maxDevices: 1 });
      expect(allowed?.unlimitedDevices).not.toBe(true);
      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "ADMIN"))
        .unique();
      expect(session?.deviceIds).toEqual(["admin-new"]);
    });
  });
});
