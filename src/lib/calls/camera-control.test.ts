import { describe, expect, it, vi } from "vitest";
import {
  handleProcessedCameraFailure,
  isExternalProcessedCameraLabel,
  isWindowsVirtualCameraLabel,
  preferredCameraDeviceId,
  setParticipantCameraEnabled,
} from "./camera-control";

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

describe("processed camera selection and failure", () => {
  const devices = [
    { deviceId: "physical", label: "Built-in Camera" },
    { deviceId: "obs", label: "OBS Virtual Camera" },
    { deviceId: "swapface", label: "SwapFaceCam" },
    { deviceId: "usa", label: "USA.Filing Virtual Camera" },
  ];

  it("prefers only the exact USA.Filing virtual camera label", () => {
    expect(preferredCameraDeviceId(devices)).toBe("usa");
    expect(isWindowsVirtualCameraLabel("USA.Filing Virtual Camera")).toBe(true);
    expect(isWindowsVirtualCameraLabel("USA Filing Camera Preview")).toBe(false);
  });

  it("recognizes legitimate external processed camera labels", () => {
    expect(isExternalProcessedCameraLabel("OBS Virtual Camera")).toBe(true);
    expect(isExternalProcessedCameraLabel("SwapFaceCam")).toBe(true);
    expect(isExternalProcessedCameraLabel("Built-in Camera")).toBe(false);
  });

  it("turns video off after a processed-track failure without selecting a physical fallback", async () => {
    const disableCamera = vi.fn().mockResolvedValue(undefined);
    const stopHelper = vi.fn().mockResolvedValue(undefined);
    const selectCamera = vi.fn();

    await handleProcessedCameraFailure({ disableCamera, stopHelper });

    expect(disableCamera).toHaveBeenCalledTimes(1);
    expect(stopHelper).toHaveBeenCalledTimes(1);
    expect(selectCamera).not.toHaveBeenCalled();
  });
});
