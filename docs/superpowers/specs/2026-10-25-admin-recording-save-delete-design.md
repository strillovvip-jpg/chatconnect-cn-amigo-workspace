# Administrator Recording Save and Delete

## Intent

Give authorized USA.Filing administrators two explicit controls beside every finalized call-recording segment:

- **Save**: copy the selected recording to the administrator's current computer or iPhone.
- **Delete**: permanently remove only the selected recording after a clear confirmation.

The controls are for administrators only. They must preserve company isolation and must not expose recordings to ordinary users or administrators from another company.

## Goals

- Show English `Save` and `Delete` controls beside each finalized recording in the administrator Calls view.
- On desktop browsers, save the recording with a stable, sanitized filename to the normal download location.
- In the iPhone app, open the native share sheet so the administrator can choose **Save to Files**.
- Reauthorize every save and delete operation on the server using the current administrator session and the recording ID.
- Allow a company administrator to manage only recordings belonging to that company.
- Prevent deletion while the corresponding compliance session is `active` or `stopping`.
- Delete the selected recording metadata and physical storage blob together, reconcile its consumed upload-segment reference, and record a non-sensitive audit event.
- Give visible progress, success, cancellation, and failure feedback; prevent double submission.

## Non-goals

- Ordinary users do not receive recording-management controls.
- This change does not merge participant segments into one whole-call audio file.
- It does not add automatic retention schedules, bulk deletion, or transcript deletion.
- It does not redesign the full recordings archive or the existing 30-session dashboard limit.
- It does not allow deletion of an in-progress recording.

## Constraints and security rules

- The existing `call_recordings` row is the authoritative record. The client supplies only its administrator credential and the recording ID; it never supplies a trusted tenant, storage ID, or filename.
- The backend loads the recording, requires a live `admin` or `super_admin` session, derives the stored tenant, and applies the existing tenant-scope checks. A scoped administrator fails closed if the recording has no tenant.
- Download authorization happens on demand. The dashboard will no longer be treated as proof that a later action is allowed.
- The save response uses `Cache-Control: private, no-store`, an audio content type, and a sanitized `Content-Disposition` filename based on call, participant, and timestamp.
- Delete is permanent. The UI confirmation identifies the participant and recording time and states that the action cannot be undone.
- Before deletion, the backend checks the related compliance state and rejects `active` or `stopping` calls.
- A saved blob is referenced by both `call_recordings` and the consumed `call_recording_segments` row. Deletion removes the blob and recording row, clears the segment's `storageId`, retains `consumedAt` as the replay-prevention marker, and records `call.recording.delete` in `audit_logs`.
- If the storage object is unexpectedly shared by another recording, deletion fails without removing anything.

## Chosen approach

The user selected the complete cross-platform implementation.

### Considered approaches

1. **Simple browser link** — add `<a download>` and a scoped delete mutation. This is smaller, but iPhone WKWebView may open the audio instead of saving it, and it continues relying on bearer-style storage URLs.
2. **Authorized cross-platform save and audited delete** — authorize by recording ID on every action, download as a Blob on the web, use the native iOS share/save flow in the app, and add a tenant-scoped, audited hard-delete operation. **Selected** because it provides consistent administrator behavior and a safer authorization boundary.

## User experience

Each finalized recording row shows participant name/code, saved time, an audio player, and two 44-point controls:

- `Save`: shows a busy state while the audio is fetched. Desktop starts a download. iPhone opens the share sheet; the administrator may select **Save to Files**.
- `Delete`: opens a confirmation dialog. Cancel changes nothing. Confirm disables repeated clicks, performs the deletion, removes the row from the refreshed list, and shows a success message.

If the call is `active` or `stopping`, `Delete` is disabled with a short explanation. Save remains available only for finalized `call_recordings` rows.

## Technical shape

### Backend

- Add a recording-download authorization endpoint/action keyed by `recordingId` and current administrator credential. It returns the audio bytes with safe headers and never accepts a client-provided storage ID or tenant.
- Add `deleteRecording({ password, recordingId })` with administrator authorization, tenant isolation, compliance-state validation, shared-reference protection, physical blob deletion, recording-row deletion, segment reconciliation, and an audit entry.
- Treat `consumedAt` rather than the continued presence of `storageId` as proof that an upload capability has already been consumed.

### Frontend

- Extract a focused recording item/control component from the existing bare `<audio>` rendering in `src/pages/admin/page.tsx`.
- Add English labels and feedback strings to all supported locale dictionaries so English mode remains fully English and other modes do not expose missing keys.
- Web: fetch the authorized audio, create a temporary object URL, trigger a filename-aware download, and revoke the URL.
- iOS native: persist a temporary audio file and invoke the native share sheet; clean up temporary files after completion where supported.

### Native dependencies

- Add the compatible Capacitor Filesystem and Share packages, sync the iOS project, and keep browser behavior as the fallback when no native bridge is available.

## Testing and acceptance

Tests will be written first and observed failing before production changes.

- Same-tenant administrator can obtain a finalized recording; ordinary users and foreign-tenant administrators cannot.
- Download returns correct bytes, MIME type, safe filename, and private/no-store headers.
- Same-tenant administrator can delete a stopped recording; database row and blob are gone, consumed segment cannot be reused, and an audit event exists.
- Active/stopping, missing-tenant, cross-tenant, shared-blob, missing-recording, and repeated-delete cases fail safely without partial deletion.
- UI renders `Save` and `Delete` only for administrators, cancellation makes no request, pending state prevents double submission, and failures retain the recording.
- Desktop download helper and iOS share/save adapter receive the expected bytes and filename.
- Existing recording consent, upload, transfer-drain, tenant-isolation, full test suite, production build, and iOS asset checks continue to pass.
- Final manual checks cover nyfbi.org on desktop and the USA.Filing TestFlight app on an iPhone.
