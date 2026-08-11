# Web Runtime Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verified web controls deterministic by removing browser-translation DOM mutation, fixing session logout, camera re-enable, incoming-call overlay priority, and web-push configuration.

**Architecture:** Preserve the existing React, Convex, LiveKit, Capacitor, and i18n architecture. Add only focused helpers around document configuration, session storage, media toggling, and overlay class names, then configure the existing web-push pipeline with the deployment's public VAPID key.

**Tech Stack:** React 19, TypeScript, Vitest, LiveKit Client, Convex, Vite, Capacitor.

## Global Constraints

- Do not change authorization semantics, native face-processing, SwiftPM, signing, or the Convex data model.
- Do not commit private VAPID material or any other secret.
- Keep the existing five-locale in-app i18n as the only translation mechanism.
- Every production change must be preceded by a failing regression test.

---

### Task 1: Prevent browser translation from mutating React DOM

**Files:**
- Modify: `index.html`
- Modify: `src/lib/i18n/context.tsx`
- Create: `src/lib/i18n/document.test.ts`

**Interfaces:**
- Consumes: resolved `AppLocale` from the existing i18n provider.
- Produces: `applyDocumentLocale(locale: AppLocale): void`, which sets the HTML language and translation opt-out attributes.

- [ ] Write a test that reads `index.html` and expects `translate="no"` plus `notranslate` before React startup.
- [ ] Write a test that expects `applyDocumentLocale("en")` to preserve translation opt-out while setting `document.documentElement.lang` to `en`.
- [ ] Run `npm test -- src/lib/i18n/document.test.ts` and confirm both assertions fail for the missing behavior.
- [ ] Implement `applyDocumentLocale` and call it from `I18nProvider`; add the same opt-out to the static HTML shell.
- [ ] Re-run the targeted test and confirm it passes.

### Task 2: Make logout clear the complete persisted session

**Files:**
- Create: `src/lib/session-storage.ts`
- Create: `src/lib/session-storage.test.ts`
- Modify: `src/pages/consultation/index.tsx`
- Modify: `src/pages/admin/page.tsx`

**Interfaces:**
- Produces: `clearPersistedSession(storage: Pick<Storage, "removeItem">): void`.
- Removes exactly `ksc_session_code`, `ksc_session_name`, and `ksc_session_role`; device identity and language preference remain intact.

- [ ] Write a test with real `localStorage` values proving all three session values are removed and the device id remains.
- [ ] Run the targeted test and confirm it fails because the helper does not exist.
- [ ] Implement the helper and replace both logout handlers; use route replacement for the user path and `location.replace` for the admin path.
- [ ] Re-run the targeted test and existing route tests.

### Task 3: Recreate the camera track when it is re-enabled

**Files:**
- Create: `src/lib/calls/camera-control.ts`
- Create: `src/lib/calls/camera-control.test.ts`
- Modify: `src/contexts/call-context.tsx`

**Interfaces:**
- Produces: `setParticipantCameraEnabled(participant, enabled): Promise<void>` using the existing 1280×720, 24 fps, user-facing capture defaults.
- The helper must call the participant camera API for both disable and re-enable and verify that an enabled camera has a live published track.

- [ ] Write tests proving disable calls `setCameraEnabled(false)` and re-enable calls `setCameraEnabled(true, captureOptions)` even when the previous publication exists but is ended.
- [ ] Run the targeted test and confirm failure.
- [ ] Implement the helper and use it from `toggleCam` and media restoration.
- [ ] Re-run the targeted tests and existing call tests.

### Task 4: Keep incoming calls above ordinary modals

**Files:**
- Create: `src/lib/ui/overlay-layers.ts`
- Create: `src/lib/ui/overlay-layers.test.ts`
- Modify: `src/contexts/notification-context.tsx`
- Modify: `src/components/face-swap-invite-modal.tsx`

**Interfaces:**
- Produces: exported class constants for `featureModal` and `urgentIncomingCall` with urgent strictly higher than feature modal.

- [ ] Write a test that parses both z-index class values and expects incoming calls to be higher.
- [ ] Run the test and confirm failure before implementation.
- [ ] Implement the layer constants and use them in both components.
- [ ] Re-run the overlay test.

### Task 5: Complete production web-push configuration

**Files:**
- Create: `.env.production`
- Modify: `.env.example` if present, otherwise create it.
- Create: `src/lib/notifications/vapid-config.test.ts`

**Interfaces:**
- Consumes: public `VAPID_PUBLIC_KEY` from the existing `adorable-parakeet-350` Convex deployment.
- Produces: Vite's `VITE_VAPID_PUBLIC_KEY`; private VAPID key remains in Convex only.

- [ ] Write a test that loads `.env.production`, requires a non-placeholder URL-safe base64 public key, and rejects any private-key variable.
- [ ] Run the test and confirm failure because the production file is absent.
- [ ] Retrieve only the deployment public key and place it in `.env.production`; document the variable name in `.env.example`.
- [ ] Re-run the test and build to confirm Vite includes the public configuration.

### Task 6: Full verification and browser regression

**Files:**
- No production files unless a reproduced failure identifies an additional root cause.

- [ ] Run all targeted regression tests.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run lint` and record any pre-existing versus new findings.
- [ ] Run `npm run build:ios` and `npm run test:build-chain`.
- [ ] Run the generic iOS Release build without signing.
- [ ] Start three clean preview origins and verify admin login/logout, user login, group-call button stability, camera off/on control state, incoming-call overlay priority, notification configuration, and language switching.
- [ ] Report only observed passes and remaining device/browser limitations.
