# Native Notification Settings Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the linked iOS notification permission and sound path, verify persisted ringtone settings, and remove the floating bundle badge while preserving About build information.

**Architecture:** Keep the existing React notification provider and Capacitor local-notifications package, but place native permission/scheduling behavior behind a small typed helper. Make the post-Capacitor SPM patch preserve the official native plugin, and keep all existing preference keys as the single persisted settings source. The iOS build remains repo source → Vite build → Capacitor sync → Xcode/Xcode Cloud.

**Tech Stack:** React 19, TypeScript, Vitest, Capacitor 8, `@capacitor/local-notifications`, Swift Package Manager, Xcode Cloud/TestFlight.

## Global Constraints

- Do not change notification UI copy or add unrelated features.
- Remove the floating purple bundle badge; keep Version, Build Number, and Git Commit in About.
- Preserve the existing Amigo, LiveKit, SwiftPM, signing, login, and call behavior.
- Never persist notification-enabled state unless iOS reports permission as granted.
- TestFlight hardware validation must use a new build number and the exact pushed commit.

---

### Task 1: Lock the native package and badge regressions

**Files:**
- Modify: `scripts/verify-ios-build-chain.test.mjs`
- Modify: `scripts/patch-ios-spm.mjs`
- Modify: `ios/App/CapApp-SPM/Package.swift`
- Modify: `src/App.tsx`
- Modify: `ci_scripts/ci_post_clone.sh`

**Interfaces:**
- Consumes: Capacitor-generated `Package.swift` and the existing `appBuildInfo` About data.
- Produces: An iOS target linked to `CapacitorLocalNotifications` and an app with no global `BundleDiagnosticBadge`.

- [x] **Step 1: Write failing build-chain assertions**

Add assertions that both the patch script and final package manifest contain the local-notifications package/product, that `src/App.tsx` contains no `BundleDiagnosticBadge` or `BUNDLE ` label, and that cloud builds default the diagnostic flag to `0`.

- [x] **Step 2: Run the build-chain test and confirm failure**

Run: `npm run test:build-chain`

Expected: failures identify the missing Swift product, floating badge, and diagnostic default.

- [x] **Step 3: Preserve the plugin and remove the badge**

Add `.package(name: "CapacitorLocalNotifications", path: "../../../node_modules/@capacitor/local-notifications")` and `.product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications")` to the generated manifest template. Remove the badge component/import/render and set `VITE_BUNDLE_DIAGNOSTIC` default to `0`.

- [x] **Step 4: Run the build-chain test and confirm pass**

Run: `npm run test:build-chain`

Expected: all build-chain tests pass.

### Task 2: Make native permission state truthful and testable

**Files:**
- Create: `src/lib/notifications/native-notifications.ts`
- Create: `src/lib/notifications/native-notifications.test.ts`
- Modify: `src/contexts/notification-context.tsx`

**Interfaces:**
- Produces: `ensureNativeNotificationPermission(plugin): Promise<"granted" | "denied">`, `readNativeNotificationPermission(plugin)`, and `scheduleNativeAlert(plugin, alert)`.
- Consumes: Capacitor plugin methods `checkPermissions`, `requestPermissions`, and `schedule`.

- [x] **Step 1: Write failing permission transition tests**

Cover already-granted, prompt-then-granted, denied, and request-result/recheck mismatch. Add a scheduling test that asserts `sound: "default"` reaches the native plugin.

- [x] **Step 2: Run the focused test and confirm module-not-found failure**

Run: `npx vitest run src/lib/notifications/native-notifications.test.ts --configLoader runner`

Expected: the new helper import cannot yet resolve.

- [x] **Step 3: Implement the helper and integrate the provider**

Implement the typed helper, replace direct `requestPermissions()` use, log the original error, synchronize OS denial when the provider becomes visible, and schedule one native sound notification for each newly observed hidden incoming call/message.

- [x] **Step 4: Run focused tests and confirm pass**

Run: `npx vitest run src/lib/notifications/native-notifications.test.ts --configLoader runner`

Expected: all permission and schedule cases pass.

### Task 3: Harden ringtone playback and custom file persistence

**Files:**
- Create: `src/lib/notifications/ringtone.ts`
- Create: `src/lib/notifications/ringtone.test.ts`
- Modify: `src/contexts/notification-context.tsx`

**Interfaces:**
- Produces: `startRingtone(volume, customSource)`, `primeRingtoneAudio()`, and `validateRingtoneSource(source)`.
- Consumes: the existing five localStorage keys without migration.

- [x] **Step 1: Write failing audio tests**

Test volume clamping, custom-audio play/pause cleanup, default ringtone cleanup, and validation rejection when the audio element emits `error`.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run src/lib/notifications/ringtone.test.ts --configLoader runner`

Expected: the ringtone module does not yet exist.

- [x] **Step 3: Implement and integrate audio behavior**

Move playback out of the provider, reuse/prime the audio context from settings interactions, log autoplay failures, and validate custom data before writing localStorage or showing the existing saved toast.

- [x] **Step 4: Run focused tests and confirm pass**

Run: `npx vitest run src/lib/notifications/ringtone.test.ts --configLoader runner`

Expected: all audio tests pass.

### Task 4: Verify, publish, and identify the installable build

**Files:**
- Modify only if validation reveals a defect in files already listed above.

**Interfaces:**
- Produces: pushed commit SHA and a new Xcode Cloud/TestFlight build number.

- [x] **Step 1: Run repository validation**

Run: `npm test`, `npm run lint`, `npm run build:ios`, and `npm run test:build-chain`.

Expected: all commands exit zero; generated iOS assets match the current source and the package manifest still links local notifications.

- [x] **Step 2: Run an unsigned generic iOS Release build**

Run Xcode 16.4 `xcodebuild` for scheme `App`, configuration `Release`, destination `generic/platform=iOS`, with `CODE_SIGNING_ALLOWED=NO`.

Expected: `BUILD SUCCEEDED` and `CapacitorLocalNotifications` resolves/links.

- [ ] **Step 3: Commit and push the scoped repair**

Commit only the plan, tests, native package, notification helper/provider, ringtone helper, App badge removal, and CI diagnostic change. Push without force and merge through the project repository’s normal branch workflow.

- [ ] **Step 4: Monitor Xcode Cloud and TestFlight**

Wait for Archive success, confirm App Store Connect processing/compliance, add the new build to the existing external testing group if necessary, and report the exact build number and commit SHA.

- [ ] **Step 5: Hardware acceptance**

Install the new TestFlight build and verify OS permission enable/deny, incoming-call ringtone, message tone, volume, custom ringtone preview/use, no floating purple badge, and unchanged About values. A fully suspended/terminated incoming call remains dependent on a future APNs/CallKit delivery path.
