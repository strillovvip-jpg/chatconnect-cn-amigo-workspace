import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code: "ADM01",
      deviceId: "admin-device",
      name: "管理员一",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "ADM02",
      deviceId: "admin-device-2",
      name: "管理员二",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "ADM01",
      role: "admin",
      enabled: true,
    });
    await ctx.db.insert("allowed_codes", {
      code: "ADM02",
      role: "admin",
      enabled: true,
    });
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
  });
  return t;
}

describe("notification center", () => {
  test("friend invitation and acceptance use the shared notification table", async () => {
    const t = await setup();
    await t.mutation(api.contacts.addContact, {
      ownerCode: "USERA",
      deviceId: "device-a",
      targetCode: "USERB",
    });
    const invite = await t.query(api.notifications.unreadMine, {
      code: "USERB",
      deviceId: "device-b",
    });
    expect(invite).toHaveLength(1);
    expect(invite[0]).toMatchObject({
      type: "friend_invite",
      priority: "urgent",
      userId: "USERB",
    });
    const data = invite[0].data as { friendRequestId: string };
    await t.mutation(api.contacts.respondFriendRequest, {
      code: "USERB",
      deviceId: "device-b",
      requestId: data.friendRequestId as never,
      accept: true,
    });
    expect(
      await t.query(api.notifications.unreadMine, {
        code: "USERA",
        deviceId: "device-a",
      }),
    ).toEqual([]);
    expect(
      await t.query(api.notifications.listMine, {
        code: "USERB",
        deviceId: "device-b",
      }),
    ).toEqual([]);
  });

  test("video calls create urgent notification visible only to callee", async () => {
    const t = await setup();
    await t.mutation(api.callState.prepareP2P, {
      code: "USERA",
      deviceId: "device-a",
      theirCode: "USERB",
      callType: "video",
    });
    expect(
      await t.query(api.notifications.unreadMine, {
        code: "USERB",
        deviceId: "device-b",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "video_call", priority: "urgent" }),
      ]),
    );
    expect(
      await t.query(api.notifications.unreadMine, {
        code: "USERA",
        deviceId: "device-a",
      }),
    ).toHaveLength(0);
  });

  test("case and document notifications are restricted to administrators", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.notifications.shareResource, {
        code: "ADM01",
        deviceId: "admin-device",
        targetCode: "USERB",
        kind: "case",
        resourceId: "case-1",
        title: "案件1",
      }),
    ).rejects.toThrow();
    await t.mutation(api.notifications.shareResource, {
      code: "ADM01",
      deviceId: "admin-device",
      targetCode: "ADM02",
      kind: "case",
      resourceId: "case-1",
      title: "案件1",
    });
    await t.mutation(api.notifications.shareResource, {
      code: "ADM01",
      deviceId: "admin-device",
      targetCode: "ADM02",
      kind: "document",
      resourceId: "doc-1",
      title: "文件1",
    });
    const records = await t.query(api.notifications.unreadMine, {
      code: "ADM02",
      deviceId: "admin-device-2",
    });
    expect(records.map((item) => item.type)).toEqual(
      expect.arrayContaining(["case_shared", "document_shared"]),
    );
  });

  test("group invite uses shared notifications and users cannot read another inbox", async () => {
    const t = await setup();
    await t.mutation(api.groups.create, {
      code: "USERA",
      deviceId: "device-a",
      name: "测试群组",
      memberCodes: ["USERB"],
    });
    expect(
      await t.query(api.notifications.unreadMine, {
        code: "USERB",
        deviceId: "device-b",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "group_invite" }),
      ]),
    );
    const otherInbox = await t.query(api.notifications.unreadMine, {
      code: "USERA",
      deviceId: "device-a",
    });
    expect(otherInbox.some((item) => item.userId === "USERB")).toBe(false);
  });
});
