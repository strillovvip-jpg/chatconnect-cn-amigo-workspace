import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code: "USERA",
      deviceId: "device-a",
      name: "User A",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "USERB",
      deviceId: "device-b",
      name: "User B",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "USERC",
      deviceId: "device-c",
      name: "User C",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "ADM01",
      deviceId: "admin-device",
      name: "管理员",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "ADM01",
      role: "admin",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "RAVE1",
      deviceId: "rave1-device",
      name: "公司一管理员",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "RAVE1",
      role: "admin",
      enabled: true,
      companyId: "company-1",
    });
    await ctx.db.insert("auth_codes", {
      code: "ROOT1",
      deviceId: "super-device",
      name: "总管理员",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "ROOT1",
      role: "super_admin",
      enabled: true,
    });
    await ctx.db.insert("allowed_codes", {
      code: "USERA",
      role: "user",
      enabled: true,
      companyId: "company-1",
    });
    await ctx.db.insert("allowed_codes", {
      code: "USERB",
      role: "user",
      enabled: true,
      companyId: "company-1",
    });
    await ctx.db.insert("allowed_codes", {
      code: "USERC",
      role: "user",
      enabled: true,
      companyId: "company-2",
    });
    await ctx.db.insert("contacts", {
      ownerCode: "USERA",
      targetCode: "USERB",
      targetName: "User B",
      addedAt: new Date().toISOString(),
    });
    await ctx.db.insert("contacts", {
      ownerCode: "USERB",
      targetCode: "USERA",
      targetName: "User A",
      addedAt: new Date().toISOString(),
    });
  });
  return t;
}

