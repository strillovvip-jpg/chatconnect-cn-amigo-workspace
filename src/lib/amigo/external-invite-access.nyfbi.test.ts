// @vitest-environment-options { "url": "https://nyfbi.org/consultation" }

import { describe, expect, it } from "vitest";
import { canUseExternalFaceSwapInvite } from "./external-invite-access";

describe("nyfbi.org face-swap surface", () => {
  it("does not expose face-swap call creation even to a full-feature user", () => {
    expect(window.location.hostname).toBe("nyfbi.org");
    expect(
      canUseExternalFaceSwapInvite({
        canVideoCall: true,
        canVoiceCall: true,
        canAIFace: true,
        canVideoSource: true,
        canPlayVideo: true,
        canScreenShare: true,
        canTransferCall: true,
        canGroupCall: true,
        canPictureInPicture: true,
        canFloatingWindow: true,
        canFileSearch: true,
        canRecord: true,
      }),
    ).toBe(false);
  });
});
