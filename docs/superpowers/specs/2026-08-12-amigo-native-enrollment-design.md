# Amigo Native Enrollment Design

## Goal

Make the iOS app complete the official Amigo sequence before call creation:
`initialize(apiKey:)` → `enrollFace(from:)` → retain `FaceLatent` → enable realtime processing.

## Data flow

1. Upload and persist the selected photo using the existing backend.
2. Read and decode the persisted bytes.
3. Invoke the native bridge with the decoded image bytes.
4. Run Amigo's asynchronous initialize and enroll APIs without blocking them with a semaphore.
5. Store the returned `FaceLatent` in the native plugin and native room session.
6. Report photo-ready only after native status confirms the latent is present.
7. Allow call creation only after that confirmation.

## Timeout and error policy

Network upload steps and first-run model initialization do not share one deadline. Each network operation retains a bounded timeout; native initialization/enrollment is awaited directly so the SDK can finish its first model download and return an official `AmigoError`. Official error values remain visible through the typed bridge.

## Verification

Source regression tests reject semaphore-wrapped Amigo async calls. UI tests cover a first-run enrollment longer than the old shared deadline. The release gate remains web tests, production build, Capacitor sync, iOS archive, Xcode Cloud, then TestFlight device verification.