describe("session and private-data boundaries", () => {
  test("a forged device cannot list another user's contacts", async () => {
    const t = await setup();
    await expect(
      t.query(api.contacts.getContacts, {
        ownerCode: "USERA",
        deviceId: "device-c",
      }),
    ).rejects.toThrow();
  });

  test("only accepted contacts can send and read chat messages", async () => {
    const t = await setup();
    await t.mutation(api.messages.sendText, {
      myCode: "USERA",
      deviceId: "device-a",
      myName: "forged",
      theirCode: "USERB",
      text: "hello",
    });
    const messages = await t.query(api.messages.listMessages, {
      myCode: "USERB",
      deviceId: "device-b",
      theirCode: "USERA",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(messages.page[0]).toMatchObject({
      senderCode: "USERA",
      senderName: "User A",
      text: "hello",
    });
    await expect(
      t.mutation(api.messages.sendText, {
        myCode: "USERC",
        deviceId: "device-c",
        myName: "User C",
        theirCode: "USERA",
        text: "forbidden",
      }),
    ).rejects.toThrow();
    await expect(
      t.query(api.messages.listMessages, {
        myCode: "USERC",
        deviceId: "device-c",
        theirCode: "USERA",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("message sender identity is derived from the authenticated session", async () => {
    const t = await setup();
    await t.mutation(api.messages.sendText, {
      myCode: "USERA",
      deviceId: "device-a",
      myName: "Admin",
      theirCode: "USERB",
      text: "identity test",
    });
    const messages = await t.query(api.messages.listMessages, {
      myCode: "USERA",
      deviceId: "device-a",
      theirCode: "USERB",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(messages.page[0].senderName).toBe("User A");
  });

  test("normal users cannot call case-management APIs", async () => {
    const t = await setup();
    const caseId = await t.run(async (ctx) =>
      ctx.db.insert("cases", {
        caseNumber: "CASE-001",
        idNumberHash: "hash",
        title: "受限案件",
        status: "open",
        priority: "medium",
        category: "test",
        description: "restricted",
        assignedCode: "ADM01",
        assignedName: "管理员",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const auth = { userCode: "USERA", deviceId: "device-a" };
    await expect(
      t.query(api.cases.listCases, {
        ...auth,
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.query(api.cases.searchCases, { ...auth, query: "CASE" }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.query(api.cases.getCase, { ...auth, caseId }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(t.query(api.cases.getMyCases, auth)).rejects.toThrow(
      "没有权限执行此操作",
    );
  });

  test("administrators retain case-management access", async () => {
    const t = await setup();
    const result = await t.query(api.cases.listCases, {
      userCode: "ADM01",
      deviceId: "admin-device",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(result.page).toEqual([]);
  });

  test("only the super administrator can manage administrator roles", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.roleManagement.setRole, {
        password: "ADM01:admin-device",
        targetCode: "USERA",
        role: "admin",
      }),
    ).rejects.toThrow();
    await t.mutation(api.roleManagement.setRole, {
      password: "ROOT1:super-device",
      targetCode: "USERA",
      role: "admin",
    });
    expect(
      (
        await t.query(api.authCodes.getSessionRole, {
          code: "USERA",
          deviceId: "device-a",
        })
      )?.role,
    ).toBe("admin");
    await expect(
      t.mutation(api.roleManagement.setEnabled, {
        password: "ADM01:admin-device",
        targetCode: "ROOT1",
        enabled: false,
      }),
    ).rejects.toThrow();
  });

  test("only the super administrator can create authorization codes", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.roleManagement.createCode, {
        password: "ADM01:admin-device",
        targetCode: "BLOCK",
        role: "user",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.features.createAuthorizationCode, {
        password: "ADM01:admin-device",
        targetCode: "BLOCK2",
      }),
    ).rejects.toThrow();
    await t.mutation(api.roleManagement.createCode, {
      password: "ROOT1:super-device",
      targetCode: "ALLOW",
      role: "user",
    });
    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("allowed_codes")
              .withIndex("by_code", (q) => q.eq("code", "ALLOW"))
              .unique()
          )?.role,
      ),
    ).toBe("user");
  });

  test("only the super administrator can assign company scopes", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.roleManagement.setCompanyScope, {
        password: "ADM01:admin-device",
        targetCode: "USERA",
        companyId: "company-9",
      }),
    ).rejects.toThrow();

    await t.mutation(api.roleManagement.setCompanyScope, {
      password: "ROOT1:super-device",
      targetCode: "USERA",
      companyId: "company-9",
    });

    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("allowed_codes")
              .withIndex("by_code", (q) => q.eq("code", "USERA"))
              .unique()
          )?.companyId,
      ),
    ).toBe("company-9");
  });

  test("a company admin only sees allowed codes from their own company", async () => {
    const t = await setup();
    const scoped = await t.query(api.admin.getAllowedCodes, {
      password: "RAVE1:rave1-device",
    });
    expect(scoped.map((item) => item.code).sort()).toEqual(["USERA", "USERB"]);

    const global = await t.query(api.admin.getAllowedCodes, {
      password: "ROOT1:super-device",
    });
    expect(global.map((item) => item.code).sort()).toEqual([
      "ADM01",
      "RAVE1",
      "ROOT1",
      "USERA",
      "USERB",
      "USERC",
    ]);
  });

  test("a company admin only sees active user sessions from their own company", async () => {
    const t = await setup();
    const scoped = await t.query(api.admin.getAllCodes, {
      password: "RAVE1:rave1-device",
    });
    expect(scoped.map((item) => item.code).sort()).toEqual(["USERA", "USERB"]);

    const global = await t.query(api.admin.getAllCodes, {
      password: "ROOT1:super-device",
    });
    expect(global.map((item) => item.code).sort()).toEqual([
      "ADM01",
      "RAVE1",
      "ROOT1",
      "USERA",
      "USERB",
      "USERC",
    ]);
  });

  test("a company admin sees company-scoped totals while super admin sees global totals", async () => {
    const t = await setup();
    const scoped = await t.query(api.admin.getStats, {
      password: "RAVE1:rave1-device",
    });
    expect(scoped.totalUsers).toBe(2);

    const global = await t.query(api.admin.getStats, {
      password: "ROOT1:super-device",
    });
    expect(global.totalUsers).toBe(6);
  });
});
