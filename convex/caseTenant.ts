import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  getAdminCompanyScope,
  tenantIdForAllowed,
  type SystemRole,
} from "./roles";

type AdminAuth = {
  role: SystemRole;
  allowed?: { companyId?: string } | null;
};

type CaseTenantRecord = Pick<Doc<"cases">, "tenantId">;

function normalizedTenantId(tenantId: string | undefined) {
  return tenantId?.trim().toLowerCase() || null;
}

export function tenantIdForNewCase(auth: AdminAuth) {
  return tenantIdForAllowed(auth.allowed);
}

export function caseBelongsToTenant(
  record: CaseTenantRecord,
  tenantId: string,
) {
  return normalizedTenantId(record.tenantId) === tenantId;
}

export function adminCanAccessCase(auth: AdminAuth, record: CaseTenantRecord) {
  const scope = getAdminCompanyScope(auth);
  return scope === null || caseBelongsToTenant(record, scope);
}

export function assertAdminCanAccessCase(
  auth: AdminAuth,
  record: CaseTenantRecord,
) {
  if (!adminCanAccessCase(auth, record))
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限执行此操作。",
    });
}
