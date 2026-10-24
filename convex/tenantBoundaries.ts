import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertSameTenant,
  isActiveAuthorizationTarget,
  tenantIdForAllowed,
} from "./roles";
import {
  explicitCodeHasExpectedTenantAndRole,
  isExplicitCommunicationPair,
} from "./explicitCodeGrants";

type DbCtx = QueryCtx | MutationCtx;
type TenantRecord = { companyId?: string } | null | undefined;

export async function allowedForCode(ctx: DbCtx, code: string) {
  return await ctx.db
    .query("allowed_codes")
    .withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase()))
    .unique();
}

export async function assertCodeInTenant(
  ctx: DbCtx,
  code: string,
  tenantId: string,
) {
  const allowed = await allowedForCode(ctx, code);
  assertSameTenant({ companyId: tenantId }, allowed);
  return allowed;
}

export async function codeIsInTenant(
  ctx: DbCtx,
  code: string,
  tenantId: string,
) {
  const allowed = await allowedForCode(ctx, code);
  return tenantIdForAllowed(allowed) === tenantId;
}

export async function canCodesCommunicate(
  ctx: DbCtx,
  firstCode: string,
  secondCode: string,
) {
  const first = await allowedForCode(ctx, firstCode);
  const second = await allowedForCode(ctx, secondCode);
  if (
    !first ||
    !second ||
    !isActiveAuthorizationTarget(first) ||
    !isActiveAuthorizationTarget(second)
  )
    return false;
  if (tenantIdForAllowed(first) === tenantIdForAllowed(second)) return true;
  return (
    explicitCodeHasExpectedTenantAndRole(
      firstCode,
      tenantIdForAllowed(first),
      first.role,
    ) &&
    explicitCodeHasExpectedTenantAndRole(
      secondCode,
      tenantIdForAllowed(second),
      second.role,
    ) &&
    isExplicitCommunicationPair(firstCode, secondCode)
  );
}

export async function assertCodesCanCommunicate(
  ctx: DbCtx,
  firstCode: string,
  secondCode: string,
) {
  if (await canCodesCommunicate(ctx, firstCode, secondCode)) return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "无法访问其他授权群组的用户。",
  });
}

export async function tenantIdForGroup(
  ctx: DbCtx,
  group: Pick<Doc<"chat_groups">, "tenantId" | "ownerUserId">,
) {
  if (group.tenantId?.trim())
    return tenantIdForAllowed({ companyId: group.tenantId });
  return tenantIdForAllowed(await allowedForCode(ctx, group.ownerUserId));
}

export async function tenantIdForLegacyOwner(ctx: DbCtx, ownerCode: string) {
  return tenantIdForAllowed(await allowedForCode(ctx, ownerCode));
}

export async function requireGroupTenant(
  ctx: DbCtx,
  groupId: Id<"chat_groups">,
  requesterAllowed: TenantRecord,
) {
  const group = await ctx.db.get(groupId);
  if (!group)
    throw new ConvexError({ code: "NOT_FOUND", message: "找不到群组。" });
  const tenantId = await tenantIdForGroup(ctx, group);
  assertSameTenant({ companyId: tenantId }, requesterAllowed);
  return { group, tenantId };
}
