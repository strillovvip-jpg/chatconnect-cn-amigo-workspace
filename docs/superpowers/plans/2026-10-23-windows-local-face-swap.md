# USA.Filing Windows Local Face-Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-local face-swap helper that accepts a permitted target photo from `nyfbi.org`, publishes locally processed video as a virtual camera, places an ordinary LiveKit video call, and cleanly hands the active call to a mobile or web recipient.

**Architecture:** A signed .NET 8 Windows helper exposes a versioned, authenticated loopback API and owns face enrollment, camera capture, processing, and virtual-camera publication. The existing React/Convex/LiveKit application obtains a short-lived helper assertion, configures the helper, and publishes the virtual camera through the existing camera path; call transfer remains the existing server-authoritative participant replacement flow.

**Tech Stack:** React 19, TypeScript 5.9, Convex, LiveKit, .NET 8/C#, ASP.NET Core loopback HTTPS, Windows Media Foundation/C++ interop, Windows installer/signing, Vitest, convex-test, xUnit.

**Spec:** `docs/superpowers/specs/2026-10-23-windows-local-face-swap-design.md`

## Global Constraints

- First release supports Windows 10 and Windows 11 with current Chrome and Edge.
- Target photos and raw camera frames never leave the Windows computer.
- The helper listens only on loopback, accepts only allowlisted origins, and requires a per-session nonce and short-lived backend assertion.
- Only full-feature codes with `canAIFace`, `canVideoCall`, and `canVideoSource` may create helper sessions.
- The helper must never silently publish the raw physical camera after face processing fails.
- Existing OBS, ordinary-camera, iOS Amigo, LiveKit, and call-transfer paths remain operational.
- A Windows face engine may be integrated only when its commercial license, redistribution rights, and modification terms are documented in the repository's private release records.
- Do not ship a fake processor, placeholder face effect, or an unlicensed InsightFace model as the completed feature.
- The Windows helper and virtual-camera components must be code-signed for release.
- The feature is incomplete until the Windows-to-phone real-device transfer sequence in the spec passes.

## Review Focus

- A malicious website origin must not reach the helper; Task 3 tests origin denial and missing/expired handshake tokens.
- A processor crash must never expose raw video; Task 5 tests privacy-frame output and publication shutdown.
- Camera enumeration may change after helper startup; Tasks 5 and 8 test device loss, refresh, and virtual-camera reselection.
- Same-code and different-code transfers may overlap helper teardown; Task 9 tests that only the replaced Windows participant stops processing.
- Windows 10 and Windows 11 use different virtual-camera mechanisms; Task 6 tests the platform adapter boundary and installer selection.

---

### Task 1: Windows Helper Solution and Protocol Contracts

**Files:**
- Create: `windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Contracts/USAFiling.FaceSwap.Contracts.csproj`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Contracts/HelperContracts.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/USAFiling.FaceSwap.Helper.csproj`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Program.cs`
- Create: `windows/USAFiling.FaceSwap/tests/USAFiling.FaceSwap.Contracts.Tests/ContractTests.cs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `HelperStatus`, `CreateSessionRequest`, `CreateSessionResponse`, `EnrollFaceResult`, `StartProcessingRequest`, `ProcessingStatus`, `HelperError`, and `ApiVersion.Current = "1"`.
- Produces: helper build commands used by every later Windows task.

- [ ] **Step 1: Write the failing contract tests**

Assert exact JSON property names for `/v1/status`, session creation, face enrollment, processing start/stop, and deletion. Assert error codes are stable strings and raw image/frame fields never appear in status responses.

- [ ] **Step 2: Run the tests and verify RED**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln`

Expected: FAIL because the contracts project and types do not exist.

- [ ] **Step 3: Create the minimal .NET solution and contracts**

Use nullable reference types, records for wire contracts, and `System.Text.Json` source generation. `Program.cs` initially exposes `/v1/status` with `engineReady=false` and `virtualCameraReady=false` but does not claim face swapping works.

- [ ] **Step 4: Verify GREEN**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln`

Expected: all contract tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore windows/USAFiling.FaceSwap
git commit -m "feat: scaffold Windows face swap helper"
```

### Task 2: Backend Helper Session Authorization

**Files:**
- Create: `convex/helperSessions.ts`
- Create: `convex/helperSessions.test.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/_generated/api.d.ts` only through Convex code generation

