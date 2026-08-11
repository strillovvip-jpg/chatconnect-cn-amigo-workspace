# Native notification settings repair

## Scope

Repair the existing notification settings path without changing user-facing copy or adding unrelated features. Remove the floating bundle diagnostic badge while keeping app version, build number, and Git commit in the existing About section.

## Root cause

Capacitor detects `@capacitor/local-notifications` and writes `LocalNotificationsPlugin` into the generated native plugin list. Immediately afterward, `scripts/patch-ios-spm.mjs` replaces `ios/App/CapApp-SPM/Package.swift` with a custom Amigo/LiveKit-only manifest. The replacement omits the `CapacitorLocalNotifications` package and product, so JavaScript calls a plugin name whose native implementation is not linked into the iOS app.

## Design

1. Make the post-sync SPM patch preserve the official local-notifications package and product alongside Capacitor, Amigo, and LiveKit.
2. Centralize native permission enablement in a small tested helper: check current permission, request only when needed, re-check the final native status, and persist the enabled flag only after native confirmation.
3. Synchronize the displayed native setting with the real iOS permission when the provider starts or the app becomes visible.
4. When the JavaScript runtime receives an incoming call or message while hidden, schedule a native local notification with sound. Foreground ringtone/message sounds continue through the existing audio path; user gestures in the settings panel prime the audio context before later playback.
5. Keep the existing localStorage keys for ringtone enabled, message sound, volume, and custom ringtone so existing users retain their choices. Verify stored custom audio before reporting success.
6. Remove the global floating `BundleDiagnosticBadge`. Keep `appBuildInfo` usage in the About section.

## Error handling

- Missing native plugin is logged with the original Capacitor error and does not save an enabled state.
- Denied permission remains disabled and returns the existing localized permission error.
- Native scheduling failures are logged without breaking the in-app incoming-call overlay.
- Audio playback failures are logged and do not leave intervals or audio contexts running.

## Verification

- Red/green unit tests for permission transitions and SPM dependency preservation.
- Component tests for settings persistence and removal of the floating badge.
- Full `npm test`, lint, Web build, Capacitor sync, iOS asset verification, build-chain tests, and generic iOS Release build.
- Xcode Cloud Archive and a new external TestFlight build. Final hardware behavior is verified by installing that new build on the user's iPhone.

## Explicit limitation

This repair restores the currently designed Capacitor local-notification permission and sound path. Receiving calls after iOS has fully suspended or terminated the app requires a separate APNs/CallKit backend with Apple push credentials and is outside this focused repair.
