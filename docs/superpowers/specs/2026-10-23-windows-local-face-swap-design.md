# USA.Filing Windows Local Face-Swap Design

## Objective

Add a Windows-first desktop face-swap flow to `nyfbi.org`. A full-feature authorization-code user can upload a face photo in the website, process the live camera locally on the Windows computer, publish the processed result into an ordinary USA.Filing video call, and later transfer that same call to another full-feature authorization code on mobile or web.

The uploaded face photo and raw camera frames must remain on the user's Windows computer. They must not be uploaded to the USA.Filing backend or a cloud GPU service.

## Scope

### Included in the first release

- Microsoft Windows 10 and Windows 11.
- Current desktop versions of Google Chrome and Microsoft Edge.
- A signed USA.Filing Windows helper application.
- A `Face Swap Setup` flow in `nyfbi.org`.
- JPG, JPEG, and PNG target-face selection.
- Local target-face validation and enrollment.
- Local live-camera face processing.
- A `USA.Filing Virtual Camera` device visible to Chrome and Edge.
- Starting a normal LiveKit video call with that virtual camera.
- Turning video off and back on during the call.
- Switching between the processed virtual camera and installed physical or virtual cameras.
- Transferring the active call to another full-feature authorization code.
- Letting the transfer recipient choose camera-on or camera-off before joining.
- Clear English setup, permission, compatibility, and recovery messages.

### Excluded from the first release

- macOS and Linux helpers.
- Cloud GPU processing.
- Browser-only WebGPU face swapping.
- Mobile browser face swapping.
- Replacing the existing native iOS Amigo pipeline.
- Automatically controlling unrelated third-party face-swap applications.
- Recording or storing raw camera frames.
- Automatic background startup without an explicit user preference.

## User Experience

### Initial setup

1. A full-feature user opens `Face Swap Setup` in `nyfbi.org` on Windows.
2. The website checks for the local USA.Filing helper.
3. If the helper is missing, the website displays a verified Windows download, installation instructions, and a `Check again` button.
4. If the helper is available, the user selects a JPG, JPEG, or PNG image.
5. The website shows a local preview and requires the user to confirm that they have permission to use the image.
6. The image is sent only to the local helper over an authenticated loopback connection.
7. The helper validates that exactly one usable face is present, enrolls it locally, and returns a non-biometric session status to the website.
8. The user starts processing and sees a local preview.

### Starting a call

1. The user chooses a contact and opens the video-call preparation screen.
2. If the helper reports a ready face-swap session, `USA.Filing Virtual Camera` is selected by default.
3. The user may instead select a physical camera, OBS, or another installed virtual camera.
4. The existing LiveKit call path publishes the selected camera track; the signaling protocol and peer do not need a separate face-swap transport.
5. The peer sees the processed virtual-camera output as a normal video track.

### During a call

- Camera off disables publication without losing the locally enrolled target face.
- Camera on resumes the same face-swap session when possible.
- Camera switching uses the existing camera-device selection path.
- Helper failure stops the processed track and displays a recoverable error. The system must never silently fall back to publishing the raw physical camera.
- The user can explicitly choose a physical camera if they want to stop face swapping.

### Call transfer

1. The Windows caller initiates transfer using the existing full-feature transfer control.
2. The recipient receives the transfer on the app or website.
3. The recipient chooses camera-on or camera-off before joining.
4. The recipient joins the existing LiveKit room.
5. After the backend confirms the replacement participant, the original Windows participant disconnects.
6. The helper stops its local processing session after the original participant leaves.
7. Compliance-status queries must accept the specifically authorized joining transfer target during the join-confirmation window and must not crash the application.

## Architecture

### Web application

New web responsibilities:

- Detect Windows desktop support.
- Detect and authenticate the local helper.
- Select and preview a target-face file locally.
- Send the file to the helper only after user confirmation.
- Display helper capability, enrollment, preview, and error states.
- Prefer `USA.Filing Virtual Camera` when the helper is ready.
- Preserve the existing generic camera picker for OBS and other cameras.

The existing `PreCallSelector`, camera-control utilities, `CallProvider`, LiveKit room lifecycle, and call-transfer APIs remain the source of truth for video calls. The web application must not introduce a second call stack.

### Windows helper

The helper is a separate signed application with five isolated modules:

1. **Loopback gateway** — exposes a versioned local API and authenticates requests from the USA.Filing web origin.
2. **Enrollment engine** — validates and enrolls one target face in memory or encrypted local storage.
3. **Capture engine** — owns the selected physical camera and supplies frames to the processor.
4. **Face processor** — applies the licensed Windows-compatible face-swap engine locally.
5. **Virtual-camera publisher** — exposes processed frames as `USA.Filing Virtual Camera`.

The face-processing engine must be accessed through an internal interface so its vendor implementation can be replaced without changing the website or call stack.

### Local connection

