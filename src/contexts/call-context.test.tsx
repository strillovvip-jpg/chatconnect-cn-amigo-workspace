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
  state: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  localParticipant: MockLocalParticipant;
  remoteParticipants: Map<
    string,
    {
      identity: string;
      trackPublications: Map<unknown, { track?: unknown }>;
    }
  >;
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
};

const mocks = vi.hoisted(() => ({
  rooms: [] as MockRoom[],
  bridgeConnect: vi.fn(),
  bridgeDisconnect: vi.fn(),
  bridgeStatus: vi.fn(),
  bridgeSetEnabled: vi.fn(),
  bridgeSetCameraEnabled: vi.fn(),
  setCameraEnabled: vi.fn(),
  handleProcessedCameraFailure: vi.fn(),
  stopWindowsHelperForPublisher: vi.fn(),
  endP2PCall: vi.fn(),
  markP2PConnected: vi.fn(),
  successToast: vi.fn(),
  backendCall: null as null | {
    peerCode: string;
    peerName: string;
    status: string;
    peerIdentity?: string;
    peerPublisherIdentities?: string[];
  },
  nextRoomConnectError: null as Error | null,
  stageProps: [] as Array<Record<string, unknown>>,
  complianceProps: [] as Array<Record<string, unknown>>,
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
  useQuery: vi.fn((reference: string) =>
    reference === "callStatus" ? mocks.backendCall : null,
  ),
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
    setNativeCameraEnabled: mocks.bridgeSetCameraEnabled,
    getNativeRoomStatus: mocks.bridgeStatus,
    requestMediaPermissions: vi.fn(),
  },
}));

vi.mock("@/lib/calls/camera-control", () => ({
  setParticipantCameraEnabled: mocks.setCameraEnabled,
  handleProcessedCameraFailure: mocks.handleProcessedCameraFailure,
}));

vi.mock("@/lib/windows-helper/call-session", () => ({
  stopWindowsHelperForPublisher: mocks.stopWindowsHelperForPublisher,
  isWindowsVirtualCameraDevice: (deviceId?: string) =>
    deviceId === "usa-camera",
}));

vi.mock("@/components/livekit-stage.tsx", () => ({
  LiveKitStage: (props: Record<string, unknown>) => {
    mocks.stageProps.push(props);
    return null;
  },
}));

