import { describe, expect, it } from "vitest";
import { canUseExternalFaceSwapInvite } from "./external-invite-access";

describe("canUseExternalFaceSwapInvite", () => {
  it("allows the full feature bundle", () => {
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
    ).toBe(true);
  });

  it("rejects reduced codes missing 6, 9, and 11", () => {
    expect(
      canUseExternalFaceSwapInvite({
        canVideoCall: true,
        canVoiceCall: true,
        canAIFace: false,
        canVideoSource: false,
        canPlayVideo: false,
        canScreenShare: false,
        canTransferCall: false,
        canGroupCall: true,
        canPictureInPicture: true,
        canFloatingWindow: true,
        canFileSearch: true,
        canRecord: false,
      }),
    ).toBe(false);
  });
});
