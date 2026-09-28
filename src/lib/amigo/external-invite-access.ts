import type { FeatureFlags } from "@/contexts/feature-context.tsx";
import { isNyfbiWebRuntime } from "@/lib/runtime-surface.ts";

export function canUseExternalFaceSwapInvite(flags: FeatureFlags) {
  if (isNyfbiWebRuntime()) return false;

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
