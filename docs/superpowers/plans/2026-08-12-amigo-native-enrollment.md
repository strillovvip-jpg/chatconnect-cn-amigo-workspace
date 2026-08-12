# Amigo Native Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the initialize/enroll deadlock and prevent first-run SDK work from being cut off by the upload deadline.

**Architecture:** Keep the existing backend, bridge, and room implementation. Change only native async orchestration and the enrollment timeout boundary, preserving typed SDK errors and the stored `FaceLatent` state.

**Tech Stack:** Swift, Capacitor, React, TypeScript, Vitest, Node test runner, Xcode Cloud.

## Global Constraints

- Use the official Amigo iOS SDK methods directly.
- Do not change login, messaging, permissions, invitation, or room behavior.
- Do not expose API keys or secrets.
- Call creation remains disabled until a native `FaceLatent` exists.

---

### Task 1: Lock the native async contract

**Files:**
- Modify: `scripts/verify-ios-build-chain.test.mjs`
- Modify: `ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift`

- [x] Add a failing source regression asserting initialize/enroll do not use `DispatchSemaphore`.
- [x] Run the build-chain test and confirm failure.
- [x] Replace blocking wrappers with direct Swift `Task`/`await` calls.
- [x] Run the build-chain test and confirm success.

### Task 2: Separate first-run enrollment timing

**Files:**
- Modify: `src/components/face-swap-invite-modal.test.tsx`
- Modify: `src/components/face-swap-invite-modal.tsx`

- [x] Add a failing regression for enrollment exceeding the former shared 90-second deadline.
- [x] Run the focused test and confirm failure.
- [x] Remove persisted-face preparation from the upload deadline while leaving each network step bounded.
- [x] Run the focused test and confirm success.

### Task 3: Verify and publish

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj`

- [x] Run focused tests, full tests, lint, production build, Capacitor sync, and iOS build-chain verification.
- [x] Increase the build number.
- [ ] Commit and push without force.
- [ ] Confirm Xcode Cloud archive/upload and make the new TestFlight build installable.
