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
      value: { enumerateDevices: mocks.enumerateDevices },
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
});
