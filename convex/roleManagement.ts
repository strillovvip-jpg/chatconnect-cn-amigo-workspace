import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  assertAdminCanAccessCode,
  assertAdminCanManageAuthorizationCode,
  assertAuthorizationSetCanExpand,
  AICHIJP_TENANT_ID,
  DEFAULT_TENANT_ID,
  getAdminCompanyScope,
  requireAdmin,
  requireSuperAdmin,
  tenantIdForAllowed,
} from "./roles";
import {
  allFeatureFlags,
  codeOnlyDeviceClaimTenantIds,
  effectiveAuthorizationDeviceLimit,
  featureKeys,
} from "./features";
import { isClaimSecretHash } from "./claimCredentials";
import {
  assertAuthorizationCodeNotRetired,
  assertAuthorizationCodesNotRetired,
  enforceAuthorizationCodeDeviceLimit,
  retireAuthorizationCode,
  revokeAuthorizationCodeIdentityState,
  scheduleAuthorizationCodeExpiry,
} from "./authorizationCodeLifecycle";

const credentialArgs = { password: v.string() };
const claimSecretHashValidator = v.object({
  code: v.string(),
  hash: v.string(),
});
const companyProvisionValidator = v.object({
  companyName: v.string(),
  adminCode: v.string(),
  fullCodes: v.array(v.string()),
  limitedCodes: v.array(v.string()),
  claimSecretHashes: v.array(claimSecretHashValidator),
});
const normalize = (value: string) => value.trim().toUpperCase();
const newAuthorizationCodePattern = /^[A-Z]{5}$/;
const reservedCompanyIds = new Set([DEFAULT_TENANT_ID, AICHIJP_TENANT_ID]);

function requireRoleMigrationSecret(provided: string) {
  const expectedSecret = process.env.ROLE_MIGRATION_SECRET;
  if (!expectedSecret || provided !== expectedSecret)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "迁移验证信息无效。",
    });
}

/**
 * Links pre-tenant production rows to an immutable owner without guessing.
 * Rows that cannot be uniquely resolved stay quarantined and fail closed.
 * This mutation is intentionally idempotent so rollout verification can rerun
 * it safely before the fail-closed release is enabled.
 */
