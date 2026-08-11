import { Track } from "livekit-client";

export const CAMERA_CAPTURE_OPTIONS = {
  resolution: { width: 1280, height: 720, frameRate: 24 },
  facingMode: "user" as const,
};

type CameraParticipant = {
  getTrackPublication(source: Track.Source):
    | { track?: { mediaStreamTrack: { readyState: MediaStreamTrackState } } }
    | undefined;
  setCameraEnabled(
    enabled: boolean,
    options?: typeof CAMERA_CAPTURE_OPTIONS,
  ): Promise<unknown>;
};

export async function setParticipantCameraEnabled(
  participant: CameraParticipant,
  enabled: boolean,
) {
  const existing = participant.getTrackPublication(Track.Source.Camera)?.track
    ?.mediaStreamTrack;

  if (!enabled) {
    await participant.setCameraEnabled(false);
    return;
  }

  if (existing?.readyState === "ended") {
    await participant.setCameraEnabled(false);
  }

  await participant.setCameraEnabled(true, CAMERA_CAPTURE_OPTIONS);

  const active = participant.getTrackPublication(Track.Source.Camera)?.track
    ?.mediaStreamTrack;
  if (!active || active.readyState !== "live") {
    throw new Error("camera track was not published");
  }
}
