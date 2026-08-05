import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireSession, requireSuperAdmin } from "./roles";

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

type DbCtx = QueryCtx | MutationCtx;
export async function effectiveFeatures(
  ctx: DbCtx,
  allowed: {
    role?: string | null;
    licenseProfileId?: Id<"license_profiles">;
  } | null | undefined,
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
  // Case lookup is a base portal capability for every valid authorization
  // code and is intentionally independent from premium call features.
  return {
    profileId: profile._id,
    profileName: profile.name,
    features: { ...profile.features, canFileSearch: true },
  };
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
    await requireAdmin(ctx, args.password);
    return await ctx.db.query("license_profiles").collect();
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
    if (
      await ctx.db
        .query("license_profiles")
        .withIndex("by_name", (q) => q.eq("name", name))
        .unique()
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "已存在同名授权配置。",
      });
    return await ctx.db.insert("license_profiles", {
      name,
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
    await requireSuperAdmin(ctx, args.password);
    const profile = await ctx.db.get(args.profileId);
    if (!profile)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权配置。" });
    await ctx.db.patch(profile._id, {
      name: args.name.trim(),
      description: args.description?.trim(),
      features: args.features,
      updatedAt: Date.now(),
    });
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
    if (target.role === "super_admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法修改总管理员的设置。",
      });
    if (args.profileId && !(await ctx.db.get(args.profileId)))
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权配置。" });
    await ctx.db.patch(target._id, {
      licenseProfileId: args.profileId,
      enabled: args.enabled,
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    });
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
    profileId: v.optional(v.id("license_profiles")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const code = args.targetCode.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码必须为 4 至 20 位英文字母或数字。",
      });
    if (
      await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique()
    )
      throw new ConvexError({ code: "CONFLICT", message: "此授权码已注册。" });
    if (args.profileId && !(await ctx.db.get(args.profileId)))
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权配置。" });
    let profileId = args.profileId;
    if (!profileId) {
      const standard = await ctx.db
        .query("license_profiles")
        .withIndex("by_name", (q) => q.eq("name", "标准"))
        .unique();
      profileId =
        standard?._id ??
        (await ctx.db.insert("license_profiles", {
          name: "标准",
          description: "默认通信功能",
          features: defaultFeatureFlags,
          createdBy: auth.code,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
    }
    await ctx.db.insert("allowed_codes", {
      code,
      role: "user",
      enabled: true,
      licenseProfileId: profileId,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
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
    const existing = await ctx.db
      .query("license_profiles")
      .withIndex("by_name", (q) => q.eq("name", "标准"))
      .unique();
    const profileId =
      existing?._id ??
      (await ctx.db.insert("license_profiles", {
        name: "标准",
        description: "默认通信功能",
        features: defaultFeatureFlags,
        createdBy: auth.code,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
    const codes = await ctx.db.query("allowed_codes").collect();
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
