import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

async function setup() {
  const t = convexTest({ schema, modules });
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    for (const allowed of [
      { code: "NYADM", role: "admin" as const, companyId: "nyfbi" },
      { code: "AIADM", role: "admin" as const, companyId: "aichijp" },
      { code: "ROOTX", role: "super_admin" as const },
      { code: "NYUSR", role: "user" as const, companyId: "nyfbi" },
      { code: "AIUSR", role: "user" as const, companyId: "aichijp" },
    ]) {
      await ctx.db.insert("allowed_codes", { ...allowed, enabled: true });
    }
    for (const session of [
      { code: "NYADM", deviceId: "ny-admin-device" },
      { code: "AIADM", deviceId: "ai-admin-device" },
      { code: "ROOTX", deviceId: "root-device" },
      { code: "NYUSR", deviceId: "ny-user-device" },
      { code: "AIUSR", deviceId: "ai-user-device" },
    ]) {
      await ctx.db.insert("auth_codes", {
        ...session,
        name: session.code,
        usedAt: now,
      });
    }
  });

  const nyCase = await t.mutation(api.cases.createCase, {
    userCode: "NYADM",
    deviceId: "ny-admin-device",
    userName: "NY admin",
    caseNumber: "NY-CASE",
    idNumber: "NY-ID",
    title: "NY investigation",
    category: "fixture",
    priority: "medium",
    description: "NY private evidence",
  });
  const aiCase = await t.mutation(api.cases.createCase, {
    userCode: "AIADM",
    deviceId: "ai-admin-device",
    userName: "AI admin",
    caseNumber: "AI-CASE",
    idNumber: "AI-ID",
    title: "AI investigation",
    category: "fixture",
    priority: "high",
    description: "AI private evidence",
  });
  const legacyCase = await t.run(async (ctx) =>
    ctx.db.insert("cases", {
      caseNumber: "LEGACY-CASE",
      title: "Legacy unscoped record",
      status: "open",
      priority: "medium",
      category: "fixture",
      description: "must fail closed for scoped administrators",
      assignedCode: "AIADM",
      assignedName: "AIADM",
      createdAt: now,
      updatedAt: now,
    }),
  );
  return { t, nyCase, aiCase, legacyCase };
}

const nyAdmin = { userCode: "NYADM", deviceId: "ny-admin-device" };
const aiAdmin = { userCode: "AIADM", deviceId: "ai-admin-device" };

