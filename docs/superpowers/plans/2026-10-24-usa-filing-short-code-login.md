# USA.Filing Short-Code Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the two new USA.Filing tenants to use five-letter first login on exactly two devices while preserving customer feature restrictions and every other tenant's secure default.

**Architecture:** Store a per-code privileged opt-in policy on `allowed_codes`; consume it in claim authentication and effective device-limit calculation. Enable it only through a validated, reversible internal rollout mutation for `nersp` and `bjqaf`.

**Tech Stack:** TypeScript, Convex, Vitest/convex-test.

**Spec:** `docs/superpowers/specs/2026-10-24-usa-filing-short-code-login-design.md`

## Global Constraints

- Keep `claimSecretHash` intact.
- Default behavior for every non-opted-in code stays unchanged.
- Customer codes retain the limited feature profile.
- Both Line2 and customer codes allow two devices; a third is rejected.
- Use TDD and run the full test suite before deployment.

## Review Focus

- Unknown and wrong-secret claims must not bypass authentication.
- Disabled, expired, and wrong-surface records must remain blocked.
- Rollout validation must fail closed on tenant-count or profile mismatch.
- Rollback must revoke sessions created while short-code mode was active.
- Profile edits and future tenant code creation must not silently revert the two-device policy.

---

### Task 1: Opt-in claim and device policy

**Files:**

- Modify: `convex/schema.ts`
- Modify: `convex/authCodes.ts`
- Modify: `convex/features.ts`
- Test: `convex/authCodes.test.ts`
- Test: `convex/authorizationDeviceLimits.test.ts`

- [ ] Write failing tests for opted-in Line2/customer device 1, device 2, device 3, limited permissions, wrong secret, disabled, expired, and wrong surface.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add the optional policy field and consume it only for code-only claims.
- [ ] Make the field imply an effective limit of exactly two devices.
- [ ] Run focused tests and confirm they pass.

### Task 2: Validated production rollout and rollback

**Files:**

- Modify: `convex/roleManagement.ts`
- Test: `convex/companyProvisioning.test.ts`

- [ ] Write failing tests for exact tenant validation, 61-record counts, profile restrictions, 122-record enablement, and session-revoking rollback.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement an internal mutation hardcoded to `nersp` and `bjqaf`.
- [ ] Preserve hashes, audit the mutation, and make reruns idempotent.
- [ ] Run focused tests and confirm they pass.

### Task 3: Release verification and documented security boundary

**Files:**

- Test: `convex/authCodes.test.ts`
- Test: `convex/companyProvisioning.test.ts`

- [x] Verify that an explicit wrong secret, unknown code, outside-tenant flag, disabled code, expired code, and wrong surface are rejected.
- [x] Document why the direct Convex mutation cannot provide a trustworthy failed-attempt limiter without an HTTP-edge/client migration.
- [x] Make policy disablement revoke sessions automatically and remain available after future customer-code creation.
- [ ] Run focused and full tests, typecheck, lint, formatting, and build.
- [ ] Deploy Convex, run the scoped rollout mutation, query the two tenants, and verify `JKASQ` on two fresh test-device IDs plus rejection on a third without consuming real user slots permanently.
- [ ] Push the verified commit and report exact deployment/build status.