export const backfillReleaseTenantOwnership = mutation({
  args: { migrationSecret: v.string() },
  handler: async (ctx, args) => {
    requireRoleMigrationSecret(args.migrationSecret);

    const allowed = await ctx.db.query("allowed_codes").collect();
    const tenantByCode = new Map(
      allowed.map((record) => [
        normalize(record.code),
        tenantIdForAllowed(record),
      ]),
    );

    const cases = await ctx.db.query("cases").collect();
    const caseTenantById = new Map<string, string>();
    type CaseOwnershipCandidate = {
      id: (typeof cases)[number]["_id"];
      tenantId: string;
      idNumberHash?: string;
    };
    const caseById = new Map<string, CaseOwnershipCandidate>();
    const casesByNumber = new Map<string, CaseOwnershipCandidate[]>();
    let casesMigrated = 0;
    let casesQuarantined = 0;

    for (const record of cases) {
      const tenantId =
        record.tenantId?.trim().toLowerCase() ||
        tenantByCode.get(normalize(record.assignedCode));
      if (!tenantId) {
        casesQuarantined += 1;
        continue;
      }
      caseTenantById.set(String(record._id), tenantId);
      const ownershipCandidate = {
        id: record._id,
        tenantId,
        idNumberHash: record.idNumberHash,
      };
      caseById.set(String(record._id), ownershipCandidate);
      const candidates = casesByNumber.get(record.caseNumber) ?? [];
      candidates.push(ownershipCandidate);
      casesByNumber.set(record.caseNumber, candidates);
      if (!record.tenantId) {
        await ctx.db.patch(record._id, { tenantId });
        casesMigrated += 1;
      }
    }

    const documents = await ctx.db.query("case_documents").collect();
    let caseDocumentsMigrated = 0;
    let caseDocumentsQuarantined = 0;
    for (const document of documents) {
      const candidates = casesByNumber.get(document.caseNumber) ?? [];
      const linkedCandidate = document.caseId
        ? caseById.get(String(document.caseId))
        : undefined;
      const candidate =
        linkedCandidate ??
        (!document.caseId && candidates.length === 1
          ? candidates[0]
          : undefined);
      const uploaderTenant = tenantByCode.get(
        normalize(document.uploadedByCode),
      );
      const documentTenant = document.tenantId?.trim().toLowerCase();
      const tenantConflict = Boolean(
        candidate &&
        ((documentTenant && documentTenant !== candidate.tenantId) ||
          (uploaderTenant && uploaderTenant !== candidate.tenantId)),
      );
      const hashConflict = Boolean(
        candidate?.idNumberHash &&
        document.idNumberHash &&
        candidate.idNumberHash !== document.idNumberHash,
      );
      const corroborated = Boolean(
        candidate &&
        (uploaderTenant === candidate.tenantId ||
          (candidate.idNumberHash &&
            document.idNumberHash &&
            candidate.idNumberHash === document.idNumberHash) ||
          (linkedCandidate && documentTenant === candidate.tenantId)),
      );
      if (!candidate || tenantConflict || hashConflict || !corroborated) {
        if (document.caseId || document.tenantId)
          await ctx.db.patch(document._id, {
            caseId: undefined,
            tenantId: undefined,
          });
        caseDocumentsQuarantined += 1;
        continue;
      }
      if (
        document.caseId !== candidate.id ||
        documentTenant !== candidate.tenantId
      ) {
        await ctx.db.patch(document._id, {
          caseId: candidate.id,
          tenantId: candidate.tenantId,
        });
        caseDocumentsMigrated += 1;
      }
    }

    const compliance = await ctx.db.query("call_compliance").collect();
    const tenantByCallId = new Map<string, string>();
    let complianceMigrated = 0;
    let complianceQuarantined = 0;
    for (const item of compliance) {
      let tenantId = item.tenantId?.trim().toLowerCase();
      if (!tenantId) {
        const participantTenants = item.participantCodes.map((code) =>
          tenantByCode.get(normalize(code)),
        );
        const uniqueTenants = new Set(
          participantTenants.filter((value): value is string => !!value),
        );
        if (
          participantTenants.length === 0 ||
          participantTenants.some((value) => !value) ||
          uniqueTenants.size !== 1
        ) {
          complianceQuarantined += 1;
          continue;
        }
        tenantId = [...uniqueTenants][0];
        await ctx.db.patch(item._id, { tenantId });
        complianceMigrated += 1;
      }
      tenantByCallId.set(item.callId, tenantId);
    }

    const recordingSegmentRows = await ctx.db
      .query("call_recording_segments")
      .collect();
    let recordingSegmentsMigrated = 0;
    let recordingSegmentsQuarantined = 0;
    for (const row of recordingSegmentRows) {
      if (row.tenantId) continue;
      const tenantId = tenantByCallId.get(row.callId);
      if (!tenantId) {
        recordingSegmentsQuarantined += 1;
        continue;
      }
      await ctx.db.patch(row._id, { tenantId });
      recordingSegmentsMigrated += 1;
    }

    const transcriptRows = await ctx.db.query("call_transcripts").collect();
    let transcriptsMigrated = 0;
    let transcriptsQuarantined = 0;
    for (const row of transcriptRows) {
      if (row.tenantId) continue;
      const tenantId = tenantByCallId.get(row.callId);
      if (!tenantId) {
        transcriptsQuarantined += 1;
        continue;
      }
      await ctx.db.patch(row._id, { tenantId });
      transcriptsMigrated += 1;
    }

    const recordingRows = await ctx.db.query("call_recordings").collect();
    let recordingsMigrated = 0;
    let recordingsQuarantined = 0;
    for (const row of recordingRows) {
      if (row.tenantId) continue;
      const tenantId = tenantByCallId.get(row.callId);
      if (!tenantId) {
        recordingsQuarantined += 1;
        continue;
      }
      await ctx.db.patch(row._id, { tenantId });
      recordingsMigrated += 1;
    }

    return {
      casesMigrated,
      casesQuarantined,
      caseDocumentsMigrated,
      caseDocumentsQuarantined,
      complianceMigrated,
      complianceQuarantined,
      recordingSegmentsMigrated,
      recordingSegmentsQuarantined,
      transcriptsMigrated,
      transcriptsQuarantined,
      recordingsMigrated,
      recordingsQuarantined,
    };
  },
});

