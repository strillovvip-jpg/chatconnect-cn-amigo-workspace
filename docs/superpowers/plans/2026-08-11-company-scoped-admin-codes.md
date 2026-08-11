# Company-Scoped Admin Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict company admins like RAVE1 to viewing and operating only on their company's authorization codes while RAVE remains global super admin.

**Architecture:** Add an optional `companyId` field to `allowed_codes`, derive admin visibility scope from the authenticated admin's own allowed-code record, and apply that scope server-side in admin queries and sensitive admin mutations. Company scoping is enforced in backend queries rather than hidden in the frontend.

**Tech Stack:** Convex, TypeScript, Vitest, convex-test

## Global Constraints

- Do not modify Amigo SDK, LiveKit, SwiftPM, signing, or iOS app behavior.
- Keep super admin (`RAVE`) global.
- Company admins (`RAVE1`, `RAVE2`, ...) keep existing admin functions but only within their visible company scope.
- Implement tests before production code changes.

---

### Task 1: Add failing backend tests for company-scoped admin visibility

**Files:**
- Modify: `convex/security.test.ts`
- Test: `convex/security.test.ts`

**Interfaces:**
- Consumes: `api.admin.getAllowedCodes`, `api.admin.getAllCodes`, `api.admin.getStats`
- Produces: regression coverage proving company admin scope

- [ ] Step 1: Add tests that assert RAVE1 only sees company-1 codes and RAVE still sees all.
- [ ] Step 2: Run the targeted test file and verify failure.
- [ ] Step 3: Implement minimal backend support.
- [ ] Step 4: Re-run the targeted test file until green.

### Task 2: Enforce company scope in backend admin queries/mutations

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/admin.ts`
- Modify: `convex/roleManagement.ts`
- Modify: `convex/roles.ts` (only if needed for shared helpers)

**Interfaces:**
- Produces: `companyId` data model, scope helper, filtered admin queries, scoped reset protections

- [ ] Step 1: Add `companyId` field to `allowed_codes`.
- [ ] Step 2: Add helper(s) to derive visible company scope from authenticated admin record.
- [ ] Step 3: Filter admin code/user/stats queries by scope.
- [ ] Step 4: Block company admins from resetting codes outside their scope.

### Task 3: Verify locally

**Files:**
- Modify: none required

**Interfaces:**
- Produces: fresh evidence for test/build claims

- [ ] Step 1: Run targeted backend tests.
- [ ] Step 2: Run full relevant test/build commands.
- [ ] Step 3: Only then report status.