vi.mock("@/components/call-compliance-agent.tsx", () => ({
  CallComplianceAgent: (props: Record<string, unknown>) => {
    mocks.complianceProps.push(props);
    return null;
  },
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
    success: mocks.successToast,
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
    mocks.complianceProps.length = 0;
    mocks.backendCall = null;
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
      roomName: "contact-room",
      faceSwapEnabled: true,
      hasTargetFace: true,
      videoPublished: true,
      videoMuted: false,
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
      roomName: "contact-room",
      faceSwapEnabled: true,
      hasTargetFace: true,
      videoPublished: true,
      videoMuted: false,
      pipeline: "native-livekit",
    });
    mocks.bridgeSetEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      roomName: "contact-room",
      faceSwapEnabled: true,
      hasTargetFace: true,
      videoPublished: true,
      videoMuted: false,
      pipeline: "native-livekit",
    });
    mocks.bridgeSetCameraEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      roomName: "contact-room",
      faceSwapEnabled: true,
      hasTargetFace: true,
      videoPublished: true,
      videoMuted: true,
      pipeline: "native-livekit",
    });
    mocks.setCameraEnabled.mockResolvedValue(undefined);
    mocks.handleProcessedCameraFailure.mockImplementation(
      async ({ disableCamera, stopHelper }) => {
        await disableCamera();
        await stopHelper();
      },
    );
    mocks.stopWindowsHelperForPublisher.mockResolvedValue(false);
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
      roomName: baseCall.roomName,
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

  it("mutes the native published track when camera is turned off during face swap", async () => {
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

    await act(async () => {
      await callApi.toggleCam();
    });

    expect(mocks.bridgeSetCameraEnabled).toHaveBeenCalledWith(false);
    expect(mocks.bridgeSetEnabled).not.toHaveBeenCalledWith(false);
    expect(callApi.camOn).toBe(false);
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

  it("disconnects only local media after this endpoint transfers the call", async () => {
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
      await callApi.hangUp({ preserveBackendCall: true });
    });

    expect(mocks.bridgeDisconnect).toHaveBeenCalledTimes(1);
    expect(browserRoom.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.endP2PCall).not.toHaveBeenCalled();
  });

  it("ends Windows helper processing after the virtual-camera publisher ends", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-token",
        cameraDeviceId: "usa-camera",
      });
      await callApi.hangUp();
    });
    expect(mocks.stopWindowsHelperForPublisher).toHaveBeenCalledWith(
      "usa-camera",
    );
  });

  it("does not alter ordinary camera cleanup", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-token",
        cameraDeviceId: "physical-camera",
      });
      await callApi.hangUp();
    });
    expect(mocks.stopWindowsHelperForPublisher).toHaveBeenCalledWith(
      "physical-camera",
    );
  });

  it("keeps a failed processed camera private instead of falling back to a physical camera", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    mocks.setCameraEnabled.mockRejectedValueOnce(
      new Error("virtual camera ended"),
    );
    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "browser-token",
        cameraDeviceId: "usa-camera",
      });
    });
    expect(mocks.handleProcessedCameraFailure).toHaveBeenCalledTimes(1);
    expect(mocks.setCameraEnabled).not.toHaveBeenCalledWith(
      expect.anything(),
      true,
      "physical-camera",
    );
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
        roomName: baseCall.roomName,
        enableMicrophone: false,
        enableCamera: true,
      }),
    );
    expect(mocks.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("disconnects a native publisher that finishes reconnecting after hangup", async () => {
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
    mocks.bridgeDisconnect.mockClear();
    mocks.bridgeStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    let finishReconnect:
      | ((status: {
          connected: boolean;
          roomUrl: string;
          roomName: string;
          faceSwapEnabled: boolean;
          hasTargetFace: boolean;
          videoPublished: boolean;
          videoMuted: boolean;
          pipeline: string;
        }) => void)
      | undefined;
    mocks.bridgeConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReconnect = resolve;
        }),
    );

    act(() => {
      for (const handler of mocks.rooms[0].handlers.get("Reconnected") ?? [])
        handler();
    });
    await waitFor(() => expect(mocks.bridgeConnect).toHaveBeenCalledTimes(1));

    await act(async () => {
      await callApi.hangUp();
    });
    expect(mocks.bridgeDisconnect).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishReconnect?.({
        connected: true,
        roomUrl: baseCall.serverUrl,
        roomName: baseCall.roomName,
        faceSwapEnabled: true,
        hasTargetFace: true,
        videoPublished: true,
        videoMuted: false,
        pipeline: "native-livekit",
      });
    });

    await waitFor(() =>
      expect(mocks.bridgeDisconnect).toHaveBeenCalledTimes(2),
    );
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

  it("publishes an ordinary call with its preselected desktop camera", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "normal-browser-token",
        cameraDeviceId: "obs-camera",
      });
    });

    expect(mocks.setCameraEnabled).toHaveBeenCalledWith(
      mocks.rooms[0].localParticipant,
      true,
      "obs-camera",
    );
  });

  it("joins a transferred video call without publishing a camera when the receiver declines video", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-no-camera-token",
        initialCameraEnabled: false,
      });
    });

    expect(mocks.setCameraEnabled).not.toHaveBeenCalled();
    expect(callApi.camOn).toBe(false);
  });

  it("marks a transferred call ready when remote media arrives while local microphone and camera stay off", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-muted-token",
        remoteCode: "CALLEE",
        initialCameraEnabled: false,
      });
    });

    const room = mocks.rooms[0];
    room.localParticipant.isMicrophoneEnabled = false;
    room.localParticipant.isCameraEnabled = false;
    room.remoteParticipants.set("CALLEE-device-2", {
      identity: "CALLEE-device-2",
      trackPublications: new Map([["remote-audio", { track: {} }]]),
    });

    expect(mocks.stageProps.at(-1)).toEqual(
      expect.objectContaining({ remoteParticipantCode: "CALLEE" }),
    );
    await expect(callApi.waitForTransferReady(10)).resolves.toBeUndefined();
  });

  it("does not mark a transfer ready from the former sender's leftover media", async () => {
    render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-overlap-token",
        remoteCode: "CALLEE",
        initialCameraEnabled: false,
      });
    });

    const room = mocks.rooms[0];
    room.remoteParticipants.set("CALLER-old-device", {
      identity: "CALLER-old-device",
      trackPublications: new Map([["old-audio", { track: {} }]]),
    });

    await expect(callApi.waitForTransferReady(10)).rejects.toThrow(
      "mediaReadyTimeout",
    );
  });

  it("uses refreshed peer identities when the remaining participant reconnects during transfer readiness", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-identity-rotation-token",
        remoteCode: "CALLEE",
        remoteIdentity: "CALLEE-old-browser",
        remotePublisherIdentities: ["CALLEE-old-browser"],
        initialCameraEnabled: false,
      });
    });

    const readyPromise = callApi.waitForTransferReady(1_000);
    mocks.backendCall = {
      peerCode: "CALLEE",
      peerName: "Callee reconnected",
      peerIdentity: "CALLEE-new-browser",
      peerPublisherIdentities: ["CALLEE-new-browser"],
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    await waitFor(() =>
      expect(mocks.stageProps.at(-1)).toEqual(
        expect.objectContaining({
          remoteParticipantIdentity: "CALLEE-new-browser",
          remoteParticipantIdentities: ["CALLEE-new-browser"],
        }),
      ),
    );

    const room = mocks.rooms[0];
    room.remoteParticipants.set("CALLEE-new-browser", {
      identity: "CALLEE-new-browser",
      trackPublications: new Map([["remote-audio", { track: {} }]]),
    });
    act(() => {
      for (const handler of room.handlers.get("ParticipantConnected") ?? [])
        handler();
    });

    await expect(readyPromise).resolves.toBeUndefined();
  });

  it("rechecks transfer readiness when identity refresh arrives after remote media", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-reverse-identity-race-token",
        remoteCode: "CALLEE",
        remoteIdentity: "CALLEE-old-browser",
        remotePublisherIdentities: ["CALLEE-old-browser"],
        initialCameraEnabled: false,
      });
    });

    const readyPromise = callApi.waitForTransferReady(1_000);
    const room = mocks.rooms[0];
    room.remoteParticipants.set("CALLEE-new-browser", {
      identity: "CALLEE-new-browser",
      trackPublications: new Map([["remote-audio", { track: {} }]]),
    });
    act(() => {
      for (const handler of room.handlers.get("ParticipantConnected") ?? [])
        handler();
    });

    mocks.backendCall = {
      peerCode: "CALLEE",
      peerName: "Callee reconnected",
      peerIdentity: "CALLEE-new-browser",
      peerPublisherIdentities: ["CALLEE-new-browser"],
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    await waitFor(() =>
      expect(mocks.stageProps.at(-1)).toEqual(
        expect.objectContaining({
          remoteParticipantIdentity: "CALLEE-new-browser",
          remoteParticipantIdentities: ["CALLEE-new-browser"],
        }),
      ),
    );

    await expect(readyPromise).resolves.toBeUndefined();
    await waitFor(() => expect(callApi.participantCount).toBe(2));
    expect(callApi.callState).toBe("connected");
  });

  it("counts the new peer when a participant connects after an in-room transfer", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "transfer-new-peer-token",
        remoteCode: "CALLEE",
      });
    });

    mocks.backendCall = {
      peerCode: "NEXT",
      peerName: "Next recipient",
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );
    await waitFor(() => expect(callApi.callInfo?.remoteCode).toBe("NEXT"));

    const room = mocks.rooms[0];
    room.remoteParticipants.set("NEXT-device-2", {
      identity: "NEXT-device-2",
      trackPublications: new Map(),
    });
    act(() => {
      for (const handler of room.handlers.get("ParticipantConnected") ?? [])
        handler();
    });

    await waitFor(() => expect(callApi.participantCount).toBe(2));
    expect(callApi.callState).toBe("connected");
  });

  it("switches to the exact receiver identity for a same-code device handoff", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "same-code-transfer-token",
        remoteCode: "CALLEE",
        remoteIdentity: "CALLEE-old-desktop",
      });
    });

    mocks.backendCall = {
      peerCode: "CALLEE",
      peerName: "Callee on mobile",
      peerIdentity: "CALLEE-new-mobile",
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await waitFor(() =>
      expect(mocks.stageProps.at(-1)).toEqual(
        expect.objectContaining({
          remoteParticipantCode: "CALLEE",
          remoteParticipantIdentity: "CALLEE-new-mobile",
        }),
      ),
    );
    expect(mocks.successToast).toHaveBeenCalledTimes(1);
  });

  it("does not report a transfer when initially hydrating exact peer identities", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "identity-hydration-token",
        remoteCode: "CALLEE",
      });
    });

    mocks.backendCall = {
      peerCode: "CALLEE",
      peerName: "Callee",
      peerIdentity: "CALLEE-browser",
      peerPublisherIdentities: ["CALLEE-browser"],
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await waitFor(() =>
      expect(mocks.stageProps.at(-1)).toEqual(
        expect.objectContaining({
          remoteParticipantIdentity: "CALLEE-browser",
          remoteParticipantIdentities: ["CALLEE-browser"],
        }),
      ),
    );
    expect(mocks.successToast).not.toHaveBeenCalled();
  });

  it("keeps the peer browser and native face-swap publisher identities after handoff", async () => {
    const view = render(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    await act(async () => {
      await callApi.startCall({
        ...baseCall,
        token: "face-swap-peer-transfer-token",
        remoteCode: "CALLEE",
      });
    });

    mocks.backendCall = {
      peerCode: "CALLEE",
      peerName: "Callee face swap",
      peerIdentity: "CALLEE-new-browser",
      peerPublisherIdentities: [
        "CALLEE-new-browser",
        "CALLEE-face-swap-new-native",
      ],
      status: "connected",
    };
    view.rerender(
      <CallProvider>
        <CaptureCallContext />
      </CallProvider>,
    );

    const expectedIdentities = [
      "CALLEE-new-browser",
      "CALLEE-face-swap-new-native",
    ];
    await waitFor(() =>
      expect(mocks.stageProps.at(-1)).toEqual(
        expect.objectContaining({
          remoteParticipantIdentity: "CALLEE-new-browser",
          remoteParticipantIdentities: expectedIdentities,
        }),
      ),
    );
    expect(mocks.complianceProps.at(-1)).toEqual(
      expect.objectContaining({
        remoteParticipantIdentity: "CALLEE-new-browser",
        remoteParticipantIdentities: expectedIdentities,
      }),
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
