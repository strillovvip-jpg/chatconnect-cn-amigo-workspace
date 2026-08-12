# Split Face Enrollment and Call Flow Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require successful native face enrollment before the user can open the face-swap call creation flow.

**Architecture:** Move photo selection, upload, and native `enrollFace` into an independent `FaceSettingsModal`. Keep `FaceSwapInviteModal` responsible only for checking retained native readiness, creating an invite, connecting the processed native video track, and sharing or ending the call. The consultation page owns the shared `faceReady` state and renders separate settings and call buttons.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Capacitor, native iOS bridge, Convex.

## Global Constraints

- Do not change native enrollment, video publishing, LiveKit, signing, or backend authorization behavior.
- Only full-feature authorization codes can see either entry point.
- The call modal must never contain a photo file input or enrollment action.
- The call entry must remain disabled until native status confirms a retained FaceLatent.

---

### Task 1: Lock the split flow with component tests

**Files:**
- Create: `src/components/face-settings-modal.test.tsx`
- Modify: `src/components/face-swap-invite-modal.test.tsx`

- [ ] Write failing tests proving photo enrollment exists only in face settings.
- [ ] Write failing tests proving call creation is disabled without `faceReady`.
- [ ] Run the focused tests and confirm they fail for the current combined modal.

### Task 2: Split face settings from call creation

**Files:**
- Create: `src/components/face-settings-modal.tsx`
- Modify: `src/components/face-swap-invite-modal.tsx`
- Modify: `src/pages/consultation/page.tsx`
- Modify: `src/lib/i18n/messages.ts`

- [ ] Move photo validation, server persistence, and awaited native enrollment to `FaceSettingsModal`.
- [ ] Update consultation page to own readiness and show separate settings/call controls.
- [ ] Remove every upload/enrollment state and element from the call modal.
- [ ] Run focused tests and confirm they pass.

### Task 3: Verify the full build chain before publishing

**Files:**
- Modify only generated/synced iOS web assets through the existing build command.

- [ ] Run the full Vitest suite.
- [ ] Run `npm run build:ios` and the build-chain verification.
- [ ] Run an unsigned iOS simulator/device compile that exercises SwiftPM and the native plugin.
- [ ] Review the diff and scan for secrets.
- [ ] Commit and push only after all prior checks pass.
