import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSwapInviteModal } from "./face-swap-invite-modal";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  endInvite: vi.fn(),
  generateUploadUrl: vi.fn(),
  addFace: vi.fn(),
  query: vi.fn(),
  enrollFaceFile: vi.fn(),
  nativeGetStatus: vi.fn(),
  nativeRequestMediaPermissions: vi.fn(),
  nativeSetFaceSwapEnabled: vi.fn(),
  nativeConnect: vi.fn(),
  nativeDisconnect: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useAction: (name: string) =>
    name === "createFaceSwapInvite" ? mocks.createInvite : mocks.endInvite,
  useMutation: (name: string) =>
    name === "generateUploadUrl" ? mocks.generateUploadUrl : mocks.addFace,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/amigo/face-swap", () => ({
  amigoFaceSwap: {
    enrollFaceFile: mocks.enrollFaceFile,
  },
}));

vi.mock("@/lib/amigo/native-room", () => ({
  nativeAmigoRoom: {
    isAvailable: true,
    getStatus: mocks.nativeGetStatus,
    requestMediaPermissions: mocks.nativeRequestMediaPermissions,
    setFaceSwapEnabled: mocks.nativeSetFaceSwapEnabled,
    connect: mocks.nativeConnect,
    disconnect: mocks.nativeDisconnect,
  },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      common: { close: "Close" },
      faceSwapInvite: {
        nativeOnly: "Only in app",
        uploadFaceFirst: "Upload first",
        created: "Created",
        createFailed: "Create failed",
        copied: "{label} copied",
        copyFailed: "Copy failed {label}",
        shareTitle: "Share",
        shareTextLink: "Link",
        shareTextPassword: "Password",
        shareReady: "Ready",
        shareFailed: "Share failed",
        ended: "Ended",
        endFailed: "End failed",
        title: "Face Swap Call",
        subtitle: "Private call",
        body: "Use a saved face photo for this private call.",
        manageFaces: "Upload face photo",
        manageFacesHint: "Save a photo before creating the call.",
        photoName: "Photo name",
        photoChoose: "Choose photo",
        photoSaveIdle: "Save photo",
        photoSaveBusy: "Saving...",
        photoReady: "Photo saved",
        photoEnrollFailed: "Photo could not be enabled",
        photoErrorFileRead: "The saved photo could not be read.",
        photoErrorDecode: "The saved photo could not be decoded.",
        photoErrorFormat: "This image format is not supported.",
        photoErrorNoFace: "No face was detected in this photo.",
        photoErrorSdkNotReady: "The image processor is not ready.",
        photoErrorAuthorization: "Image processing authorization failed.",
        photoErrorNetwork: "Connect to the internet and try again.",
        photoErrorQuota: "The image processing limit has been reached.",
        photoErrorEnroll: "The saved photo could not be enabled.",
        operationTimedOut: "The operation timed out.",
        mediaPermissionRequired: "Allow camera and microphone access.",
        createBusy: "Creating...",
        createIdle: "Create call",
        inviteLink: "Invite link",
        copyLink: "Copy link",
        share: "Share",
        password: "Password",
        copyPassword: "Copy password",
        endBusy: "Ending...",
        endIdle: "End call",
        linkLabel: "link",
        passwordLabel: "password",
      },
      chatPage: {
        chooseImageFile: "Choose image",
        imageMaxSize: "Too large",
        imageUploadFailed: (status: number) => `Upload failed ${status}`,
        imageIdMissing: "Missing id",
        uploadRequestMissing: "Missing upload request",
        faceAdded: "Added",
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
    calls: {
      createFaceSwapInvite: "createFaceSwapInvite",
      endFaceSwapInvite: "endFaceSwapInvite",
    },
    faceLibrary: {
      generateUploadUrl: "generateUploadUrl",
      addFace: "addFace",
      listMine: "listMine",
    },
  },
}));

