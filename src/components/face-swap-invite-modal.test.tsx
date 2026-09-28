import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSwapInviteModal } from "./face-swap-invite-modal";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  verifyHostReady: vi.fn(),
  endInvite: vi.fn(),
  nativeGetStatus: vi.fn(),
  nativeRequestMediaPermissions: vi.fn(),
  nativeSetFaceSwapEnabled: vi.fn(),
  nativeConnect: vi.fn(),
  nativeDisconnect: vi.fn(),
  ensureNativePublisherConnected: vi.fn(),
  viewerConnect: vi.fn(),
  viewerStartAudio: vi.fn(),
  viewerDisconnect: vi.fn(),
  viewerOn: vi.fn(),
  onFaceReadyChange: vi.fn(),
  onClose: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("livekit-client", () => ({
  Room: class {
    remoteParticipants = new Map();
    localParticipant = { identity: "operator-viewer-1" };
    connect = mocks.viewerConnect;
    startAudio = mocks.viewerStartAudio;
    disconnect = mocks.viewerDisconnect;
    on = mocks.viewerOn;
  },
  RoomEvent: { Disconnected: "disconnected" },
}));

vi.mock("@/components/livekit-stage", () => ({
  LiveKitStage: ({
    localPublisherIdentity,
  }: {
    localPublisherIdentity?: string;
  }) => (
    <div
      data-testid="host-call-stage"
      data-publisher={localPublisherIdentity}
    />
  ),
}));

