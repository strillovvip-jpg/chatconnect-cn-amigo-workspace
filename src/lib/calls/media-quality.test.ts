import { describe, expect, it } from "vitest";
import { resilientCallRoomOptions } from "./media-quality";

describe("resilientCallRoomOptions", () => {
  it("caps video bandwidth and protects speech during concurrent calls", () => {
    const options = resilientCallRoomOptions("p2p");

    expect(options.videoCaptureDefaults).toMatchObject({
      resolution: { width: 960, height: 540, frameRate: 20 },
    });
    expect(options.publishDefaults).toMatchObject({
      audioPreset: { maxBitrate: 24_000 },
      dtx: true,
      red: true,
      simulcast: true,
      degradationPreference: "balanced",
      videoEncoding: { maxBitrate: 800_000 },
    });
  });

  it("keeps adaptive receiving enabled for group calls only", () => {
    expect(resilientCallRoomOptions("p2p").adaptiveStream).toBe(false);
    expect(resilientCallRoomOptions("group").adaptiveStream).toBe(true);
  });
});
