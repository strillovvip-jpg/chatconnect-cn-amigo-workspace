# USA.Filing Short-Code Login Design

## Intent

For the two newly provisioned USA.Filing companies (`nersp` and `bjqaf`), make the five-letter authorization code sufficient for first login on up to two devices. Keep the existing feature distinction: Line2 codes retain the full profile, while customer codes keep the limited profile without screen sharing, call transfer, or video switching.

## Scope

- Opt in only the 122 authorization records owned by `nersp` and `bjqaf`.
- Administrator, Line2, and customer codes in those tenants receive two device slots.
- A third distinct device is rejected.
- Disabled, expired, wrong-surface, retired, and unknown codes remain rejected.
- Existing tenants remain on the high-entropy `CODE.secret` first-claim behavior.
- Keep every `claimSecretHash` so the policy can be rolled back without reprovisioning credentials.

## Approach

Add one optional privileged policy field to `allowed_codes`. When enabled, the record accepts a five-letter code-only claim and has an effective device limit of two; when absent, all current secure defaults remain unchanged. A dedicated internal rollout mutation validates the exact tenant shape and feature profiles before enabling the policy, and can clear the field plus revoke sessions for rollback.

This tenant-scoped opt-in was selected over globally weakening authentication or deleting activation hashes because it contains the requested convenience change and preserves a safe rollback path.

## Security Tradeoff

Five uppercase letters provide only about 23.5 bits of entropy. A Convex public mutation cannot obtain a trustworthy client IP, client-provided device IDs can be forged, and writes made before a thrown login error roll back. Therefore this direct-mutation release cannot honestly claim a reliable failed-attempt limiter.

The requested five-letter-only flow is contained to the two named tenants, retains every high-entropy claim hash for rollback, enforces two device slots, rejects an explicit wrong secret, and automatically revokes all sessions when the policy is disabled. A true per-IP limiter remains a separate HTTP-edge/client migration rather than a misleading counter inside `claimCode`.

## Acceptance

- `JKASQ` succeeds on new devices one and two without a suffix.
- `JKASQ` fails on device three.
- A customer code behaves identically for device count while its limited feature flags remain disabled.
- A non-opted-in code still requires `CODE.secret`.
- `CODE.wrong` fails even for an opted-in code.
- Initial rollout touches exactly 122 records: 61 per tenant.
- Future customer codes created by either company administrator inherit the same two-device policy.
- Rollback remains available after future code creation and always revokes affected sessions.