**Interfaces:**
- Consumes: existing `requireSession` and license-profile feature resolution.
- Produces: `api.helperSessions.create({code, deviceId, helperNonce}) -> {assertion, expiresAt, origin}`.
- Produces: `api.helperSessions.consume({assertionId, helperNonce})` for single-use server validation if needed by deployment tooling.

- [ ] **Step 1: Write failing Convex tests**

Test full-feature approval, limited-code denial, disabled-code denial, nonce binding, five-minute expiry, single-use assertion behavior, and that no target photo or biometric field is stored.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run convex/helperSessions.test.ts --configLoader runner`

Expected: FAIL because `api.helperSessions` does not exist.

- [ ] **Step 3: Implement helper session storage and functions**

Add `helper_sessions` with hashed assertion ID, authorization code, device ID, hashed nonce, allowed origin, creation time, expiry time, and optional consumed time. Generate 256-bit random assertions; return the secret only once.

- [ ] **Step 4: Verify GREEN and regenerate bindings**

Run: `npx convex codegen && npx vitest run convex/helperSessions.test.ts --configLoader runner`

Expected: all helper-session tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/helperSessions.ts convex/helperSessions.test.ts convex/schema.ts convex/_generated
git commit -m "feat: authorize local face swap helper sessions"
```

### Task 3: Authenticated Loopback Gateway

**Files:**
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Gateway/OriginPolicy.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Gateway/SessionRegistry.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Gateway/HelperEndpoints.cs`
- Create: `windows/USAFiling.FaceSwap/tests/USAFiling.FaceSwap.Helper.Tests/GatewayTests.cs`
- Modify: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Program.cs`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 short-lived assertion payload.
- Produces: `IOriginPolicy.IsAllowed(string origin)`, `ISessionRegistry.Create`, `Validate`, and `Delete`.
- Produces: authenticated local `/v1/status` and `/v1/session` endpoints for the website client.

- [ ] **Step 1: Write failing gateway tests**

Test production origin allow, development-origin allow only in development, arbitrary-origin denial, non-loopback binding denial, missing nonce denial, mismatched nonce denial, expired assertion denial, replay denial, and successful authenticated session creation.

- [ ] **Step 2: Verify RED**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter GatewayTests`

Expected: FAIL because gateway services do not exist.

- [ ] **Step 3: Implement the loopback gateway**

Bind only to configured loopback HTTPS, require exact origin matching, validate assertion expiry and nonce, return CORS headers only for allowed origins, and keep live session secrets in memory.

- [ ] **Step 4: Verify GREEN**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter GatewayTests`

Expected: all gateway tests PASS.

- [ ] **Step 5: Commit**

```bash
git add windows/USAFiling.FaceSwap
git commit -m "feat: secure Windows helper loopback gateway"
```

### Task 4: Licensed Face Engine Adapter and Enrollment

**Files:**
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Engine/USAFiling.FaceSwap.Engine.csproj`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Engine/IFaceSwapEngine.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Engine/FaceEnrollmentService.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Engine/CommercialEngineAdapter.cs`
- Create: `windows/USAFiling.FaceSwap/tests/USAFiling.FaceSwap.Engine.Tests/EnrollmentTests.cs`
- Create: `windows/USAFiling.FaceSwap/THIRD_PARTY_PRIVATE.md.example`

**Interfaces:**
- Produces: `IFaceSwapEngine.InitializeAsync`, `EnrollAsync(ReadOnlyMemory<byte>)`, `ProcessAsync(VideoFrame)`, `ClearFaceAsync`, and `DisposeAsync`.
- Produces: `FaceEnrollmentService.EnrollAsync(Stream image, CancellationToken)` with exact-one-face validation.
- Requires: a documented, commercially licensed Windows x64 engine package supplied outside Git. The task must stop with `ENGINE_PACKAGE_MISSING` if it is absent.

- [ ] **Step 1: Verify the commercial engine prerequisite**

Record vendor, version, commercial-use permission, modification terms, redistribution terms, package checksum, and supported GPU/runtime requirements in a private release record. Do not proceed with an unclear or noncommercial model license.

- [ ] **Step 2: Write failing enrollment tests against a deterministic test double**

Test valid one-face enrollment, no-face rejection, multiple-face rejection, malformed image rejection, oversized-file rejection, clear-face behavior, and cancellation. The test double proves orchestration only and must never be compiled into Release builds.

