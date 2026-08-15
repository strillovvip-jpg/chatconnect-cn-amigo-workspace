import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  setEnabled: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("./bridge.ts", () => ({
  amigoBridge: {
    available: true,
    getPipelineCapabilities: vi.fn(),
    connectNativeRoom: bridge.connect,
    disconnectNativeRoom: bridge.disconnect,
    setNativeFaceSwapEnabled: bridge.setEnabled,
    getNativeRoomStatus: bridge.getStatus,
    requestMediaPermissions: vi.fn(),
  },
}));

import {
  connectNativePublisherBeforeBrowser,
  disconnectNativePublisherWithRetry,
  ensureNativePublisherConnected,
} from "./native-room";

describe("connectNativePublisherBeforeBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.connect.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.disconnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.setEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.getStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
  });

  it("reconnects a dropped processed publisher with camera only", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    const status = await ensureNativePublisherConnected({
      url: "wss://live.example.test",
      token: "native-token",
      enableMicrophone: false,
      enableCamera: true,
    });

    expect(status.connected).toBe(true);
    expect(bridge.connect).toHaveBeenCalledWith({
      url: "wss://live.example.test",
      token: "native-token",
      enableMicrophone: false,
      enableCamera: true,
    });
  });

  it("re-enables processed frames without reconnecting an intact publisher", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.setEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    const status = await ensureNativePublisherConnected({
      url: "wss://live.example.test",
      token: "native-token",
      enableMicrophone: false,
      enableCamera: true,
    });

    expect(status.faceSwapEnabled).toBe(true);
    expect(bridge.connect).not.toHaveBeenCalled();
    expect(bridge.setEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps the processed camera disabled when the user turned video off", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.setEnabled.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    const status = await ensureNativePublisherConnected({
      url: "wss://live.example.test",
      token: "native-token",
      enableMicrophone: false,
      enableCamera: false,
    });

    expect(status.faceSwapEnabled).toBe(false);
    expect(bridge.setEnabled).toHaveBeenCalledWith(false);
  });

  it("disconnects a stale native room before reconnecting the expected room", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://stale.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    await ensureNativePublisherConnected({
      url: "wss://live.example.test",
      token: "new-native-token",
      enableMicrophone: false,
      enableCamera: true,
    });

    expect(bridge.disconnect).toHaveBeenCalledTimes(1);
    expect(bridge.connect).toHaveBeenCalledWith({
      url: "wss://live.example.test",
      token: "new-native-token",
      enableMicrophone: false,
      enableCamera: true,
    });
  });

  it("disconnects an active publisher before rejecting a missing target face", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: false,
      pipeline: "native-livekit",
    });
    bridge.disconnect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: false,
      hasTargetFace: false,
      pipeline: "native-livekit",
    });

    await expect(
      ensureNativePublisherConnected({
        url: "wss://live.example.test",
        token: "native-token",
        enableMicrophone: false,
        enableCamera: true,
      }),
    ).rejects.toThrow("NATIVE_TARGET_FACE_MISSING");

    expect(bridge.disconnect).toHaveBeenCalledTimes(1);
    expect(bridge.connect).not.toHaveBeenCalled();
  });

  it("rejects a reconnect that does not produce a connected processed publisher", async () => {
    bridge.getStatus.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    bridge.connect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: false,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    await expect(
      ensureNativePublisherConnected({
        url: "wss://live.example.test",
        token: "native-token",
        enableMicrophone: false,
        enableCamera: true,
      }),
    ).rejects.toThrow("NATIVE_PUBLISHER_RECONNECT_FAILED");
  });

  it("connects the processed native publisher before the browser subscriber", async () => {
    const order: string[] = [];
    bridge.connect.mockImplementation(async () => {
      order.push("native");
      return {
        connected: true,
        roomUrl: "wss://live.example.test",
        faceSwapEnabled: true,
        hasTargetFace: true,
        pipeline: "native-livekit",
      };
    });

    await connectNativePublisherBeforeBrowser({
      native: {
        url: "wss://live.example.test",
        token: "native-token",
        enableMicrophone: false,
        enableCamera: true,
      },
      connectBrowser: async () => {
        order.push("browser");
        return "browser-connected";
      },
      disconnectBrowser: vi.fn(),
    });

    expect(order).toEqual(["native", "browser"]);
  });

  it("disconnects both transports when the browser subscriber fails", async () => {
    const disconnectBrowser = vi.fn().mockResolvedValue(undefined);

    await expect(
      connectNativePublisherBeforeBrowser({
        native: {
          url: "wss://live.example.test",
          token: "native-token",
          enableMicrophone: false,
          enableCamera: true,
        },
        connectBrowser: vi.fn().mockRejectedValue(new Error("browser failed")),
        disconnectBrowser,
      }),
    ).rejects.toThrow("browser failed");

    expect(disconnectBrowser).toHaveBeenCalledTimes(1);
    expect(bridge.disconnect).toHaveBeenCalledTimes(1);
  });

  it("never connects the browser when native publication is not connected", async () => {
    bridge.connect.mockResolvedValue({
      connected: false,
      roomUrl: null,
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });
    const connectBrowser = vi.fn();

    await expect(
      connectNativePublisherBeforeBrowser({
        native: {
          url: "wss://live.example.test",
          token: "native-token",
          enableMicrophone: false,
          enableCamera: true,
        },
        connectBrowser,
        disconnectBrowser: vi.fn(),
      }),
    ).rejects.toThrow("Native face-swap publisher did not connect");

    expect(connectBrowser).not.toHaveBeenCalled();
    expect(bridge.disconnect).toHaveBeenCalledTimes(1);
  });

  it("retries disconnect and fails closed when the native publisher remains connected", async () => {
    bridge.disconnect.mockResolvedValue({
      connected: true,
      roomUrl: "wss://live.example.test",
      faceSwapEnabled: true,
      hasTargetFace: true,
      pipeline: "native-livekit",
    });

    await expect(disconnectNativePublisherWithRetry()).rejects.toThrow(
      "NATIVE_PUBLISHER_STILL_CONNECTED",
    );

    expect(bridge.disconnect).toHaveBeenCalledTimes(3);
    expect(bridge.setEnabled).toHaveBeenCalledWith(false);
  });
});
