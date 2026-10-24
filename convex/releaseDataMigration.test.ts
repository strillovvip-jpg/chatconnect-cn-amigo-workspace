import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("release data migrations", () => {
  beforeEach(() => {
    process.env.ROLE_MIGRATION_SECRET = "migration-secret";
  });

  afterEach(() => {
    delete process.env.ROLE_MIGRATION_SECRET;
  });

  test("backfills immutable tenant ownership for legacy cases, documents, and recording data", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "NYUSR",
        role: "user",
        companyId: "nycorp",
        enabled: true,
      });
      await ctx.db.insert("allowed_codes", {
        code: "AIUSR",
        role: "user",
        companyId: "aicorp",
        enabled: true,
      });
      await ctx.db.insert("cases", {
        caseNumber: "LEGACY-1",
        title: "Legacy case",
        status: "open",
        priority: "high",
        category: "Test",
        description: "Legacy",
        assignedCode: "NYUSR",
        assignedName: "NY user",
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString(),
      });
      const storageId = await ctx.storage.store(
        new Blob(["recording"], { type: "audio/webm" }),
      );
      const documentStorageId = await ctx.storage.store(
        new Blob(["document"], { type: "application/pdf" }),
      );
      await ctx.db.insert("case_documents", {
        caseNumber: "LEGACY-1",
        fileName: "legacy.pdf",
        storageId: documentStorageId,
        uploadedByCode: "NYUSR",
        uploadedByName: "NY user",
        uploadedAt: new Date(2).toISOString(),
      });
      await ctx.db.insert("call_compliance", {
        callId: "legacy-call",
        participantCodes: ["NYUSR"],
        consentedCodes: ["NYUSR"],
        declinedCodes: [],
        status: "active",
        requestedBy: "NYUSR",
        requestedAt: 3,
      });
      await ctx.db.insert("call_recording_segments", {
        callId: "legacy-call",
        participantCode: "NYUSR",
        deviceId: "device-1",
        consentEpoch: 1,
        clientNonce: "legacy-nonce",
        startedAt: 4,
        expiresAt: 5,
      });
      await ctx.db.insert("call_transcripts", {
        callId: "legacy-call",
        speakerCode: "NYUSR",
        speakerName: "NY user",
        text: "Legacy transcript",
        createdAt: 6,
      });
      await ctx.db.insert("call_recordings", {
        callId: "legacy-call",
        participantCode: "NYUSR",
        participantName: "NY user",
        storageId,
        mimeType: "audio/webm",
        createdAt: 7,
      });
    });

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "wrong-secret",
      }),
    ).rejects.toThrow("迁移验证信息无效");

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({
      casesMigrated: 1,
      casesQuarantined: 0,
      caseDocumentsMigrated: 1,
      caseDocumentsQuarantined: 0,
      complianceMigrated: 1,
      complianceQuarantined: 0,
      recordingSegmentsMigrated: 1,
      recordingSegmentsQuarantined: 0,
      transcriptsMigrated: 1,
      transcriptsQuarantined: 0,
      recordingsMigrated: 1,
      recordingsQuarantined: 0,
    });

    await t.run(async (ctx) => {
      for (const table of [
        "cases",
        "case_documents",
        "call_compliance",
        "call_recording_segments",
        "call_transcripts",
        "call_recordings",
      ] as const) {
        const rows = await ctx.db.query(table).collect();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tenantId: "nycorp" });
      }
      const [legacyCase] = await ctx.db.query("cases").collect();
      const [document] = await ctx.db.query("case_documents").collect();
      expect(document.caseId).toBe(legacyCase._id);
    });

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({
      casesMigrated: 0,
      casesQuarantined: 0,
      caseDocumentsMigrated: 0,
      caseDocumentsQuarantined: 0,
      complianceMigrated: 0,
      complianceQuarantined: 0,
      recordingSegmentsMigrated: 0,
      recordingSegmentsQuarantined: 0,
      transcriptsMigrated: 0,
      transcriptsQuarantined: 0,
      recordingsMigrated: 0,
      recordingsQuarantined: 0,
    });
  });

  test("tenant backfill quarantines unresolved ownership instead of guessing", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const documentStorageId = await ctx.storage.store(
        new Blob(["orphan document"], { type: "application/pdf" }),
      );
      const recordingStorageId = await ctx.storage.store(
        new Blob(["orphan recording"], { type: "audio/webm" }),
      );
      await ctx.db.insert("cases", {
        caseNumber: "UNKNOWN-1",
        title: "Unknown owner",
        status: "open",
        priority: "low",
        category: "Test",
        description: "Unknown",
        assignedCode: "GONE1",
        assignedName: "Gone",
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString(),
      });
      await ctx.db.insert("case_documents", {
        caseNumber: "ORPHAN-DOCUMENT",
        fileName: "orphan.pdf",
        storageId: documentStorageId,
        uploadedByCode: "GONE1",
        uploadedByName: "Gone",
        uploadedAt: new Date(2).toISOString(),
      });
      await ctx.db.insert("call_compliance", {
        callId: "orphan-call",
        participantCodes: ["GONE1"],
        consentedCodes: ["GONE1"],
        declinedCodes: [],
        status: "stopped",
        requestedBy: "GONE1",
        requestedAt: 3,
      });
      await ctx.db.insert("call_recordings", {
        callId: "orphan-call",
        participantCode: "GONE1",
        participantName: "Gone",
        storageId: recordingStorageId,
        mimeType: "audio/webm",
        createdAt: 4,
      });
    });

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toMatchObject({
      casesMigrated: 0,
      casesQuarantined: 1,
      caseDocumentsMigrated: 0,
      caseDocumentsQuarantined: 1,
      complianceMigrated: 0,
      complianceQuarantined: 1,
      recordingsMigrated: 0,
      recordingsQuarantined: 1,
    });

    await t.run(async (ctx) => {
      const [record] = await ctx.db.query("cases").collect();
      expect(record.tenantId).toBeUndefined();
      const [document] = await ctx.db.query("case_documents").collect();
      expect(document.tenantId).toBeUndefined();
      expect(document.caseId).toBeUndefined();
      const [compliance] = await ctx.db.query("call_compliance").collect();
      const [recording] = await ctx.db.query("call_recordings").collect();
      expect(compliance.tenantId).toBeUndefined();
      expect(recording.tenantId).toBeUndefined();
    });
  });

  test("document backfill refuses a reused case number when uploader ownership contradicts the sole current case", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "OLDUP",
        role: "user",
        companyId: "old-company",
        enabled: true,
      });
      await ctx.db.insert("allowed_codes", {
        code: "NEWUP",
        role: "user",
        companyId: "new-company",
        enabled: true,
      });
      await ctx.db.insert("cases", {
        tenantId: "new-company",
        caseNumber: "REUSED-1",
        title: "Current case",
        status: "open",
        priority: "medium",
        category: "Test",
        description: "Current owner",
        assignedCode: "NEWUP",
        assignedName: "New owner",
        createdAt: new Date(2).toISOString(),
        updatedAt: new Date(2).toISOString(),
      });
      const storageId = await ctx.storage.store(
        new Blob(["legacy evidence"], { type: "application/pdf" }),
      );
      await ctx.db.insert("case_documents", {
        caseNumber: "REUSED-1",
        fileName: "old-evidence.pdf",
        storageId,
        uploadedByCode: "OLDUP",
        uploadedByName: "Old uploader",
        uploadedAt: new Date(1).toISOString(),
      });
    });

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toMatchObject({
      caseDocumentsMigrated: 0,
      caseDocumentsQuarantined: 1,
    });

    await t.run(async (ctx) => {
      const [document] = await ctx.db.query("case_documents").collect();
      expect(document.caseId).toBeUndefined();
      expect(document.tenantId).toBeUndefined();
    });
  });

  test("document backfill removes a previous unsafe assignment when immutable ownership evidence conflicts", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "OLDUP",
        role: "user",
        companyId: "old-company",
        enabled: true,
      });
      await ctx.db.insert("allowed_codes", {
        code: "NEWUP",
        role: "user",
        companyId: "new-company",
        enabled: true,
      });
      const caseId = await ctx.db.insert("cases", {
        tenantId: "new-company",
        caseNumber: "REUSED-2",
        title: "Current case",
        status: "open",
        priority: "medium",
        category: "Test",
        description: "Current owner",
        assignedCode: "NEWUP",
        assignedName: "New owner",
        createdAt: new Date(2).toISOString(),
        updatedAt: new Date(2).toISOString(),
      });
      const storageId = await ctx.storage.store(
        new Blob(["legacy evidence"], { type: "application/pdf" }),
      );
      await ctx.db.insert("case_documents", {
        tenantId: "new-company",
        caseId,
        caseNumber: "REUSED-2",
        fileName: "old-evidence.pdf",
        storageId,
        uploadedByCode: "OLDUP",
        uploadedByName: "Old uploader",
        uploadedAt: new Date(1).toISOString(),
      });
    });

    await expect(
      t.mutation(api.roleManagement.backfillReleaseTenantOwnership, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toMatchObject({
      caseDocumentsMigrated: 0,
      caseDocumentsQuarantined: 1,
    });

    await t.run(async (ctx) => {
      const [document] = await ctx.db.query("case_documents").collect();
      expect(document.caseId).toBeUndefined();
      expect(document.tenantId).toBeUndefined();
    });
  });

  test("backfills permanent tombstones from historical delete audit logs", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("audit_logs", {
        actorCode: "ADMIN",
        action: "auth_code.delete",
        targetType: "auth_code",
        targetId: "gonea",
        success: true,
        createdAt: 10,
      });
      await ctx.db.insert("audit_logs", {
        actorCode: "ADMIN",
        action: "auth_code.delete",
        targetType: "auth_code",
        targetId: "GONEA",
        success: true,
        createdAt: 11,
      });
      await ctx.db.insert("audit_logs", {
        actorCode: "ADMIN",
        action: "auth_code.delete",
        targetType: "auth_code",
        targetId: "ACTIVE",
        success: true,
        createdAt: 12,
      });
      await ctx.db.insert("allowed_codes", {
        code: "ACTIVE",
        role: "user",
        companyId: "nycorp",
        enabled: true,
      });
    });

    await expect(
      t.mutation(api.roleManagement.backfillDeletedCodeTombstones, {
        migrationSecret: "migration-secret",
      }),
    ).rejects.toThrow("历史删除码仍处于启用状态");

    await t.run(async (ctx) => {
      expect(
        await ctx.db.query("authorization_code_tombstones").collect(),
      ).toEqual([]);
      const active = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", "ACTIVE"))
        .unique();
      await ctx.db.delete(active!._id);
    });

    await expect(
      t.mutation(api.roleManagement.backfillDeletedCodeTombstones, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({ inserted: 2, alreadyRetired: 0 });

    await t.run(async (ctx) => {
      const tombstones = await ctx.db
        .query("authorization_code_tombstones")
        .collect();
      expect(
        tombstones
          .map(({ code, retiredAt }) => ({ code, retiredAt }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      ).toEqual([
        { code: "ACTIVE", retiredAt: 12 },
        { code: "GONEA", retiredAt: 10 },
      ]);
    });

    await expect(
      t.mutation(api.roleManagement.backfillDeletedCodeTombstones, {
        migrationSecret: "migration-secret",
      }),
    ).resolves.toEqual({ inserted: 0, alreadyRetired: 2 });
  });
});
