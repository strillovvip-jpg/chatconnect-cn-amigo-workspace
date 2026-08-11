import { Track, type LocalVideoTrack, type Room } from "livekit-client";
import type {
  PreparedVideoSource,
  VideoFileOptions,
  VideoSource,
} from "./types.ts";
import { amigoFaceSwap } from "@/lib/amigo/face-swap.ts";
import { getRuntimeMessages } from "@/lib/i18n";

const cameraConstraints: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: "user",
};

export class CameraSource implements VideoSource {
  readonly kind = "camera" as const;
  isSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }
  async prepare(_room: Room): Promise<PreparedVideoSource> {
    const copy = getRuntimeMessages().videoSources;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: cameraConstraints,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error(copy.cameraUnavailable);
    return { kind: this.kind, track, dispose: () => track.stop() };
  }
}

export class ScreenShareSource implements VideoSource {
  readonly kind = "screen-share" as const;
  isSupported() {
    return Boolean(navigator.mediaDevices?.getDisplayMedia);
  }
  async prepare(_room: Room): Promise<PreparedVideoSource> {
    const copy = getRuntimeMessages().videoSources;
    if (!navigator.mediaDevices?.getDisplayMedia)
      throw new Error(copy.screenShareUnsupported);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error(copy.screenTrackMissing);
    return { kind: this.kind, track, dispose: () => track.stop() };
  }
}

export class VideoFileSource implements VideoSource {
  readonly kind = "video-file" as const;
  constructor(private readonly options: VideoFileOptions) {}
  isSupported() {
    return (
      typeof document !== "undefined" &&
      "captureStream" in HTMLCanvasElement.prototype
    );
  }
  async prepare(_room: Room): Promise<PreparedVideoSource> {
    const copy = getRuntimeMessages().videoSources;
    if (!this.options.file && !this.options.url)
      throw new Error(copy.chooseMp4);
    if (!this.isSupported()) throw new Error(copy.videoFileUnsupported);

    const objectUrl = this.options.file
      ? URL.createObjectURL(this.options.file)
      : null;
    const video = document.createElement("video");
    video.src = objectUrl ?? this.options.url!;
    video.muted = true;
    video.playsInline = true;
    // A selected video remains the active camera source for the whole call.
    // It must only stop when the user replaces it or switches back to camera.
    video.loop = true;
    video.preload = "auto";
    if (!objectUrl) video.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error(copy.videoFileReadFailed));
      };
      const cleanup = () => {
        video.removeEventListener("canplay", ready);
        video.removeEventListener("error", failed);
      };
      video.addEventListener("canplay", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
      video.load();
    });
    if (
      this.options.startedAt &&
      video.duration > 0 &&
      Number.isFinite(video.duration)
    ) {
      const elapsed = Math.max(0, (Date.now() - this.options.startedAt) / 1000);
      video.currentTime = elapsed % video.duration;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, video.videoWidth || 1280);
    canvas.height = Math.max(2, video.videoHeight || 720);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(copy.videoRenderStartFailed);
    let frameRequest = 0;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frameRequest = window.requestAnimationFrame(render);
    };
    render();
    await video.play();
    const stream = canvas.captureStream(24);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error(copy.publishTrackCreateFailed);
    const keepPlaying = () => {
      if (disposed) return;
      video.currentTime = 0;
      void video.play();
    };
    video.addEventListener("ended", keepPlaying);
    const dispose = () => {
      disposed = true;
      window.cancelAnimationFrame(frameRequest);
      video.pause();
      video.removeEventListener("ended", keepPlaying);
      video.removeAttribute("src");
      video.load();
      track.stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    return {
      kind: this.kind,
      track,
      dispose,
      pause: async () => {
        video.pause();
      },
      resume: async () => {
        await video.play();
      },
    };
  }
}

/**
 * AI face-swap video source. On the native iOS app the frame pipeline runs
 * through the Amigo Face Swap SDK (`processFrame`); in a plain browser this
 * source stays unavailable so existing call flows are untouched.
 */
export class AISource implements VideoSource {
  readonly kind = "ai" as const;
  isSupported() {
    return amigoFaceSwap.isAvailable;
  }
  async prepare(room: Room): Promise<PreparedVideoSource> {
    const copy = getRuntimeMessages().videoSources;
    if (!amigoFaceSwap.isAvailable)
      throw new Error(copy.aiIosOnly);
    const published = room.localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.videoTrack as LocalVideoTrack | undefined;
    if (!published?.mediaStreamTrack)
      throw new Error(copy.aiCameraTrackMissing);

    const video = document.createElement("video");
    video.srcObject = new MediaStream([published.mediaStreamTrack]);
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error(copy.aiCameraReadFailed));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", ready);
        video.removeEventListener("error", failed);
      };
      video.addEventListener("loadedmetadata", ready);
      video.addEventListener("error", failed);
      void video.play().catch(() => undefined);
    });

    const width = Math.max(2, video.videoWidth || 640);
    const height = Math.max(2, video.videoHeight || 480);
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    const inputContext = input.getContext("2d", { alpha: false });
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const outputContext = output.getContext("2d", { alpha: false });
    if (!inputContext || !outputContext)
      throw new Error(copy.aiRenderStartFailed);

    let frameRequest = 0;
    let processing = false;
    let disposed = false;

    const render = () => {
      if (disposed) return;
      frameRequest = window.requestAnimationFrame(render);
      if (processing) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      inputContext.drawImage(video, 0, 0, width, height);
      const sourceJpeg = input.toDataURL("image/jpeg", 0.8);
      processing = true;
      void amigoFaceSwap
        .processFrame(sourceJpeg.split(",")[1] ?? "")
        .then((swappedJpeg) => {
          if (disposed) return;
          if (swappedJpeg) {
            void drawJpegToCanvas(outputContext, swappedJpeg, width, height);
          } else {
            outputContext.drawImage(video, 0, 0, width, height);
          }
        })
        .finally(() => {
          processing = false;
        });
    };
    render();

    const stream = output.captureStream(24);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error(copy.aiTrackCreateFailed);
    const dispose = () => {
      disposed = true;
      window.cancelAnimationFrame(frameRequest);
      video.pause();
      video.removeAttribute("src");
      video.load();
      track.stop();
    };
    return { kind: this.kind, track, dispose };
  }
}

function drawJpegToCanvas(
  context: CanvasRenderingContext2D,
  base64: string,
  width: number,
  height: number,
): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => resolve();
    image.src = `data:image/jpeg;base64,${base64}`;
  });
}
