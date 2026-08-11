import { amigoBridge } from "./bridge.ts";

const API_KEY = import.meta.env.VITE_AMIGO_API_KEY ?? "";

export class AmigoFaceSwapService {
  private initialization: Promise<void> | null = null;
  private initialized = false;
  private enrolled = false;

  constructor(private readonly apiKey = API_KEY) {}

  get isAvailable() {
    return amigoBridge.available;
  }
  get isInitialized() {
    return this.initialized;
  }
  get hasTargetFace() {
    return this.enrolled;
  }

  /** Initialize the SDK once at app startup. No-op outside the native app. */
  initialize(): Promise<void> {
    if (this.initialized || !amigoBridge.available) return Promise.resolve();
    if (!this.initialization)
      this.initialization = this.doInitialize();
    return this.initialization;
  }

  private async doInitialize(): Promise<void> {
    if (!this.apiKey) {
      console.warn("[AmigoFaceSwap] missing VITE_AMIGO_API_KEY, native SDK init skipped");
      return;
    }
    try {
      await amigoBridge.initialize(this.apiKey);
      this.initialized = true;
      console.info("[AmigoFaceSwap] native SDK initialized");
    } catch (error) {
      console.warn("[AmigoFaceSwap] initialize failed", error);
    }
  }

  /** Build a FaceLatent from the latest face-library photo after login. */
  async enrollFace(imageUrl: string): Promise<boolean> {
    await this.initialize();
    if (!amigoBridge.available || !this.initialized) return false;
    const imageData = await imageUrlToJpegBase64(imageUrl);
    if (!imageData) return false;
    return await this.enrollFaceData(imageData);
  }

  /** Enroll the exact photo selected in the app before reporting it as ready. */
  async enrollFaceFile(file: Blob): Promise<boolean> {
    await this.initialize();
    if (!amigoBridge.available || !this.initialized) return false;
    const dataUrl = await blobToDataUrl(file);
    const imageData = dataUrl.split(",")[1];
    if (!imageData) return false;
    return await this.enrollFaceData(imageData);
  }

  private async enrollFaceData(imageData: string): Promise<boolean> {
    try {
      const ok = await amigoBridge.enrollFace(imageData);
      this.enrolled = ok;
      if (ok) console.info("[AmigoFaceSwap] target face enrolled from latest face library image");
      return ok;
    } catch (error) {
      console.warn("[AmigoFaceSwap] enrollFace failed", error);
      return false;
    }
  }

  /** Process one frame through the native SDK. Falls back to unmodified frame. */
  async processFrame(jpegData: string): Promise<string | null> {
    if (!amigoBridge.available || !this.initialized || !this.enrolled)
      return null;
    const result = await amigoBridge.processFrame(jpegData);
    if (!result.swapped) console.debug("[AmigoFaceSwap] frame passthrough (no swap result)");
    return result.swapped && result.imageData ? result.imageData : null;
  }

  markDisconnected() {
    this.enrolled = false;
  }
}

async function imageUrlToJpegBase64(
  url: string,
): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.split(",")[1];
    return base64 ?? null;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const amigoFaceSwap = new AmigoFaceSwapService();
