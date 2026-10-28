# NFHSJ Company 2 Authorization-Code Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit NFHSJ and BJQAF to manage the same legacy-plus-Company-2 user-code pool without merging tenant-owned business data.

**Architecture:** Add narrowly validated bidirectional authorization-code management grants in `explicitCodeGrants.ts`, then consume them only in the manageable-code list and authorization-code mutation guard in `roles.ts`. Keep all tenant-owned business-data queries on existing company scoping.

**Tech Stack:** TypeScript, Convex, Vitest

**Spec:** `docs/superpowers/specs/2026-10-28-nfhsj-company-2-code-management-design.md`

## Global Constraints

- The grants apply only to administrator codes `NFHSJ` in `nyfbi` and `BJQAF` in `bjqaf`.
- NFHSJ targets must be one of the fixed Company 2 60 user codes; BJQAF cross-tenant targets must be legacy `nyfbi` user codes.
- No cases, documents, calls, recordings, transcripts, administrators, Company 1 codes, or future Company 2 codes are delegated.

## Review Focus

- A listed code moved to another tenant must lose the grant.
- A listed code promoted to administrator must lose the grant.
- A new Company 2 code outside the fixed list must remain hidden.
- `BJQAF` itself must remain hidden and unmanageable.
- Existing Company 1/Company 2 communication grants must remain unchanged.

---

### Task 1: Lock the shared code-management pool with regression tests

**Files:**

- Modify: `convex/bjqafDelegation.test.ts`

**Interfaces:**

- Consumes: `admin.getAllowedCodes`, `roleManagement.setEnabled`, existing tenant fixtures.
- Produces: Tests defining NFHSJ's exact manageable-code cohort and isolation boundaries.

- [ ] Add tests proving both administrators see legacy nyfbi users plus the fixed 60 Company 2 user codes.
- [ ] Add negative assertions for BJQAF, Company 1 codes, and an unlisted Company 2 code.
- [ ] Add management assertions for one listed code and rejected targets.
- [ ] Run the focused test and confirm it fails for the missing grant.

### Task 2: Implement the exact management grant

**Files:**

- Modify: `convex/explicitCodeGrants.ts`
- Modify: `convex/roles.ts`

**Interfaces:**

- Produces: `administratorHasDelegatedCodeAccess(administratorCode, administratorTenantId, targetCode, targetTenantId, targetRole): boolean`.

- [ ] Implement exact NFHSJ-to-Company-2 and BJQAF-to-legacy-user validation.
- [ ] Apply it only to manageable-code listing and authorization-code mutation checks.
- [ ] Run the focused test and confirm it passes.

### Task 3: Verify and deploy

**Files:**

- No additional production files.

- [ ] Run all tests, TypeScript production build, lint, formatting, and diff checks.
- [ ] Commit and push the scoped changes without staging unrelated files.
- [ ] Deploy Convex production functions.
- [ ] Query production as NFHSJ and verify a listed Company 2 code appears while BJQAF and Company 1 codes remain absent.
