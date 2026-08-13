import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSwapInviteModal } from "./face-swap-invite-modal";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  endInvite: vi.fn(),
  nativeGetStatus: vi.fn(),
  nativeRequestMediaPermissions: vi.fn(),
  nativeSetFaceSwapEnabled: vi.fn(),
  nativeConnect: vi.fn(),
  nativeDisconnect: vi.fn(),
  onFaceReadyChange: vi.fn(),
  onClose: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (name: string) =>
    name === "createFaceSwapInvite" ? mocks.createInvite : mocks.endInvite,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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
        uploadFaceFirst: "Enable a face first",
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
        body: "Use the enabled face for this private call.",
        photoEnrollFailed: "Face unavailable",
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
  },
}));

function renderModal(faceReady = true) {
  return render(
    <FaceSwapInviteModal
      open
      onClose={mocks.onClose}
      userCode="QQAUF"
      deviceId="device-1"
      faceReady={faceReady}
      onFaceReadyChange={mocks.onFaceReadyChange}
    />,
  );
}

describe("FaceSwapInviteModal", () => {
  beforeEach(() => {
    mocks.nativeGetStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    mocks.nativeRequestMediaPermissions.mockResolvedValue({
      camera: "authorized",
      microphone: "authorized",
    });
    mocks.nativeSetFaceSwapEnabled.mockResolvedValue({
      connected: false,
      roomUrl: null,
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    mocks.nativeConnect.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    mocks.nativeDisconnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    mocks.endInvite.mockResolvedValue({ ended: true });
    mocks.createInvite.mockResolvedValue({
      inviteId: "invite-1",
      inviteUrl: "https://example.test/video_call/invite-1",
      password: "123456",
      roomName: "room-1",
      serverUrl: "wss://live.example.test",
      operatorToken: "token-1",
      operatorIdentity: "operator-1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("contains only call creation and never contains face upload controls", () => {
    renderModal();

    expect(
      screen.queryByRole("button", { name: /upload/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save photo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create call" }),
    ).toBeInTheDocument();
  });

  it("keeps call creation disabled until native enrollment is ready", () => {
    renderModal(false);
    expect(screen.getByRole("button", { name: "Create call" })).toBeDisabled();
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("creates and connects the room with the already-enrolled native face", async () => {
    mocks.nativeGetStatus.mockResolvedValue({
      hasTargetFace: true,
      faceSwapEnabled: true,
    });
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.nativeConnect).toHaveBeenCalledTimes(1));
    expect(mocks.nativeSetFaceSwapEnabled).not.toHaveBeenCalled();
    expect(mocks.nativeConnect).toHaveBeenCalledWith({
      url: "wss://live.example.test",
      token: "token-1",
      enableMicrophone: true,
      enableCamera: true,
    });
    expect(
      screen.getByText("https://example.test/video_call/invite-1"),
    ).toBeInTheDocument();
  });

  it("refuses the call if native memory no longer contains the enrolled face", async () => {
    mocks.nativeGetStatus
      .mockResolvedValueOnce({ hasTargetFace: true, faceSwapEnabled: true })
      .mockResolvedValueOnce({ hasTargetFace: false, faceSwapEnabled: false });
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(false),
    );
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("re-enables the retained native face before creating", async () => {
    mocks.nativeGetStatus
      .mockResolvedValueOnce({ hasTargetFace: true, faceSwapEnabled: true })
      .mockResolvedValueOnce({ hasTargetFace: true, faceSwapEnabled: false });
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.createInvite).toHaveBeenCalledTimes(1));
    expect(mocks.nativeSetFaceSwapEnabled).toHaveBeenCalledWith(true);
    expect(mocks.nativeSetFaceSwapEnabled).toHaveBeenCalledTimes(1);
  });

  it("shows the native connection stage, code, and original message and rolls the invite back", async () => {
    const nativeError = Object.assign(
      new Error("VideoCapturer dimensions are not resolved"),
      {
        code: "LIVEKIT_PROCESSED_VIDEO_PUBLISH_FAILED",
        data: { stage: "processed-video-publish", nativeCode: 9 },
      },
    );
    mocks.nativeConnect.mockRejectedValue(nativeError);
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "[processed-video-publish/LIVEKIT_PROCESSED_VIDEO_PUBLISH_FAILED] VideoCapturer dimensions are not resolved",
      ),
    );
    expect(mocks.endInvite).toHaveBeenCalledWith({
      code: "QQAUF",
      deviceId: "device-1",
      inviteId: "invite-1",
    });
    expect(mocks.nativeDisconnect).toHaveBeenCalled();
  });

  it("keeps the modal open while call creation is in flight", async () => {
    let releasePermissions!: (value: {
      camera: string;
      microphone: string;
    }) => void;
    mocks.nativeRequestMediaPermissions.mockReturnValue(
      new Promise((resolve) => {
        releasePermissions = resolve;
      }),
    );
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton).toBeDisabled();
    fireEvent.click(closeButton);
    expect(mocks.onClose).not.toHaveBeenCalled();

    releasePermissions({ camera: "authorized", microphone: "authorized" });
    await waitFor(() => expect(mocks.nativeConnect).toHaveBeenCalledTimes(1));
  });

  it("retries an idempotent invite rollback and reports a distinct rollback failure", async () => {
    mocks.nativeConnect.mockRejectedValue(
      Object.assign(new Error("publish failed"), {
        code: "LIVEKIT_PROCESSED_VIDEO_PUBLISH_FAILED",
        data: { stage: "processed-video-publish" },
      }),
    );
    mocks.endInvite.mockRejectedValue(new Error("Convex rollback unavailable"));
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.endInvite).toHaveBeenCalledTimes(2));
    expect(mocks.toastError).toHaveBeenCalledWith(
      "[rollback-room-invite/INVITE_ROLLBACK_FAILED] Convex rollback unavailable",
    );
    expect(mocks.nativeDisconnect).toHaveBeenCalled();
  });

  it("does not present an invite when native connect resolves without a connected host", async () => {
    mocks.nativeConnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "[connect-native-room/NATIVE_ROOM_NOT_CONNECTED] Native room returned without a connected host.",
      ),
    );
    expect(
      screen.queryByText("https://example.test/video_call/invite-1"),
    ).not.toBeInTheDocument();
    expect(mocks.endInvite).toHaveBeenCalledWith({
      code: "QQAUF",
      deviceId: "device-1",
      inviteId: "invite-1",
    });
    expect(mocks.nativeDisconnect).toHaveBeenCalled();
  });
});
