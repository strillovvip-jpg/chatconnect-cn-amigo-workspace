import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreCallSelector } from "./pre-call-selector";

const mocks = vi.hoisted(() => ({
  enumerateDevices: vi.fn(),
  getUserMedia: vi.fn(),
}));

vi.mock("@/contexts/feature-context.tsx", () => ({
  useFeatures: () => ({ can: () => true }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      preCall: {
        dialogLabel: "Choose call mode",
        title: "Choose call mode",
        callPrefix: "Calling",
        close: "Close",
        camera: "Camera",
        videoFile: "Video file",
        audioOnly: "Audio only",
        chooseVideo: "Choose video",
        videoLoopHint: "The video loops.",
        preparing: "Preparing...",
        start: "Start call",
        virtualCameraMissing:
          "USA.Filing Virtual Camera is not available. Start the helper or choose another camera.",
      },
    },
  }),
}));

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function device(
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: "group-1",
    toJSON: () => ({ kind, deviceId, label, groupId: "group-1" }),
  };
}

describe("PreCallSelector camera selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: mocks.enumerateDevices,
        getUserMedia: mocks.getUserMedia,
      },
    });
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    mocks.enumerateDevices.mockResolvedValue([
      device("audioinput", "microphone-1", "Desk microphone"),
      device("videoinput", "built-in-camera", "Built-in Camera"),
      device("videoinput", "obs-camera", "OBS Virtual Camera"),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists desktop video inputs and confirms the selected camera", async () => {
    setViewport(1280);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const cameraSelect = await screen.findByRole("combobox", {
      name: "Camera",
    });
    expect(
      within(cameraSelect).getByRole("option", { name: "Built-in Camera" }),
    ).toBeInTheDocument();
    expect(
      within(cameraSelect).getByRole("option", {
        name: "OBS Virtual Camera",
      }),
    ).toBeInTheDocument();
    expect(
      within(cameraSelect).queryByRole("option", { name: "Desk microphone" }),
    ).not.toBeInTheDocument();

    fireEvent.change(cameraSelect, { target: { value: "obs-camera" } });
    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        callType: "video",
        cameraDeviceId: "obs-camera",
      }),
    );
  });

  it("unlocks camera permission before listing virtual cameras", async () => {
    setViewport(1280);
    mocks.enumerateDevices
      .mockResolvedValueOnce([
        device("videoinput", "built-in-camera", ""),
      ])
      .mockResolvedValueOnce([
        device("videoinput", "built-in-camera", "Built-in Camera"),
        device("videoinput", "obs-camera", "OBS Virtual Camera"),
      ]);

    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const cameraSelect = await screen.findByRole("combobox", {
      name: "Camera",
    });
    expect(mocks.getUserMedia).toHaveBeenCalledWith({
      video: true,
      audio: false,
    });
    expect(
      within(cameraSelect).getByRole("option", {
        name: "OBS Virtual Camera",
      }),
    ).toBeInTheDocument();
  });

  it("keeps camera selection off the mobile preparation page", async () => {
    setViewport(390);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: "Camera" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ callType: "video" }),
    );
    expect(mocks.enumerateDevices).not.toHaveBeenCalled();
  });

  it("automatically selects the exact USA.Filing virtual camera", async () => {
    setViewport(1280);
    mocks.enumerateDevices.mockResolvedValue([
      device("videoinput", "built-in-camera", "Built-in Camera"),
      device("videoinput", "usa-camera", "USA.Filing Virtual Camera"),
      device("videoinput", "similar-camera", "USA Filing Camera Preview"),
    ]);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByRole("combobox", { name: "Camera" })).toHaveValue(
      "usa-camera",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start call" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        callType: "video",
        cameraDeviceId: "usa-camera",
      }),
    );
  });

  it("keeps an explicit OBS override instead of restoring the preferred camera", async () => {
    setViewport(1280);
    mocks.enumerateDevices.mockResolvedValue([
      device("videoinput", "usa-camera", "USA.Filing Virtual Camera"),
      device("videoinput", "obs-camera", "OBS Virtual Camera"),
    ]);

    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const cameraSelect = await screen.findByRole("combobox", { name: "Camera" });
    fireEvent.change(cameraSelect, { target: { value: "obs-camera" } });
    fireEvent.click(screen.getByRole("button", { name: "Audio only" }));
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(cameraSelect).toHaveValue("obs-camera");
  });

  it("shows recovery copy when the USA.Filing virtual camera is missing", async () => {
    setViewport(1280);
    mocks.enumerateDevices.mockResolvedValue([
      device("videoinput", "built-in-camera", "Built-in Camera"),
    ]);
    render(
      <PreCallSelector
        contactName="Callee"
        onClose={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        expectWindowsVirtualCamera
      />,
    );
    expect(
      await screen.findByText(
        "USA.Filing Virtual Camera is not available. Start the helper or choose another camera.",
      ),
    ).toBeInTheDocument();
  });
});
