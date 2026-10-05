import { describe, expect, test } from "vitest";
import { callControlVisibility } from "./call-ui";

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