- [ ] **Step 3: Verify RED**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter EnrollmentTests`

Expected: FAIL because engine and enrollment interfaces do not exist.

- [ ] **Step 4: Implement interfaces, enrollment service, and licensed adapter**

Set input limits to JPG/JPEG/PNG and 15 MB. Keep the enrolled representation inside the vendor adapter; do not expose reusable embeddings through the local API.

- [ ] **Step 5: Add a Release-build guard**

Make Release builds fail if the real adapter package, license record, or signed runtime dependency is missing, or if the deterministic test engine is referenced.

- [ ] **Step 6: Verify GREEN**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter EnrollmentTests && dotnet build windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln -c Release`

Expected: enrollment tests PASS and Release build succeeds only with the licensed package configured.

- [ ] **Step 7: Commit**

```bash
git add windows/USAFiling.FaceSwap
git commit -m "feat: integrate licensed Windows face engine"
```

### Task 5: Camera Capture and Privacy-Safe Processing Pipeline

**Files:**
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Processing/ICameraCapture.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Processing/ProcessingPipeline.cs`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Processing/PrivacyFrameFactory.cs`
- Create: `windows/USAFiling.FaceSwap/tests/USAFiling.FaceSwap.Helper.Tests/ProcessingPipelineTests.cs`
- Modify: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.Helper/Gateway/HelperEndpoints.cs`

**Interfaces:**
- Consumes: `IFaceSwapEngine` from Task 4.
- Produces: `ProcessingPipeline.StartAsync(cameraId)`, `StopAsync`, `Status`, and `FrameReady`.
- Produces: processed frames or an opaque privacy frame; never an unprocessed camera frame.

- [ ] **Step 1: Write failing processing tests**

Test 720p/24fps target configuration, successful processed output, engine exception privacy frame, engine timeout privacy frame, camera loss, restart, bounded frame queue, 60-minute simulated memory stability, and no raw-frame emission in every failure path.

- [ ] **Step 2: Verify RED**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter ProcessingPipelineTests`

Expected: FAIL because processing services do not exist.

- [ ] **Step 3: Implement the bounded processing loop**

Use a latest-frame queue with capacity one, cancel stale work, record only timing/error codes, and switch immediately to privacy frames when processing is unavailable.

- [ ] **Step 4: Verify GREEN**

Run: `dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln --filter ProcessingPipelineTests`

Expected: all processing tests PASS with no raw-frame assertion failures.

- [ ] **Step 5: Commit**

```bash
git add windows/USAFiling.FaceSwap
git commit -m "feat: add privacy-safe face processing pipeline"
```

### Task 6: Windows 10 and Windows 11 Virtual Camera Adapters

**Files:**
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.VirtualCamera/USAFiling.FaceSwap.VirtualCamera.vcxproj`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.VirtualCamera/IVirtualCameraPublisher.h`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.VirtualCamera/Windows11MediaFoundationCamera.cpp`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.VirtualCamera/Windows10DirectShowCamera.cpp`
- Create: `windows/USAFiling.FaceSwap/src/USAFiling.FaceSwap.VirtualCamera/VirtualCameraFactory.cpp`
- Create: `windows/USAFiling.FaceSwap/tests/USAFiling.FaceSwap.VirtualCamera.Tests/VirtualCameraContractTests.cpp`
- Modify: `windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln`

**Interfaces:**
- Consumes: processed BGRA/NV12 frames from Task 5.
- Produces: a device labeled exactly `USA.Filing Virtual Camera`.
- Produces: platform adapters selected by supported Windows build at runtime and installer registration at install time.

- [ ] **Step 1: Write failing adapter contract tests**

Test Windows 11 Media Foundation selection, Windows 10 DirectShow selection, unsupported-build failure, stable device label, frame timestamp monotonicity, stop/restart, device registration removal, and privacy-frame continuity after processor failure.

- [ ] **Step 2: Verify RED**

Run the Visual Studio test target for `USAFiling.FaceSwap.VirtualCamera.Tests`.

Expected: FAIL because publisher adapters do not exist.

- [ ] **Step 3: Implement platform adapters and factory**

Use Media Foundation virtual camera APIs where supported and the signed DirectShow source filter on Windows 10. Both adapters consume the same frame contract and expose the same label.

- [ ] **Step 4: Verify GREEN on Windows 10 and Windows 11 CI runners**

Run the virtual-camera contract suite plus Chrome and Edge device-enumeration smoke tests on both operating-system versions.

Expected: the device is listed exactly once, publishes processed/privacy frames, and unregisters cleanly.

- [ ] **Step 5: Commit**

```bash
git add windows/USAFiling.FaceSwap
git commit -m "feat: publish USA.Filing Windows virtual camera"
```

