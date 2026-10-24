# Transfer Recording Drain Follow-ups

## Goal

Close three loss/fail-closed gaps in recording-aware call transfer without weakening consent or device authorization.

## Plan

1. Add client regressions for a transfer requested before its recording controller registers, bounded retry of a failed final upload across rollback, and reconciliation after a lost successful response.
2. Add backend regressions proving a cross-code transfer admits only the remaining peer's already-open old-epoch segment, on its exact device and transfer, during a short deadline; prove new segments, the replaced source, expiry, stop/reset, and revocation stay denied.
3. Register a transfer-suspended fallback controller, retain stopped blobs in a room-scoped retry queue, retry boundedly, and reconcile ambiguous responses through a narrow authenticated segment-status query.
4. Mark eligible peer segments atomically during cross-code completion and centralize the exact grace predicate in recording upload authorization.
5. Run focused tests after each red/green cycle, then the full test suite, type/build, lint, formatting, and diff checks.
