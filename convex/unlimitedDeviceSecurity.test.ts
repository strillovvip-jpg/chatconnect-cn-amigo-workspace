import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { hashClaimSecret } from "./claimCredentials";

const modules = import.meta.glob("./**/*.*s");

describe("unlimited-device session binding", () => {
  test("requires every device to claim with the activation secret before using session or admin APIs", async () => {
    const t = convexTest({ schema, modules });
    const secret = "A".repeat(32);
    const claimSecretHash = await hashClaimSecret("ROOT1", secret);
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "ROOT1",
        role: "super_admin",
        enabled: true,
        unlimitedDevices: true,
        claimSecretHash,
      });
      await ctx.db.insert("auth_codes", {
        code: "ROOT1",
        deviceId: "bound-device",
        deviceIds: ["bound-device"],
        name: "Root administrator",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "ROOT1",
        deviceId: "unbound-device",
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.admin.getStats, {
        password: "ROOT1:unbound-device",
      }),
    ).rejects.toThrow("需要有效的登录会话");

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: `ROOT1.${secret}`,
        deviceId: "unbound-device",
        deviceType: "desktop",
        name: "Root administrator",
      }),
    ).resolves.toMatchObject({ code: "ROOT1", role: "super_admin" });
    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "ROOT1",
        deviceId: "unbound-device",
      }),
    ).resolves.toMatchObject({ code: "ROOT1", role: "super_admin" });
    await expect(
      t.query(api.admin.getStats, {
        password: "ROOT1:unbound-device",
      }),
    ).resolves.toMatchObject({ totalUsers: 1 });
  });
});
