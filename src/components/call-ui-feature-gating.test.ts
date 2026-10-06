import { describe, expect, test } from "vitest";
import { callControlVisibility, transferTargetOptions } from "./call-ui";

describe("call control feature gating", () => {
  test("limited customer codes keep camera controls but hide features 6, 9, and 11", () => {
    const visibility = callControlVisibility({
      canVideoSource: true,
      canPlayVideo: false,
      canScreenShare: false,
      canTransferCall: false,
    });

    expect(visibility.camera).toBe(true);
    expect(visibility.albumVideo).toBe(false);
    expect(visibility.screenShare).toBe(false);
    expect(visibility.transfer).toBe(false);
  });
});

describe("call transfer targets", () => {
  test("offers the current authorization code for a handoff to its other device", () => {
    expect(
      transferTargetOptions({
        currentCode: "AAAAA",
        remoteCode: "BBBBB",
        contacts: [
          { code: "BBBBB", name: "Current caller" },
          { code: "CCCCC", name: "Other recipient" },
        ],
      }),
    ).toEqual([
      { code: "AAAAA", name: "This authorization code (other device)" },
      { code: "CCCCC", name: "Other recipient" },
    ]);
  });
});