### Task 7: Web Helper Client and Face Swap Setup UI

**Files:**
- Create: `src/lib/windows-helper/contracts.ts`
- Create: `src/lib/windows-helper/client.ts`
- Create: `src/lib/windows-helper/client.test.ts`
- Create: `src/components/windows-face-swap-setup.tsx`
- Create: `src/components/windows-face-swap-setup.test.tsx`
- Modify: `src/pages/consultation/page.tsx`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 2 `api.helperSessions.create` and Task 3 local API.
- Produces: `WindowsHelperClient.detect`, `createSession`, `enrollFace`, `start`, `stop`, and `clearFace`.
- Produces: `WindowsFaceSwapSetup` with `unavailable`, `install-required`, `outdated`, `ready`, `enrolling`, `preview`, and `error` states.

- [ ] **Step 1: Write failing helper-client tests**

Test production-origin handshake, timeout, unavailable helper, unsupported version, expired assertion retry, malformed response, and that the face blob is sent only to loopback after explicit confirmation.

- [ ] **Step 2: Write failing UI tests**

Test Windows/full-feature visibility, non-Windows explanation, limited-code denial, JPG/PNG acceptance, 15 MB rejection, permission confirmation, helper download prompt, enrollment states, clear-face, and specific recovery copy.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run src/lib/windows-helper/client.test.ts src/components/windows-face-swap-setup.test.tsx --configLoader runner`

Expected: FAIL because client and component do not exist.

- [ ] **Step 4: Implement the client and setup component**

Keep the selected file in memory, revoke object URLs on replacement/unmount, never call a cloud upload URL, and contain helper errors inside the setup UI.

- [ ] **Step 5: Verify GREEN**

Run the same Vitest command.

Expected: all helper-client and setup-UI tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/windows-helper src/components/windows-face-swap-setup* src/pages/consultation/page.tsx src/lib/i18n/messages.ts
git commit -m "feat: add Windows face swap setup to web"
```

### Task 8: Pre-Call Selection and Live Call Lifecycle

**Files:**
- Modify: `src/components/pre-call-selector.tsx`
- Modify: `src/components/pre-call-selector.test.tsx`
- Modify: `src/lib/calls/camera-control.ts`
- Modify: `src/lib/calls/camera-control.test.ts`
- Modify: `src/contexts/call-context.tsx`
- Modify: `src/contexts/call-context.test.tsx`
- Create: `src/lib/windows-helper/call-session.ts`
- Create: `src/lib/windows-helper/call-session.test.ts`

**Interfaces:**
- Consumes: Task 7 helper status and existing `cameraDeviceId` call option.
- Produces: default selection of the exact `USA.Filing Virtual Camera` device when helper processing is ready.
- Produces: explicit lifecycle hooks that stop helper processing only when the Windows call publisher ends.

- [ ] **Step 1: Write failing call-flow tests**

Test automatic virtual-camera selection, user override to physical camera or OBS, missing virtual camera recovery, camera off/on retaining enrollment, ended virtual-camera track recovery, helper crash privacy behavior, and ordinary camera calls unchanged.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/components/pre-call-selector.test.tsx src/lib/calls/camera-control.test.ts src/lib/windows-helper/call-session.test.ts src/contexts/call-context.test.tsx --configLoader runner`

Expected: new Windows-helper scenarios FAIL.

- [ ] **Step 3: Implement helper-aware selection and lifecycle**

Reuse the existing LiveKit camera track and `cameraDeviceId`; do not introduce a second publishing stack. Never choose a physical camera automatically after processed-track failure.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command.

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/pre-call-selector* src/lib/calls/camera-control* src/contexts/call-context* src/lib/windows-helper
git commit -m "feat: place calls with Windows virtual camera"
```

### Task 9: Transfer-Safe Helper Teardown

**Files:**
- Modify: `src/components/call-ui.tsx`
- Create: `src/components/call-ui-transfer.test.tsx`
- Modify: `src/contexts/call-context.tsx`
- Modify: `src/contexts/call-context.test.tsx`
- Modify: `convex/callCompliance.ts`
- Modify: `convex/incomingCalls.test.ts`

**Interfaces:**
- Consumes: existing transfer mutations and Task 8 helper lifecycle.
- Produces: recipient camera-on/camera-off choice followed by confirmed participant replacement and source-side helper stop.

- [ ] **Step 1: Write failing transfer lifecycle tests**