/** Replays successful historical deletes into the permanent identity ledger. */
export const backfillDeletedCodeTombstones = mutation({
  args: { migrationSecret: v.string() },
  handler: async (ctx, args) => {
    requireRoleMigrationSecret(args.migrationSecret);
    const [allowed, auditLogs, existingTombstones] = await Promise.all([
      ctx.db.query("allowed_codes").collect(),
      ctx.db.query("audit_logs").collect(),
      ctx.db.query("authorization_code_tombstones").collect(),
    ]);
    const allowedByCode = new Map(
      allowed.map((record) => [normalize(record.code), record]),
    );
    const deletionByCode = new Map<string, (typeof auditLogs)[number]>();
    for (const log of auditLogs) {
      if (
        !log.success ||
        log.action !== "auth_code.delete" ||
        !log.targetId?.trim()
      )
        continue;
      const code = normalize(log.targetId.normalize("NFKC"));
      const previous = deletionByCode.get(code);
      if (!previous || log.createdAt < previous.createdAt)
        deletionByCode.set(code, log);
    }
    const activeConflicts = [...deletionByCode.keys()].filter((code) =>
      allowedByCode.has(code),
    );
    if (activeConflicts.length)
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: `有 ${activeConflicts.length} 个历史删除码仍处于启用状态，迁移已停止。`,
      });

    const retired = new Set(existingTombstones.map((item) => item.code));
    let inserted = 0;
    let alreadyRetired = 0;
    for (const [code, log] of deletionByCode) {
      if (retired.has(code)) {
        alreadyRetired += 1;
        continue;
      }
      const actor = allowedByCode.get(normalize(log.actorCode));
      await ctx.db.insert("authorization_code_tombstones", {
        code,
        companyId: actor ? tenantIdForAllowed(actor) : undefined,
        reason: "deleted",
        retiredBy: log.actorCode,
        retiredAt: log.createdAt,
      });
      retired.add(code);
      inserted += 1;
    }
    return { inserted, alreadyRetired };
  },
});

