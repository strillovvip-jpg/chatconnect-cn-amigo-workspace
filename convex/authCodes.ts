import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { assertSurfaceAccess, boundDeviceIds, requireSession } from "./roles";
import type { MutationCtx } from "./_generated/server";

const authorizationCodePattern = /^[A-Z0-9]{4,20}$/;
const profileFeatureKeys = [
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

type ProfileFeatures = Record<(typeof profileFeatureKeys)[number], boolean>;

const fullProfileFeatures: ProfileFeatures = {
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

const limitedProfileFeatures: ProfileFeatures = {
  ...fullProfileFeatures,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

function normalizeAuthorizationCode(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}

function validateTierCodes(
  values: string[],
  label: string,
  expectedCount = 50,
) {
  if (values.length !== expectedCount)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label}授权码必须正好包含 ${expectedCount} 个。`,
    });
  const codes = values.map(normalizeAuthorizationCode);
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

function isFullProfile(features: ProfileFeatures) {
  return profileFeatureKeys.every((key) => features[key] === true);
}

function isLimitedProfile(features: ProfileFeatures) {
  return (
    features.canVideoCall === true &&
    features.canVoiceCall === true &&
    features.canAIFace === true &&
    features.canVideoSource === true &&
    features.canPlayVideo === false &&
    features.canScreenShare === false &&
    features.canTransferCall === false &&
    features.canGroupCall === true &&
    features.canPictureInPicture === true &&
    features.canFloatingWindow === true &&
    features.canFileSearch === true &&
    features.canRecord === true
  );
}

function selectProfile<T extends { name: string; features: ProfileFeatures }>(
  profiles: T[],
  kind: "full" | "limited",
) {
  const matches = profiles.filter((profile) =>
    kind === "full"
      ? isFullProfile(profile.features)
      : isLimitedProfile(profile.features),
  );
  if (matches.length === 1) return matches[0];

  const namePattern =
    kind === "full"
      ? /(全部功能|全功能|full\s*feature|^full$)/i
      : /(受限|limited|(?:缺少|少|无|無)\s*[6６].*[9９].*11)/i;
  const namedMatches = matches.filter((profile) =>
    namePattern.test(profile.name.normalize("NFKC")),
  );
  if (namedMatches.length === 1) return namedMatches[0];

  throw new ConvexError({
    code: "PRECONDITION_FAILED",
    message:
      kind === "full"
        ? "无法唯一识别现有的全功能授权配置。"
        : "无法唯一识别现有的受限（缺少 6、9、11）授权配置。",
  });
}

async function ensureAichijpProfile(
  ctx: MutationCtx,
  profiles: Array<{
    _id: import("./_generated/dataModel").Id<"license_profiles">;
    name: string;
    companyId?: string;
    features: ProfileFeatures;
  }>,
  kind: "full" | "limited",
  createdBy: string,
) {
  const tenantProfiles = profiles.filter(
    (profile) => profile.companyId?.trim().toLowerCase() === "aichijp",
  );
  const matching = tenantProfiles.filter((profile) =>
    kind === "full"
      ? isFullProfile(profile.features)
      : isLimitedProfile(profile.features),
  );
  if (matching.length > 0) return selectProfile(tenantProfiles, kind)._id;

  return await ctx.db.insert("license_profiles", {
    name:
      kind === "full"
        ? "Aichijp full-feature authorization"
        : "Aichijp limited authorization (without 6, 9, and 11)",
    companyId: "aichijp",
    description:
      kind === "full"
        ? "All communication features"
        : "Without screen sharing, call transfer, and camera/album video switching",
    features: kind === "full" ? fullProfileFeatures : limitedProfileFeatures,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

const administratorValidator = v.object({
  code: v.string(),
  role: v.union(v.literal("super_admin"), v.literal("admin")),
  companyId: v.optional(v.string()),
  unlimitedDevices: v.optional(v.boolean()),
});

export const replaceAuthorizationCodes = internalMutation({
  args: {
    password: v.string(),
    companyId: v.optional(v.string()),
    fullCodes: v.array(v.string()),
    limitedCodes: v.array(v.string()),
    administrators: v.array(administratorValidator),
  },
  handler: async (ctx, args) => {
    const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!importSecret || args.password !== importSecret)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "授权码替换验证失败。",
      });

    const companyId = args.companyId?.trim().toLowerCase() || undefined;
    const fullCodeCount = companyId === "aichijp" ? 20 : 50;
    const fullCodes = validateTierCodes(
      args.fullCodes,
      "全功能",
      fullCodeCount,
    );
    const limitedCodes = validateTierCodes(args.limitedCodes, "受限");
    const userCodes = [...fullCodes, ...limitedCodes];
    if (new Set(userCodes).size !== userCodes.length)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "全功能与受限授权码之间不得重复。",
      });

    const administrators = new Map<
      string,
      {
        code: string;
        role: "super_admin" | "admin";
        companyId?: string;
        unlimitedDevices?: boolean;
      }
    >();
    const addAdministrator = (item: {
      code: string;
      role: "super_admin" | "admin";
      companyId?: string;
      unlimitedDevices?: boolean;
    }) => {
      const code = normalizeAuthorizationCode(item.code);
      if (!authorizationCodePattern.test(code))
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "管理员授权码必须为 4 至 20 位英文字母或数字。",
        });
      if (userCodes.includes(code))
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "管理员授权码不得与用户授权码重复。",
        });
      const existing = administrators.get(code);
      if (existing && existing.role !== item.role)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "同一个管理员授权码不能指定多个角色。",
        });
      administrators.set(code, {
        code,
        role: item.role,
        companyId:
          (companyId
            ? item.companyId?.trim().toLowerCase()
            : item.companyId?.trim()) || undefined,
        unlimitedDevices: item.unlimitedDevices,
      });
    };

    // The explicit replacement payload is the sole source of administrators.
    // In particular, do not silently revive codes from legacy environment
    // variables when the operator has requested a complete authorization reset.
    for (const item of args.administrators) addAdministrator(item);
    if (companyId) {
      if (
        administrators.size !== 1 ||
        [...administrators.values()].some(
          (administrator) => administrator.companyId !== companyId,
        )
      )
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "固定授权群组必须正好包含一位同群组总管理员。",
        });
    }
    if (
      ![...administrators.values()].some(
        (administrator) => administrator.role === "super_admin",
      )
    )
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "替换后必须保留至少一个总管理员授权码，以免系统被锁死。",
      });

    const profiles = await ctx.db.query("license_profiles").collect();
    const profileOwner = [...administrators.values()].find(
      (administrator) => administrator.role === "super_admin",
    )!.code;
    const fullProfileId =
      companyId === "aichijp"
        ? await ensureAichijpProfile(ctx, profiles, "full", profileOwner)
        : selectProfile(profiles, "full")._id;
    const limitedProfileId =
      companyId === "aichijp"
        ? await ensureAichijpProfile(ctx, profiles, "limited", profileOwner)
        : selectProfile(profiles, "limited")._id;

    // Convex mutations are transactional. All validation and profile lookup
    // happens before these writes, so a failure cannot leave a half-imported
    // authorization set.
    const existingCodes = await ctx.db.query("allowed_codes").collect();
    const recordsToReplace = companyId
      ? existingCodes.filter(
          (record) => record.companyId?.trim().toLowerCase() === companyId,
        )
      : existingCodes;
    const recordsToKeep = companyId
      ? existingCodes.filter((record) => !recordsToReplace.includes(record))
      : [];
    const incomingCodes = new Set([...userCodes, ...administrators.keys()]);
    if (recordsToKeep.some((record) => incomingCodes.has(record.code)))
      throw new ConvexError({
        code: "CONFLICT",
        message: "授权码已属于其他授权群组。",
      });

    const replacedCodes = new Set(
      recordsToReplace.map((record) => record.code),
    );
    const allSessions = await ctx.db.query("auth_codes").collect();
    const sessions = companyId
      ? allSessions.filter((session) => replacedCodes.has(session.code))
      : allSessions;
    for (const session of sessions) await ctx.db.delete(session._id);
    for (const record of recordsToReplace) await ctx.db.delete(record._id);

    const now = Date.now();
    for (const code of fullCodes)
      await ctx.db.insert("allowed_codes", {
        code,
        role: "user",
        companyId,
        enabled: true,
        maxDevices: companyId === "aichijp" ? 2 : undefined,
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
        maxDevices: companyId === "aichijp" ? 1 : undefined,
        licenseProfileId: limitedProfileId,
        createdAt: now,
        updatedAt: now,
      });
    for (const administrator of administrators.values())
      await ctx.db.insert("allowed_codes", {
        code: administrator.code,
        role: administrator.role,
        companyId: administrator.companyId,
        enabled: true,
        unlimitedDevices: administrator.unlimitedDevices,
        createdAt: now,
        updatedAt: now,
      });

    return {
      full: fullCodes.length,
      limited: limitedCodes.length,
      administrators: administrators.size,
      revokedSessions: sessions.length,
    };
  },
});

export const configureAichijpDeviceLimits = internalMutation({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!importSecret || args.password !== importSecret)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "授权码设备限制设置验证失败。",
      });

    const profiles = await ctx.db.query("license_profiles").collect();
    const profilesById = new Map(
      profiles.map((profile) => [String(profile._id), profile]),
    );
    const tenantCodes = (await ctx.db.query("allowed_codes").collect()).filter(
      (record) =>
        record.companyId?.trim().toLowerCase() === "aichijp" &&
        record.role === "user",
    );
    const fullCodes = tenantCodes.filter((record) => {
      const profile = record.licenseProfileId
        ? profilesById.get(String(record.licenseProfileId))
        : undefined;
      return profile ? isFullProfile(profile.features) : false;
    });
    const limitedCodes = tenantCodes.filter((record) => {
      const profile = record.licenseProfileId
        ? profilesById.get(String(record.licenseProfileId))
        : undefined;
      return profile ? isLimitedProfile(profile.features) : false;
    });
    if (
      fullCodes.length !== 20 ||
      limitedCodes.length !== 50 ||
      fullCodes.length + limitedCodes.length !== tenantCodes.length
    )
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "Aichijp 授权码分级数量不正确，未修改设备限制。",
      });

    const normalizedFullCodes = fullCodes.map((record) =>
      normalizeAuthorizationCode(record.code),
    );
    const normalizedLimitedCodes = limitedCodes.map((record) =>
      normalizeAuthorizationCode(record.code),
    );
    const fullCodeSet = new Set(normalizedFullCodes);
    const limitedCodeSet = new Set(normalizedLimitedCodes);
    if (
      fullCodeSet.size !== fullCodes.length ||
      limitedCodeSet.size !== limitedCodes.length ||
      normalizedFullCodes.some((code) => limitedCodeSet.has(code))
    )
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "Aichijp 授权码存在重复，未修改设备限制。",
      });

    const limitsByCode = new Map<string, number>([
      ...fullCodes.map((record) => [record.code, 2] as const),
      ...limitedCodes.map((record) => [record.code, 1] as const),
    ]);
    const sessions = (await ctx.db.query("auth_codes").collect()).filter(
      (session) => limitsByCode.has(session.code),
    );
    const sessionCounts = new Map<string, number>();
    for (const session of sessions)
      sessionCounts.set(
        session.code,
        (sessionCounts.get(session.code) ?? 0) + 1,
      );
    if ([...sessionCounts.values()].some((count) => count > 1))
      throw new ConvexError({
        code: "PRECONDITION_FAILED",
        message: "Aichijp 授权码存在重复的登录记录，未修改设备限制。",
      });
    const sessionUpdates = sessions.map((session) => {
      const deviceIds = boundDeviceIds(session);
      const maxDevices = limitsByCode.get(session.code)!;
      if (deviceIds.length > maxDevices)
        throw new ConvexError({
          code: "PRECONDITION_FAILED",
          message: "现有登录设备超过新的设备数量上限，未进行任何修改。",
        });
      return { session, deviceIds };
    });

    const now = Date.now();
    for (const record of fullCodes)
      await ctx.db.patch(record._id, {
        maxDevices: 2,
        unlimitedDevices: false,
        updatedAt: now,
      });
    for (const record of limitedCodes)
      await ctx.db.patch(record._id, {
        maxDevices: 1,
        unlimitedDevices: false,
        updatedAt: now,
      });
    for (const { session, deviceIds } of sessionUpdates)
      await ctx.db.patch(session._id, { deviceIds });

    return {
      full: fullCodes.length,
      limited: limitedCodes.length,
      migratedSessions: sessionUpdates.length,
    };
  },
});

export const importAllowedCodes = internalMutation({
  args: {
    password: v.string(),
    codes: v.array(
      v.object({
        code: v.string(),
        role: v.union(
          v.literal("super_admin"),
          v.literal("admin"),
          v.literal("user"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!importSecret || args.password !== importSecret) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "需要管理员权限。",
      });
    }
    if (
      args.codes.length !== 50 ||
      new Set(args.codes.map((item) => item.code)).size !== 50
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码必须为 50 个且不得重复。",
      });
    }
    const existing = await ctx.db.query("allowed_codes").collect();
    for (const record of existing) await ctx.db.delete(record._id);
    for (const item of args.codes) {
      await ctx.db.insert("allowed_codes", {
        code: item.code.trim().toUpperCase(),
        role: item.role,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { imported: args.codes.length };
  },
});

export const assignAuthorizationCodeTenant = internalMutation({
  args: {
    password: v.string(),
    code: v.string(),
    companyId: v.string(),
  },
  handler: async (ctx, args) => {
    const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
    if (!importSecret || args.password !== importSecret)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "授权码群组设置验证失败。",
      });
    const code = normalizeAuthorizationCode(args.code);
    const companyId = args.companyId.trim().toLowerCase();
    if (!authorizationCodePattern.test(code) || !companyId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码或授权群组无效。",
      });
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    await ctx.db.patch(target._id, { companyId, updatedAt: Date.now() });
    return { code, companyId };
  },
});

// Check if a code is already used and by which device
export const getCodeStatus = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    const record = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    return { used: Boolean(record) };
  },
});

export const getSessionRole = query({
  args: {
    code: v.string(),
    deviceId: v.string(),
    surface: v.optional(
      v.union(v.literal("app"), v.literal("aichijp"), v.literal("nyfbi")),
    ),
  },
  handler: async (ctx, args) => {
    try {
      const auth = await requireSession(ctx, args.code, args.deviceId);
      assertSurfaceAccess(auth.allowed, args.surface);
      return {
        role: auth.role,
        code: auth.code,
        name: auth.session.name,
        expiresAt: auth.allowed?.expiresAt ?? null,
        licenseProfileId: auth.allowed?.licenseProfileId ?? null,
        companyId: auth.allowed?.companyId?.trim().toLowerCase() ?? "nyfbi",
      };
    } catch {
      return null;
    }
  },
});

// Attempt to claim a code for a device
export const claimCode = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    deviceType: v.union(v.literal("mobile"), v.literal("desktop")),
    deviceContext: v.optional(
      v.union(v.literal("browser"), v.literal("standalone")),
    ),
    surface: v.optional(
      v.union(v.literal("app"), v.literal("aichijp"), v.literal("nyfbi")),
    ),
    name: v.string(),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    const name = args.name.trim();
    if (!name || name.length > 100)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "请输入有效的姓名。",
      });
    if (!args.deviceId || args.deviceId.length > 200)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "设备标识无效。",
      });

    const allowed = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!allowed) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码无效，请输入正确的授权码。",
      });
    }
    assertSurfaceAccess(allowed, args.surface);
    if (allowed.expiresAt && allowed.expiresAt <= Date.now()) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "此授权码已过期。",
      });
    }

    // Check if this code is already claimed
    const existing = await ctx.db
      .query("auth_codes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (existing) {
      if (allowed.enabled === false)
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "此授权码已停用。",
        });
      if (allowed.unlimitedDevices === true) {
        await ctx.db.patch(existing._id, { name, lastLoginAt: Date.now() });
        return { success: true, role: allowed.role, name };
      }
      if (allowed.maxDevices !== undefined) {
        const maxDevices = Math.max(1, Math.floor(allowed.maxDevices));
        const currentDeviceIds = boundDeviceIds(existing).slice(0, maxDevices);
        const alreadyBound = currentDeviceIds.includes(args.deviceId);
        if (!alreadyBound && currentDeviceIds.length >= maxDevices)
          throw new ConvexError({
            code: "CONFLICT",
            message: "此授权码已达到可登录设备数量上限。",
          });
        await ctx.db.patch(existing._id, {
          name,
          deviceIds: alreadyBound
            ? currentDeviceIds
            : [...currentDeviceIds, args.deviceId],
          lastLoginAt: Date.now(),
        });
        return { success: true, role: allowed.role, name };
      }
      const standaloneMobile =
        args.deviceType === "mobile" && args.deviceContext === "standalone";
      const alreadyBound =
        existing.deviceId === args.deviceId ||
        existing.mobileDeviceId === args.deviceId ||
        existing.mobileAppDeviceId === args.deviceId ||
        existing.desktopDeviceId === args.deviceId;
      const requestedSlot =
        args.deviceType === "desktop"
          ? existing.desktopDeviceId
          : standaloneMobile
            ? existing.mobileAppDeviceId
            : existing.mobileDeviceId;
      if (!alreadyBound && requestedSlot) {
        throw new ConvexError({
          code: "CONFLICT",
          message:
            args.deviceType === "mobile"
              ? "此授权码已绑定其他移动设备。仅允许一个手机浏览器和一个已安装的手机应用。"
              : "此授权码已绑定其他电脑。仅允许一台电脑。",
        });
      }
      // Legacy records had one device only. Until that device identifies
      // itself, reserve the mobile slot for it and still allow one desktop.
      if (
        !alreadyBound &&
        args.deviceType === "mobile" &&
        !existing.mobileDeviceId &&
        !existing.desktopDeviceId
      ) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "此授权码已绑定其他移动设备。",
        });
      }
      const patch =
        args.deviceType === "desktop"
          ? {
              name,
              desktopDeviceId: existing.desktopDeviceId ?? args.deviceId,
              lastLoginAt: Date.now(),
            }
          : standaloneMobile
            ? {
                name,
                mobileAppDeviceId: existing.mobileAppDeviceId ?? args.deviceId,
                lastLoginAt: Date.now(),
              }
            : {
                name,
                mobileDeviceId: existing.mobileDeviceId ?? args.deviceId,
                lastLoginAt: Date.now(),
              };
      await ctx.db.patch(existing._id, patch);
      return { success: true, role: allowed.role, name };
    }

    // Claim the code
    await ctx.db.insert("auth_codes", {
      code,
      deviceId: args.deviceId,
      deviceIds: allowed.maxDevices === undefined ? undefined : [args.deviceId],
      mobileDeviceId:
        args.deviceType === "mobile" && args.deviceContext !== "standalone"
          ? args.deviceId
          : undefined,
      mobileAppDeviceId:
        args.deviceType === "mobile" && args.deviceContext === "standalone"
          ? args.deviceId
          : undefined,
      desktopDeviceId:
        args.deviceType === "desktop" ? args.deviceId : undefined,
      name,
      department: args.department,
      usedAt: new Date().toISOString(),
      firstLoginAt: Date.now(),
      lastLoginAt: Date.now(),
    });

    return { success: true, role: allowed.role, name };
  },
});