- The helper listens only on the loopback interface.
- Communication uses a secure local channel suitable for an HTTPS website, such as a helper-managed trusted loopback TLS endpoint.
- The helper validates the requesting web origin against an allowlist containing the production USA.Filing domain and approved development origins.
- Each browser session performs a nonce-based handshake. Requests without the current session token are rejected.
- The helper never exposes a LAN listener and never accepts wildcard origins.
- The local API is versioned so the website can report an outdated helper instead of failing silently.

### Local API contract

The first version provides these conceptual operations:

- `GET /v1/status` — helper version, engine readiness, virtual-camera status, and compatibility flags.
- `POST /v1/session` — creates an authenticated local processing session.
- `POST /v1/session/{id}/face` — supplies the confirmed target-face image.
- `POST /v1/session/{id}/start` — selects the capture camera and starts processing.
- `POST /v1/session/{id}/stop` — stops processing and clears transient frames.
- `DELETE /v1/session/{id}/face` — removes the enrolled target face.

Responses contain status and diagnostic codes, never raw frames or reusable biometric embeddings.

## Privacy and Safety

- Target photos and raw frames remain local.
- The backend stores only an optional non-sensitive preference indicating that local face swap was selected; it stores no photo, embedding, or frame.
- Target-face files are held in memory by default. Persistent local storage is opt-in and encrypted using Windows-protected credentials.
- The helper clears frame buffers promptly and never writes frames to logs.
- Logs contain version, state transitions, device identifiers, timing, and error codes only.
- The UI requires confirmation that the user has permission to use the selected image.
- Raw-camera fallback is prohibited. A processor failure produces no video or a privacy frame until the user explicitly selects another source.

## Authorization and Entitlements

- Only authorization codes with `canAIFace`, `canVideoCall`, and `canVideoSource` may enter the Windows face-swap setup flow.
- Existing limited customer codes remain unable to use face swap or call transfer.
- The helper does not trust the authorization code directly. The website obtains a short-lived, backend-signed local-session assertion after the normal authorization-code session is validated.
- The assertion is scoped to local helper setup and expires quickly.

## Error Handling

The website distinguishes these states:

- Helper not installed.
- Helper stopped.
- Helper version unsupported.
- Local channel blocked.
- Target photo has no face or multiple faces.
- Face enrollment failed.
- Capture camera unavailable or busy.
- Virtual camera missing or not started.
- Processing performance below the supported threshold.
- Processed track ended during a call.
- Transfer join failed or expired.

Each state has a specific English message and recovery action. Errors from helper detection or compliance-status checks are contained within their feature UI and must not trigger the application-level fatal error screen.

## Performance Targets

- 720p processed output at a target of 24 frames per second on supported hardware.
- End-to-end local processing latency target below 150 milliseconds.
- Preview ready within 10 seconds after a valid target face is selected, excluding the first engine-model installation.
- Helper health status returned within 2 seconds.
- No unbounded memory growth during a 60-minute call.

Hardware that cannot sustain the minimum safe processing rate receives an explicit compatibility failure instead of unstable or intermittently black video.

## Testing and Acceptance

### Automated coverage

- Local API authentication, origin checks, token expiry, and version negotiation.
- One-face validation and invalid-file rejection.
- Virtual-camera startup, stop, and device-loss recovery.
- Website helper detection and all failure states.
- Pre-call automatic selection and manual camera override.
- No raw-camera fallback after processor failure.
- Camera-off and camera-on behavior.
- Existing OBS selection remains functional.
- Existing LiveKit ordinary-camera calls remain functional.
- Transfer authorization, joining window, completion, expiry, and rollback.
- Limited-code feature gating.

### Required Windows end-to-end acceptance

1. Install the signed helper on a clean supported Windows computer.
2. Open `nyfbi.org` in Chrome and sign in with a full-feature authorization code.
3. Upload a permitted target-face image in `Face Swap Setup`.
4. Confirm that processing occurs locally and the preview is stable.
5. Place a video call using `USA.Filing Virtual Camera`.
6. Verify that the peer receives stable processed video and audio.
7. Turn the camera off and on without exposing raw video.
8. Transfer the live call to a different full-feature authorization code signed in on a phone.
9. Let the phone choose camera-off or camera-on before accepting.
10. Confirm the phone continues the same call and the Windows participant/helper stops publishing.
11. Repeat the transfer with the recipient signed in on the website.
12. Run a continuous 60-minute call without black-frame flicker, fatal application errors, or uncontrolled memory growth.

The feature is not complete until this real Windows-to-phone sequence passes. Automated tests and a visible upload button alone are insufficient.

## Rollout

1. Internal helper build with development origin only.
2. Signed QA build with the production domain allowlisted and virtual-camera installation verified.
3. Full end-to-end testing with two full-feature codes and two devices.
4. Limited pilot release behind a backend feature flag.
5. General release after stability and privacy checks pass.

The existing OBS camera path remains available throughout rollout as the operational fallback.
