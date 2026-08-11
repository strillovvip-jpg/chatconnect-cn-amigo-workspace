import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmigoFaceSwapService } from "./face-swap";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  enrollFace: vi.fn(),
}));

vi.mock("./bridge.ts", () => ({
  amigoBridge: {
    available: true,
    initialize: mocks.initialize,
    enrollFace: mocks.enrollFace,
    processFrame: vi.fn(),
  },
}));

describe("AmigoFaceSwapService", () => {
  beforeEach(() => {
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.enrollFace.mockReset().mockResolvedValue(true);
    vi.stubGlobal("localStorage", {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("initializes and enrolls a selected file as one awaited operation", async () => {
    const service = new AmigoFaceSwapService("api-key");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).resolves.toBe(true);

    expect(mocks.initialize).toHaveBeenCalledWith("api-key");
    expect(mocks.enrollFace).toHaveBeenCalledTimes(1);
    expect(service.hasTargetFace).toBe(true);
  });

  it("rejects with an explicit configuration error when the SDK key is missing", async () => {
    const service = new AmigoFaceSwapService("");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).rejects.toMatchObject({
      code: "SDK_API_KEY_MISSING",
      stage: "initialize",
    });

    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.enrollFace).not.toHaveBeenCalled();
  });

  it("preserves the native SDK error code and message instead of returning false", async () => {
    const nativeError = Object.assign(
      new Error("No face was detected in the provided image."),
      {
        code: "FACE_NOT_DETECTED",
        data: {
          stage: "enroll",
          sdkDomain: "AmigoFaceSwapSDK.AmigoError",
          sdkCode: 2,
          sdkMessage: "No face was detected in the provided image.",
        },
      },
    );
    mocks.enrollFace.mockRejectedValue(nativeError);
    const service = new AmigoFaceSwapService("api-key");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).rejects.toMatchObject({
      code: "FACE_NOT_DETECTED",
      stage: "enroll",
      message: "No face was detected in the provided image.",
    });

    expect(service.hasTargetFace).toBe(false);
  });

  it("allows initialization to be retried after a native initialization failure", async () => {
    mocks.initialize
      .mockRejectedValueOnce(
        Object.assign(new Error("The API key is invalid."), {
          code: "SDK_AUTHORIZATION_FAILED",
        }),
      )
      .mockResolvedValueOnce(undefined);
    const service = new AmigoFaceSwapService("api-key");

    await expect(service.initialize()).rejects.toMatchObject({
      code: "SDK_AUTHORIZATION_FAILED",
    });
    await expect(service.initialize()).resolves.toBeUndefined();

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(service.isInitialized).toBe(true);
  });
});
