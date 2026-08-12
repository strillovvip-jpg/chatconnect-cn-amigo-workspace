import { Capacitor, registerPlugin } from "@capacitor/core";

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
  faceSwapEnabled: boolean;
  hasTargetFace: boolean;
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

export type AmigoFaceSwapPlugin = {
  initialize(options: { apiKey: string }): Promise<void>;
  enrollFace(options: {
    imageData: string;
  }): Promise<NativeFaceEnrollmentResult>;
  processFrame(options: { imageData: string }): Promise<AmigoProcessedFrame>;
  clearModelCache(): Promise<void>;
  getPipelineCapabilities(): Promise<AmigoPipelineCapabilities>;
  connectNativeRoom(options: {
    url: string;
    token: string;
    enableMicrophone?: boolean;
    enableCamera?: boolean;
  }): Promise<NativeRoomStatus>;
  disconnectNativeRoom(): Promise<NativeRoomStatus>;
  setNativeFaceSwapEnabled(options: {
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
  initialize(apiKey: string): Promise<void>;
  enrollFace(imageData: string): Promise<NativeFaceEnrollmentResult>;
  processFrame(imageData: string): Promise<AmigoProcessedFrame>;
  getPipelineCapabilities(): Promise<AmigoPipelineCapabilities>;
  connectNativeRoom(options: {
    url: string;
    token: string;
    enableMicrophone?: boolean;
    enableCamera?: boolean;
  }): Promise<NativeRoomStatus>;
  disconnectNativeRoom(): Promise<NativeRoomStatus>;
  setNativeFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus>;
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

  async initialize(apiKey: string): Promise<void> {
    if (!this.available) return;
    await plugin.initialize({ apiKey });
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
