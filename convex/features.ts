import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertAuthorizationSetCanExpand,
  assertAdminCanAccessCode,
  getAdminCompanyScope,
  listVisibleAllowedCodes,
  requireAdmin,
  requireSession,
  requireSuperAdmin,
  tenantIdForAllowed,
} from "./roles";
import { isClaimSecretHash } from "./claimCredentials";
import {
  assertAuthorizationCodeNotRetired,
  enforceAuthorizationCodeDeviceLimit,
  revokeAuthorizationCodeIdentityState,
  scheduleAuthorizationCodeExpiry,
} from "./authorizationCodeLifecycle";

export const featureKeys = [
  "canVideoCall",
  "canVoiceCall",
  "canAIFace",
  "canVideoSource",
  "canPlayVideo",
  "canScreenShare",
  "canTransferCall",
  "canGroupCall",
  "canPictureInPicture",
  "canFloatingWindow",
  "canFileSearch",
  "canRecord",
] as const;
export type FeatureKey = (typeof featureKeys)[number];

export const featureFlagsValidator = v.object({
  canVideoCall: v.boolean(),
  canVoiceCall: v.boolean(),
  canAIFace: v.boolean(),
  canVideoSource: v.boolean(),
  canPlayVideo: v.boolean(),
  canScreenShare: v.boolean(),
  canTransferCall: v.boolean(),
  canGroupCall: v.boolean(),
  canPictureInPicture: v.boolean(),
  canFloatingWindow: v.boolean(),
  canFileSearch: v.boolean(),
  canRecord: v.boolean(),
});

export const defaultFeatureFlags: Record<FeatureKey, boolean> = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: false,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: false,
};

export const allFeatureFlags: Record<FeatureKey, boolean> = {
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

export const codeOnlyDeviceClaimTenantIds = ["nersp", "bjqaf"] as const;

export function permitsCodeOnlyDeviceClaim(
  allowed:
    | { companyId?: string; allowCodeOnlyDeviceClaim?: boolean }
    | null
    | undefined,
) {
  const companyId = allowed?.companyId?.trim().toLowerCase();
  return (
    allowed?.allowCodeOnlyDeviceClaim === true &&
    codeOnlyDeviceClaimTenantIds.some((tenantId) => tenantId === companyId)
  );
}

type DbCtx = QueryCtx | MutationCtx;

type AdminAuth = {
  code: string;
  role: "super_admin" | "admin" | "user";
  allowed?: { companyId?: string } | null;
};

async function profileTenantId(ctx: DbCtx, profile: Doc<"license_profiles">) {
  if (profile.companyId?.trim()) return profile.companyId.trim().toLowerCase();
  const creator = await ctx.db
    .query("allowed_codes")
    .withIndex("by_code", (q) => q.eq("code", profile.createdBy))
    .unique();
  return tenantIdForAllowed(creator);
}

async function assertAdminCanAccessProfile(
  ctx: DbCtx,
  auth: AdminAuth,
  profile: Doc<"license_profiles">,
) {
  const tenantId = getAdminCompanyScope(auth);
  if (tenantId && (await profileTenantId(ctx, profile)) !== tenantId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
}

async function visibleProfiles(ctx: DbCtx, auth: AdminAuth) {
  const profiles = await ctx.db.query("license_profiles").collect();
  const tenantId = getAdminCompanyScope(auth);
  if (!tenantId) return profiles;
  const resolved = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      tenantId: await profileTenantId(ctx, profile),
    })),
  );
  return resolved
    .filter((item) => item.tenantId === tenantId)
    .map((item) => item.profile);
}

async function findVisibleProfileByName(
  ctx: DbCtx,
  auth: AdminAuth,
  name: string,
) {
  const matching = await ctx.db
    .query("license_profiles")
    .withIndex("by_name", (q) => q.eq("name", name))
    .collect();
  const tenantId = getAdminCompanyScope(auth);
  if (!tenantId) return matching[0] ?? null;
  for (const profile of matching)
    if ((await profileTenantId(ctx, profile)) === tenantId) return profile;
  return null;
}

export async function effectiveFeatures(
  ctx: DbCtx,
  allowed:
    | {
        role?: string | null;
        companyId?: string;
        licenseProfileId?: Id<"license_profiles">;
      }
    | null
    | undefined,
) {
  // Admins always keep every call feature regardless of the license profile.
  if (allowed?.role === "admin" || allowed?.role === "super_admin")
    return {
      profileId: null,
      profileName: "管理员",
      features: allFeatureFlags,
    };
  if (!allowed?.licenseProfileId)
    return {
      profileId: null,
      profileName: "标准",
      features: defaultFeatureFlags,
    };
  const profile = await ctx.db.get(allowed.licenseProfileId);
  if (!profile)
    return {
      profileId: null,
      profileName: "标准",
      features: defaultFeatureFlags,
    };
  if ((await profileTenantId(ctx, profile)) !== tenantIdForAllowed(allowed))
    return {
      profileId: null,
      profileName: "标准",
      features: defaultFeatureFlags,
    };
  // Case lookup is a base portal capability for every valid authorization
  // code and is intentionally independent from premium call features.
  return {
    profileId: profile._id,
    profileName: profile.name,
    features: { ...profile.features, canFileSearch: true },
  };
}