Cover different-code phone transfer, different-code web transfer with camera selection, same-code other-device transfer, recipient camera-off, recipient camera-on, transfer rejection, expiry, join failure rollback, compliance query during `joining`, and helper stop only after source replacement completes.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run convex/incomingCalls.test.ts src/components/call-ui-transfer.test.tsx src/contexts/call-context.test.tsx --configLoader runner`

Expected: new helper teardown and end-to-end transfer assertions FAIL.

- [ ] **Step 3: Implement transfer lifecycle coordination**

Keep the current server-authoritative order: authorize recipient, join media, confirm participant replacement, then disconnect original publisher and stop its helper session. Preserve the original caller on rejection, expiry, or recipient join failure.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command.

Expected: all transfer tests PASS without an application-level error boundary.

- [ ] **Step 5: Commit**

```bash
git add src/components/call-ui.tsx src/components/call-ui-transfer.test.tsx src/contexts/call-context* convex/callCompliance.ts convex/incomingCalls.test.ts
git commit -m "feat: preserve Windows face swap across call transfer"
```

### Task 10: Installer, Signing, Diagnostics, and Release Verification

**Files:**
- Create: `windows/USAFiling.FaceSwap/installer/USAFiling.FaceSwap.Installer.wixproj`
- Create: `windows/USAFiling.FaceSwap/installer/Product.wxs`
- Create: `windows/USAFiling.FaceSwap/scripts/build-release.ps1`
- Create: `windows/USAFiling.FaceSwap/scripts/verify-release.ps1`
- Create: `windows/USAFiling.FaceSwap/README.md`
- Create: `scripts/windows-helper-release-contract.test.mjs`
- Modify: `package.json`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: all prior Windows and web tasks.
- Produces: signed MSI installer, signed helper binaries, signed virtual-camera component, checksums, version manifest, and verified website download metadata.

- [ ] **Step 1: Write failing release-contract tests**

Test Windows 10/11 installer entries, Chrome/Edge visibility instructions, signed binary verification, production-origin allowlist, helper/version manifest match, no private engine package in Git, no raw-frame logging, and download checksum rendering.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/windows-helper-release-contract.test.mjs`

Expected: FAIL because release artifacts and scripts do not exist.

- [ ] **Step 3: Implement installer and release scripts**

Install the helper, TLS/loopback prerequisites, correct virtual-camera adapter, Start menu entry, and clean uninstaller. Refuse Release packaging without valid code-signing inputs and the licensed engine guard from Task 4.

- [ ] **Step 4: Run complete automated verification**

Run:

```bash
npm test
npm run build
npm run test:build-chain
dotnet test windows/USAFiling.FaceSwap/USAFiling.FaceSwap.sln -c Release
node --test scripts/windows-helper-release-contract.test.mjs
pwsh windows/USAFiling.FaceSwap/scripts/verify-release.ps1
```

Expected: zero failed tests, production web build succeeds, Windows Release build succeeds, signatures validate, and installer smoke tests pass on Windows 10 and Windows 11.

- [ ] **Step 5: Perform required real-device acceptance**

Execute all 12 acceptance steps from the spec with a Windows computer, one remote peer, and a phone/web transfer recipient. Capture version numbers, helper diagnostics, camera enumeration, call IDs, transfer IDs, frame-rate/latency measurements, memory measurements, and screenshots without storing face photos or raw frames.

- [ ] **Step 6: Deploy in pilot mode**

Deploy Convex and `nyfbi.org`, publish the signed helper behind the backend feature flag, verify online asset checksums, then enable only the designated pilot authorization codes.

- [ ] **Step 7: Commit release metadata**

```bash
git add windows/USAFiling.FaceSwap scripts/windows-helper-release-contract.test.mjs package.json src/lib/i18n/messages.ts
git commit -m "release: package Windows local face swap helper"
```

## External Prerequisites and Stop Conditions

Implementation may begin with Tasks 1–3 while release prerequisites are collected. Task 4 and all real face-processing acceptance are blocked until these are available:

- A commercially licensed Windows x64 face-swap SDK/runtime and model package with redistribution rights.
- Vendor documentation for enrollment, frame processing, GPU/runtime support, and thread safety.
- A Windows code-signing certificate suitable for the helper, installer, and virtual-camera component.
- Windows 10 and Windows 11 test machines with supported GPUs.
- Two full-feature authorization codes and a phone/web recipient for transfer acceptance.

If any prerequisite is missing, report the exact missing item. Do not substitute a fake processor, unlicensed model, unsigned release binary, or HTML-only preview and call the feature complete.
