import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockLocalParticipant = {
  trackPublications: Map<unknown, unknown>;
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  setMicrophoneEnabled: ReturnType<typeof vi.fn>;
  getTrackPublication: ReturnType<typeof vi.fn>;
  unpublishTrack: ReturnType<typeof vi.fn>;
};

type MockRoom = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  localParticipant: MockLocalParticipant;
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
};

const mocks = vi.hoisted(() => ({
  rooms: [] as MockRoom[],
  bridgeConnect: vi.fn(),
  bridgeDisconnect: vi.fn(),
  bridgeStatus: vi.fn(),
  bridgeSetEnabled: vi.fn(),
  setCameraEnabled: vi.fn(),
  endP2PCall: vi.fn(),
  markP2PConnected: vi.fn(),
  nextRoomConnectError: null as Error | null,
  stageProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("livekit-client", () => {
  const RoomEvent = {
    ParticipantConnected: "ParticipantConnected",
    ParticipantDisconnected: "ParticipantDisconnected",
    TrackSubscribed: "TrackSubscribed",
    TrackPublished: "TrackPublished",
    TrackSubscriptionFailed: "TrackSubscriptionFailed",
    LocalTrackPublished: "LocalTrackPublished",
    LocalTrackUnpublished: "LocalTrackUnpublished",
    TrackMuted: "TrackMuted",
    TrackUnmuted: "TrackUnmuted",
    Reconnecting: "Reconnecting",
    Reconnected: "Reconnected",
    Disconnected: "Disconnected",
  };
  const Track = {
    Source: {
      Camera: "camera",
      Microphone: "microphone",
      ScreenShare: "screen_share",
    },
    Kind: { Video: "video", Audio: "audio" },
  };
  class Room {
    state = "disconnected";
    remoteParticipants = new Map();
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async () => {
      if (mocks.nextRoomConnectError) throw mocks.nextRoomConnectError;
      this.state = "connected";
    });
    disconnect = vi.fn(async () => {
      this.state = "disconnected";
    });
    startAudio = vi.fn().mockResolvedValue(undefined);
    removeAllListeners = vi.fn();
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = this.handlers.get(event) ?? new Set();
      handlers.add(handler);
      this.handlers.set(event, handlers);
      return this;
    });
    off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.get(event)?.delete(handler);
      return this;
    });
    localParticipant: MockLocalParticipant;

    constructor() {
      const cameraPublication = {
        trackSid: "camera-track",
        track: { mediaStreamTrack: { readyState: "live" }, stop: vi.fn() },
      };
      const participant = {
        trackPublications: new Map(),
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
          participant.isMicrophoneEnabled = enabled;
        }),
        getTrackPublication: vi.fn((source: string) =>
          source === Track.Source.Camera ? cameraPublication : undefined,
        ),
        unpublishTrack: vi.fn().mockResolvedValue(undefined),
      };
      this.localParticipant = participant;
      mocks.rooms.push(this as unknown as MockRoom);
    }
  }
  return {
    ConnectionState: { Connected: "connected" },
    Room,
    RoomEvent,
    Track,
  };
});

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => null),
  useMutation: (reference: string) => {
    if (reference === "endP2PCall") return mocks.endP2PCall;
    if (reference === "markP2PConnected") return mocks.markP2PConnected;
    return vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    callState: {
      endP2PCall: "endP2PCall",
      markParticipantConnected: "markP2PConnected",
      heartbeatCall: "heartbeatCall",
      callStatus: "callStatus",
    },
    groupCallState: {
      leave: "leaveGroupCall",
      heartbeat: "heartbeatGroupCall",
      callStatus: "groupCallStatus",
    },
    features: { authorizeVideoSource: "authorizeVideoSource" },
  },
}));

