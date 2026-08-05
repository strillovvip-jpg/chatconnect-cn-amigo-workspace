import type { Room } from "livekit-client";

export type VideoSourceKind = "camera" | "video-file" | "ai" | "screen-share";
export type VideoFilePlaybackState = "idle" | "playing" | "paused";

export type PreparedVideoSource = {
  kind: VideoSourceKind;
  track: MediaStreamTrack;
  dispose: () => void | Promise<void>;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
};

export interface VideoSource {
  readonly kind: VideoSourceKind;
  isSupported(): boolean;
  prepare(room: Room): Promise<PreparedVideoSource>;
}

export type VideoSourceSnapshot = {
  active: VideoSourceKind;
  switching: boolean;
  videoFileState: VideoFilePlaybackState;
  lastSwitchMs: number | null;
  error: string | null;
};

export type VideoFileOptions = {
  file?: File;
  url?: string;
  loop: boolean;
  /** Wall-clock start used to continue pre-call playback after acceptance. */
  startedAt?: number;
};
