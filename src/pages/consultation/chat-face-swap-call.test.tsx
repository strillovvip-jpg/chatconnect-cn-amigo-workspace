import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChatPage from "./chat";

const mocks = vi.hoisted(() => ({
  getOrCreateRoom: vi.fn(),
  startCall: vi.fn(),
  flags: {
    canVideoCall: true,
    canVoiceCall: true,
    canAIFace: true,
    canVideoSource: true,
    canPlayVideo: true,
    canScreenShare: true,
    canTransferCall: true,
    canGroupCall: true,
    canPictureInPicture: true,
    canFloatingWindow: true,
    canFileSearch: true,
    canRecord: true,
  },
  nativeGetStatus: vi.fn(),
  nativeRequestPermissions: vi.fn(),
  nativeSetEnabled: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => mocks.getOrCreateRoom,
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/contexts/call-context.tsx", () => ({
  useCall: () => ({ startCall: mocks.startCall }),
}));

vi.mock("@/contexts/feature-context.tsx", () => ({
  useFeatures: () => ({
    flags: mocks.flags,
    can: (key: keyof typeof mocks.flags) => mocks.flags[key],
  }),
}));

vi.mock("@/lib/amigo/native-room", () => ({
  nativeAmigoRoom: {
    isAvailable: true,
    getStatus: mocks.nativeGetStatus,
    requestMediaPermissions: mocks.nativeRequestPermissions,
    setFaceSwapEnabled: mocks.nativeSetEnabled,
  },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      consultation: { faceSwapVideo: "Face Swap Call" },
      faceSwapInvite: {
        nativeOnly: "Native only",
        uploadFaceFirst: "Enable a face",
        mediaPermissionRequired: "Allow camera and microphone",
        photoErrorSdkNotReady: "Native not ready",
        photoErrorEnroll: "Enable failed",
        createFailed: "Call failed",
      },
      chatPage: {
        remoteUser: "Remote",
        selfUser: "Me",
        startCallFailed: "Call failed",
        back: "Back",
        online: "Online",
        startVoiceCall: "Voice call",
        startVideoCall: "Video call",
        loadMore: "Load more",
        sendAttachment: "Attachment",
        messagePlaceholder: "Message",
        sendMessage: "Send",
      },
    },
  }),
}));

vi.mock("./chat-message-content", () => ({
  ChatMessageContent: () => null,
}));

function renderChat() {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/consultation/chat/BBBBB",
          state: { chatName: "Callee", myCode: "AAAAA", myName: "Caller" },
        },
      ]}
    >
      <Routes>
        <Route path="/consultation/chat/:theirCode" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ChatPage contact face-swap calling", () => {
  beforeEach(() => {
    mocks.flags.canAIFace = true;
    mocks.nativeGetStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.nativeRequestPermissions.mockResolvedValue({
      camera: "authorized",
      microphone: "authorized",
    });
    mocks.nativeSetEnabled.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.getOrCreateRoom.mockResolvedValue({
      serverUrl: "",
      token: "",
      roomName: "room-a-b",
      callId: "call-1",
      myCode: "AAAAA",
      remoteCode: "BBBBB",
      callType: "video",
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
    });
    mocks.startCall.mockResolvedValue(undefined);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "ksc_device_id" ? "device-a" : null),
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not show the entry if any full-feature flag is missing", () => {
    mocks.flags.canAIFace = false;
    renderChat();

    expect(
      screen.queryByRole("button", { name: "Face Swap Call" }),
    ).not.toBeInTheDocument();
  });

  it("preflights before signaling and starts the contact call in face-swap mode", async () => {
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Face Swap Call" }));

    await waitFor(() => expect(mocks.startCall).toHaveBeenCalledTimes(1));
    expect(mocks.getOrCreateRoom).toHaveBeenCalledWith({
      myCode: "AAAAA",
      theirCode: "BBBBB",
      myName: "Caller",
      deviceId: "device-a",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    expect(mocks.startCall).toHaveBeenCalledWith(
      expect.objectContaining({
        callerMediaMode: "face-swap",
        localMediaMode: "face-swap",
        callType: "video",
        waitForAnswer: true,
      }),
    );
  });
});
