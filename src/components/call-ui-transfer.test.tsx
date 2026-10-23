import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalTransferNotification } from "./call-ui";

const mocks = vi.hoisted(() => ({
  pending: null as null | Record<string, unknown>,
  outgoing: null as null | Record<string, unknown>,
  respond: vi.fn(),
  confirm: vi.fn(),
  failJoin: vi.fn(),
  join: vi.fn(),
  startCall: vi.fn(),
  hangUp: vi.fn(),
  waitForTransferReady: vi.fn(),
  listCameraDevices: vi.fn(),
  query: vi.fn(),
  markWindowsVirtualCameraDevice: vi.fn(),
}));
const originalUserAgent = navigator.userAgent;

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: (reference: string) =>
    reference === "pendingTransfer" ? mocks.pending : mocks.outgoing,
  useMutation: (reference: string) =>
    ({
      respondTransfer: mocks.respond,
      confirmTransferJoined: mocks.confirm,
      failTransferJoin: mocks.failJoin,
    })[reference] ?? vi.fn(),
  useAction: (reference: string) =>
    reference === "completeTransferredRoom" ? mocks.confirm : mocks.join,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    callState: {
      pendingTransfer: "pendingTransfer",
      myOutgoingTransfer: "myOutgoingTransfer",
      respondTransfer: "respondTransfer",
      confirmTransferJoined: "confirmTransferJoined",
      failTransferJoin: "failTransferJoin",
      targetTransferStatus: "targetTransferStatus",
      contactsForTransfer: "contactsForTransfer",
      initiateTransfer: "initiateTransfer",
      cancelTransfer: "cancelTransfer",
    },
    calls: {
      joinTransferredRoom: "joinTransferredRoom",
      completeTransferredRoom: "completeTransferredRoom",
    },
  },
}));

vi.mock("@/contexts/call-context.tsx", () => ({
  PIP_HEIGHT: 140,
  PIP_WIDTH: 224,
  useCall: () => ({
    callInfo: { callId: "call-1" },
    startCall: mocks.startCall,
    hangUp: mocks.hangUp,
    waitForTransferReady: mocks.waitForTransferReady,
  }),
}));

vi.mock("@/contexts/feature-context.tsx", () => ({
  useFeatures: () => ({ can: () => true }),
}));

vi.mock("@/lib/calls/camera-control.ts", () => ({
  listCameraDevices: mocks.listCameraDevices,
  isWindowsVirtualCameraLabel: (label: string) =>
    label === "USA.Filing Virtual Camera",
}));

vi.mock("@/lib/windows-helper/call-session", () => ({
  markWindowsVirtualCameraDevice: mocks.markWindowsVirtualCameraDevice,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      callUi: new Proxy(
        {
          incomingTransferTitle: "Incoming call transfer",
          incomingTransferBody: (from: string, remote: string) =>
            `${from} wants to transfer ${remote}`,
          reject: "Decline",
          accept: "Answer",
          joinedTransferred: "Joined transferred call",
          joinTransferredFailed: "Unable to join transferred call",
          connectTransferredFailed: "Unable to connect transferred call",
          transferCompleted: "Call transferred",
          transferRejected: "Transfer declined",
          transferExpired: "Transfer expired",
          transferJoinFailedContinue:
            "Transfer failed; original call continues",
          cameraListFailed: "Unable to list cameras",
        },
        { get: (target, key) => Reflect.get(target, key) ?? String(key) },
      ),
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function pendingTransfer() {
  return {
    _id: "transfer-1",
    fromName: "Desktop",
    remoteName: "Caller",
    status: "pending",
    callId: "call-1",
  };
}

describe("GlobalTransferNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map<string, string>();
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
    mocks.pending = pendingTransfer();
    mocks.outgoing = null;
    mocks.respond.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(undefined);
    mocks.failJoin.mockResolvedValue(undefined);
    mocks.join.mockResolvedValue({
      serverUrl: "wss://live.example.test",
      token: "token",
      roomName: "room",
      callId: "call-1",
      callType: "video",
    });
    mocks.startCall.mockResolvedValue(undefined);
    mocks.waitForTransferReady.mockResolvedValue(undefined);
    mocks.hangUp.mockResolvedValue(undefined);
    mocks.listCameraDevices.mockResolvedValue([
      { deviceId: "usa-camera", label: "USA.Filing Virtual Camera" },
      { deviceId: "obs-camera", label: "OBS Virtual Camera" },
    ]);
    mocks.query.mockResolvedValue({ status: "completed" });
    localStorage.setItem("ksc_session_code", "CCCCC");
    localStorage.setItem("ksc_device_id", "device-c");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it("lets the recipient join with camera off before confirming replacement", async () => {
    render(<GlobalTransferNotification />);
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Accept without Camera" }),
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.startCall).toHaveBeenCalledWith(
      expect.objectContaining({ initialCameraEnabled: false }),
    );
    expect(mocks.waitForTransferReady.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirm.mock.invocationCallOrder[0],
    );
  });

  it("lets a web recipient select the processed camera before joining", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Windows NT 10.0",
    });
    render(<GlobalTransferNotification />);
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept with Camera" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "USA.Filing Virtual Camera" }),
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.startCall).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCameraEnabled: true,
        cameraDeviceId: "usa-camera",
      }),
    );
    expect(mocks.markWindowsVirtualCameraDevice).toHaveBeenCalledWith(
      "usa-camera",
    );
  });

  it("rolls back the recipient when media join fails", async () => {
    vi.useFakeTimers();
    mocks.startCall.mockRejectedValue(new Error("media failed"));
    render(<GlobalTransferNotification />);
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Accept without Camera" }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.failJoin).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.hangUp).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("keeps the source publisher until replacement is confirmed completed", async () => {
    mocks.pending = null;
    mocks.outgoing = { _id: "transfer-1", status: "joining" };
    const view = render(<GlobalTransferNotification />);
    expect(mocks.hangUp).not.toHaveBeenCalled();

    mocks.outgoing = { _id: "transfer-1", status: "completed" };
    view.rerender(<GlobalTransferNotification />);
    await waitFor(() => expect(mocks.hangUp).toHaveBeenCalledTimes(1));
  });

  it.each(["rejected", "expired", "failed"])(
    "keeps the original source call alive when transfer is %s",
    async (status) => {
      mocks.pending = null;
      mocks.outgoing = { _id: "transfer-1", status };
      render(<GlobalTransferNotification />);
      await act(async () => undefined);
      expect(mocks.hangUp).not.toHaveBeenCalled();
    },
  );
});
