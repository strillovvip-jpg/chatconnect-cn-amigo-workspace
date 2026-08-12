import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSettingsModal } from "./face-settings-modal";

const mocks = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  addFace: vi.fn(),
  enrollFaceFile: vi.fn(),
  nativeGetStatus: vi.fn(),
  onReadyChange: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (name: string) =>
    name === "generateUploadUrl" ? mocks.generateUploadUrl : mocks.addFace,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/lib/amigo/face-swap", () => ({
  amigoFaceSwap: { enrollFaceFile: mocks.enrollFaceFile },
}));

vi.mock("@/lib/amigo/native-room", () => ({
  nativeAmigoRoom: { isAvailable: true, getStatus: mocks.nativeGetStatus },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      common: { close: "Close" },
      faceSwapInvite: {
        manageFaces: "Face settings",
        manageFacesHint: "Enroll a face before creating a call.",
        photoName: "Photo name",
        photoSaveIdle: "Enable face",
        photoSaveBusy: "Enabling...",
        photoReady: "Face enabled",
        photoErrorFileRead: "Read failed",
        photoErrorDecode: "Decode failed",
        photoErrorFormat: "Format failed",
        photoErrorNoFace: "No face",
        photoErrorSdkNotReady: "Not ready",
        photoErrorAuthorization: "Unauthorized",
        photoErrorNetwork: "Network failed",
        photoErrorQuota: "Quota failed",
        photoErrorEnroll: "Enroll failed",
        operationTimedOut: "Timed out",
      },
      chatPage: {
        chooseImageFile: "Choose image",
        imageMaxSize: "Too large",
        imageUploadFailed: (status: number) => `Upload failed ${status}`,
        imageIdMissing: "Missing id",
        uploadRequestMissing: "Missing request",
        faceAddFailed: "Add failed",
      },
    },
  }),
}));

vi.mock("@/lib/utils", () => ({
  uiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    faceLibrary: {
      generateUploadUrl: "generateUploadUrl",
      addFace: "addFace",
    },
  },
}));

describe("FaceSettingsModal", () => {
  beforeEach(() => {
    mocks.generateUploadUrl.mockResolvedValue({
      uploadUrl: "https://uploads.example.test/face",
      requestId: "request-1",
    });
    mocks.addFace.mockResolvedValue({ faceId: "face-1" });
    mocks.enrollFaceFile.mockResolvedValue(true);
    mocks.nativeGetStatus.mockResolvedValue({ hasTargetFace: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ storageId: "storage-1" }),
      })),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("owns enrollment and only reports ready after native retained the FaceLatent", async () => {
    const { container } = render(
      <FaceSettingsModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
        onReadyChange={mocks.onReadyChange}
      />,
    );

    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable face" }));

    await waitFor(() => expect(mocks.enrollFaceFile).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mocks.onReadyChange).toHaveBeenCalledWith(true));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Face enabled");
  });
});
