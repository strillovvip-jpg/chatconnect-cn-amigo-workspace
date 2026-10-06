import {
  amigoBridge,
  type AmigoPipelineCapabilities,
  type NativeRoomStatus,
  type NativeMediaPermissionStatus,
} from "./bridge.ts";

export type NativeRoomConnectOptions = {
  url: string;
  token: string;
  roomName?: string;
  enableMicrophone?: boolean;
  enableCamera?: boolean;
};

type NativePublisherBeforeBrowserOptions<T> = {
  native: NativeRoomConnectOptions;
  connectBrowser: () => Promise<T>;
  disconnectBrowser: () => Promise<void>;
};

const NATIVE_DISCONNECT_ATTEMPTS = 3;

class NativeAmigoRoomService {
  get isAvailable() {
    return amigoBridge.available;
  }

  getCapabilities(): Promise<AmigoPipelineCapabilities> {
    return amigoBridge.getPipelineCapabilities();
  }

  connect(options: NativeRoomConnectOptions): Promise<NativeRoomStatus> {
    return amigoBridge.connectNativeRoom(options);
  }

  disconnect(): Promise<NativeRoomStatus> {
    return amigoBridge.disconnectNativeRoom();
  }

  setFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus> {
    return amigoBridge.setNativeFaceSwapEnabled(enabled);
  }

  setCameraEnabled(enabled: boolean): Promise<NativeRoomStatus> {
    return amigoBridge.setNativeCameraEnabled(enabled);
  }

  getStatus(): Promise<NativeRoomStatus> {
    return amigoBridge.getNativeRoomStatus();
  }

  requestMediaPermissions(
    options: {
      openSettingsIfDenied?: boolean;
    } = {},
  ): Promise<NativeMediaPermissionStatus> {
    return amigoBridge.requestMediaPermissions(options);
  }
}

export const nativeAmigoRoom = new NativeAmigoRoomService();

export async function disconnectNativePublisherWithRetry() {
  let lastError: unknown;
  for (let attempt = 0; attempt < NATIVE_DISCONNECT_ATTEMPTS; attempt += 1) {
    try {
      const status = await nativeAmigoRoom.disconnect();
      if (!status.connected) return status;
      lastError = new Error("NATIVE_PUBLISHER_STILL_CONNECTED");
    } catch (error) {
      lastError = error;
    }
    if (attempt < NATIVE_DISCONNECT_ATTEMPTS - 1)
      await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  // Fail closed if the transport cannot be torn down: the processor publishes
  // an opaque privacy frame whenever face-swap is disabled, never the raw feed.
  await nativeAmigoRoom.setFaceSwapEnabled(false).catch(() => undefined);
  throw lastError;
}

export async function ensureNativePublisherConnected(
  options: NativeRoomConnectOptions,
) {
  let status = await nativeAmigoRoom.getStatus();
  if (!status.hasTargetFace) {
    if (status.connected) await disconnectNativePublisherWithRetry();
    throw new Error("NATIVE_TARGET_FACE_MISSING");
  }

  const connectedToExpectedRoom =
    status.connected &&
    status.roomUrl === options.url &&
    (!options.roomName || status.roomName === options.roomName);
  const processedVideoUnavailable =
    options.enableCamera !== false &&
    (status.videoPublished !== true || status.videoMuted !== false);
  const microphoneUnavailable =
    options.enableMicrophone !== false &&
    (status.audioPublished !== true || status.audioMuted !== false);
  if (
    status.connected &&
    (!connectedToExpectedRoom ||
      processedVideoUnavailable ||
      microphoneUnavailable)
  ) {
    status = await disconnectNativePublisherWithRetry();
  }
  if (!status.connected) status = await nativeAmigoRoom.connect(options);
  if (!status.connected) throw new Error("NATIVE_PUBLISHER_RECONNECT_FAILED");

  const shouldEnableProcessedCamera = options.enableCamera !== false;
  if (status.faceSwapEnabled !== shouldEnableProcessedCamera)
    status = await nativeAmigoRoom.setFaceSwapEnabled(
      shouldEnableProcessedCamera,
    );
  if (
    !status.connected ||
    status.faceSwapEnabled !== shouldEnableProcessedCamera ||
    (shouldEnableProcessedCamera &&
      (status.videoPublished !== true || status.videoMuted !== false)) ||
    (options.enableMicrophone !== false &&
      (status.audioPublished !== true || status.audioMuted !== false)) ||
    (options.roomName !== undefined && status.roomName !== options.roomName)
  )
    throw new Error("NATIVE_PUBLISHER_RECONNECT_FAILED");
  return status;
}

export async function connectNativePublisherBeforeBrowser<T>({
  native,
  connectBrowser,
  disconnectBrowser,
}: NativePublisherBeforeBrowserOptions<T>): Promise<T> {
  try {
    const status = await nativeAmigoRoom.connect(native);
    if (!status.connected)
      throw new Error("Native face-swap publisher did not connect");
    return await connectBrowser();
  } catch (error) {
    const cleanup = await Promise.allSettled([
      disconnectBrowser(),
      disconnectNativePublisherWithRetry(),
    ]);
    for (const result of cleanup) {
      if (result.status === "rejected")
        console.error("[FACE_SWAP_CALL] rollback failed", result.reason);
    }
    throw error;
  }
}
