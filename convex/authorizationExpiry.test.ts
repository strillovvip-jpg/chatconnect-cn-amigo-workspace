import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const NOW = 1_800_000_000_000;

async function setup() {
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
      name: "Root",
      usedAt: new Date(NOW).toISOString(),
    });
  });
  return t;
}

async function addRevocableState(
  t: Awaited<ReturnType<typeof setup>>,
  code: string,
) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code,
      deviceId: `${code.toLowerCase()}-device`,
      name: code,
      usedAt: new Date(NOW).toISOString(),
    });
    await ctx.db.insert("push_subscriptions", {
      userId: code,
      endpoint: `https://push.example/${code.toLowerCase()}`,
      p256dh: `${code}-key`,
      auth: `${code}-auth`,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("helper_sessions", {
      assertionHash: `${code}-assertion`,
      authorizationCode: code,
      deviceId: `${code.toLowerCase()}-device`,
      nonceHash: `${code}-nonce`,
      allowedOrigin: "https://nyfbi.org",
      createdAt: NOW,
      expiresAt: NOW + 60_000,
    });
    await ctx.db.insert("face_upload_requests", {
      ownerCode: code,
      createdAt: NOW,
      expiresAt: NOW + 60_000,
    });
    return await ctx.db.insert("external_video_invites", {
      inviteId: `${code.toLowerCase()}-expiry-invite`,
      roomName: `${code.toLowerCase()}-expiry-room`,
      operatorCode: code,
      operatorName: code,
      operatorIdentity: `${code}-host-publisher`,
      operatorViewerIdentity: `${code}-host-viewer`,
      tenantId: "nyfbi",
      passwordHash: `${code}-hash`,
      passwordSalt: `${code}-salt`,
      status: "active",
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      guestJoinedAt: NOW,
      guestIdentity: `${code}-guest`,
    });
  });
}

async function expectIdentityStateRevoked(
  t: Awaited<ReturnType<typeof setup>>,
  code: string,
  inviteId: Awaited<ReturnType<typeof addRevocableState>>,
) {
  await t.run(async (ctx) => {
    expect(
      await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first(),
    ).toBeNull();
    expect(
      await ctx.db
        .query("push_subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", code))
        .first(),
    ).toBeNull();
    expect(
      await ctx.db
        .query("helper_sessions")
        .withIndex("by_authorization_code", (q) =>
          q.eq("authorizationCode", code),
        )
        .first(),
    ).toBeNull();
    expect(
      await ctx.db
        .query("face_upload_requests")
        .withIndex("by_owner_created", (q) => q.eq("ownerCode", code))
        .first(),
    ).toBeNull();
    expect(await ctx.db.get(inviteId)).toMatchObject({
      status: "ended",
      endedAt: expect.any(Number),
    });
    const inviteCleanup = (await ctx.db.query("audit_logs").collect()).find(
      (record) =>
        record.action === "authorization.livekit_revoke" &&
        record.targetId === `${code.toLowerCase()}-expiry-room`,
    );
    expect(
      [...(inviteCleanup?.details.participantIdentities ?? [])].sort(),
    ).toEqual([
      `${code}-guest`,
      `${code}-host-publisher`,
      `${code}-host-viewer`,
    ]);
  });
}

describe("authorization code expiry scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.ROLE_MIGRATION_SECRET = "migration-secret";
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.ROLE_MIGRATION_SECRET;
  });

  test("a newly created future expiry revokes identity, push, helper, upload, and invite state without another admin write", async () => {
    const t = await setup();
    const expiresAt = NOW + 1_000;
    await t.mutation(api.features.createAuthorizationCode, {
      password: "ROOT1:root-device",
      targetCode: "EXPIA",
      claimSecretHash: "a".repeat(64),
      expiresAt,
    });
    const inviteId = await addRevocableState(t, "EXPIA");

    vi.advanceTimersByTime(1_001);
    await t.finishInProgressScheduledFunctions();

    await expectIdentityStateRevoked(t, "EXPIA", inviteId);
  });

  test("an obsolete expiry cannot revoke early and the replacement expiry still revokes on schedule", async () => {
    const t = await setup();
    await t.mutation(api.features.createAuthorizationCode, {
      password: "ROOT1:root-device",
      targetCode: "EXPIB",
      claimSecretHash: "b".repeat(64),
      expiresAt: NOW + 1_000,
    });
    const inviteId = await addRevocableState(t, "EXPIB");
    await t.mutation(api.features.configureCode, {
      password: "ROOT1:root-device",
      targetCode: "EXPIB",
      enabled: true,
      expiresAt: NOW + 10_000,
    });

    vi.advanceTimersByTime(1_001);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", "EXPIB"))
          .first(),
      ).not.toBeNull();
      expect(await ctx.db.get(inviteId)).toMatchObject({ status: "active" });
    });

    vi.advanceTimersByTime(9_000);
    await t.finishInProgressScheduledFunctions();

    await expectIdentityStateRevoked(t, "EXPIB", inviteId);
  });

  test("the protected backfill schedules revocation for existing future expiries", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "EXPIC",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        expiresAt: NOW + 1_000,
      });
    });
    const inviteId = await addRevocableState(t, "EXPIC");

    await expect(
      t.mutation(api.roleManagement.backfillAuthorizationCodeExpirySchedules, {
        migrationSecret: "wrong-secret",
      }),
    ).rejects.toThrow("迁移验证信息无效");
    await expect(
      t.mutation(api.roleManagement.backfillAuthorizationCodeExpirySchedules, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({ revoked: 0, scheduled: 1 });

    vi.advanceTimersByTime(1_001);
    await t.finishInProgressScheduledFunctions();

    await expectIdentityStateRevoked(t, "EXPIC", inviteId);
  });

  test("the protected backfill immediately revokes existing unprocessed past expiries", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "EXPID",
        role: "user",
        companyId: "nyfbi",
        enabled: true,
        expiresAt: NOW - 1,
      });
    });
    const inviteId = await addRevocableState(t, "EXPID");

    await expect(
      t.mutation(api.roleManagement.backfillAuthorizationCodeExpirySchedules, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({ revoked: 1, scheduled: 0 });

    await expectIdentityStateRevoked(t, "EXPID", inviteId);
  });

  test("a backfilled future expiry also cleans stale state on a legacy-disabled code", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "EXPIE",
        role: "user",
        companyId: "nyfbi",
        enabled: false,
        expiresAt: NOW + 1_000,
      });
    });
    const inviteId = await addRevocableState(t, "EXPIE");
    await expect(
      t.mutation(api.roleManagement.backfillAuthorizationCodeExpirySchedules, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({ revoked: 0, scheduled: 1 });

    vi.advanceTimersByTime(1_001);
    await t.finishInProgressScheduledFunctions();

    await expectIdentityStateRevoked(t, "EXPIE", inviteId);
  });
});
