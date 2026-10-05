import { Track, type VideoCaptureOptions } from "livekit-client";

export const CAMERA_CAPTURE_OPTIONS = {
  resolution: { width: 1280, height: 720, frameRate: 24 },
  facingMode: "user" as const,
};

export type CameraDeviceOption = { deviceId: string; label: string };

type CameraMediaDevices = Pick<
  MediaDevices,
  "enumerateDevices" | "getUserMedia"
>;

export async function listCameraDevices(
  mediaDevices: CameraMediaDevices = navigator.mediaDevices,
): Promise<CameraDeviceOption[]> {
  let devices = await mediaDevices.enumerateDevices();
  const cameras = () =>
    devices.filter((device) => device.kind === "videoinput");

  if (cameras().some((device) => !device.label)) {
    try {
      const stream = await mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      stream.getTracks().forEach((track) => track.stop());
      devices = await mediaDevices.enumerateDevices();
    } catch {
      // Permission errors are reported by the selected camera capture itself.
    }
  }

  return cameras()
    .filter((device) => Boolean(device.deviceId))
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label.trim() || `Camera ${index + 1}`,
    }));
}

type CameraParticipant = {
  getTrackPublication(
    source: Track.Source,
  ):
    | { track?: { mediaStreamTrack: { readyState: MediaStreamTrackState } } }
    | undefined;
  setCameraEnabled(
    enabled: boolean,
    options?: VideoCaptureOptions,
  ): Promise<unknown>;
};

export function cameraCaptureOptions(deviceId?: string): VideoCaptureOptions {
  return deviceId
    ? {
        resolution: CAMERA_CAPTURE_OPTIONS.resolution,
        deviceId,
      }
    : CAMERA_CAPTURE_OPTIONS;
}

export async function setParticipantCameraEnabled(
  participant: CameraParticipant,
  enabled: boolean,
  deviceId?: string,
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

  await participant.setCameraEnabled(true, cameraCaptureOptions(deviceId));

  const active = participant.getTrackPublication(Track.Source.Camera)?.track
    ?.mediaStreamTrack;
  if (!active || active.readyState !== "live") {
    throw new Error("camera track was not published");
  }
}