async function uploadDocument(
  t: Awaited<ReturnType<typeof setup>>["t"],
  password: string,
) {
  const previousSite = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  try {
    const url = new URL(
      await t.mutation(api.caseDocuments.generateUploadUrl, { password }),
    );
    const response = await t.fetch(`${url.pathname}${url.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: new Blob(["tenant document"], { type: "application/pdf" }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).storageId as Id<"_storage">;
  } finally {
    if (previousSite === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousSite;
  }
}

describe("case tenant isolation", () => {
  test("every app case creation path persists immutable tenant ownership", async () => {
    const { t, nyCase, aiCase } = await setup();

    const bulk = await t.mutation(api.cases.createCasesBulk, {
      ...aiAdmin,
      cases: [
        {
          caseNumber: "AI-BULK",
          idNumber: "AI-BULK-ID",
          name: "AI subject",
          title: "AI bulk case",
          description: "AI bulk description",
          status: "open",
        },
      ],
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(nyCase)).toMatchObject({ tenantId: "nyfbi" });
      expect(await ctx.db.get(aiCase)).toMatchObject({ tenantId: "aichijp" });
      expect(await ctx.db.get(bulk.ids[0])).toMatchObject({
        tenantId: "aichijp",
      });
    });
  });

  test("scoped list and search return only immutable same-tenant cases", async () => {
    const { t } = await setup();

    const [nyList, aiList, aiSearch, legacySearch] = await Promise.all([
      t.query(api.cases.listCases, {
        ...nyAdmin,
        paginationOpts: { numItems: 20, cursor: null },
      }),
      t.query(api.cases.listCases, {
        ...aiAdmin,
        paginationOpts: { numItems: 20, cursor: null },
      }),
      t.query(api.cases.searchCases, { ...aiAdmin, query: "investigation" }),
      t.query(api.cases.searchCases, { ...aiAdmin, query: "legacy" }),
    ]);

    expect(nyList.page.map((record) => record.caseNumber)).toEqual(["NY-CASE"]);
    expect(aiList.page.map((record) => record.caseNumber)).toEqual(["AI-CASE"]);
    expect(aiSearch.map((record) => record.caseNumber)).toEqual(["AI-CASE"]);
    expect(legacySearch).toEqual([]);
  });

  test("scoped get and mutations reject cross-tenant and legacy cases", async () => {
    const { t, nyCase, aiCase, legacyCase } = await setup();

    await expect(
      t.query(api.cases.getCase, { ...aiAdmin, caseId: nyCase }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.query(api.cases.getCase, { ...aiAdmin, caseId: legacyCase }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.mutation(api.cases.updateCaseStatus, {
        ...aiAdmin,
        caseId: nyCase,
        status: "closed",
      }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.mutation(api.cases.updateCaseDetails, {
        ...aiAdmin,
        caseId: nyCase,
        caseNumber: "NY-CASE",
        title: "tampered",
        description: "tampered",
        status: "closed",
      }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.mutation(api.cases.deleteCase, { ...aiAdmin, caseId: nyCase }),
    ).rejects.toThrow("没有权限执行此操作");

    await t.mutation(api.cases.updateCaseStatus, {
      ...aiAdmin,
      caseId: aiCase,
      status: "closed",
    });
    expect(
      await t.query(api.cases.getCase, { ...aiAdmin, caseId: aiCase }),
    ).toMatchObject({ status: "closed" });
  });

  test("case-number verification and existing grants cannot cross tenants", async () => {
    const { t } = await setup();

    await expect(
      t.mutation(api.cases.verifyCaseAccess, {
        userCode: "NYUSR",
        deviceId: "ny-user-device",
        caseNumber: "AI-CASE",
        idNumber: "AI-ID",
      }),
    ).rejects.toThrow("案件编号或证件号码不正确");

    const { token } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "AIUSR",
      deviceId: "ai-user-device",
      caseNumber: "AI-CASE",
      idNumber: "AI-ID",
    });
    expect(
      await t.query(api.cases.getVerifiedCase, {
        token,
        userCode: "AIUSR",
        deviceId: "ai-user-device",
      }),
    ).toMatchObject({ caseNumber: "AI-CASE" });

    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "AIUSR"))
        .unique();
      if (!allowed) throw new Error("missing fixture authorization");
      await ctx.db.patch(allowed._id, { companyId: "nyfbi" });
    });
    expect(
      await t.query(api.cases.getVerifiedCase, {
        token,
        userCode: "AIUSR",
        deviceId: "ai-user-device",
      }),
    ).toBeNull();
  });

  test("an explicitly unscoped super administrator retains global access", async () => {
    const { t, nyCase, legacyCase } = await setup();
    const root = { userCode: "ROOTX", deviceId: "root-device" };

    const listed = await t.query(api.cases.listCases, {
      ...root,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(listed.page.map((record) => record.caseNumber).sort()).toEqual([
      "AI-CASE",
      "LEGACY-CASE",
      "NY-CASE",
    ]);
    expect(
      await t.query(api.cases.getCase, { ...root, caseId: legacyCase }),
    ).toMatchObject({ caseNumber: "LEGACY-CASE" });
    await t.mutation(api.cases.updateCaseStatus, {
      ...root,
      caseId: nyCase,
      status: "closed",
    });
  });

  test("admin dashboard case reads and mutations use immutable tenant ownership", async () => {
    const { t, nyCase, aiCase, legacyCase } = await setup();

    const [aiCases, aiStats] = await Promise.all([
      t.query(api.admin.getAllCases, {
        password: "AIADM:ai-admin-device",
      }),
      t.query(api.admin.getStats, {
        password: "AIADM:ai-admin-device",
      }),
    ]);
    expect(aiCases.map((record) => record.caseNumber)).toEqual(["AI-CASE"]);
    expect(aiStats.totalCases).toBe(1);

    await expect(
      t.mutation(api.admin.updateCaseStatusAdmin, {
        password: "AIADM:ai-admin-device",
        caseId: nyCase,
        status: "closed",
      }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.mutation(api.admin.deleteCaseAdmin, {
        password: "AIADM:ai-admin-device",
        caseId: legacyCase,
      }),
    ).rejects.toThrow("没有权限执行此操作");

    await t.mutation(api.admin.updateCaseStatusAdmin, {
      password: "AIADM:ai-admin-device",
      caseId: aiCase,
      status: "closed",
    });
  });

  test("another tenant's volume cannot starve the scoped dashboard", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        const timestamp = new Date(Date.now() + index).toISOString();
        await ctx.db.insert("cases", {
          tenantId: "nyfbi",
          caseNumber: `NY-NOISE-${index}`,
          title: "NY only",
          status: "open",
          priority: "medium",
          category: "fixture",
          description: "other tenant volume",
          assignedCode: "NYADM",
          assignedName: "NYADM",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });

    const aiCases = await t.query(api.admin.getAllCases, {
      password: "AIADM:ai-admin-device",
    });
    expect(aiCases.map((record) => record.caseNumber)).toEqual(["AI-CASE"]);
  });

  test("document upload case creation persists the administrator tenant", async () => {
    const { t } = await setup();
    const storageId = await uploadDocument(t, "AIADM:ai-admin-device");

    await t.mutation(api.caseDocuments.saveDocument, {
      password: "AIADM:ai-admin-device",
      caseNumber: "AI-DOCUMENT",
      idNumber: "AI-DOCUMENT-ID",
      name: "AI subject",
      caseName: "AI uploaded case",
      fileName: "ai.pdf",
      storageId,
    });

    await t.run(async (ctx) => {
      const record = await ctx.db
        .query("cases")
        .withIndex("by_case_number", (q) => q.eq("caseNumber", "AI-DOCUMENT"))
        .unique();
      expect(record).toMatchObject({ tenantId: "aichijp" });

      for (let index = 0; index < 101; index += 1) {
        const timestamp = new Date(Date.now() + index).toISOString();
        await ctx.db.insert("cases", {
          tenantId: "nyfbi",
          caseNumber: `NY-DOCUMENT-${index}`,
          title: "NY document case",
          status: "open",
          priority: "medium",
          category: "fixture",
          description: "other tenant document volume",
          assignedCode: "NYADM",
          assignedName: "NYADM",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await ctx.db.insert("case_documents", {
          caseNumber: `NY-DOCUMENT-${index}`,
          fileName: `ny-${index}.pdf`,
          storageId,
          uploadedByCode: "NYADM",
          uploadedByName: "NYADM",
          uploadedAt: timestamp,
        });
      }
    });

    const documents = await t.query(api.caseDocuments.listAll, {
      password: "AIADM:ai-admin-device",
    });
    expect(documents.map((document) => document.fileName)).toEqual(["ai.pdf"]);
  });

  test("different tenants can reuse one case number without leaking either record", async () => {
    const { t } = await setup();

    const nyShared = await t.mutation(api.cases.createCase, {
      ...nyAdmin,
      userName: "NY admin",
      caseNumber: "SHARED-CASE",
      idNumber: "NY-SHARED-ID",
      title: "NY shared-number case",
      category: "fixture",
      priority: "medium",
      description: "NY tenant data",
    });
    const aiShared = await t.mutation(api.cases.createCase, {
      ...aiAdmin,
      userName: "AI admin",
      caseNumber: "SHARED-CASE",
      idNumber: "AI-SHARED-ID",
      title: "AI shared-number case",
      category: "fixture",
      priority: "high",
      description: "AI tenant data",
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(nyShared)).toMatchObject({
        tenantId: "nyfbi",
        title: "NY shared-number case",
      });
      expect(await ctx.db.get(aiShared)).toMatchObject({
        tenantId: "aichijp",
        title: "AI shared-number case",
      });
    });

    const { token: nyToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "NYUSR",
      deviceId: "ny-user-device",
      caseNumber: "SHARED-CASE",
      idNumber: "NY-SHARED-ID",
    });
    const { token: aiToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "AIUSR",
      deviceId: "ai-user-device",
      caseNumber: "SHARED-CASE",
      idNumber: "AI-SHARED-ID",
    });

    await expect(
      t.mutation(api.cases.verifyCaseAccess, {
        userCode: "NYUSR",
        deviceId: "ny-user-device",
        caseNumber: "SHARED-CASE",
        idNumber: "AI-SHARED-ID",
      }),
    ).rejects.toThrow("案件编号或证件号码不正确");
    expect(
      await t.query(api.cases.getVerifiedCase, {
        token: nyToken,
        userCode: "NYUSR",
        deviceId: "ny-user-device",
      }),
    ).toMatchObject({ title: "NY shared-number case" });
    expect(
      await t.query(api.cases.getVerifiedCase, {
        token: aiToken,
        userCode: "AIUSR",
        deviceId: "ai-user-device",
      }),
    ).toMatchObject({ title: "AI shared-number case" });
  });

  test("same-number documents remain tenant-owned while legacy documents fail closed", async () => {
    const { t } = await setup();
    const storageId = await uploadDocument(t, "NYADM:ny-admin-device");

    const nyDocument = await t.mutation(api.caseDocuments.saveDocument, {
      password: "NYADM:ny-admin-device",
      caseNumber: "SHARED-DOCUMENT",
      idNumber: "NY-DOCUMENT-ID",
      name: "NY subject",
      caseName: "NY document case",
      fileName: "ny-shared.pdf",
      storageId,
    });
    const aiDocument = await t.mutation(api.caseDocuments.saveDocument, {
      password: "AIADM:ai-admin-device",
      caseNumber: "SHARED-DOCUMENT",
      idNumber: "AI-DOCUMENT-ID",
      name: "AI subject",
      caseName: "AI document case",
      fileName: "ai-shared.pdf",
      storageId: await uploadDocument(t, "AIADM:ai-admin-device"),
    });
    await t.run((ctx) =>
      ctx.db.insert("case_documents", {
        caseNumber: "SHARED-DOCUMENT",
        fileName: "legacy-unscoped.pdf",
        storageId,
        uploadedByCode: "ROOTX",
        uploadedByName: "Legacy root",
        uploadedAt: new Date().toISOString(),
      }),
    );

    const [nyDocuments, aiDocuments, rootDocuments] = await Promise.all([
      t.query(api.caseDocuments.listAll, {
        password: "NYADM:ny-admin-device",
      }),
      t.query(api.caseDocuments.listAll, {
        password: "AIADM:ai-admin-device",
      }),
      t.query(api.caseDocuments.listAll, {
        password: "ROOTX:root-device",
      }),
    ]);
    expect(nyDocuments.map((document) => document.fileName)).toEqual([
      "ny-shared.pdf",
    ]);
    expect(aiDocuments.map((document) => document.fileName)).toEqual([
      "ai-shared.pdf",
    ]);
    expect(rootDocuments.map((document) => document.fileName)).toEqual(
      expect.arrayContaining([
        "ny-shared.pdf",
        "ai-shared.pdf",
        "legacy-unscoped.pdf",
      ]),
    );

    const { token: nyToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "NYUSR",
      deviceId: "ny-user-device",
      caseNumber: "SHARED-DOCUMENT",
      idNumber: "NY-DOCUMENT-ID",
    });
    const { token: aiToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "AIUSR",
      deviceId: "ai-user-device",
      caseNumber: "SHARED-DOCUMENT",
      idNumber: "AI-DOCUMENT-ID",
    });
    const [nyVerified, aiVerified] = await Promise.all([
      t.query(api.cases.getVerifiedCase, {
        token: nyToken,
        userCode: "NYUSR",
        deviceId: "ny-user-device",
      }),
      t.query(api.cases.getVerifiedCase, {
        token: aiToken,
        userCode: "AIUSR",
        deviceId: "ai-user-device",
      }),
    ]);
    expect(nyVerified?.documents.map((document) => document.fileName)).toEqual([
      "ny-shared.pdf",
    ]);
    expect(aiVerified?.documents.map((document) => document.fileName)).toEqual([
      "ai-shared.pdf",
    ]);

    await expect(
      t.mutation(api.caseDocuments.deleteDocument, {
        password: "NYADM:ny-admin-device",
        documentId: aiDocument,
      }),
    ).rejects.toThrow("没有权限执行此操作");
    await expect(
      t.mutation(api.caseDocuments.deleteDocument, {
        password: "NYADM:ny-admin-device",
        documentId: await t.run(async (ctx) => {
          const docs = await ctx.db.query("case_documents").collect();
          const legacy = docs.find(
            (document) => document.fileName === "legacy-unscoped.pdf",
          );
          if (!legacy) throw new Error("missing legacy fixture");
          return legacy._id;
        }),
      }),
    ).rejects.toThrow("没有权限执行此操作");

    await t.mutation(api.caseDocuments.deleteDocument, {
      password: "NYADM:ny-admin-device",
      documentId: nyDocument,
    });
  });

  test("renaming a case never attaches its documents to a reused case number", async () => {
    const { t } = await setup();
    const storageId = await uploadDocument(t, "NYADM:ny-admin-device");
    await t.mutation(api.caseDocuments.saveDocument, {
      password: "NYADM:ny-admin-device",
      caseNumber: "REUSED-CASE",
      idNumber: "OLD-CASE-ID",
      name: "Original subject",
      caseName: "Original case",
      fileName: "original.pdf",
      storageId,
    });
    const originalCase = await t.run(async (ctx) =>
      ctx.db
        .query("cases")
        .withIndex("by_tenant_case_number", (q) =>
          q.eq("tenantId", "nyfbi").eq("caseNumber", "REUSED-CASE"),
        )
        .unique(),
    );
    if (!originalCase) throw new Error("missing original case fixture");

    await t.mutation(api.cases.updateCaseDetails, {
      ...nyAdmin,
      caseId: originalCase._id,
      caseNumber: "RENAMED-CASE",
      title: originalCase.title,
      description: originalCase.description,
      status: originalCase.status,
    });
    await t.mutation(api.cases.createCase, {
      ...nyAdmin,
      userName: "NY admin",
      caseNumber: "REUSED-CASE",
      idNumber: "NEW-CASE-ID",
      title: "Replacement case",
      category: "fixture",
      priority: "medium",
      description: "Must not inherit the original document",
    });

    const { token: oldToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "NYUSR",
      deviceId: "ny-user-device",
      caseNumber: "RENAMED-CASE",
      idNumber: "OLD-CASE-ID",
    });
    const { token: newToken } = await t.mutation(api.cases.verifyCaseAccess, {
      userCode: "NYUSR",
      deviceId: "ny-user-device",
      caseNumber: "REUSED-CASE",
      idNumber: "NEW-CASE-ID",
    });
    const [oldResult, newResult] = await Promise.all([
      t.query(api.cases.getVerifiedCase, {
        token: oldToken,
        userCode: "NYUSR",
        deviceId: "ny-user-device",
      }),
      t.query(api.cases.getVerifiedCase, {
        token: newToken,
        userCode: "NYUSR",
        deviceId: "ny-user-device",
      }),
    ]);
    expect(oldResult?.documents.map((document) => document.fileName)).toEqual([
      "original.pdf",
    ]);
    expect(newResult?.documents).toEqual([]);
  });
});
