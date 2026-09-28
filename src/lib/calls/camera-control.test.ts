import { describe, expect, it, vi } from "vitest";
import { setParticipantCameraEnabled } from "./camera-control";

function participantWithTrack(readyState: MediaStreamTrackState) {
  const setCameraEnabled = vi.fn().mockResolvedValue(undefined);
  return {
    participant: {
      getTrackPublication: vi.fn(() => ({
        track: { mediaStreamTrack: { readyState } },
      })),
      setCameraEnabled,
    },
    setCameraEnabled,
  };
}

describe("setParticipantCameraEnabled", () => {
  it("publishes from the selected desktop camera device", async () => {
    const { participant, setCameraEnabled } = participantWithTrack("live");

    await setParticipantCameraEnabled(participant, true, "obs-camera");

    expect(setCameraEnabled).toHaveBeenCalledExactlyOnceWith(
      true,
      expect.objectContaining({ deviceId: "obs-camera" }),
    );
    expect(setCameraEnabled.mock.calls[0]?.[1]).not.toHaveProperty(
      "facingMode",
    );
  });

  it("recreates an ended camera before enabling it", async () => {
    const { participant, setCameraEnabled } = participantWithTrack("ended");
    participant.getTrackPublication
      .mockReturnValueOnce({
        track: { mediaStreamTrack: { readyState: "ended" } },
      })
      .mockReturnValueOnce({
        track: { mediaStreamTrack: { readyState: "live" } },
      });

    await setParticipantCameraEnabled(participant, true);

    expect(setCameraEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setCameraEnabled).toHaveBeenNthCalledWith(
      2,
      true,
      expect.objectContaining({ facingMode: "user" }),
    );
  });

  it("uses the participant API to mute a live camera", async () => {
    const { participant, setCameraEnabled } = participantWithTrack("live");

    await setParticipantCameraEnabled(participant, false);

    expect(setCameraEnabled).toHaveBeenCalledExactlyOnceWith(false);
  });
});