const limitedCompanyFeatures = {
  ...allFeatureFlags,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

function validateProvisionCodes(
  values: string[],
  label: string,
  expectedCount: number,
) {
  if (values.length !== expectedCount)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label}授权码必须正好包含 ${expectedCount} 个。`,
    });
  const codes = values.map((value) => normalize(value.normalize("NFKC")));
  if (codes.some((code) => !newAuthorizationCodePattern.test(code)))
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} authorization codes must contain exactly five letters.`,
    });
  if (new Set(codes).size !== codes.length)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label}授权码不得重复。`,
    });
  return codes;
}

async function audit(
  ctx: MutationCtx,
  actorCode: string,
  action: string,
  targetId: string,
  details?: unknown,
) {
  await ctx.db.insert("audit_logs", {
    actorCode,
    action,
    targetType: "auth_code",
    targetId,
    success: true,
    details,
    createdAt: Date.now(),
  });
}

type CompanyProvisionInput = {
  companyName: string;
  adminCode: string;
  fullCodes: string[];
  limitedCodes: string[];
  claimSecretHashes: Array<{ code: string; hash: string }>;
};

async function provisionCompanyRecords(
  ctx: MutationCtx,
  input: CompanyProvisionInput,
  actorCode: string,
) {
  const companyName = input.companyName.normalize("NFKC").trim();
  if (!companyName || companyName.length > 100)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "公司名称必须为 1 至 100 个字符。",
    });
  const adminCode = normalize(input.adminCode.normalize("NFKC"));
  if (reservedCompanyIds.has(adminCode.toLowerCase()))
    throw new ConvexError({
      code: "CONFLICT",
      message: "此管理员授权码属于系统保留租户，不能建立新公司。",
    });
  if (!newAuthorizationCodePattern.test(adminCode))
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Administrator code must contain exactly five letters.",
    });
  const fullCodes = validateProvisionCodes(input.fullCodes, "全功能", 10);
  const limitedCodes = validateProvisionCodes(input.limitedCodes, "受限", 50);
  const allNewCodes = [adminCode, ...fullCodes, ...limitedCodes];
  if (new Set(allNewCodes).size !== allNewCodes.length)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "管理员、全功能与受限授权码之间不得重复。",
    });
  await assertAuthorizationCodesNotRetired(ctx, allNewCodes);
  const claimSecretHashes = new Map(
    input.claimSecretHashes.map(({ code, hash }) => [normalize(code), hash]),
  );
  if (
    input.claimSecretHashes.length !== allNewCodes.length ||
    claimSecretHashes.size !== allNewCodes.length ||
    allNewCodes.some(
      (code) => !isClaimSecretHash(claimSecretHashes.get(code) ?? ""),
    )
  )
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "每个授权码都必须有唯一且有效的设备启用密钥摘要。",
    });

  const companyId = adminCode.toLowerCase();
  const existingCodes = await ctx.db.query("allowed_codes").collect();
  const existingProfiles = await ctx.db.query("license_profiles").collect();
  const existingCodeSet = new Set(
    existingCodes.map((item) => normalize(item.code.normalize("NFKC"))),
  );
  const collision = allNewCodes.find((code) => existingCodeSet.has(code));
  if (collision)
    throw new ConvexError({
      code: "CONFLICT",
      message: `授权码 ${collision} 已注册。`,
    });
  if (
    existingCodes.some(
      (item) => item.companyId?.trim().toLowerCase() === companyId,
    ) ||
    existingProfiles.some(
      (item) => item.companyId?.trim().toLowerCase() === companyId,
    )
  )
    throw new ConvexError({
      code: "CONFLICT",
      message: "此公司管理员授权码已经建立过公司。",
    });

  const now = Date.now();
  const fullProfileId = await ctx.db.insert("license_profiles", {
    name: `${companyName} · Full feature`,
    companyId,
    description: "All communication features",
    features: allFeatureFlags,
    createdBy: actorCode,
    createdAt: now,
    updatedAt: now,
  });
  const limitedProfileId = await ctx.db.insert("license_profiles", {
    name: `${companyName} · Limited`,
    companyId,
    description: "Without screen sharing, call transfer, and video switching",
    features: limitedCompanyFeatures,
    createdBy: actorCode,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("allowed_codes", {
    code: adminCode,
    role: "admin",
    companyId,
    enabled: true,
    maxDevices: 2,
    claimSecretHash: claimSecretHashes.get(adminCode),
    createdAt: now,
    updatedAt: now,
  });
  for (const code of fullCodes)
    await ctx.db.insert("allowed_codes", {
      code,
      role: "user",
      companyId,
      enabled: true,
      maxDevices: 2,
      claimSecretHash: claimSecretHashes.get(code),
      licenseProfileId: fullProfileId,
      createdAt: now,
      updatedAt: now,
    });
  for (const code of limitedCodes)
    await ctx.db.insert("allowed_codes", {
      code,
      role: "user",
      companyId,
      enabled: true,
      maxDevices: 1,
      claimSecretHash: claimSecretHashes.get(code),
      licenseProfileId: limitedProfileId,
      createdAt: now,
      updatedAt: now,
    });

  await ctx.db.insert("audit_logs", {
    actorCode,
    action: "company.provision",
    targetType: "company",
    targetId: companyId,
    success: true,
    details: {
      companyName,
      adminCode,
      fullCodeCount: fullCodes.length,
      limitedCodeCount: limitedCodes.length,
    },
    createdAt: now,
  });

  return {
    companyId,
    companyName,
    adminCode,
    fullCodes,
    limitedCodes,
  };
}

export const initializeRoles = mutation({
  args: { migrationSecret: v.string() },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.ROLE_MIGRATION_SECRET;
    const superCode = normalize(process.env.SUPER_ADMIN_CODE ?? "");
    if (
      !expectedSecret ||
      args.migrationSecret !== expectedSecret ||
      !superCode
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "迁移验证信息无效。",
      });
    const records = await ctx.db.query("allowed_codes").collect();
    const existing = records.find((record) => record.code === superCode);
    if (!existing)
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "角色迁移只能更新既有授权码，不能新增授权码。",
      });
    for (const record of records)
      await ctx.db.patch(record._id, {
        role: record.code === superCode ? "super_admin" : "user",
        enabled: record.enabled !== false,
        updatedAt: Date.now(),
      });
    await ctx.db.patch(existing._id, {
      role: "super_admin",
      enabled: true,
      updatedAt: Date.now(),
    });
    await audit(ctx, superCode, "roles.initialize", superCode, {
      resetLegacyAdministrators: true,
    });
    return { superAdminCode: superCode };
  },
});

export const configurePrimaryRoles = mutation({
  args: {
    migrationSecret: v.string(),
    adminCodes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.ROLE_MIGRATION_SECRET;
    const superCode = normalize(process.env.SUPER_ADMIN_CODE ?? "");
    if (
      !expectedSecret ||
      args.migrationSecret !== expectedSecret ||
      !superCode
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "迁移验证信息无效。",
      });
    }
    const adminCodes = [...new Set(args.adminCodes.map(normalize))].filter(
      (code) => code && code !== superCode,
    );
    const records = await ctx.db.query("allowed_codes").collect();
    for (const record of records) {
      if (record.role === "super_admin" && record.code !== superCode) {
        await ctx.db.patch(record._id, { role: "user", updatedAt: Date.now() });
      }
    }
    const desired = [
      { code: superCode, role: "super_admin" as const },
      ...adminCodes.map((code) => ({ code, role: "admin" as const })),
    ];
    const recordsByCode = new Map(
      records.map((record) => [record.code, record]),
    );
    if (desired.some((item) => !recordsByCode.has(item.code)))
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "角色迁移只能更新既有授权码，不能新增授权码。",
      });
    for (const item of desired) {
      const existing = recordsByCode.get(item.code)!;
      await ctx.db.patch(existing._id, {
        role: item.role,
        enabled: true,
        updatedAt: Date.now(),
      });
      await audit(ctx, superCode, "role.configure", item.code, {
        role: item.role,
      });
    }
    return { superAdmin: superCode, admins: adminCodes };
  },
});

export const configureUnlimitedDevices = mutation({
  args: {
    migrationSecret: v.string(),
    codes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.ROLE_MIGRATION_SECRET;
    const superCode = normalize(process.env.SUPER_ADMIN_CODE ?? "");
    if (
      !expectedSecret ||
      args.migrationSecret !== expectedSecret ||
      !superCode
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "迁移验证信息无效。",
      });
    }
    const codes = [...new Set(args.codes.map(normalize))].filter(Boolean);
    const records = await ctx.db.query("allowed_codes").collect();
    const recordsByCode = new Map(
      records.map((record) => [record.code, record]),
    );
    if (codes.some((code) => !recordsByCode.has(code)))
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "装置迁移只能更新既有授权码，不能新增授权码。",
      });
    for (const code of codes) {
      const existing = recordsByCode.get(code)!;
      await ctx.db.patch(existing._id, {
        unlimitedDevices: true,
        enabled: true,
        updatedAt: Date.now(),
      });
      await audit(ctx, superCode, "devices.unlimited", code, {
        unlimitedDevices: true,
      });
    }
    return { unlimitedDeviceCodes: codes };
  },
});

// Creates a complete, isolated company authorization set in one Convex
// transaction. The administrator code is also the immutable tenant key, so
// every company administrator and customer code has one unambiguous owner.
export const provisionCompany = mutation({
  args: {
    ...credentialArgs,
    companyName: v.string(),
    adminCode: v.string(),
    fullCodes: v.array(v.string()),
    limitedCodes: v.array(v.string()),
    claimSecretHashes: v.array(claimSecretHashValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    if (getAdminCompanyScope(auth) !== null)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有全局总管理员可以新增公司。",
      });
    return await provisionCompanyRecords(ctx, args, auth.code);
  },
});

export const provisionCompaniesWithImportSecret = mutation({
  args: {
    password: v.string(),
    companies: v.array(companyProvisionValidator),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!expectedSecret || args.password !== expectedSecret)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "公司授权码导入验证失败。",
      });
    if (args.companies.length !== 2)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "批次必须正好包含两家公司。",
      });

    const results = [];
    for (const company of args.companies)
      results.push(
        await provisionCompanyRecords(ctx, company, "SYSTEM_IMPORT"),
      );
    return results;
  },
});

async function validateUsaFilingCodeOnlyClaimTenant(
  ctx: MutationCtx,
  tenantId: (typeof codeOnlyDeviceClaimTenantIds)[number],
  requireInitialShape: boolean,
) {
  const records = (await ctx.db.query("allowed_codes").collect()).filter(
    (record) => record.companyId?.trim().toLowerCase() === tenantId,
  );
  if (requireInitialShape && records.length !== 61)
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 必须正好包含 61 个授权码。`,
    });
  if (
    new Set(records.map((record) => normalize(record.code))).size !==
    records.length
  )
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 的授权码不得重复。`,
    });

  const expectedAdminCode = tenantId.toUpperCase();
  const administrators = records.filter((record) => record.role === "admin");
  if (
    administrators.length !== 1 ||
    administrators[0].code !== expectedAdminCode ||
    records.some(
      (record) =>
        record.companyId?.trim().toLowerCase() !== tenantId ||
        (record.code !== expectedAdminCode && record.role !== "user") ||
        (record.code === expectedAdminCode && record.role !== "admin"),
    )
  )
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 的管理员授权码必须为 ${expectedAdminCode}，其余授权码必须为用户。`,
    });
  if (
    records.some(
      (record) =>
        !newAuthorizationCodePattern.test(record.code) ||
        !isClaimSecretHash(record.claimSecretHash ?? ""),
    )
  )
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 的每个授权码都必须保留有效的设备启用密钥摘要。`,
    });

  let fullCount = 0;
  let limitedCount = 0;
  for (const record of records) {
    if (record.role === "admin") continue;
    const profile = record.licenseProfileId
      ? await ctx.db.get(record.licenseProfileId)
      : null;
    if (!profile || profile.companyId?.trim().toLowerCase() !== tenantId)
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: `公司 ${tenantId} 的用户授权码必须使用本公司的授权配置。`,
      });
    if (
      featureKeys.every((key) => profile.features[key] === allFeatureFlags[key])
    ) {
      fullCount += 1;
      continue;
    }
    if (
      featureKeys.every(
        (key) => profile.features[key] === limitedCompanyFeatures[key],
      )
    ) {
      limitedCount += 1;
      continue;
    }
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 的受限授权配置必须停用视频切换、屏幕共享与通话转接。`,
    });
  }
  if (requireInitialShape && (fullCount !== 10 || limitedCount !== 50))
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: `公司 ${tenantId} 必须正好包含 10 个全功能及 50 个受限授权码。`,
    });
  return { tenantId, records, fullCount, limitedCount };
}

