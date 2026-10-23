import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsFaceSwapSetup } from "./windows-face-swap-setup";

const copy = {
  title: "Windows face swap",
  windowsOnly: "Use a Windows computer.",
  fullFeatureOnly: "A full-feature authorization code is required.",
  checking: "Checking local helper...",
  installRequired: "Install the Windows helper.",
  downloadHelper: "Download helper",
  outdated: "Update the Windows helper.",
  engineUnavailable: "The licensed face-swap engine is not installed yet.",
  selectPhoto: "Choose face photo",
  photoHint: "JPG or PNG, up to 15 MB.",
  invalidPhoto: "Choose a JPG or PNG image.",
  photoTooLarge: "The image must be 15 MB or smaller.",
  localConsent: "Process this photo only on this computer",
  enroll: "Use this face",
  enrolling: "Preparing face...",
  ready: "Face is ready.",
  start: "Start virtual camera",
  stop: "Stop virtual camera",
  clear: "Clear face",
  preview: "Virtual camera is running.",
  retry: "Try again",
  unavailableRecovery: "Open or install the helper, then try again.",
  genericError: "The helper could not complete the request.",
};

function client(overrides: Record<string, unknown> = {}) {
  return {
    detect: vi.fn().mockResolvedValue({
      apiVersion: "1",
      helperVersion: "0.1.0",
      engineReady: true,
      virtualCameraReady: true,
      processingState: "idle",
    }),
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    enrollFace: vi
      .fn()
      .mockResolvedValue({ enrolled: true, faceCount: 1, error: null }),
    start: vi
      .fn()
      .mockResolvedValue({
        state: "processing",
        framesPerSecond: 24,
        error: null,
      }),
    stop: vi
      .fn()
      .mockResolvedValue({ state: "stopped", framesPerSecond: 0, error: null }),
    clearFace: vi
      .fn()
      .mockResolvedValue({
        state: "face-cleared",
        framesPerSecond: 0,
        error: null,
      }),
    ...overrides,
  };
}

function renderSetup(options: Record<string, unknown> = {}) {
  return render(
    <WindowsFaceSwapSetup
      authorizationCode="ABCDE"
      deviceId="desktop-1"
      fullFeature
      platform="Win32"
      copy={copy}
      createAssertion={vi.fn().mockResolvedValue({ assertion: "assertion-1" })}
      client={client() as never}
      {...options}
    />,
  );
}

describe("WindowsFaceSwapSetup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explains that setup is unavailable outside Windows", () => {
    renderSetup({ platform: "iPhone" });
    expect(screen.getByText(copy.windowsOnly)).toBeInTheDocument();
  });

  it("denies setup to a limited authorization code", () => {
    renderSetup({ fullFeature: false });
    expect(screen.getByText(copy.fullFeatureOnly)).toBeInTheDocument();
  });

  it("shows a helper download prompt when loopback is unavailable", async () => {
    renderSetup({
      client: client({
        detect: vi.fn().mockRejectedValue({ code: "HELPER_UNAVAILABLE" }),
      }),
    });
    expect(await screen.findByText(copy.installRequired)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: copy.downloadHelper }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.unavailableRecovery)).toBeInTheDocument();
  });

  it("accepts JPG and PNG but rejects other formats and files over 15 MB", async () => {
    renderSetup();
    const input = await screen.findByLabelText(copy.selectPhoto);

    fireEvent.change(input, {
      target: { files: [new File(["x"], "face.webp", { type: "image/webp" })] },
    });
    expect(screen.getByText(copy.invalidPhoto)).toBeInTheDocument();

    const tooLarge = new File(["x"], "face.png", { type: "image/png" });
    Object.defineProperty(tooLarge, "size", { value: 15 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [tooLarge] } });
    expect(screen.getByText(copy.photoTooLarge)).toBeInTheDocument();

    fireEvent.change(input, {
      target: { files: [new File(["ok"], "face.jpg", { type: "image/jpeg" })] },
    });
    expect(screen.queryByText(copy.invalidPhoto)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.photoTooLarge)).not.toBeInTheDocument();
  });

  it("requires local-processing confirmation before enrollment", async () => {
    const helper = client();
    renderSetup({ client: helper });
    const input = await screen.findByLabelText(copy.selectPhoto);
    fireEvent.change(input, {
      target: { files: [new File(["ok"], "face.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: copy.enroll })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: copy.localConsent }));
    fireEvent.click(screen.getByRole("button", { name: copy.enroll }));
    await waitFor(() => expect(helper.enrollFace).toHaveBeenCalled());
    expect(helper.enrollFace).toHaveBeenCalledWith(expect.any(File), {
      confirmed: true,
    });
  });

  it("shows enrollment, preview, stop, and clear-face states", async () => {
    let finishEnrollment!: (value: unknown) => void;
    const helper = client({
      enrollFace: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finishEnrollment = resolve;
          }),
      ),
    });
    renderSetup({ client: helper });
    const input = await screen.findByLabelText(copy.selectPhoto);
    fireEvent.change(input, {
      target: { files: [new File(["ok"], "face.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: copy.localConsent }));
    fireEvent.click(screen.getByRole("button", { name: copy.enroll }));
    expect(screen.getByText(copy.enrolling)).toBeInTheDocument();
    finishEnrollment({ enrolled: true, faceCount: 1, error: null });
    expect(await screen.findByText(copy.ready)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.start }));
    expect(await screen.findByText(copy.preview)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.stop }));
    await waitFor(() => expect(helper.stop).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: copy.clear }));
    await waitFor(() => expect(helper.clearFace).toHaveBeenCalled());
    expect(screen.getByLabelText(copy.selectPhoto)).toBeInTheDocument();
  });

  it("shows update recovery for an unsupported helper", async () => {
    renderSetup({
      client: client({
        detect: vi.fn().mockRejectedValue({ code: "UNSUPPORTED_VERSION" }),
      }),
    });
    expect(await screen.findByText(copy.outdated)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.retry }),
    ).toBeInTheDocument();
  });

  it("states that the licensed engine is unavailable without presenting a fake ready state", async () => {
    renderSetup({
      client: client({
        detect: vi.fn().mockResolvedValue({
          apiVersion: "1",
          helperVersion: "0.1.0",
          engineReady: false,
          virtualCameraReady: false,
          processingState: "idle",
        }),
      }),
    });
    expect(await screen.findByText(copy.engineUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(copy.ready)).not.toBeInTheDocument();
  });
});
