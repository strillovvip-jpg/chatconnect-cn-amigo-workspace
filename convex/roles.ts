import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type SystemRole = "super_admin" | "admin" | "user";
export type AuthSurface = "app" | "aichijp" | "nyfbi";
export const DEFAULT_TENANT_ID = "nyfbi";
export const AICHIJP_TENANT_ID = "aichijp";
type DbCtx = QueryCtx | MutationCtx;
type AllowedCodeRecord = {
  _id: Id<"allowed_codes">;
  code: string;
  role: SystemRole;
  companyId?: string;
  enabled?: boolean;
  licenseProfileId?: Id<"license_profiles">;
  expiresAt?: number;
};

export function tenantIdForAllowed(allowed?: { companyId?: string } | null) {
  return allowed?.companyId?.trim().toLowerCase() || DEFAULT_TENANT_ID;
}

export function assertSurfaceAccess(
  allowed: { companyId?: string } | null | undefined,
  surface: AuthSurface | undefined,
) {
  if (!surface || surface === "app") return;
  if (tenantIdForAllowed(allowed) !== surface)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "此授权码不能使用这个网站。",
    });
}

export function assertSameTenant(
  first?: { companyId?: string } | null,
  second?: { companyId?: string } | null,
) {
  if (tenantIdForAllowed(first) !== tenantIdForAllowed(second))
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "无法访问其他授权群组的用户。",
    });
}

export function assertAuthorizationSetCanExpand(auth: {
  allowed?: { companyId?: string } | null;
}) {
  if (tenantIdForAllowed(auth.allowed) === AICHIJP_TENANT_ID)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "此授权群组使用固定授权码清单，不能新增或变更角色。",
    });
}

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
      session.deviceIds?.includes(deviceId) ||
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
  code?: string;
  role: SystemRole;
  allowed?: { companyId?: string } | null;
}) {
  if (auth.role !== "admin" && auth.role !== "super_admin") return null;
  return auth.allowed?.companyId?.trim()
    ? tenantIdForAllowed(auth.allowed)
    : null;
}

export async function listVisibleAllowedCodes(
  ctx: DbCtx,
  auth: {
    code?: string;
    role: SystemRole;
    allowed?: { companyId?: string } | null;
  },
) {
  const records = (await ctx.db
    .query("allowed_codes")
    .collect()) as Array<AllowedCodeRecord>;
  const companyId = getAdminCompanyScope(auth);
  if (!companyId) return records;
  return records.filter((record) => tenantIdForAllowed(record) === companyId);
}

export async function assertAdminCanAccessCode(
  ctx: DbCtx,
  auth: {
    code?: string;
    role: SystemRole;
    allowed?: { companyId?: string } | null;
  },
  code: string,
) {
  const companyId = getAdminCompanyScope(auth);
  if (!companyId) return;
  const target = (await ctx.db
    .query("allowed_codes")
    .withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase()))
    .unique()) as AllowedCodeRecord | null;
  if (!target || tenantIdForAllowed(target) !== companyId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
}