// This migration is deliberately internal and tenant-specific. It cannot be
// reused to weaken first-device authentication for an arbitrary company.
export const rolloutUsaFilingCodeOnlyDeviceClaims = internalMutation({
  args: {
    password: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!expectedSecret || args.password !== expectedSecret)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "USA Filing 授权码切换验证失败。",
      });

    // Complete both tenant audits before the first write. Convex would roll
    // back a thrown mutation, but this ordering also makes the fail-closed
    // boundary explicit and reviewable.
    const validated: Array<{
      tenantId: (typeof codeOnlyDeviceClaimTenantIds)[number];
      records: Doc<"allowed_codes">[];
      fullCount?: number;
      limitedCount?: number;
    }> = [];
    for (const tenantId of codeOnlyDeviceClaimTenantIds) {
      if (args.enabled) {
        const hasPriorRollout = (
          await ctx.db.query("audit_logs").collect()
        ).some(
          (entry) =>
            entry.action === "company.code_only_device_claim_rollout" &&
            entry.targetType === "company" &&
            entry.targetId === tenantId &&
            (entry.details as { enabled?: boolean } | undefined)?.enabled ===
              true,
        );
        validated.push(
          await validateUsaFilingCodeOnlyClaimTenant(
            ctx,
            tenantId,
            !hasPriorRollout,
          ),
        );
        continue;
      }
      const records = (await ctx.db.query("allowed_codes").collect()).filter(
        (record) => record.companyId?.trim().toLowerCase() === tenantId,
      );
      validated.push({ tenantId, records });
    }

    const now = Date.now();
    // Disabling this weaker login path is a security rollback, so every
    // session claimed under it is revoked unconditionally.
    const revokeSessions = !args.enabled;
    for (const tenant of validated) {
      for (const record of tenant.records) {
        const maxDevices = args.enabled
          ? 2
          : await effectiveAuthorizationDeviceLimit(ctx, {
              ...record,
              allowCodeOnlyDeviceClaim: false,
            });
        await ctx.db.patch(record._id, {
          allowCodeOnlyDeviceClaim: args.enabled ? true : undefined,
          maxDevices,
          unlimitedDevices: undefined,
          updatedAt: now,
        });
        if (revokeSessions)
          await revokeAuthorizationCodeIdentityState(ctx, record.code);
        else
          await enforceAuthorizationCodeDeviceLimit(
            ctx,
            record.code,
            maxDevices,
          );
      }
      await ctx.db.insert("audit_logs", {
        actorCode: "SYSTEM_IMPORT",
        action: "company.code_only_device_claim_rollout",
        targetType: "company",
        targetId: tenant.tenantId,
        success: true,
        details: {
          enabled: args.enabled,
          recordCount: tenant.records.length,
          ...(tenant.fullCount === undefined
            ? {}
            : { fullCount: tenant.fullCount }),
          ...(tenant.limitedCount === undefined
            ? {}
            : { limitedCount: tenant.limitedCount }),
          revokeSessions,
        },
        createdAt: now,
      });
    }

    return {
      enabled: args.enabled,
      updated: validated.reduce(
        (count, tenant) => count + tenant.records.length,
        0,
      ),
      revokedSessions: revokeSessions,
    };
  },
});

