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

  it("preserves each official Amigo SDK error code for diagnostics", async () => {
    const nativeError = Object.assign(new Error("The API key was revoked."), {
      code: "SDK_REVOKED_API_KEY",
      data: {
        stage: "enroll",
        sdkCase: "revokedAPIKey",
        sdkMessage: "The API key was revoked.",
      },
    });
    mocks.enrollFace.mockRejectedValue(nativeError);
    const service = new AmigoFaceSwapService("api-key");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).rejects.toMatchObject({
      code: "SDK_REVOKED_API_KEY",
      stage: "enroll",
      message: "The API key was revoked.",
      nativeDetails: expect.objectContaining({
        sdkCase: "revokedAPIKey",
      }),
    });
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

  it("reinitializes once when native enrollment reports lost SDK state", async () => {
    mocks.enrollFace
      .mockRejectedValueOnce(
        Object.assign(new Error("The native SDK has not been initialized."), {
          code: "SDK_NOT_INITIALIZED",
          data: { stage: "enroll" },
        }),
      )
      .mockResolvedValueOnce(true);
    const service = new AmigoFaceSwapService("api-key");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).resolves.toBe(true);

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(mocks.enrollFace).toHaveBeenCalledTimes(2);
    expect(service.hasTargetFace).toBe(true);
  });

  it("serializes overlapping enrollments so the native SDK receives one photo at a time", async () => {
    let resolveFirst: ((value: boolean) => void) | undefined;
    mocks.enrollFace
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    const service = new AmigoFaceSwapService("api-key");

    const first = service.enrollFaceFile(
      new File(["first"], "first.jpeg", { type: "image/jpeg" }),
    );
    const second = service.enrollFaceFile(
      new File(["second"], "second.jpeg", { type: "image/jpeg" }),
    );
    await vi.waitFor(() => expect(mocks.enrollFace).toHaveBeenCalledTimes(1));

    resolveFirst?.(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    expect(mocks.enrollFace).toHaveBeenCalledTimes(2);
    expect(service.hasTargetFace).toBe(true);
  });
});