vi.mock("convex/react", () => ({
  useAction: (name: string) => {
    if (name === "createFaceSwapInvite") return mocks.createInvite;
    if (name === "verifyFaceSwapInviteHostReady") return mocks.verifyHostReady;
    return mocks.endInvite;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/lib/amigo/native-room", () => ({
  disconnectNativePublisherWithRetry: mocks.nativeDisconnect,
  ensureNativePublisherConnected: mocks.ensureNativePublisherConnected,
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
        enterRoom: "Enter call",
        backToInvite: "Back to invite",
        hostRoomTitle: "Private call",
        waitingGuest: "Waiting for guest",
        hostAudioStartFailed: "Tap again to enable call audio.",
        hostConnectionLost: "The call viewer disconnected.",
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
      verifyFaceSwapInviteHostReady: "verifyFaceSwapInviteHostReady",
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
      roomName: "room-1",
      hasTargetFace: true,
      faceSwapEnabled: true,
      videoPublished: true,
      videoMuted: false,
      audioPublished: true,
      audioMuted: false,
      pipeline: "native-livekit",
    });
    mocks.nativeDisconnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      hasTargetFace: true,
      faceSwapEnabled: true,
      pipeline: "native-livekit",
    });
    mocks.viewerConnect.mockResolvedValue(undefined);
    mocks.viewerStartAudio.mockResolvedValue(undefined);
    mocks.viewerDisconnect.mockResolvedValue(undefined);
    mocks.endInvite.mockResolvedValue({ ended: true });
    mocks.verifyHostReady.mockResolvedValue({ ready: true });
    mocks.ensureNativePublisherConnected.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      hasTargetFace: true,
      faceSwapEnabled: true,
      videoPublished: true,
      videoMuted: false,
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
      operatorViewerToken: "viewer-token-1",
      operatorViewerIdentity: "operator-viewer-1",
    });
  });

  afterEach(() => {
    cleanup();
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
      roomName: "room-1",
      enableMicrophone: true,
      enableCamera: true,
    });
    expect(mocks.viewerConnect).toHaveBeenCalledWith(
      "wss://live.example.test",
      "viewer-token-1",
      { autoSubscribe: true },
    );
    expect(mocks.viewerStartAudio).not.toHaveBeenCalled();
    expect(mocks.nativeConnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyHostReady.mock.invocationCallOrder[0],
    );
    expect(mocks.verifyHostReady).toHaveBeenCalledWith({
      code: "QQAUF",
      deviceId: "device-1",
      inviteId: "invite-1",
    });
    expect(mocks.verifyHostReady.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.viewerConnect.mock.invocationCallOrder[0],
    );
    expect(
      screen.getByText("https://example.test/video_call/invite-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enter call" }),
    ).toBeInTheDocument();
  });

  it("opens a host call stage that hides the viewer identity and previews the processed publisher", async () => {
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "Enter call" });
    fireEvent.click(screen.getByRole("button", { name: "Enter call" }));

    await waitFor(() =>
      expect(mocks.viewerStartAudio).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByTestId("host-call-stage")).toHaveAttribute(
      "data-publisher",
      "operator-1",
    );
    expect(
      screen.getByRole("button", { name: "Back to invite" }),
    ).toBeInTheDocument();
  });

  it("rolls everything back if the host viewer cannot join", async () => {
    mocks.viewerConnect.mockRejectedValue(new Error("viewer connect failed"));
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.endInvite).toHaveBeenCalledTimes(1));
    expect(mocks.viewerDisconnect).toHaveBeenCalled();
    expect(mocks.nativeDisconnect).toHaveBeenCalled();
    expect(
      screen.queryByText("https://example.test/video_call/invite-1"),
    ).not.toBeInTheDocument();
  });

  it("does not expose an invitation until the backend sees the processed host track", async () => {
    mocks.verifyHostReady.mockRejectedValue(
      Object.assign(new Error("Processed host video is not ready."), {
        code: "HOST_PROCESSED_VIDEO_NOT_READY",
      }),
    );
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create call" }));

    await waitFor(() => expect(mocks.endInvite).toHaveBeenCalledTimes(1));
    expect(mocks.viewerConnect).not.toHaveBeenCalled();
    expect(
      screen.queryByText("https://example.test/video_call/invite-1"),
    ).not.toBeInTheDocument();
  });

  it("restores a muted native publisher when the app returns to the foreground", async () => {
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "Enter call" });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(mocks.ensureNativePublisherConnected).toHaveBeenCalledWith({
        url: "wss://live.example.test",
        token: "token-1",
        roomName: "room-1",
        enableMicrophone: true,
        enableCamera: true,
      }),
    );
  });

  it("forces one reconnect when the backend cannot see a locally healthy publisher", async () => {
    mocks.verifyHostReady
      .mockResolvedValueOnce({ ready: true })
      .mockRejectedValueOnce(
        new ConvexError({
          code: "HOST_PROCESSED_VIDEO_NOT_READY",
          message: "Processed host video is not ready.",
        }),
      )
      .mockResolvedValueOnce({ ready: true });
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "Enter call" });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(mocks.ensureNativePublisherConnected).toHaveBeenCalledTimes(2),
    );
    expect(mocks.nativeDisconnect).toHaveBeenCalledTimes(1);
    expect(mocks.verifyHostReady).toHaveBeenCalledTimes(3);
  });

  it("stops both local connections even when backend ending fails", async () => {
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "Enter call" });
    mocks.endInvite.mockRejectedValue(new Error("backend unavailable"));

    fireEvent.click(screen.getByRole("button", { name: "End call" }));

    await waitFor(() => expect(mocks.viewerDisconnect).toHaveBeenCalled());
    expect(mocks.nativeDisconnect).toHaveBeenCalled();
  });

  it("invalidates a normally ended invitation exactly once", async () => {
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "End call" });
    mocks.endInvite.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "End call" }));

    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(mocks.endInvite).toHaveBeenCalledTimes(1);
  });

  it("does not let an in-flight foreground restore republish after ending fails", async () => {
    let finishRestore!: (value: {
      connected: boolean;
      roomUrl: string;
      hasTargetFace: boolean;
      faceSwapEnabled: boolean;
      videoPublished: boolean;
      videoMuted: boolean;
      pipeline: string;
    }) => void;
    const restoring = new Promise<Parameters<typeof finishRestore>[0]>(
      (resolve) => {
        finishRestore = resolve;
      },
    );
    mocks.ensureNativePublisherConnected.mockReturnValueOnce(restoring);

    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "End call" });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() =>
      expect(mocks.ensureNativePublisherConnected).toHaveBeenCalledTimes(1),
    );

    mocks.endInvite.mockRejectedValue(new Error("backend unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    await waitFor(() => expect(mocks.nativeDisconnect).toHaveBeenCalled());

    finishRestore({
      connected: true,
      roomUrl: "wss://live.example.test",
      hasTargetFace: true,
      faceSwapEnabled: true,
      videoPublished: true,
      videoMuted: false,
      pipeline: "native-livekit",
    });

    await waitFor(() => expect(mocks.endInvite).toHaveBeenCalledTimes(1));
    expect(mocks.nativeDisconnect).toHaveBeenCalledTimes(2);
    expect(mocks.verifyHostReady).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(mocks.ensureNativePublisherConnected).toHaveBeenCalledTimes(1);
  });

  it("fails closed and invalidates the invite when the modal unmounts", async () => {
    const rendered = renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "End call" });
    mocks.nativeDisconnect.mockClear();
    mocks.endInvite.mockClear();

    rendered.unmount();

    await waitFor(() => expect(mocks.nativeDisconnect).toHaveBeenCalled());
    expect(mocks.endInvite).toHaveBeenCalledWith({
      code: "QQAUF",
      deviceId: "device-1",
      inviteId: "invite-1",
    });
  });

  it("fails closed when the host viewer disconnects unexpectedly", async () => {
    renderModal(true);
    await waitFor(() =>
      expect(mocks.onFaceReadyChange).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create call" }));
    await screen.findByRole("button", { name: "Enter call" });
    const disconnected = mocks.viewerOn.mock.calls.find(
      ([event]) => event === "disconnected",
    )?.[1] as (() => void) | undefined;
    expect(disconnected).toEqual(expect.any(Function));

    disconnected?.();

    await waitFor(() => expect(mocks.nativeDisconnect).toHaveBeenCalled());
    expect(mocks.endInvite).toHaveBeenCalledWith({
      code: "QQAUF",
      deviceId: "device-1",
      inviteId: "invite-1",
    });
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
