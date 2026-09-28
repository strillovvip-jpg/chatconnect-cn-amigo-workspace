import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSettingsModal } from "./face-settings-modal";

const mocks = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  addFace: vi.fn(),
  enrollFaceFile: vi.fn(),
  addInitializationProgressListener: vi.fn(),
  initializationProgressListener: null as
    null | ((event: { percent: number }) => void),
  nativeGetStatus: vi.fn(),
  nativeSetFaceSwapEnabled: vi.fn(),
  query: vi.fn(),
  onReadyChange: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (name: string) =>
    name === "generateUploadUrl" ? mocks.generateUploadUrl : mocks.addFace,
  useConvex: () => ({ query: mocks.query }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/lib/amigo/face-swap", () => ({
  amigoFaceSwap: {
    enrollFaceFile: mocks.enrollFaceFile,
    addInitializationProgressListener: mocks.addInitializationProgressListener,
  },
}));

vi.mock("@/lib/amigo/native-room", () => ({
  nativeAmigoRoom: {
    isAvailable: true,
    getStatus: mocks.nativeGetStatus,
    setFaceSwapEnabled: mocks.nativeSetFaceSwapEnabled,
  },
}));

vi.mock("@/lib/i18n", () => ({
  formatUiDate: () => "9/28/26",
  useI18n: () => ({
    locale: "en",
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
      getUploadRequestStatus: "getUploadRequestStatus",
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
    mocks.initializationProgressListener = null;
    mocks.addInitializationProgressListener.mockImplementation(
      async (listener: (event: { percent: number }) => void) => {
        mocks.initializationProgressListener = listener;
        return async () => {
          mocks.initializationProgressListener = null;
        };
      },
    );
    mocks.nativeGetStatus.mockResolvedValue({ hasTargetFace: true });
    mocks.nativeSetFaceSwapEnabled.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ consumed: false });
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

    await waitFor(() =>
      expect(mocks.enrollFaceFile).toHaveBeenCalledWith(file),
    );
    await waitFor(() =>
      expect(mocks.nativeSetFaceSwapEnabled).toHaveBeenCalledWith(true),
    );
    await waitFor(() => expect(mocks.onReadyChange).toHaveBeenCalledWith(true));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Face enabled");
  });

  it("recovers a lost addFace acknowledgement when the authenticated status query confirms consumption", async () => {
    vi.useFakeTimers();
    try {
      mocks.addFace.mockImplementation(() => new Promise(() => undefined));
      mocks.query.mockResolvedValue({ consumed: true });
      const { container } = render(
        <FaceSettingsModal
          open
          onClose={() => undefined}
          userCode="IGIDM"
          deviceId="device-igidm"
          onReadyChange={mocks.onReadyChange}
        />,
      );

      const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Enable face" }));

      await vi.waitFor(() => expect(mocks.addFace).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await vi.waitFor(() =>
        expect(mocks.query).toHaveBeenCalledWith("getUploadRequestStatus", {
          code: "IGIDM",
          deviceId: "device-igidm",
          uploadRequestId: "request-1",
        }),
      );

      expect(mocks.onReadyChange).toHaveBeenLastCalledWith(true);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Face enabled");
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Enable face" }),
        ).toBeDisabled(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a just-committing addFace mutation before reporting failure", async () => {
    vi.useFakeTimers();
    try {
      mocks.addFace.mockImplementation(() => new Promise(() => undefined));
      mocks.query
        .mockResolvedValueOnce({ consumed: false })
        .mockResolvedValueOnce({ consumed: true });
      const { container } = render(
        <FaceSettingsModal
          open
          onClose={() => undefined}
          userCode="IGIDM"
          deviceId="device-igidm"
          onReadyChange={mocks.onReadyChange}
        />,
      );

      const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Enable face" }));

      await vi.waitFor(() => expect(mocks.addFace).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
      expect(mocks.toastError).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2));

      expect(mocks.onReadyChange).toHaveBeenLastCalledWith(true);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Face enabled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows native model-download progress without falsely timing out an active enrollment", async () => {
    vi.useFakeTimers();
    try {
      mocks.enrollFaceFile.mockImplementation(
        () => new Promise(() => undefined),
      );
      const { container, unmount } = render(
        <FaceSettingsModal
          open
          onClose={() => undefined}
          userCode="IGIDM"
          deviceId="device-igidm"
          onReadyChange={mocks.onReadyChange}
        />,
      );

      const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Enable face" }));

      await vi.waitFor(() => expect(mocks.enrollFaceFile).toHaveBeenCalled());
      await act(async () => {
        mocks.initializationProgressListener?.({ percent: 35 });
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Enabling... 35%" }),
        ).toBeDisabled(),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.generateUploadUrl).not.toHaveBeenCalled();
      expect(mocks.onReadyChange).toHaveBeenLastCalledWith(false);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits the busy state when the upload response body never settles", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: () => new Promise(() => undefined),
        })),
      );
      const { container } = render(
        <FaceSettingsModal
          open
          onClose={() => undefined}
          userCode="IGIDM"
          deviceId="device-igidm"
          onReadyChange={mocks.onReadyChange}
        />,
      );

      const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Enable face" }));

      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await vi.waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith("Timed out"),
      );
      expect(screen.getByRole("button", { name: "Enable face" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
