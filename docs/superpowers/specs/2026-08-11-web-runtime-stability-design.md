# Web Runtime Stability Design

## Scope

Repair only the failures reproduced during the 2026-08-11 browser verification. Do not add product features or change the existing authorization, call, messaging, case, native face-processing, or deployment architecture.

## Approved outcome

The user approved proceeding with the previously proposed repair direction: prevent third-party page translation from mutating React-owned DOM, make logout deterministic, recreate camera media correctly after it is disabled or ends, keep incoming calls above ordinary modals, and make web-push configuration available to production web builds.

## Architecture

1. **Document ownership:** the app remains responsible for localization through its existing i18n provider. The root document opts out of browser translation before React starts, while the i18n provider continues to update the HTML language code.
2. **Session lifecycle:** one small session-storage module owns clearing the persisted code, name, and role. Both user and administrator logout paths use it and navigate with replacement so an authenticated route cannot remain in browser history.
3. **Camera lifecycle:** camera toggling uses the LiveKit participant camera API for both disable and re-enable. Re-enabling must recreate a missing or ended track rather than merely unmuting an unusable publication.
4. **Overlay priority:** urgent incoming-call UI has a higher z-index than feature/settings modals so calls always remain answerable.
5. **Web notifications:** production web builds receive the existing Convex deployment's public VAPID key. The private key remains only in Convex. Native iOS notifications continue using the native path.

## Error handling

- Camera failures keep the UI synchronized with the participant's actual state and display the existing localized error.
- Unsupported web-push environments remain explicitly unsupported; missing production configuration is treated as a build/configuration defect rather than silently reported as success.
- Logout always clears local session identity before navigation.

## Verification

- Regression tests first for translation opt-out, session clearing, camera recreation, and urgent-overlay ordering.
- Run targeted tests, then the full Vitest suite, TypeScript/Vite build, iOS build-chain verification, and Capacitor sync.
- Re-run browser flows for login/logout, group-call entry, camera toggle controls, incoming-call visibility, notification settings, and language switching with browser translation enabled.

## Non-goals

- File chooser automation blocked by the Chrome extension permission is not an application defect and will not be bypassed in source.
- Audible output cannot be proven by DOM automation; the ringtone trigger and settings can be verified, while final speaker audibility remains a device-level check.
