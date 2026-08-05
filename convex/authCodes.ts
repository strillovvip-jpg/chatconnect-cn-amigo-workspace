import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireSession } from "./roles";

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
  args: { code: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    try {
      const auth = await requireSession(ctx, args.code, args.deviceId);
      return {
        role: auth.role,
        code: auth.code,
        name: auth.session.name,
        expiresAt: auth.allowed?.expiresAt ?? null,
        licenseProfileId: auth.allowed?.licenseProfileId ?? null,
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
