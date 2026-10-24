import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    for (const [code, role, companyId] of [
      ["ADMIN", "admin", "one"],
      ["ALICE", "user", "one"],
      ["BOBXX", "user", "one"],
      ["OTHER", "admin", "two"],
    ] as const) {
      await ctx.db.insert("allowed_codes", {
        code,
        role,
        companyId,
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code,
        deviceId: `${code}-device`,
        deviceIds: [`${code}-device`, `${code}-second`],
        name: code,
        usedAt: new Date().toISOString(),
      });
    }
    await ctx.db.insert("contacts", {
      ownerCode: "ALICE",
      targetCode: "BOBXX",
      targetName: "Bob",
      addedAt: new Date().toISOString(),
    });
  });
  return t;
}

const document = {
  password: "ADMIN:ADMIN-device",
  caseNumber: "CASE-1",
  idNumber: "ID-1",
  name: "Subject",
  caseName: "Case",
  fileName: "case.pdf",
};
const message = {
  myCode: "ALICE",
  myName: "Alice",
  deviceId: "ALICE-device",
  theirCode: "BOBXX",
  mediaType: "file" as const,
  mimeType: "application/pdf",
  fileName: "case.pdf",
};

async function upload(
  t: Awaited<ReturnType<typeof setup>>,
  url: string,
  type = "application/pdf",
  contents = "%PDF-1.7 test",
) {
  const parsed = new URL(url);
  return t.fetch(`${parsed.pathname}${parsed.search}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: new Blob([contents], { type }),
  });
}

async function createGroup(t: Awaited<ReturnType<typeof setup>>, name: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const groupId = await ctx.db.insert("chat_groups", {
      name,
      ownerUserId: "ALICE",
      tenantId: "one",
      maxMembers: 20,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const [userId, role] of [
      ["ALICE", "owner"],
      ["BOBXX", "member"],
    ] as const)
      await ctx.db.insert("chat_group_members", {
        groupId,
        userId,
        role,
        status: "active",
        joinedAt: now,
      });
    return groupId;
  });
}

describe("owner-bound file upload admission", () => {
  beforeEach(() => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
  });
  afterEach(() => {
    delete process.env.CONVEX_SITE_URL;
  });

  test("rejects arbitrary storage IDs in document and message saves", async () => {
    const t = await setup();
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["foreign"], { type: "application/pdf" })),
    );
    await expect(
      t.mutation(api.caseDocuments.saveDocument, { ...document, storageId }),
    ).rejects.toThrow("upload");
    await expect(
      t.mutation(api.messages.sendMedia, { ...message, storageId }),
    ).rejects.toThrow("upload");
  });

  test("rejects arbitrary storage IDs in group attachment saves", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Bound group");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["foreign"], { type: "application/pdf" })),
    );

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "file",
        text: "foreign.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");
  });

  test("rejects storage IDs smuggled through group text messages", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Text-only group");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["foreign"], { type: "application/pdf" })),
    );

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "text",
        text: "This must stay text-only",
        storageId,
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("chat_group_messages").collect()),
    ).toHaveLength(0);
  });

  test("group reads hide storage attached to legacy text records", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Legacy text group");
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["legacy foreign storage"], { type: "application/pdf" }),
      );
      await ctx.db.insert("chat_group_messages", {
        groupId,
        senderUserId: "ALICE",
        senderName: "Alice",
        type: "text",
        text: "Legacy malformed text",
        storageId,
        sentAt: Date.now(),
      });
    });

    const [record] = await t.query(api.groups.messages, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    expect(record.url).toBeNull();
    expect("storageId" in record).toBe(false);
  });

  test("group admission is bound to its group, issuing device, and one save", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "First group");
    const otherGroupId = await createGroup(t, "Second group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    expect(new URL(url).pathname).toBe("/api/files/upload");
    const response = await upload(t, url);
    expect(response.status).toBe(200);
    const { storageId } = await response.json();

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "BOBXX",
        deviceId: "BOBXX-device",
        groupId,
        type: "file",
        text: "owner.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-second",
        groupId,
        type: "file",
        text: "device.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId: otherGroupId,
        type: "file",
        text: "other-group.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");

    const messageId = await t.mutation(api.groups.sendMessage, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
      type: "file",
      text: "bound.pdf",
      storageId,
    });
    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "file",
        text: "reused.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await t.run(async (ctx) => {
      await expect(ctx.db.get(messageId)).resolves.toMatchObject({
        groupId,
        storageId,
      });
    });
  });

  test("direct-message admission cannot be consumed by a group", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Purpose-bound group");
    const url = await t.mutation(api.messages.generateUploadUrl, {
      myCode: "ALICE",
      deviceId: "ALICE-device",
      theirCode: "BOBXX",
    });
    const response = await upload(t, url);
    expect(response.status).toBe(200);
    const { storageId } = await response.json();

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "file",
        text: "wrong-purpose.pdf",
        storageId,
      }),
    ).rejects.toThrow("upload");
  });

  test("group admission is invalid after the issuing session is replaced", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Session-bound group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("auth_codes")
        .withIndex("by_code", (q) => q.eq("code", "ALICE"))
        .unique();
      if (!session) throw new Error("Missing auth session fixture");
      await ctx.db.delete(session._id);
      await ctx.db.insert("auth_codes", {
        code: "ALICE",
        deviceId: "ALICE-device",
        deviceIds: ["ALICE-device", "ALICE-second"],
        name: "Alice replacement session",
        usedAt: new Date().toISOString(),
      });
    });

    expect((await upload(t, url)).status).toBe(403);
  });

  test("group admission is invalid after the owner changes tenant", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Tenant-bound group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ALICE"))
        .unique();
      if (!allowed) throw new Error("Missing authorization fixture");
      await ctx.db.patch(allowed._id, { companyId: "two" });
    });

    expect((await upload(t, url)).status).toBe(403);
  });

  test("group membership is rechecked immediately before upload", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Revoked member group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("chat_group_members")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", "ALICE"),
        )
        .unique();
      if (!membership) throw new Error("Missing group membership fixture");
      await ctx.db.patch(membership._id, { status: "removed" });
    });

    expect((await upload(t, url)).status).toBe(403);
    expect(
      await t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).toHaveLength(0);
  });

  test("group membership is rechecked immediately before attachment save", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Removed before save group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    const response = await upload(t, url);
    expect(response.status).toBe(200);
    const { storageId } = await response.json();
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("chat_group_members")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", "ALICE"),
        )
        .unique();
      if (!membership) throw new Error("Missing group membership fixture");
      await ctx.db.patch(membership._id, { status: "removed" });
    });

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "file",
        text: "removed.pdf",
        storageId,
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("chat_group_messages").collect()),
    ).toHaveLength(0);
  });

  test("group upload rejects disallowed MIME and oversize declarations", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Validated upload group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    expect(
      (await upload(t, url, "text/html", "<script>alert(1)</script>")).status,
    ).toBe(400);
    const parsed = new URL(url);
    expect(
      (
        await t.fetch(`${parsed.pathname}${parsed.search}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(51 * 1024 * 1024),
          },
          body: "too big",
        })
      ).status,
    ).toBe(400);
    expect(
      await t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).toHaveLength(0);
  });

  test("group save validates the attachment kind against uploaded MIME", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "MIME-bound group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    const response = await upload(t, url, "application/pdf");
    expect(response.status).toBe(200);
    const { storageId } = await response.json();

    await expect(
      t.mutation(api.groups.sendMessage, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
        type: "image",
        text: "not-an-image.pdf",
        storageId,
      }),
    ).rejects.toThrow("MIME");
  });

  test("group admission accepts allowed video attachments", async () => {
    const t = await setup();
    const groupId = await createGroup(t, "Video attachment group");
    const url = await t.mutation(api.groups.generateUploadUrl, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
    });
    const response = await upload(t, url, "video/mp4", "video bytes");
    expect(response.status).toBe(200);
    const { storageId } = await response.json();

    const messageId = await t.mutation(api.groups.sendMessage, {
      code: "ALICE",
      deviceId: "ALICE-device",
      groupId,
      type: "video",
      text: "clip.mp4",
      storageId,
    });
    await t.run(async (ctx) => {
      await expect(ctx.db.get(messageId)).resolves.toMatchObject({
        type: "video",
        storageId,
      });
    });
  });

  test.each([
    ["application/zip", "archive.zip"],
    ["application/x-zip-compressed", "windows-archive.zip"],
    ["application/octet-stream", "unknown.bin"],
  ])(
    "group admission preserves supported file flow for %s",
    async (mimeType, fileName) => {
      const t = await setup();
      const groupId = await createGroup(t, `${mimeType} group`);
      const url = await t.mutation(api.groups.generateUploadUrl, {
        code: "ALICE",
        deviceId: "ALICE-device",
        groupId,
      });
      const response = await upload(t, url, mimeType, "file bytes");
      expect(response.status).toBe(200);
      const { storageId } = await response.json();

      await expect(
        t.mutation(api.groups.sendMessage, {
          code: "ALICE",
          deviceId: "ALICE-device",
          groupId,
          type: "file",
          text: fileName,
          storageId,
        }),
      ).resolves.toBeDefined();
    },
  );

  test("document admission uploads once and only the issuing device can consume it", async () => {
    const t = await setup();
    const url = await t.mutation(api.caseDocuments.generateUploadUrl, {
      password: document.password,
    });
    expect(new URL(url).pathname).toBe("/api/files/upload");
    const response = await upload(t, url);
    expect(response.status).toBe(200);
    const { storageId } = await response.json();
    expect((await upload(t, url)).status).toBe(403);
    await expect(
      t.mutation(api.caseDocuments.saveDocument, {
        ...document,
        password: "OTHER:OTHER-device",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await expect(
      t.mutation(api.caseDocuments.saveDocument, {
        ...document,
        password: "ADMIN:ADMIN-second",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await t.mutation(api.caseDocuments.saveDocument, {
      ...document,
      storageId,
    });
    await expect(
      t.mutation(api.caseDocuments.saveDocument, { ...document, storageId }),
    ).rejects.toThrow("upload");
    expect(
      await t.query(api.caseDocuments.listAll, { password: document.password }),
    ).toHaveLength(1);
  });

  test("message admission is bound to recipient and cannot be reused", async () => {
    const t = await setup();
    const url = await t.mutation(api.messages.generateUploadUrl, {
      myCode: message.myCode,
      deviceId: message.deviceId,
      theirCode: message.theirCode,
    });
    const response = await upload(t, url);
    expect(response.status).toBe(200);
    const { storageId } = await response.json();
    await expect(
      t.mutation(api.messages.sendMedia, {
        ...message,
        deviceId: "ALICE-second",
        storageId,
      }),
    ).rejects.toThrow("upload");
    await t.mutation(api.messages.sendMedia, { ...message, storageId });
    await expect(
      t.mutation(api.messages.sendMedia, { ...message, storageId }),
    ).rejects.toThrow("upload");
  });

  test("rejects disallowed MIME, oversize bodies, and revoked upload owners before storage", async () => {
    const t = await setup();
    const url = await t.mutation(api.caseDocuments.generateUploadUrl, {
      password: document.password,
    });
    expect(
      (await upload(t, url, "text/html", "<script>alert(1)</script>")).status,
    ).toBe(400);
    const parsed = new URL(url);
    expect(
      (
        await t.fetch(`${parsed.pathname}${parsed.search}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(26 * 1024 * 1024),
          },
          body: "too big",
        })
      ).status,
    ).toBe(400);
    await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ADMIN"))
        .unique();
      await ctx.db.patch(owner!._id, { enabled: false });
    });
    expect((await upload(t, url)).status).toBe(403);
    expect(
      await t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).toHaveLength(0);
  });
});