vi.mock("@/lib/amigo/bridge.ts", () => ({
  amigoBridge: {
    available: true,
    getPipelineCapabilities: vi.fn(),
    connectNativeRoom: mocks.bridgeConnect,
    disconnectNativeRoom: mocks.bridgeDisconnect,
    setNativeFaceSwapEnabled: mocks.bridgeSetEnabled,
    getNativeRoomStatus: mocks.bridgeStatus,
    requestMediaPermissions: vi.fn(),
  },
}));

vi.mock("@/lib/calls/camera-control", () => ({
  setParticipantCameraEnabled: mocks.setCameraEnabled,
}));

vi.mock("@/components/livekit-stage.tsx", () => ({
  LiveKitStage: (props: Record<string, unknown>) => {
    mocks.stageProps.push(props);
    return null;
  },
}));

vi.mock("@/components/call-compliance-agent.tsx", () => ({
  CallComplianceAgent: () => null,
}));

vi.mock("@/lib/video-sources/video-source-manager.ts", () => ({
  VideoSourceManager: class {
    subscribe = vi.fn();
    isAISourceAvailable = vi.fn(() => false);
    dispose = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("@/contexts/feature-context.tsx", () => ({
  useFeatures: () => ({ can: () => true }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      callContext: new Proxy(
        { transferredTo: (name: string) => `Transferred to ${name}` },
        { get: (target, key) => Reflect.get(target, key) ?? String(key) },
      ),
    },
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/consultation" }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { CallProvider, useCall } from "./call-context";

let callApi: ReturnType<typeof useCall>;

function CaptureCallContext() {
  callApi = useCall();
  return null;
}

function jwt(identity: string) {
  const payload = btoa(JSON.stringify({ sub: identity }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const baseCall = {
  serverUrl: "wss://live.example.test",
  roomName: "contact-room",
  callId: "call-1",
  myName: "Caller",
  chatName: "Callee",
  callType: "video" as const,
  mode: "p2p" as const,
};

describe("CallProvider native face-swap media mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rooms.length = 0;
    mocks.stageProps.length = 0;
    mocks.nextRoomConnectError = null;
    const storage = new Map<string, string>([
      ["ksc_session_code", "CALLER"],
      ["ksc_device_id", "device-1"],
    ]);
    const localStorageStub = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageStub,
    });
    vi.stubGlobal("localStorage", localStorageStub);
    mocks.bridgeConnect.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.bridgeDisconnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.bridgeStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.bridgeSetEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    mocks.setCameraEnabled.mockResolvedValue(undefined);
    mocks.endP2PCall.mockResolvedValue(undefined);
    mocks.markP2PConnected.mockResolvedValue(undefined);
  });

  it("publishes native processed camera before joining browser microphone", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-subscriber-token",
        localMediaMode: "face-swap",
        nativeVideoToken: jwt("CALLER-native"),
        nativeVideoIdentity: "CALLER-native",
      });
    });

    const browserRoom = mocks.rooms[0];
    expect(mocks.bridgeConnect).toHaveBeenCalledWith({
      url: baseCall.serverUrl,
      token: expect.stringContaining(".signature"),
      enableMicrophone: false,
      enableCamera: true,
    });
    expect(browserRoom.connect).toHaveBeenCalledWith(
      baseCall.serverUrl,
      "browser-subscriber-token",
      { autoSubscribe: true },
    );
    expect(mocks.bridgeConnect.mock.invocationCallOrder[0]).toBeLessThan(
      browserRoom.connect.mock.invocationCallOrder[0],
    );
    expect(
      browserRoom.localParticipant.setMicrophoneEnabled,
    ).toHaveBeenCalledWith(true);
    expect(mocks.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("disconnects native publishing when browser subscription fails", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    mocks.nextRoomConnectError = new Error("browser connect failed");

    await expect(
      act(async () => {
        await callApi.startCall({
          ...baseCall,
          token: "browser-subscriber-token",
          localMediaMode: "face-swap",
          nativeVideoToken: jwt("CALLER-native"),
          nativeVideoIdentity: "CALLER-native",
        });
      }),
    ).rejects.toThrow("browser connect failed");

    expect(mocks.bridgeDisconnect).toHaveBeenCalled();
    expect(mocks.endP2PCall).toHaveBeenCalledWith({
      code: "CALLER",
      deviceId: "device-1",
      callId: "call-1",
    });
  });

  it("disconnects both native video and browser audio on hangup", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-subscriber-token",
        localMediaMode: "face-swap",
        nativeVideoToken: jwt("CALLER-native"),
        nativeVideoIdentity: "CALLER-native",
      });
    });

    const browserRoom = mocks.rooms[0];
    await act(async () => {
      await callApi.hangUp();
    });

    expect(mocks.bridgeDisconnect).toHaveBeenCalledTimes(1);
    expect(browserRoom.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.endP2PCall).toHaveBeenCalledWith({
      code: "CALLER",
      deviceId: "device-1",
      callId: "call-1",
    });
  });

  it("reconnects only the native processed publisher after room reconnection", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    const nativeToken = jwt("CALLER-native");

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-subscriber-token",
        localMediaMode: "face-swap",
        nativeVideoToken: nativeToken,
        nativeVideoIdentity: "CALLER-native",
      });
    });
    mocks.bridgeConnect.mockClear();
    mocks.setCameraEnabled.mockClear();
    mocks.bridgeStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    await act(async () => {
      for (const handler of mocks.rooms[0].handlers.get("Reconnected") ?? [])
        handler();
    });

    await waitFor(() =>
      expect(mocks.bridgeConnect).toHaveBeenCalledWith({
        url: baseCall.serverUrl,
        token: nativeToken,
        enableMicrophone: false,
        enableCamera: true,
      }),
    );
    expect(mocks.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("retries native disconnect and records an unmount cleanup failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-subscriber-token",
        localMediaMode: "face-swap",
        nativeVideoToken: jwt("CALLER-native"),
        nativeVideoIdentity: "CALLER-native",
      });
    });
    mocks.bridgeDisconnect.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    view.unmount();

    await waitFor(
      () => expect(mocks.bridgeDisconnect).toHaveBeenCalledTimes(3),
      { timeout: 2_000 },
    );
    expect(mocks.bridgeSetEnabled).toHaveBeenCalledWith(false);
    expect(consoleError).toHaveBeenCalledWith(
      "[FACE_SWAP_CALL] unmount native publisher disconnect failed",
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it("derives the local native publisher identity from its LiveKit token", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-subscriber-token",
        localMediaMode: "face-swap",
        nativePublisherToken: jwt("CALLER-native-from-token"),
      });
    });

    expect(mocks.stageProps.at(-1)).toEqual(
      expect.objectContaining({
        localPublisherIdentity: "CALLER-native-from-token",
      }),
    );
  });

  it("keeps normal calls on the existing browser microphone and camera path", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "normal-browser-token",
      });
    });

    const browserRoom = mocks.rooms[0];
    expect(mocks.bridgeConnect).not.toHaveBeenCalled();
    expect(browserRoom.connect).toHaveBeenCalledWith(
      baseCall.serverUrl,
      "normal-browser-token",
      { autoSubscribe: true },
    );
    expect(
      browserRoom.localParticipant.setMicrophoneEnabled,
    ).toHaveBeenCalledWith(true);
    expect(mocks.setCameraEnabled).toHaveBeenCalledWith(
      browserRoom.localParticipant,
      true,
    );
  });

  it("keeps an accepted ordinary call pending after a retryable setup failure", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "pending-token",
        waitForAnswer: true,
      });
    });
    mocks.nextRoomConnectError = new Error("temporary browser connect failure");

    await expect(
      act(async () => {
        await callApi.startCall({
          ...baseCall,
          token: "first-accepted-token",
          retrySetupOnFailure: true,
        });
      }),
    ).rejects.toThrow("temporary browser connect failure");

    await waitFor(() => expect(callApi.callState).toBe("ringing"));
    expect(callApi.callInfo?.callId).toBe("call-1");
    expect(mocks.endP2PCall).not.toHaveBeenCalled();
  });
});
