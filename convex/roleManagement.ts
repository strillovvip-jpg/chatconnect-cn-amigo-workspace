import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireSuperAdmin } from "./roles";

const credentialArgs = { password: v.string() };
const normalize = (value: string) => value.trim().toUpperCase();

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
    for (const record of records)
      await ctx.db.patch(record._id, {
        role: record.code === superCode ? "super_admin" : "user",
        enabled: record.enabled !== false,
        updatedAt: Date.now(),
      });
    const existing = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", superCode))
      .unique();
    if (existing)
      await ctx.db.patch(existing._id, {
        role: "super_admin",
        enabled: true,
        updatedAt: Date.now(),
      });
    else
      await ctx.db.insert("allowed_codes", {
        code: superCode,
        role: "super_admin",
        enabled: true,
        createdAt: Date.now(),
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
    for (const item of desired) {
      const existing = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", item.code))
        .unique();
      if (existing)
        await ctx.db.patch(existing._id, {
          role: item.role,
          enabled: true,
          updatedAt: Date.now(),
        });
      else
        await ctx.db.insert("allowed_codes", {
          code: item.code,
          role: item.role,
          enabled: true,
          createdAt: Date.now(),
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
    for (const code of codes) {
      const existing = await ctx.db
        .query("allowed_codes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (existing)
        await ctx.db.patch(existing._id, {
          unlimitedDevices: true,
          enabled: true,
          updatedAt: Date.now(),
        });
      else
        await ctx.db.insert("allowed_codes", {
          code,
          role: "user",
          enabled: true,
          unlimitedDevices: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      await audit(ctx, superCode, "devices.unlimited", code, {
        unlimitedDevices: true,
      });
    }
    return { unlimitedDeviceCodes: codes };
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
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
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
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    if (!/^[A-Z0-9]{4,20}$/.test(targetCode))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码格式不正确。",
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
      enabled: true,
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
  args: { ...credentialArgs, targetCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode.normalize("NFKC"));
    if (!/^[A-Z0-9]{4,20}$/.test(targetCode)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "授权码格式不正确，请输入 4 至 20 位英文字母或数字。",
      });
    }
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
      if (existing.role === "super_admin")
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "无法修改总管理员。",
        });
      await ctx.db.patch(existing._id, {
        role: "admin",
        enabled: true,
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
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, auth.code, "auth_code.create_admin", targetCode, {
      role: "admin",
    });
    return { code: targetCode, created: true };
  },
});

export const setEnabled = mutation({
  args: { ...credentialArgs, targetCode: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    if (target.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法停用总管理员。",
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

export const deleteCode = mutation({
  args: { ...credentialArgs, targetCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSuperAdmin(ctx, args.password);
    const targetCode = normalize(args.targetCode);
    const target = await ctx.db
      .query("allowed_codes")
      .withIndex("by_code", (q) => q.eq("code", targetCode))
      .unique();
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到授权码。" });
    if (target.role === "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "无法删除总管理员。",
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
