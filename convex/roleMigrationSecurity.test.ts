import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("role migration security", () => {
  beforeEach(() => {
    process.env.ROLE_MIGRATION_SECRET = "migration-secret";
    process.env.SUPER_ADMIN_CODE = "ROOT1";
  });

  afterEach(() => {
    delete process.env.ROLE_MIGRATION_SECRET;
    delete process.env.SUPER_ADMIN_CODE;
  });

  test("role initialization cannot create an authorization code without an activation digest", async () => {
    const t = convexTest({ schema, modules });

    await expect(
      t.mutation(api.roleManagement.initializeRoles, {
        migrationSecret: "migration-secret",
      }),
    ).rejects.toThrow("只能更新既有授权码");
    expect(
      await t.run((ctx) => ctx.db.query("allowed_codes").collect()),
    ).toEqual([]);
  });

  test("primary-role and unlimited-device migrations refuse missing codes instead of inserting them", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "ROOT1",
        role: "user",
        enabled: true,
        claimSecretHash: "a".repeat(64),
      });
    });

    await expect(
      t.mutation(api.roleManagement.configurePrimaryRoles, {
        migrationSecret: "migration-secret",
        adminCodes: ["NEWAD"],
      }),
    ).rejects.toThrow("只能更新既有授权码");
    await expect(
      t.mutation(api.roleManagement.configureUnlimitedDevices, {
        migrationSecret: "migration-secret",
        codes: ["NEW01"],
      }),
    ).rejects.toThrow("只能更新既有授权码");

    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("allowed_codes").collect()).map(({ code }) => code),
      ).toEqual(["ROOT1"]);
    });
  });

  test("migrations still update existing digested authorization codes", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      for (const code of ["ROOT1", "ADMIN", "USER1"])
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          enabled: true,
          claimSecretHash: "a".repeat(64),
        });
    });

    await t.mutation(api.roleManagement.configurePrimaryRoles, {
      migrationSecret: "migration-secret",
      adminCodes: ["ADMIN"],
    });
    await t.mutation(api.roleManagement.configureUnlimitedDevices, {
      migrationSecret: "migration-secret",
      codes: ["USER1"],
    });

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", "ROOT1"))
          .unique(),
      ).toMatchObject({ role: "super_admin" });
      expect(
        await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", "ADMIN"))
          .unique(),
      ).toMatchObject({ role: "admin" });
      expect(
        await ctx.db
          .query("allowed_codes")
          .withIndex("by_code", (q) => q.eq("code", "USER1"))
          .unique(),
      ).toMatchObject({ unlimitedDevices: true });
    });
  });
});
