import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";

export type AmigoProcessedFrame = {
  swapped: boolean;
  imageData: string | null;
};

export type AmigoPipelineCapabilities = {
  nativeRealtimeLiveKit: boolean;
  legacyBridgeJpeg: boolean;
  platform: string;
};

export type NativeRoomStatus = {
  connected: boolean;
  roomUrl: string | null;
  roomName?: string | null;
  faceSwapEnabled: boolean;
  hasTargetFace: boolean;
  videoPublished?: boolean;
  videoMuted?: boolean;
  audioPublished?: boolean;
  audioMuted?: boolean;
  pipeline: string;
};

export type NativeMediaPermission =
  "notDetermined" | "restricted" | "denied" | "authorized" | "unknown";

export type NativeMediaPermissionStatus = {
  camera: NativeMediaPermission;
  microphone: NativeMediaPermission;
};

export type NativeFaceEnrollmentResult = {
  success: boolean;
  enrolled: boolean;
  hasTargetFace: boolean;
  latentHash?: number;
  imageByteLength?: number;
  imageWidth?: number;
  imageHeight?: number;
};

export type AmigoInitializationProgress = {
  percent: number;
};

export type AmigoFaceSwapPlugin = {
  addListener(
    eventName: "initializationProgress",
    listener: (event: AmigoInitializationProgress) => void,
  ): Promise<PluginListenerHandle>;
  initialize(): Promise<void>;
  enrollFace(options: {
    imageData: string;
  }): Promise<NativeFaceEnrollmentResult>;
  processFrame(options: { imageData: string }): Promise<AmigoProcessedFrame>;
  clearModelCache(): Promise<void>;
  getPipelineCapabilities(): Promise<AmigoPipelineCapabilities>;
  connectNativeRoom(options: {
    url: string;
    token: string;
    roomName?: string;
    enableMicrophone?: boolean;
    enableCamera?: boolean;
  }): Promise<NativeRoomStatus>;
  disconnectNativeRoom(): Promise<NativeRoomStatus>;
  setNativeFaceSwapEnabled(options: {
    enabled: boolean;
  }): Promise<NativeRoomStatus>;
  setNativeCameraEnabled(options: {
    enabled: boolean;
  }): Promise<NativeRoomStatus>;
  getNativeRoomStatus(): Promise<NativeRoomStatus>;
  requestMediaPermissions(options: {
    openSettingsIfDenied?: boolean;
  }): Promise<NativeMediaPermissionStatus>;
};

export interface AmigoBridge {
  readonly available: boolean;
  readonly platform: string;
  addInitializationProgressListener(
    listener: (event: AmigoInitializationProgress) => void,
  ): Promise<() => Promise<void>>;
  initialize(): Promise<void>;
  clearModelCache(): Promise<void>;
  enrollFace(imageData: string): Promise<NativeFaceEnrollmentResult>;
  processFrame(imageData: string): Promise<AmigoProcessedFrame>;
  getPipelineCapabilities(): Promise<AmigoPipelineCapabilities>;
  connectNativeRoom(options: {
    url: string;
    token: string;
    roomName?: string;
    enableMicrophone?: boolean;
    enableCamera?: boolean;
  }): Promise<NativeRoomStatus>;
  disconnectNativeRoom(): Promise<NativeRoomStatus>;
  setNativeFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus>;
  setNativeCameraEnabled(enabled: boolean): Promise<NativeRoomStatus>;
  getNativeRoomStatus(): Promise<NativeRoomStatus>;
  requestMediaPermissions(options?: {
    openSettingsIfDenied?: boolean;
  }): Promise<NativeMediaPermissionStatus>;
}

const plugin = registerPlugin<AmigoFaceSwapPlugin>("AmigoFaceSwap");

/**
 * Bridge to the native Amigo Face Swap SDK exposed through the Capacitor
 * plugin `AmigoFaceSwapPlugin` (see ios/App/CapApp-SPM/Sources/CapApp-SPM).
 * In a plain browser (web preview / Android / non-iOS), the bridge reports
 * itself as unavailable so the AI video source degrades gracefully.
 */