export function authorizationDeviceLimit(
  role: string | null | undefined,
  features: Record<FeatureKey, boolean>,
  allowCodeOnlyDeviceClaim = false,
) {
  if (allowCodeOnlyDeviceClaim) return 2;
  if (role === "admin" || role === "super_admin") return 2;
  return featureKeys.every((key) => features[key] === true) ? 2 : 1;
}

export async function effectiveAuthorizationDeviceLimit(
  ctx: DbCtx,
  allowed:
    | {
      role?: string | null;
        code?: string;
        companyId?: string;
        licenseProfileId?: Id<"license_profiles">;
        allowCodeOnlyDeviceClaim?: boolean;
      }
    | null
    | undefined,
) {
  if (allowed?.code?.normalize("NFKC").trim().toUpperCase() === "NERSP")
    return 5;
  const license = await effectiveFeatures(ctx, allowed);
  // This flag is writable only through privileged provisioning or
  // administration. Opted-in full and limited/customer codes both receive
  // exactly two slots; their feature permissions remain profile-driven.
  return authorizationDeviceLimit(
    allowed?.role,
    license.features,
    permitsCodeOnlyDeviceClaim(allowed),
  );
}

export async function requireFeature(
  ctx: DbCtx,
  code: string,
  deviceId: string,
  key: FeatureKey,
) {
  const auth = await requireSession(ctx, code, deviceId);
  const license = await effectiveFeatures(ctx, auth.allowed);
  if (!license.features[key])
    throw new ConvexError({
      code: "FEATURE_DISABLED",
      message: "此授权码无法使用该功能。",
    });
  return { ...auth, license };
}

const credentialArgs = { password: v.string() };
export const current = query({
  args: { code: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const license = await effectiveFeatures(ctx, auth.allowed);
    return {
      ...license,
      expiresAt: auth.allowed?.expiresAt ?? null,
      enabled: auth.allowed?.enabled !== false,
    };
  },
});

export const authorizeVideoSource = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    source: v.union(
      v.literal("camera"),
      v.literal("video-file"),
      v.literal("ai"),
      v.literal("screen-share"),
    ),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.code, args.deviceId, "canVideoSource");
    if (args.source === "video-file")
      await requireFeature(ctx, args.code, args.deviceId, "canPlayVideo");
    if (args.source === "ai")
      await requireFeature(ctx, args.code, args.deviceId, "canAIFace");
    if (args.source === "screen-share")
      await requireFeature(ctx, args.code, args.deviceId, "canScreenShare");
    return true;
  },
});

export const listProfiles = query({
  args: credentialArgs,
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    return await visibleProfiles(ctx, auth);
  },
});

export const createProfile = mutation({
  args: {
    ...credentialArgs,
    name: v.string(),
    description: v.optional(v.string()),
    features: featureFlagsValidator,
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const name = args.name.trim();
    if (!name)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "请输入授权配置名称。",
      });
    if (await findVisibleProfileByName(ctx, auth, name))
      throw new ConvexError({
        code: "CONFLICT",
        message: "已存在同名授权配置。",
      });
    return await ctx.db.insert("license_profiles", {
      name,
      companyId: getAdminCompanyScope(auth) ?? undefined,
      description: args.description?.trim(),
      features: args.features,
      createdBy: auth.code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateProfile = mutation({
  args: {
    ...credentialArgs,
    profileId: v.id("license_profiles"),
    name: v.string(),
    description: v.optional(v.string()),
    features: featureFlagsValidator,
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const profile = await ctx.db.get(args.profileId);
    if (!profile)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权配置。" });
    await assertAdminCanAccessProfile(ctx, auth, profile);
    await ctx.db.patch(profile._id, {
      name: args.name.trim(),
      description: args.description?.trim(),
      features: args.features,
      updatedAt: Date.now(),
    });
    const assignedCodes = (
      await ctx.db.query("allowed_codes").collect()
    ).filter((record) => record.licenseProfileId === profile._id);
    for (const record of assignedCodes) {
      const maxDevices = authorizationDeviceLimit(
        record.role,
        args.features,
        permitsCodeOnlyDeviceClaim(record),
      );
      await ctx.db.patch(record._id, {
        maxDevices,
        unlimitedDevices: undefined,
        updatedAt: Date.now(),
      });
      await enforceAuthorizationCodeDeviceLimit(ctx, record.code, maxDevices);
    }
  },
});

export const configureCode = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    profileId: v.optional(v.id("license_profiles")),
    enabled: v.boolean(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const code = args.targetCode.trim().toUpperCase();
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await assertAdminCanAccessCode(ctx, auth, code);
    if (target.role === "super_admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法修改总管理员的设置。",
      });
    const profile = args.profileId ? await ctx.db.get(args.profileId) : null;
    if (args.profileId) {
      if (!profile)
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "找不到授权配置。",
        });
      await assertAdminCanAccessProfile(ctx, auth, profile);
    }
    const maxDevices = authorizationDeviceLimit(
      target.role,
      profile?.features ?? defaultFeatureFlags,
      permitsCodeOnlyDeviceClaim(target),
    );
    await ctx.db.patch(target._id, {
      licenseProfileId: args.profileId,
      enabled: args.enabled,
      expiresAt: args.expiresAt,
      maxDevices,
      unlimitedDevices: undefined,
      updatedAt: Date.now(),
    });
    if (
      !args.enabled ||
      (args.expiresAt !== undefined && args.expiresAt <= Date.now())
    ) {
      await revokeAuthorizationCodeIdentityState(ctx, code);
      if (args.expiresAt !== undefined && args.expiresAt <= Date.now())
        await ctx.db.patch(target._id, {
          expiryRevocationVersion: args.expiresAt,
        });
    } else {
      await scheduleAuthorizationCodeExpiry(ctx, target._id, args.expiresAt);
      await enforceAuthorizationCodeDeviceLimit(ctx, code, maxDevices);
    }
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "license.configure",
      targetType: "auth_code",
      targetId: code,
      success: true,
      details: {
        profileId: args.profileId,
        enabled: args.enabled,
        expiresAt: args.expiresAt,
      },
      createdAt: Date.now(),
    });
  },
});

