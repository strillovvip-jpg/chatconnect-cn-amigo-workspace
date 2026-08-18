import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./components/app-error-boundary.tsx";

const render = vi.fn();
let consoleError: ReturnType<typeof vi.spyOn>;

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render })),
}));

vi.mock("./App.tsx", () => ({
  default: () => null,
}));

describe("application bootstrap runtime errors", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  it("mounts the entire application inside the fatal UI boundary", async () => {
    await import("./main.tsx");

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]?.type).toBe(AppErrorBoundary);
  });

  it("does not replace a running app for an Event-shaped unhandled rejection", async () => {
    await import("./main.tsx");

    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    root!.innerHTML = '<div data-testid="running-app">running</div>';

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      configurable: true,
      value: { isTrusted: true },
    });
    window.dispatchEvent(rejection);

    expect(root!.querySelector('[data-testid="running-app"]')).not.toBeNull();
    expect(root!.textContent).not.toContain('{"isTrusted":true}');
    expect(consoleError).toHaveBeenCalledWith(
      "ChatConnect unhandled rejection",
      { isTrusted: true },
    );
  });

  it("does not replace a running app for a recoverable window error", async () => {
    await import("./main.tsx");

    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    root!.innerHTML = '<div data-testid="running-app">running</div>';

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("transient browser error"),
        message: "transient browser error",
      }),
    );

    expect(root!.querySelector('[data-testid="running-app"]')).not.toBeNull();
    expect(root!.textContent).not.toContain("transient browser error");
    expect(consoleError).toHaveBeenCalledWith(
      "ChatConnect fatal error",
      expect.objectContaining({ message: "transient browser error" }),
    );
  });
});
