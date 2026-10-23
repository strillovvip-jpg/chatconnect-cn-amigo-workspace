import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  assertAdminCanAccessCode,
  assertAuthorizationSetCanExpand,
  AICHIJP_TENANT_ID,
  DEFAULT_TENANT_ID,
  getAdminCompanyScope,
  requireAdmin,
  requireSuperAdmin,
} from "./roles";
import { allFeatureFlags } from "./features";
import { isClaimSecretHash } from "./claimCredentials";

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
const authorizationCodePattern = /^[A-Z0-9]{4,20}$/;
const reservedCompanyIds = new Set([DEFAULT_TENANT_ID, AICHIJP_TENANT_ID]);

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
  if (codes.some((code) => !authorizationCodePattern.test(code)))
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label}授权码必须为 4 至 20 位英文字母或数字。`,
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
  if (!authorizationCodePattern.test(adminCode))
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "管理员授权码必须为 4 至 20 位英文字母或数字。",
    });
  const fullCodes = validateProvisionCodes(input.fullCodes, "全功能", 10);
  const limitedCodes = validateProvisionCodes(input.limitedCodes, "受限", 50);
  const allNewCodes = [adminCode, ...fullCodes, ...limitedCodes];
  if (new Set(allNewCodes).size !== allNewCodes.length)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "管理员、全功能与受限授权码之间不得重复。",
    });
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
  if (reservedCompanyIds.has(companyId))
    throw new ConvexError({
      code: "CONFLICT",
      message: "此管理员授权码属于系统保留租户，不能建立新公司。",
    });
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
    await ctx.db.patch(target._id, { role: args.role, updatedAt: Date.now() });
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
    if (!/^[A-Z0-9]{4,20}$/.test(targetCode))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码格式不正确。",
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
    await ctx.db.insert("allowed_codes", {
      code: targetCode,
      role: args.role,
      companyId: auth.allowed?.companyId,
      enabled: true,
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
    if (!/^[A-Z0-9]{4,20}$/.test(targetCode)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码格式不正确，请输入 4 至 20 位英文字母或数字。",
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
        claimSecretHash: args.claimSecretHash,
        updatedAt: Date.now(),
      });
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
    await assertAdminCanAccessCode(ctx, auth, targetCode);
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
    await assertAdminCanAccessCode(ctx, auth, targetCode);
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
    await assertAdminCanAccessCode(ctx, auth, targetCode);
    if (target.role !== "user")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员不能删除管理员授权码。",
      });
    const session = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (session) await ctx.db.delete(session._id);
    await ctx.db.delete(target._id);
    await audit(ctx, auth.code, "auth_code.delete", targetCode);
  },
});
