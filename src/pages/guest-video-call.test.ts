import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/guest-video-call.tsx"),
  "utf8",
);

describe("GuestVideoCallPage join lifecycle", () => {
  it("acquires camera and microphone before consuming a token, then publishes both tracks", () => {
    expect(source).toContain("createDeadline(GUEST_JOIN_TIMEOUT_MS");
    expect(source).toContain("deadline.run(localTracksPromise)");
    expect(source).toMatch(/deadline\.run\(\s*joinInvite\(/);
    expect(source).toMatch(/deadline\.run\(\s*nextRoom\.connect\(/);
    expect(source.indexOf("createLocalTracks(")).toBeLessThan(
      source.indexOf("joinInvite({"),
    );
    expect(source).toContain("nextRoom.localParticipant.publishTrack(track)");
    expect(source).not.toContain("setMicrophoneEnabled(true)");
    expect(source).not.toContain("setCameraEnabled(true");
    expect(source).toMatch(/deadline\.run\(\s*confirmInvite\(/);
  });

  it("disconnects a partially joined room and reports a localized timeout", () => {
    expect(source).toContain(
      "await nextRoom?.disconnect().catch(() => undefined)",
    );
    expect(source).toContain("error instanceof OperationTimeoutError");
    expect(source).toContain("copy.joinTimeout");
  });
});