export const setRole = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    assertAuthorizationSetCanExpand(auth);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanAccessCode(ctx, auth, targetCode);
    if (target.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法修改总管理员。",
      });
    const maxDevices = await effectiveAuthorizationDeviceLimit(ctx, {
      ...target,
      role: args.role,
    });
    await ctx.db.patch(target._id, {
      role: args.role,
      maxDevices,
      unlimitedDevices: undefined,
      updatedAt: Date.now(),
    });
    await enforceAuthorizationCodeDeviceLimit(ctx, targetCode, maxDevices);
    await audit(ctx, auth.code, "role.update", targetCode, { role: args.role });
  },
});

export const createCode = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    claimSecretHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    assertAuthorizationSetCanExpand(auth);
    const targetCode = normalize(args.targetCode);
    if (!newAuthorizationCodePattern.test(targetCode))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Authorization code must contain exactly five letters.",
      });
    if (!isClaimSecretHash(args.claimSecretHash))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "设备启用密钥摘要无效。",
      });
    if (
      await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", targetCode))
        .unique()
    )
      throw new ConvexError({ code: "CONFLICT", message: "此授权码已注册。" });
    await assertAuthorizationCodeNotRetired(ctx, targetCode);
    await ctx.db.insert("allowed_codes", {
      code: targetCode,
      role: args.role,
      companyId: auth.allowed?.companyId,
      enabled: true,
      maxDevices: args.role === "admin" ? 2 : 1,
      claimSecretHash: args.claimSecretHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, auth.code, "auth_code.create", targetCode, {
      role: args.role,
    });
  },
});

