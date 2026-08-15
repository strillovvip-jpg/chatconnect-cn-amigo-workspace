import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuestVideoCallPage from "./guest-video-call";

const mocks = vi.hoisted(() => ({
  joinInvite: vi.fn(),
  confirmInvite: vi.fn(),
  connect: vi.fn(),
  createLocalTracks: vi.fn(),
  startAudio: vi.fn(),
  publishTrack: vi.fn(),
  stopAudioTrack: vi.fn(),
  stopVideoTrack: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  toastError: vi.fn(),
  stageProps: null as Record<string, unknown> | null,
}));

vi.mock("convex/react", () => ({
  useAction: (name: string) =>
    name === "joinFaceSwapInvite" ? mocks.joinInvite : mocks.confirmInvite,
  useQuery: () => ({
    inviteId: "invite-1",
    status: "pending",
    requiresPassword: true,
    available: true,
    guestJoined: false,
  }),
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    calls: {
      joinFaceSwapInvite: "joinFaceSwapInvite",
      confirmFaceSwapInviteJoin: "confirmFaceSwapInviteJoin",
    },
  },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "invite-1" }),
}));

vi.mock("livekit-client", () => ({
  Room: class {
    remoteParticipants = new Map();
    localParticipant = {
      identity: "guest-1",
      publishTrack: mocks.publishTrack,
    };
    connect = mocks.connect;
    startAudio = mocks.startAudio;
    disconnect = mocks.disconnect;
    on = mocks.on;
  },
  createLocalTracks: mocks.createLocalTracks,
  RoomEvent: { Disconnected: "disconnected" },
}));

vi.mock("@/components/livekit-stage", () => ({
  LiveKitStage: (props: Record<string, unknown>) => {
    mocks.stageProps = props;
    return <div data-testid="guest-call-stage" />;
  },
}));

vi.mock("@/components/language-selector", () => ({
  LanguageSelector: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      guest: {
        invalidLink: "Invalid link",
        enterPasswordTitle: "Enter password",
        enterPasswordBody: "Enter the password.",
        passwordPlaceholder: "Password",
        joinBusy: "Joining...",
        joinIdle: "Join call",
        joinTimeout: "Timed out",
        joinError: "Could not join",
        unavailableEnded: "Ended",
        unavailableUsed: "Used",
        unavailableGeneric: "Unavailable",
        callEnded: "Call ended",
        oneToOneTitle: "Call",
        connected: "Connected",
        end: "End",
      },
    },
  }),
}));

describe("GuestVideoCallPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.joinInvite.mockResolvedValue({
      serverUrl: "wss://live.example.test",
      token: "guest-token",
      roomName: "room-1",
      inviteId: "invite-1",
      guestIdentity: "guest-1",
    });
    mocks.confirmInvite.mockResolvedValue({ confirmed: true });
    mocks.connect.mockResolvedValue(undefined);
    mocks.startAudio
      .mockRejectedValueOnce(new Error("NotAllowedError"))
      .mockResolvedValue(undefined);
    mocks.createLocalTracks.mockResolvedValue([
      { kind: "audio", stop: mocks.stopAudioTrack },
      { kind: "video", stop: mocks.stopVideoTrack },
    ]);
    mocks.publishTrack.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
  });

  it("does not request or consume an invite until iOS audio is unlocked", async () => {
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.startAudio).toHaveBeenCalledTimes(1);
    expect(mocks.joinInvite).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.confirmInvite).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not consume the invite when local media setup fails", async () => {
    mocks.startAudio.mockReset().mockResolvedValue(undefined);
    mocks.createLocalTracks.mockRejectedValueOnce(new Error("camera denied"));
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
    expect(mocks.joinInvite).not.toHaveBeenCalled();
    expect(mocks.confirmInvite).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("guest-call-stage")).not.toBeInTheDocument();
  });

  it("confirms the invite only after room and local media are ready", async () => {
    mocks.startAudio.mockReset().mockResolvedValue(undefined);
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() =>
      expect(screen.getByTestId("guest-call-stage")).toBeInTheDocument(),
    );
    expect(mocks.connect).toHaveBeenCalledWith(
      "wss://live.example.test",
      "guest-token",
      { autoSubscribe: true },
    );
    expect(mocks.createLocalTracks).toHaveBeenCalledWith({
      audio: true,
      video: {
        resolution: { width: 1280, height: 720, frameRate: 24 },
        facingMode: "user",
      },
    });
    expect(mocks.createLocalTracks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.joinInvite.mock.invocationCallOrder[0],
    );
    expect(mocks.publishTrack).toHaveBeenCalledTimes(2);
    expect(mocks.publishTrack.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.confirmInvite.mock.invocationCallOrder[0],
    );
    expect(mocks.confirmInvite).toHaveBeenCalledWith({
      inviteId: "invite-1",
      token: "guest-token",
    });
    expect(mocks.stageProps).toMatchObject({
      mode: "p2p",
      showSelfPreview: true,
      remoteVideoIdentityPrefix: "host-publisher-",
    });
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("gives the connected call a definite dynamic viewport height on iPhone Safari", async () => {
    mocks.startAudio.mockReset().mockResolvedValue(undefined);
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    const stage = await screen.findByTestId("guest-call-stage");
    const mediaRegion = stage.parentElement;
    const connectedViewport = mediaRegion?.parentElement;

    expect(connectedViewport).toHaveClass("h-[100dvh]", "overflow-hidden");
    expect(connectedViewport).not.toHaveClass("min-h-[100dvh]");
    expect(mediaRegion).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
  });

  it("stops every acquired media track when room publication fails", async () => {
    mocks.startAudio.mockReset().mockResolvedValue(undefined);
    mocks.publishTrack.mockRejectedValueOnce(new Error("publish failed"));
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.stopAudioTrack).toHaveBeenCalledTimes(1);
    expect(mocks.stopVideoTrack).toHaveBeenCalledTimes(1);
    expect(mocks.confirmInvite).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
