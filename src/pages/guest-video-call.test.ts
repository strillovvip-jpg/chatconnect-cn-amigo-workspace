import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/guest-video-call.tsx"),
  "utf8",
);

describe("GuestVideoCallPage join lifecycle", () => {
  it("applies one deadline to token issuance, room connection and media publication", () => {
    expect(source).toContain("createDeadline(GUEST_JOIN_TIMEOUT_MS");
    expect(source).toContain("deadline.run(joinInvite(");
    expect(source).toContain("deadline.run(nextRoom.connect(");
    expect(source).toContain(
      "deadline.run(nextRoom.localParticipant.setMicrophoneEnabled(true))",
    );
    expect(source).toContain(
      "deadline.run(\n        nextRoom.localParticipant.setCameraEnabled(true",
    );
  });

  it("disconnects a partially joined room and reports a localized timeout", () => {
    expect(source).toContain("await nextRoom?.disconnect().catch(() => undefined)");
    expect(source).toContain("error instanceof OperationTimeoutError");
    expect(source).toContain("copy.joinTimeout");
  });
});
