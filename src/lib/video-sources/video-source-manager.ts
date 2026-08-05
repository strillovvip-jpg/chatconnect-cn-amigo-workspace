import {
  ConnectionState,
  Room,
  Track,
  type LocalVideoTrack,
} from "livekit-client";
import {
  AISource,
  CameraSource,
  ScreenShareSource,
  VideoFileSource,
} from "./sources.ts";
import type {
  PreparedVideoSource,
  VideoFileOptions,
  VideoSourceKind,
  VideoSourceSnapshot,
} from "./types.ts";
import type { VideoSource } from "./types.ts";
import { uiErrorMessage } from "@/lib/utils.ts";

const initialSnapshot: VideoSourceSnapshot = {
  active: "camera",
  switching: false,
  videoFileState: "idle",
  lastSwitchMs: null,
  error: null,
};

export class VideoSourceManager {
  private current: PreparedVideoSource | null = null;
  private snapshot: VideoSourceSnapshot = initialSnapshot;
  private listeners = new Set<(snapshot: VideoSourceSnapshot) => void>();
  private operation = Promise.resolve();
  private disposed = false;
  private readonly sources = new Map<VideoSourceKind, VideoSource>();
  private readonly aiSource = new AISource();

  constructor(private readonly room: Room) {
    this.registerSource(new CameraSource());
    this.registerSource(new ScreenShareSource());
    this.registerSource(this.aiSource);
  }

  /** New providers can be installed without changing LiveKit connection code. */
  registerSource(source: VideoSource) {
    this.sources.set(source.kind, source);
  }

  subscribe(listener: (snapshot: VideoSourceSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return this.snapshot;
  }
  isAISourceAvailable() {
    return this.aiSource.isSupported();
  }
  isScreenShareSupported() {
    return new ScreenShareSource().isSupported();
  }

  private update(patch: Partial<VideoSourceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private cameraTrack(): LocalVideoTrack {
    const track = this.room.localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.videoTrack;
    if (!track) throw new Error("未找到用于发送的摄像头轨道。");
    return track;
  }

  private enqueue(action: () => Promise<void>) {
    const result = this.operation.then(action, action);
    this.operation = result.catch(() => undefined);
    return result;
  }

  switchTo(
    kind: Exclude<VideoSourceKind, "video-file">,
    options?: { automatic?: boolean },
  ) {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error("通话已结束。");
      if (this.room.state !== ConnectionState.Connected)
        throw new Error("请在通话连接后切换视频来源。");
      if (this.snapshot.active === kind && !options?.automatic) return;
      const source = this.sources.get(kind);
      if (!source) throw new Error("指定的视频来源尚未注册。");
      await this.replaceWith(source);
    });
  }

  useVideoFile(options: VideoFileOptions) {
    return this.enqueue(async () =>
      this.replaceWith(new VideoFileSource(options)),
    );
  }

  private async replaceWith(source: VideoSource) {
    if (!source.isSupported())
      throw new Error(
        source.kind === "ai"
          ? "人工智能视频来源目前尚未开放。"
          : "此设备无法使用所选视频来源。",
      );
    this.update({ switching: true, error: null });
    const started = performance.now();
    let next: PreparedVideoSource | null = null;
    try {
      next = await source.prepare(this.room);
      const published = this.cameraTrack();
      const replacedTrack = published.mediaStreamTrack;
      await published.replaceTrack(next.track, { userProvidedTrack: true });
      const previous = this.current;
      this.current = next;
      this.update({
        active: source.kind,
        switching: false,
        videoFileState: source.kind === "video-file" ? "playing" : "idle",
        lastSwitchMs: Math.round(performance.now() - started),
      });
      await previous?.dispose();
      // The first source switch replaces the camera track that LiveKit created
      // before this manager existed. Stop that detached capture explicitly so
      // Safari/Chrome do not keep an orphaned camera stream alive.
      if (
        !previous &&
        replacedTrack !== next.track &&
        replacedTrack.readyState !== "ended"
      )
        replacedTrack.stop();
      if (source.kind === "screen-share" || source.kind === "video-file") {
        next.track.addEventListener(
          "ended",
          () => void this.switchTo("camera", { automatic: true }),
          { once: true },
        );
      }
    } catch (error) {
      await next?.dispose();
      const message = uiErrorMessage(error, "无法切换视频来源。");
      this.update({ switching: false, error: message });
      throw error;
    }
  }

  pauseVideoFile() {
    return this.enqueue(async () => {
      if (this.snapshot.active !== "video-file" || !this.current?.pause) return;
      await this.current.pause();
      this.update({ videoFileState: "paused" });
    });
  }

  resumeVideoFile() {
    return this.enqueue(async () => {
      if (this.snapshot.active !== "video-file" || !this.current?.resume)
        return;
      await this.current.resume();
      this.update({ videoFileState: "playing" });
    });
  }

  stopVideoFile() {
    return this.switchTo("camera", { automatic: true });
  }

  async dispose() {
    this.disposed = true;
    await this.operation.catch(() => undefined);
    await this.current?.dispose();
    this.current = null;
    this.listeners.clear();
  }
}
