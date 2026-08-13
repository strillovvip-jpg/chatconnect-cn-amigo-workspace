import { amigoBridge } from "./bridge.ts";

export type FaceSwapStage = "initialize" | "read" | "decode" | "enroll";

export type FaceSwapErrorCode =
  | "NATIVE_BRIDGE_UNAVAILABLE"
  | "SDK_API_KEY_MISSING"
  | "SDK_NOT_INITIALIZED"
  | "SDK_INITIALIZATION_FAILED"
  | "SDK_AUTHORIZATION_FAILED"
  | "SDK_INVALID_API_KEY"
  | "SDK_REVOKED_API_KEY"
  | "SDK_NETWORK_REQUIRED"
  | "SDK_QUOTA_EXCEEDED"
  | "SDK_MODEL_LOAD_FAILED"
  | "SDK_MODEL_DOWNLOAD_FAILED"
  | "SDK_MODEL_DECRYPTION_FAILED"
  | "SDK_SERVER_ERROR"
  | "SDK_INFERENCE_FAILURE"
  | "SDK_UNKNOWN_ERROR"
  | "SDK_INVALID_INPUT"
  | "FACE_IMAGE_EMPTY"
  | "FACE_IMAGE_FORMAT_UNSUPPORTED"
  | "FACE_IMAGE_DECODE_FAILED"
  | "FACE_NOT_DETECTED"
  | "FACE_ENROLL_TIMEOUT"
  | "FACE_ENROLL_FAILED";

export class FaceSwapError extends Error {
  readonly name = "FaceSwapError";

