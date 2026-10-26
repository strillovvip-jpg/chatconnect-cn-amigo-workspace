import type { RoomOptions } from "livekit-client";

export function resilientCallRoomOptions(
  mode: "p2p" | "group",
): RoomOptions {
  return {
    // P2P keeps its single remote feed active across Safari layout changes;
    // group calls can safely adapt subscriptions to visible tile sizes.
    adaptiveStream: mode === "group",
    dynacast: true,
    videoCaptureDefaults: {
      resolution: { width: 960, height: 540, frameRate: 20 },
      facingMode: "user",
    },
    publishDefaults: {
      // Speech remains high-priority while redundant Opus data masks brief
      // packet loss. Video is capped so a second call cannot starve audio.
      audioPreset: { maxBitrate: 24_000 },
      dtx: true,
      red: true,
      forceStereo: false,
      simulcast: true,
      videoEncoding: { maxBitrate: 800_000, maxFramerate: 20 },
      // LiveKit's default simulcast layers (180p and 360p) provide the lower
      // bandwidth levels without creating another full-resolution encoder.
      degradationPreference: "balanced",
    },
  };
}
