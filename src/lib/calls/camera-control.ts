import { Track } from "livekit-client";

export const CAMERA_CAPTURE_OPTIONS = {
  resolution: { width: 1280, height: 720, frameRate: 24 },
  facingMode: "user" as const,
};

export type CameraDeviceOption = { deviceId: string; label: string };

type CameraMediaDevices = Pick<
  MediaDevices,
  "enumerateDevices" | "getUserMedia"
>;

export function buildCameraCaptureOptions(deviceId?: string) {
  return deviceId
    ? {
        resolution: CAMERA_CAPTURE_OPTIONS.resolution,
        deviceId: { exact: deviceId },
      }
    : CAMERA_CAPTURE_OPTIONS;
}

export function buildCameraConstraints(
  deviceId?: string,
): MediaTrackConstraints {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24, max: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
  };
}

export async function listCameraDevices(
  mediaDevices: CameraMediaDevices = navigator.mediaDevices,
): Promise<CameraDeviceOption[]> {
  let devices = await mediaDevices.enumerateDevices();
  const cameras = () =>
    devices.filter((device) => device.kind === "videoinput");

  if (cameras().some((device) => !device.label)) {
    try {
      const permissionStream = await mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      devices = await mediaDevices.enumerateDevices();
    } catch {
      // A denied permission still allows us to show anonymous camera entries.
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
    options?: ReturnType<typeof buildCameraCaptureOptions>,
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