  constructor(
    readonly code: FaceSwapErrorCode,
    readonly stage: FaceSwapStage,
    message: string,
    readonly nativeDetails?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class AmigoFaceSwapService {
  private initialization: Promise<void> | null = null;
  private enrollmentQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  private enrolled = false;

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
    if (this.initialized) return Promise.resolve();
    if (!amigoBridge.available)
      return Promise.reject(
        new FaceSwapError(
          "NATIVE_BRIDGE_UNAVAILABLE",
          "initialize",
          "The native image processor is unavailable on this device.",
        ),
      );
    if (!this.initialization) {
      this.initialization = this.doInitialize().catch((error) => {
        this.initialization = null;
        throw normalizeFaceSwapError(
          error,
          "SDK_INITIALIZATION_FAILED",
          "initialize",
        );
      });
    }
    return this.initialization;
  }

  private async doInitialize(): Promise<void> {
    await amigoBridge.initialize();
    this.initialized = true;
    console.info("[FaceSwap:init] native SDK initialized");
  }

  /** Build a FaceLatent from the latest face-library photo after login. */
  async enrollFace(imageUrl: string): Promise<boolean> {
    await this.initialize();
    this.assertReadyForEnrollment();
    const imageData = await imageUrlToJpegBase64(imageUrl);
    if (!imageData)
      throw new FaceSwapError(
        "FACE_IMAGE_DECODE_FAILED",
        "decode",
        "The saved image could not be read as image data.",
      );
    return await this.enrollFaceData(imageData);
  }

  /** Enroll the exact photo selected in the app before reporting it as ready. */
  async enrollFaceFile(file: Blob): Promise<boolean> {
    await this.initialize();
    this.assertReadyForEnrollment();
    if (file.size < 1)
      throw new FaceSwapError(
        "FACE_IMAGE_EMPTY",
        "read",
        "The saved image contains no data.",
      );
    if (file.type && !file.type.toLowerCase().startsWith("image/"))
      throw new FaceSwapError(
        "FACE_IMAGE_FORMAT_UNSUPPORTED",
        "decode",
        `Unsupported image type: ${file.type}`,
      );
    let dataUrl: string;
    try {
      dataUrl = await blobToDataUrl(file);
    } catch (error) {
      throw new FaceSwapError(
        "FACE_IMAGE_DECODE_FAILED",
        "decode",
        "The saved image bytes could not be decoded.",
        undefined,
        { cause: error },
      );
    }
    const imageData = dataUrl.split(",")[1];
    if (!imageData)
      throw new FaceSwapError(
        "FACE_IMAGE_DECODE_FAILED",
        "decode",
        "The saved image did not produce a valid data payload.",
      );
    return await this.enrollFaceData(imageData);
  }

  private async enrollFaceData(imageData: string): Promise<boolean> {
    // The vendor SDK owns process-wide model state, so never invoke enrollFace
    // concurrently. Chaining makes the last explicitly selected photo
    // deterministically become the live FaceLatent.
    const enrollment = this.enrollmentQueue.then(() =>
      this.enrollFaceDataWithRecovery(imageData, true),
    );
    this.enrollmentQueue = enrollment.then(
      () => undefined,
      () => undefined,
    );
    return enrollment;
  }

  private async enrollFaceDataWithRecovery(
    imageData: string,
    allowInitializationRecovery: boolean,
  ): Promise<boolean> {
    try {
      const result = await amigoBridge.enrollFace(imageData);
      const ready =
        result.success === true &&
        result.enrolled === true &&
        result.hasTargetFace === true;
      this.enrolled = ready;
      if (!ready)
        throw new FaceSwapError(
          "FACE_ENROLL_FAILED",
          "enroll",
          "The native SDK did not retain the enrolled FaceLatent.",
          { result },
        );
      console.info("[FaceSwap:enroll] native FaceLatent retained", {
        success: result.success,
        enrolled: result.enrolled,
        hasTargetFace: result.hasTargetFace,
        latentHash: result.latentHash,
      });
      return true;
    } catch (error) {
      this.enrolled = false;
      const normalized = normalizeFaceSwapError(
        error,
        "FACE_ENROLL_FAILED",
        "enroll",
      );
      console.error("[FaceSwap:enroll] native enrollment failed", {
        code: normalized.code,
        stage: normalized.stage,
        message: normalized.message,
        nativeDetails: normalized.nativeDetails,
      });
      if (
        allowInitializationRecovery &&
        normalized.code === "SDK_NOT_INITIALIZED"
      ) {
        console.warn(
          "[FaceSwap:enroll] native SDK state was lost; reinitializing once",
        );
        this.initialized = false;
        this.initialization = null;
        await this.initialize();
        return this.enrollFaceDataWithRecovery(imageData, false);
      }
      throw normalized;
    }
  }

  private assertReadyForEnrollment() {
    if (!amigoBridge.available || !this.initialized)
      throw new FaceSwapError(
        "SDK_NOT_INITIALIZED",
        "initialize",
        "The native SDK has not finished initializing.",
      );
  }

  /** Process one frame through the native SDK. Falls back to unmodified frame. */
  async processFrame(jpegData: string): Promise<string | null> {
    if (!amigoBridge.available || !this.initialized || !this.enrolled)
      return null;
    const result = await amigoBridge.processFrame(jpegData);
    if (!result.swapped)
      console.debug("[AmigoFaceSwap] frame passthrough (no swap result)");
    return result.swapped && result.imageData ? result.imageData : null;
  }

  markDisconnected() {
    this.enrolled = false;
  }
}

async function imageUrlToJpegBase64(url: string): Promise<string | null> {
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

function normalizeFaceSwapError(
  error: unknown,
  fallbackCode: FaceSwapErrorCode,
  fallbackStage: FaceSwapStage,
): FaceSwapError {
  if (error instanceof FaceSwapError) return error;

  const record = isRecord(error) ? error : {};
  const outerData = isRecord(record.data) ? record.data : {};
  const data = isRecord(outerData.data) ? outerData.data : outerData;
  const code = isFaceSwapErrorCode(record.code)
    ? record.code
    : isFaceSwapErrorCode(data.code)
      ? data.code
      : typeof data.sdkCode === "number"
        ? "SDK_UNKNOWN_ERROR"
        : fallbackCode;
  const stage = isFaceSwapStage(data.stage) ? data.stage : fallbackStage;
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message
      : "The native image processor failed.";

  return new FaceSwapError(code, stage, message, data, {
    cause: error,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFaceSwapStage(value: unknown): value is FaceSwapStage {
  return ["initialize", "read", "decode", "enroll"].includes(String(value));
}

function isFaceSwapErrorCode(value: unknown): value is FaceSwapErrorCode {
  return [
    "NATIVE_BRIDGE_UNAVAILABLE",
    "SDK_API_KEY_MISSING",
    "SDK_NOT_INITIALIZED",
    "SDK_INITIALIZATION_FAILED",
    "SDK_AUTHORIZATION_FAILED",
    "SDK_INVALID_API_KEY",
    "SDK_REVOKED_API_KEY",
    "SDK_NETWORK_REQUIRED",
    "SDK_QUOTA_EXCEEDED",
    "SDK_MODEL_LOAD_FAILED",
    "SDK_MODEL_DOWNLOAD_FAILED",
    "SDK_MODEL_DECRYPTION_FAILED",
    "SDK_SERVER_ERROR",
    "SDK_INFERENCE_FAILURE",
    "SDK_INVALID_INPUT",
    "FACE_IMAGE_EMPTY",
    "FACE_IMAGE_FORMAT_UNSUPPORTED",
    "FACE_IMAGE_DECODE_FAILED",
    "FACE_NOT_DETECTED",
    "FACE_ENROLL_TIMEOUT",
    "FACE_ENROLL_FAILED",
  ].includes(String(value));
}