class CapacitorAmigoBridge implements AmigoBridge {
  readonly available: boolean;
  readonly platform: string;

  constructor() {
    const platform = Capacitor.getPlatform();
    this.platform = platform;
    this.available = Capacitor.isNativePlatform() && platform === "ios";
  }

  async addInitializationProgressListener(
    listener: (event: AmigoInitializationProgress) => void,
  ): Promise<() => Promise<void>> {
    if (!this.available) return async () => undefined;
    const handle = await plugin.addListener("initializationProgress", listener);
    return async () => handle.remove();
  }

  async initialize(): Promise<void> {
    if (!this.available) return;
    await plugin.initialize();
  }

  async clearModelCache(): Promise<void> {
    if (!this.available) return;
    await plugin.clearModelCache();
  }

  async enrollFace(imageData: string): Promise<NativeFaceEnrollmentResult> {
    if (!this.available)
      return { success: false, enrolled: false, hasTargetFace: false };
    return await plugin.enrollFace({ imageData });
  }

  async processFrame(imageData: string): Promise<AmigoProcessedFrame> {
    if (!this.available) return { swapped: false, imageData: null };
    try {
      return await plugin.processFrame({ imageData });
    } catch {
      return { swapped: false, imageData: null };
    }
  }

  async getPipelineCapabilities(): Promise<AmigoPipelineCapabilities> {
    if (!this.available)
      return {
        nativeRealtimeLiveKit: false,
        legacyBridgeJpeg: false,
        platform: this.platform,
      };
    try {
      return await plugin.getPipelineCapabilities();
    } catch {
      return {
        nativeRealtimeLiveKit: false,
        legacyBridgeJpeg: true,
        platform: this.platform,
      };
    }
  }

  async connectNativeRoom(options: {
    url: string;
    token: string;
    roomName?: string;
    enableMicrophone?: boolean;
    enableCamera?: boolean;
  }): Promise<NativeRoomStatus> {
    if (!this.available)
      return {
        connected: false,
        roomUrl: null,
        faceSwapEnabled: false,
        hasTargetFace: false,
        pipeline: "unavailable",
      };
    return plugin.connectNativeRoom(options);
  }

  async disconnectNativeRoom(): Promise<NativeRoomStatus> {
    if (!this.available)
      return {
        connected: false,
        roomUrl: null,
        faceSwapEnabled: false,
        hasTargetFace: false,
        pipeline: "unavailable",
      };
    return plugin.disconnectNativeRoom();
  }

  async setNativeFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus> {
    if (!this.available)
      return {
        connected: false,
        roomUrl: null,
        faceSwapEnabled: false,
        hasTargetFace: false,
        pipeline: "unavailable",
      };
    return plugin.setNativeFaceSwapEnabled({ enabled });
  }

  async setNativeCameraEnabled(enabled: boolean): Promise<NativeRoomStatus> {
    if (!this.available)
      return {
        connected: false,
        roomUrl: null,
        faceSwapEnabled: false,
        hasTargetFace: false,
        pipeline: "unavailable",
      };
    return plugin.setNativeCameraEnabled({ enabled });
  }

  async getNativeRoomStatus(): Promise<NativeRoomStatus> {
    if (!this.available)
      return {
        connected: false,
        roomUrl: null,
        faceSwapEnabled: false,
        hasTargetFace: false,
        pipeline: "unavailable",
      };
    return plugin.getNativeRoomStatus();
  }

  async requestMediaPermissions(
    options: {
      openSettingsIfDenied?: boolean;
    } = {},
  ): Promise<NativeMediaPermissionStatus> {
    if (!this.available) return { camera: "unknown", microphone: "unknown" };
    return plugin.requestMediaPermissions(options);
  }
}

export const amigoBridge: AmigoBridge = new CapacitorAmigoBridge();