export const createAuthorizationCode = mutation({
  args: {
    ...credentialArgs,
    targetCode: v.string(),
    claimSecretHash: v.string(),
    profileId: v.optional(v.id("license_profiles")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    assertAuthorizationSetCanExpand(auth);
    const code = args.targetCode.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(code))
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
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique()
    )
      throw new ConvexError({ code: "CONFLICT", message: "此授权码已注册。" });
    await assertAuthorizationCodeNotRetired(ctx, code);
    if (args.profileId) {
      const profile = await ctx.db.get(args.profileId);
      if (!profile)
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "找不到授权配置。",
        });
      await assertAdminCanAccessProfile(ctx, auth, profile);
      if (
        auth.role !== "super_admin" &&
        (profile.features.canScreenShare ||
          profile.features.canTransferCall ||
          profile.features.canPlayVideo)
      )
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "普通管理员只能新增受限授权码。",
        });
    } else if (auth.role !== "super_admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "普通管理员只能新增受限授权码。",
      });
    }
    let profileId = args.profileId;
    if (!profileId) {
      const standard = await findVisibleProfileByName(ctx, auth, "标准");
      profileId =
        standard?._id ??
        (await ctx.db.insert("license_profiles", {
          name: "标准",
          companyId: getAdminCompanyScope(auth) ?? undefined,
          description: "默认通信功能",
          features: defaultFeatureFlags,
          createdBy: auth.code,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
    }
    const assignedProfile = await ctx.db.get(profileId);
    const allowCodeOnlyDeviceClaim = permitsCodeOnlyDeviceClaim(auth.allowed);
    const maxDevices = authorizationDeviceLimit(
      "user",
      assignedProfile?.features ?? defaultFeatureFlags,
      allowCodeOnlyDeviceClaim,
    );
    const authorizationCodeId = await ctx.db.insert("allowed_codes", {
      code,
      role: "user",
      companyId: auth.allowed?.companyId,
      enabled: true,
      claimSecretHash: args.claimSecretHash,
      allowCodeOnlyDeviceClaim: allowCodeOnlyDeviceClaim ? true : undefined,
      licenseProfileId: profileId,
      maxDevices,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await scheduleAuthorizationCodeExpiry(
      ctx,
      authorizationCodeId,
      args.expiresAt,
    );
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "auth_code.create",
      targetType: "auth_code",
      targetId: code,
      success: true,
      details: {
        role: "user",
        profileId: args.profileId,
        expiresAt: args.expiresAt,
      },
      createdAt: Date.now(),
    });
    return code;
  },
});

export const migrateUnassignedCodes = mutation({
  args: credentialArgs,
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const existing = await findVisibleProfileByName(ctx, auth, "标准");
    const profileId =
      existing?._id ??
      (await ctx.db.insert("license_profiles", {
        name: "标准",
        companyId: getAdminCompanyScope(auth) ?? undefined,
        description: "默认通信功能",
        features: defaultFeatureFlags,
        createdBy: auth.code,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
    const codes = await listVisibleAllowedCodes(ctx, auth);
    const missing = codes.filter((item) => !item.licenseProfileId);
    for (const item of missing)
      await ctx.db.patch(item._id, {
        licenseProfileId: profileId,
        updatedAt: Date.now(),
      });
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "license.migrate",
      targetType: "license_profile",
      targetId: String(profileId),
      success: true,
      details: { migrated: missing.length },
      createdAt: Date.now(),
    });
    return { migrated: missing.length, profileId };
  },
});
