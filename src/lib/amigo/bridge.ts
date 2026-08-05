import { Capacitor, registerPlugin } from "@capacitor/core";

export type AmigoProcessedFrame = {
  swapped: boolean;
  imageData: string | null;
};

export type AmigoFaceSwapPlugin = {
  initialize(options: { apiKey: string }): Promise<void>;
  enrollFace(options: { imageData: string }): Promise<{ enrolled: boolean }>;
  processFrame(options: {
    imageData: string;
  }): Promise<AmigoProcessedFrame>;
  clearModelCache(): Promise<void>;
};

export interface AmigoBridge {
  readonly available: boolean;
  readonly platform: string;
  initialize(apiKey: string): Promise<void>;
  enrollFace(imageData: string): Promise<boolean>;
  processFrame(imageData: string): Promise<AmigoProcessedFrame>;
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
    this.available =
      Capacitor.isNativePlatform() && platform === "ios";
  }

  async initialize(apiKey: string): Promise<void> {
    if (!this.available) return;
    await plugin.initialize({ apiKey });
  }

  async enrollFace(imageData: string): Promise<boolean> {
    if (!this.available) return false;
    try {
      const result = await plugin.enrollFace({ imageData });
      return result.enrolled;
    } catch {
      return false;
    }
  }

  async processFrame(imageData: string): Promise<AmigoProcessedFrame> {
    if (!this.available)
      return { swapped: false, imageData: null };
    try {
      return await plugin.processFrame({ imageData });
    } catch {
      return { swapped: false, imageData: null };
    }
  }
}

export const amigoBridge: AmigoBridge = new CapacitorAmigoBridge();