// The manager screen accepts either an existing authorization code or a new
// one. Keeping this decision in one server-side mutation avoids the race where
// the client tries to create an existing code and receives a conflict instead
// of promoting it.
export const createOrPromoteAdmin = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    claimSecretHash: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    assertAuthorizationSetCanExpand(auth);
    const targetCode = normalize(args.targetCode.normalize("NFKC"));
    if (!newAuthorizationCodePattern.test(targetCode)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Authorization code must contain exactly five letters.",
      });
    }
    if (!isClaimSecretHash(args.claimSecretHash))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "设备启用密钥摘要无效。",
      });
    if (targetCode === auth.code) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "当前授权码已经是总管理员。",
      });
    }
    await assertAuthorizationCodeNotRetired(ctx, targetCode);
    const existing = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (existing) {
      await assertAdminCanAccessCode(ctx, auth, targetCode);
      if (existing.role === "super_admin")
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "无法修改总管理员。",
        });
      await ctx.db.patch(existing._id, {
        role: "admin",
        enabled: true,
        maxDevices: 2,
        unlimitedDevices: undefined,
        claimSecretHash: args.claimSecretHash,
        updatedAt: Date.now(),
      });
      await revokeAuthorizationCodeIdentityState(ctx, targetCode);
      await audit(ctx, auth.code, "role.promote_admin", targetCode, {
        previousRole: existing.role,
        role: "admin",
      });
      return { code: targetCode, created: false };
    }
    await ctx.db.insert("allowed_codes", {
      code: targetCode,
      role: "admin",
      companyId: auth.allowed?.companyId,
      enabled: true,
      maxDevices: 2,
      claimSecretHash: args.claimSecretHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, auth.code, "auth_code.create_admin", targetCode, {
      role: "admin",
    });
    return { code: targetCode, created: true };
  },
});

