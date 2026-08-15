import type { FeatureFlags } from "@/contexts/feature-context.tsx";

export function canUseExternalFaceSwapInvite(flags: FeatureFlags) {
  return (
    flags.canVideoCall &&
    flags.canVoiceCall &&
    flags.canAIFace &&
    flags.canVideoSource &&
    flags.canPlayVideo &&
    flags.canScreenShare &&
    flags.canTransferCall &&
    flags.canGroupCall &&
    flags.canPictureInPicture &&
    flags.canFloatingWindow &&
    flags.canFileSearch &&
    flags.canRecord
  );
}
