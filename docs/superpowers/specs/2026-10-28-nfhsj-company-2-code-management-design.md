# Shared Legacy and Company 2 Authorization-Code Management Design

## Intent

Allow administrators `NFHSJ` and `BJQAF` to manage the same authorization-code pool: existing `nyfbi` user codes plus the explicitly listed 60 Company 2 user codes. This is an authorization-code management exception, not a tenant-data merger.

## Scope

- `NFHSJ` and `BJQAF` can list and manage the 10 Company 2 full-access codes and 50 Company 2 limited-access codes already enumerated in `explicitCodeGrants.ts`.
- Management includes the existing administrator actions for a user code, including enabling/disabling, logging out registered devices, rotating activation credentials, and deleting the code.
- Both administrators can manage legacy `nyfbi` user codes.
- Neither administrator can manage the other administrator code, Company 1 administrator `NERSP`, or any Company 1 user code.
- `NFHSJ` cannot access Company 2 cases, documents, calls, recordings, transcripts, or other tenant-owned business records. `BJQAF` keeps normal access to its own Company 2 records.
- Future Company 2 codes are not delegated automatically; only the fixed 60-code allowlist is included.

## Approaches

1. **Bidirectional management grants (selected):** Extend authorization-code management checks so `NFHSJ` can manage the fixed Company 2 user cohort and `BJQAF` can manage legacy `nyfbi` user codes. This preserves business-data tenant isolation while producing one shared code-management pool.
2. **Merge NFHSJ into Company 2:** Rejected because it would remove access to its legacy `nyfbi` codes and expose all Company 2 tenant data.
3. **Grant NFHSJ global administrator access:** Rejected because it would expose unrelated companies and administrators.

## Verification

- A regression test must first fail while `NFHSJ` cannot see or manage a listed Company 2 user code.
- Tests must prove both administrators see legacy `nyfbi` user codes plus the fixed 60-code Company 2 cohort.
- Tests must prove neither can manage administrator codes, Company 1 users, or newly added Company 2 users outside the allowlist.
- Tests must prove `NFHSJ` cannot access Company 2 business records while `BJQAF` retains access to them.
- Existing tenant-isolation and cross-company communication tests must remain green.