export const rotateClaimSecret = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    claimSecretHash: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode.normalize("NFKC"));
    if (!isClaimSecretHash(args.claimSecretHash))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "设备启用密钥摘要无效。",
      });
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanManageAuthorizationCode(ctx, auth, targetCode);
    if (target.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法重设总管理员的设备启用凭证。",
      });
    if (auth.role !== "super_admin" && target.role !== "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员只能管理本公司的用户授权码。",
      });
    await ctx.db.patch(target._id, {
      claimSecretHash: args.claimSecretHash,
      updatedAt: Date.now(),
    });
    await revokeAuthorizationCodeIdentityState(ctx, targetCode);
    await audit(ctx, auth.code, "auth_code.rotate_claim_secret", targetCode);
    return { code: targetCode };
  },
});

export const setEnabled = mutation({
  args: { ...credentialArgs, targetCode: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanManageAuthorizationCode(ctx, auth, targetCode);
    if (target.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法停用总管理员。",
      });
    if (auth.role !== "super_admin" && target.role !== "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员只能管理本公司的用户授权码。",
      });
    await ctx.db.patch(target._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    if (!args.enabled)
      await revokeAuthorizationCodeIdentityState(ctx, targetCode);
    await audit(
      ctx,
      auth.code,
      args.enabled ? "auth_code.enable" : "auth_code.disable",
      targetCode,
    );
  },
});

export const setCompanyScope = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    companyId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanAccessCode(ctx, auth, targetCode);
    const normalizedCompanyId = args.companyId?.trim() || undefined;
    if (
      auth.allowed?.companyId &&
      normalizedCompanyId !== auth.allowed.companyId
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法将授权码移到其他授权群组。",
      });
    await ctx.db.patch(target._id, {
      companyId: normalizedCompanyId,
      updatedAt: Date.now(),
    });
    await audit(ctx, auth.code, "company_scope.update", targetCode, {
      companyId: normalizedCompanyId ?? null,
    });
    return { code: targetCode, companyId: normalizedCompanyId ?? null };
  },
});

export const deleteCode = mutation({
  args: { ...credentialArgs, targetCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanManageAuthorizationCode(ctx, auth, targetCode);
    if (target.role !== "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员不能删除管理员授权码。",
      });
    await retireAuthorizationCode(ctx, targetCode, {
      retiredBy: auth.code,
      companyId: target.companyId,
      reason: "deleted",
    });
    await ctx.db.delete(target._id);
    await audit(ctx, auth.code, "auth_code.delete", targetCode);
  },
});

/**
 * One-time rollout hook for codes whose future expiry predates automatic
 * scheduling. It is safe to rerun: duplicate jobs carry the same expiry
 * version and the internal expiry mutation records that version atomically.
 */
export const backfillAuthorizationCodeExpirySchedules = mutation({
  args: { migrationSecret: v.string() },
  handler: async (ctx, args) => {
    requireRoleMigrationSecret(args.migrationSecret);
    const records = await ctx.db.query("allowed_codes").collect();
    let revoked = 0;
    let scheduled = 0;
    for (const record of records) {
      if (
        record.expiresAt === undefined ||
        record.expiryRevocationVersion === record.expiresAt
      )
        continue;
      if (record.expiresAt <= Date.now()) {
        await revokeAuthorizationCodeIdentityState(ctx, record.code);
        await ctx.db.patch(record._id, {
          expiryRevocationVersion: record.expiresAt,
          updatedAt: Date.now(),
        });
        revoked += 1;
        continue;
      }
      if (
        await scheduleAuthorizationCodeExpiry(ctx, record._id, record.expiresAt)
      )
        scheduled += 1;
    }
    return { revoked, scheduled };
  },
});
