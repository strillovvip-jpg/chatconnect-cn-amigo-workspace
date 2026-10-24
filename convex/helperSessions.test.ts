import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const now = Date.UTC(2026, 9, 23, 3, 0, 0);

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

async function setup(companyId = "nyfbi") {
  const t = convexTest({ schema, modules });
  const fullProfileId = await t.run((ctx) =>
    ctx.db.insert("license_profiles", {
      name: "Full Windows face swap",
      companyId,
      features: fullFeatures,
      createdBy: "RAVE",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const limitedProfileId = await t.run((ctx) =>
    ctx.db.insert("license_profiles", {
      name: "Limited",
      companyId,
      features: { ...fullFeatures, canAIFace: false },
      createdBy: "RAVE",
      createdAt: now,
      updatedAt: now,
    }),
  );

  await t.run(async (ctx) => {
    for (const entry of [
      {
        code: "FULL1",
        deviceId: "device-full",
        enabled: true,
        licenseProfileId: fullProfileId,
      },
      {
        code: "LIMIT",
        deviceId: "device-limit",
        enabled: true,
        licenseProfileId: limitedProfileId,
      },
      {
        code: "OFF01",
        deviceId: "device-off",
        enabled: false,
        licenseProfileId: fullProfileId,
      },
    ]) {
      await ctx.db.insert("auth_codes", {
        code: entry.code,
        deviceId: entry.deviceId,
        name: entry.code,
        usedAt: new Date(now).toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: entry.code,
        role: "user",
        companyId,
        enabled: entry.enabled,
        licenseProfileId: entry.licenseProfileId,
      });
    }
  });
  return t;
}

describe("Windows helper sessions", () => {
  beforeEach(() => vi.setSystemTime(now));
  afterEach(() => vi.useRealTimers());

  test("a full-feature session receives one opaque five-minute assertion", async () => {
    const t = await setup();

    const result = await t.mutation(api.helperSessions.create, {
      code: "FULL1",
      deviceId: "device-full",
      helperNonce: "browser-nonce-1",
    });

    expect(result.origin).toBe("https://nyfbi.org");
    expect(result.expiresAt).toBe(now + 5 * 60 * 1000);
    expect(result.assertion).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const records = await t.run((ctx) =>
      ctx.db.query("helper_sessions").collect(),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      authorizationCode: "FULL1",
      deviceId: "device-full",
      allowedOrigin: "https://nyfbi.org",
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    });
    expect(records[0]).not.toHaveProperty("assertion");
    expect(records[0]).not.toHaveProperty("helperNonce");
    expect(JSON.stringify(records[0])).not.toMatch(
      /photo|image|frame|biometric/i,
    );
  });

  test("limited and disabled authorization codes are denied", async () => {
    const t = await setup();

    await expect(
      t.mutation(api.helperSessions.create, {
        code: "LIMIT",
        deviceId: "device-limit",
        helperNonce: "limited-nonce",
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      t.mutation(api.helperSessions.create, {
        code: "OFF01",
        deviceId: "device-off",
        helperNonce: "disabled-nonce",
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("a custom company uses the USA.Filing production portal origin", async () => {
    const t = await setup("company-usa-1");

    await expect(
      t.mutation(api.helperSessions.create, {
        code: "FULL1",
        deviceId: "device-full",
        helperNonce: "custom-company-nonce",
      }),
    ).resolves.toMatchObject({ origin: "https://nyfbi.org" });
  });

  test("the aichijp tenant cannot create a USA.Filing helper session", async () => {
    const t = await setup("aichijp");

    await expect(
      t.mutation(api.helperSessions.create, {
        code: "FULL1",
        deviceId: "device-full",
        helperNonce: "wrong-portal-nonce",
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("assertions are bound to the nonce and are single-use", async () => {
    const t = await setup();
    const created = await t.mutation(api.helperSessions.create, {
      code: "FULL1",
      deviceId: "device-full",
      helperNonce: "correct-nonce",
    });

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "wrong-nonce",
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "correct-nonce",
      }),
    ).resolves.toMatchObject({
      authorizationCode: "FULL1",
      deviceId: "device-full",
      origin: "https://nyfbi.org",
    });

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "correct-nonce",
      }),
    ).rejects.toThrow();
  });

  test("expired assertions cannot be consumed", async () => {
    const t = await setup();
    const created = await t.mutation(api.helperSessions.create, {
      code: "FULL1",
      deviceId: "device-full",
      helperNonce: "expiring-nonce",
    });

    vi.setSystemTime(now + 5 * 60 * 1000 + 1);

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "expiring-nonce",
      }),
    ).rejects.toThrow();
  });

  test("an unconsumed assertion is revoked when its authorization code is disabled or deleted", async () => {
    for (const revoke of ["disable", "delete"] as const) {
      const t = await setup();
      const created = await t.mutation(api.helperSessions.create, {
        code: "FULL1",
        deviceId: "device-full",
        helperNonce: `revoked-${revoke}`,
      });
      await t.run(async (ctx) => {
        const allowed = await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (query) => query.eq("code", "FULL1"))
          .unique();
        if (!allowed) throw new Error("missing fixture authorization code");
        if (revoke === "disable")
          await ctx.db.patch(allowed._id, { enabled: false });
        else await ctx.db.delete(allowed._id);
      });

      await expect(
        t.mutation(api.helperSessions.consume, {
          assertionId: created.assertion,
          helperNonce: `revoked-${revoke}`,
        }),
      ).rejects.toMatchObject({
        data: {
          code: "UNAUTHENTICATED",
          message: "The local helper assertion is invalid or expired.",
        },
      });
    }
  });

  test("an unconsumed assertion is revoked after the call device is rebound", async () => {
    const t = await setup();
    const created = await t.mutation(api.helperSessions.create, {
      code: "FULL1",
      deviceId: "device-full",
      helperNonce: "old-device-nonce",
    });
    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (query) => query.eq("code", "FULL1"))
        .unique();
      if (!session) throw new Error("missing fixture session");
      await ctx.db.patch(session._id, {
        deviceId: "replacement-device",
        deviceIds: ["replacement-device"],
      });
    });

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "old-device-nonce",
      }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  test("an unconsumed assertion is revoked when full face-video features are removed", async () => {
    const t = await setup();
    const created = await t.mutation(api.helperSessions.create, {
      code: "FULL1",
      deviceId: "device-full",
      helperNonce: "feature-revoked-nonce",
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (query) => query.eq("code", "FULL1"))
        .unique();
      const profile = allowed?.licenseProfileId
        ? await ctx.db.get(allowed.licenseProfileId)
        : null;
      if (!profile) throw new Error("missing fixture license profile");
      await ctx.db.patch(profile._id, {
        features: { ...profile.features, canAIFace: false },
      });
    });

    await expect(
      t.mutation(api.helperSessions.consume, {
        assertionId: created.assertion,
        helperNonce: "feature-revoked-nonce",
      }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });
});