describe("FaceSwapInviteModal", () => {
  beforeEach(() => {
    mocks.generateUploadUrl.mockResolvedValue({
      uploadUrl: "https://uploads.example.test/face",
      requestId: "request-1",
    });
    mocks.addFace.mockResolvedValue({ faceId: "face-1" });
    mocks.query.mockResolvedValue([
      {
        _id: "face-db-1",
        faceId: "FACE-1",
        storageId: "storage-1",
        imageUrl: "https://storage.example.test/face.jpeg",
        createdAt: 1_754_900_000_000,
      },
    ]);
    mocks.enrollFaceFile.mockResolvedValue(true);
    mocks.nativeGetStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.nativeRequestMediaPermissions.mockResolvedValue({
      camera: "authorized",
      microphone: "authorized",
    });
    mocks.nativeSetFaceSwapEnabled.mockResolvedValue(undefined);
    mocks.nativeConnect.mockResolvedValue(undefined);
    mocks.nativeDisconnect.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("uploads.example.test")) {
          return {
            ok: true,
            json: async () => ({ storageId: "storage-1" }),
          };
        }
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          blob: async () =>
            new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
              type: "image/jpeg",
            }),
        };
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a face-photo upload entrypoint before creating the call", () => {
    render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Upload face photo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Save a photo before creating the call."),
    ).toBeInTheDocument();
  });

  it("requests native camera and microphone access when the call entry opens", async () => {
    render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );

    await waitFor(() =>
      expect(mocks.nativeRequestMediaPermissions).toHaveBeenCalledWith({
        openSettingsIfDenied: false,
      }),
    );
  });

  it("enrolls the saved photo in the native processor before reporting success", async () => {
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(mocks.addFace).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.query).toHaveBeenCalledWith("listMine", {
        code: "QQAUF",
        deviceId: "device-1",
      }),
    );
    await waitFor(() =>
      expect(mocks.enrollFaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ type: "image/jpeg" }),
      ),
    );
    expect(mocks.nativeGetStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Photo saved");
  });

  it("does not let the upload deadline cancel first-run native enrollment", async () => {
    vi.useFakeTimers();
    mocks.enrollFaceFile.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), 100_000);
        }),
    );
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.enrollFaceFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });

    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "The operation timed out.",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Photo saved");
  });

  it("times out a stalled persisted-photo download without timing out enrollment", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("uploads.example.test")) {
          return {
            ok: true,
            json: async () => ({ storageId: "storage-1" }),
          };
        }
        return await new Promise<Response>(() => undefined);
      }),
    );
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(mocks.toastError).toHaveBeenCalledWith("The operation timed out.");
    expect(mocks.enrollFaceFile).not.toHaveBeenCalled();
  });

  it("times out when persisted-photo response bytes never finish", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("uploads.example.test")) {
          return {
            ok: true,
            json: async () => ({ storageId: "storage-1" }),
          };
        }
        return {
          ok: true,
          blob: () => new Promise<Blob>(() => undefined),
        };
      }),
    );
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(mocks.toastError).toHaveBeenCalledWith("The operation timed out.");
    expect(mocks.enrollFaceFile).not.toHaveBeenCalled();
  });

  it("prevents create while the face photo is still being saved", async () => {
    mocks.generateUploadUrl.mockReturnValue(new Promise(() => undefined));
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    expect(screen.getByRole("button", { name: "Create call" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("rehydrates the persisted face before creating a call when native memory is empty", async () => {
    mocks.nativeGetStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.createInvite.mockResolvedValue({
      inviteId: "invite-1",
      inviteUrl: "https://example.test/video_call/invite-1",
      password: "123456",
      roomName: "room-1",
      serverUrl: "wss://live.example.test",
      operatorToken: "token-1",
      operatorIdentity: "operator-1",
    });

    render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.enrollFaceFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.createInvite).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).not.toHaveBeenCalledWith("Upload first");
  });

  it("does not report success when the persisted bytes cannot be decoded", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode failed")),
    );
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "The saved photo could not be decoded.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith("Photo saved");
    expect(mocks.enrollFaceFile).not.toHaveBeenCalled();
  });

  it("shows the native no-face error instead of the generic photo-quality error", async () => {
    mocks.enrollFaceFile.mockRejectedValue(
      Object.assign(new Error("No face was detected in the provided image."), {
        name: "FaceSwapError",
        code: "FACE_NOT_DETECTED",
        stage: "enroll",
      }),
    );
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "No face was detected in this photo.",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "Photo could not be enabled",
    );
  });

  it("reads the same persisted photo again after the modal is closed and reopened", async () => {
    mocks.createInvite.mockResolvedValue({
      inviteId: "invite-1",
      inviteUrl: "https://example.test/video_call/invite-1",
      password: "123456",
      roomName: "room-1",
      serverUrl: "wss://live.example.test",
      operatorToken: "token-1",
      operatorIdentity: "operator-1",
    });
    const { rerender } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );

    rerender(
      <FaceSwapInviteModal
        open={false}
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    rerender(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.createInvite).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
