import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type SystemRole = "super_admin" | "admin" | "user";
type DbCtx = QueryCtx | MutationCtx;
type AllowedCodeRecord = {
  code: string;
  role: SystemRole;
  companyId?: string;
  enabled?: boolean;
  licenseProfileId?: Id<"license_profiles">;
  expiresAt?: number;
};

export async function requireSession(
  ctx: DbCtx,
  code: string,
  deviceId: string,
) {
  const normalized = code.trim().toUpperCase();
  const session = await ctx.db
    .query("auth_codes")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  const allowed = await ctx.db
    .query("allowed_codes")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  const validDevice =
    session &&
    (allowed?.unlimitedDevices === true ||
      session.deviceId === deviceId ||
      session.mobileDeviceId === deviceId ||
      session.mobileAppDeviceId === deviceId ||
      session.desktopDeviceId === deviceId);
  if (!session || !validDevice) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "需要有效的登录会话。",
    });
  }
  if (allowed?.enabled === false)
    throw new ConvexError({ code: "FORBIDDEN", message: "此授权码已停用。" });
  if (allowed?.expiresAt && allowed.expiresAt <= Date.now())
    throw new ConvexError({ code: "FORBIDDEN", message: "此授权码已过期。" });
  return {
    code: normalized,
    role: (allowed?.role ?? "user") as SystemRole,
    session,
    allowed,
  };
}

export async function requireAdmin(ctx: DbCtx, credential: string) {
  const separator = credential.indexOf(":");
  if (separator < 1)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
  const auth = await requireSession(
    ctx,
    credential.slice(0, separator),
    credential.slice(separator + 1),
  );
  if (auth.role !== "admin" && auth.role !== "super_admin")
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
  return auth;
}

export async function requireSuperAdmin(ctx: DbCtx, credential: string) {
  const separator = credential.indexOf(":");
  if (separator < 1)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
  const auth = await requireSession(
    ctx,
    credential.slice(0, separator),
    credential.slice(separator + 1),
  );
  if (auth.role !== "super_admin")
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "只有总管理员可以执行此操作。",
    });
  return auth;
}

export function getAdminCompanyScope(auth: {
  role: SystemRole;
  allowed?: { companyId?: string } | null;
}) {
  return auth.role === "admin" ? auth.allowed?.companyId ?? null : null;
}

export async function listVisibleAllowedCodes(
  ctx: DbCtx,
  auth: { role: SystemRole; allowed?: { companyId?: string } | null },
) {
  const records = (await ctx.db.query("allowed_codes").collect()) as Array<
    AllowedCodeRecord
  >;
  const companyId = getAdminCompanyScope(auth);
  if (!companyId) return records;
  return records.filter((record) => record.companyId === companyId);
}

export async function assertAdminCanAccessCode(
  ctx: DbCtx,
  auth: { role: SystemRole; allowed?: { companyId?: string } | null },
  code: string,
) {
  const companyId = getAdminCompanyScope(auth);
  if (!companyId) return;
  const target = (await ctx.db
    .query("allowed_codes")
    .withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase()))
    .unique()) as AllowedCodeRecord | null;
  if (!target || target.companyId !== companyId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
}
