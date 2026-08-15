import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuestVideoCallPage from "./guest-video-call";

const mocks = vi.hoisted(() => ({
  joinInvite: vi.fn(),
  confirmInvite: vi.fn(),
  connect: vi.fn(),
  startAudio: vi.fn(),
  setMicrophoneEnabled: vi.fn(),
  setCameraEnabled: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  toastError: vi.fn(),
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
      setMicrophoneEnabled: mocks.setMicrophoneEnabled,
      setCameraEnabled: mocks.setCameraEnabled,
    };
    connect = mocks.connect;
    startAudio = mocks.startAudio;
    disconnect = mocks.disconnect;
    on = mocks.on;
  },
  RoomEvent: { Disconnected: "disconnected" },
}));

vi.mock("@/components/livekit-stage", () => ({
  LiveKitStage: () => <div data-testid="guest-call-stage" />,
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
    mocks.setMicrophoneEnabled.mockResolvedValue(undefined);
    mocks.setCameraEnabled.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
  });

  it("keeps joining when the first iOS audio unlock attempt is rejected", async () => {
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() =>
      expect(screen.getByTestId("guest-call-stage")).toBeInTheDocument(),
    );
    expect(mocks.startAudio).toHaveBeenCalledTimes(2);
    expect(mocks.connect).toHaveBeenCalledWith(
      "wss://live.example.test",
      "guest-token",
      { autoSubscribe: true },
    );
    expect(mocks.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(mocks.setCameraEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.confirmInvite).toHaveBeenCalledWith({
      inviteId: "invite-1",
      token: "guest-token",
    });
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("does not consume the invite when local media setup fails", async () => {
    mocks.setCameraEnabled.mockRejectedValueOnce(new Error("camera denied"));
    render(<GuestVideoCallPage />);
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.confirmInvite).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("guest-call-stage")).not.toBeInTheDocument();
  });
});
