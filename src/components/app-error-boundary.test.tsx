import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./app-error-boundary.tsx";

const runtime = vi.hoisted(() => ({
  isNyfbiWebRuntime: vi.fn(() => false),
}));

vi.mock("../lib/runtime-surface.ts", () => runtime);

function BrokenProvider(): never {
  throw new Error("provider render failed");
}

describe("AppErrorBoundary", () => {
  it("renders the fatal fallback for a provider render failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenProvider />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("provider render failed")).toBeInTheDocument();
  });

  it("does not expose a CJK error message on the nyfbi English website", () => {
    runtime.isNyfbiWebRuntime.mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    function BrokenNyfbiProvider(): never {
      throw new Error("应用启动失败：授权码无效");
    }

    render(
      <AppErrorBoundary>
        <BrokenNyfbiProvider />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByText("An unexpected application error occurred."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/应用启动失败/)).not.toBeInTheDocument();
  });

  it("keeps the original error message outside the nyfbi website", () => {
    runtime.isNyfbiWebRuntime.mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    function BrokenNativeProvider(): never {
      throw new Error("應用程式啟動失敗：原生診斷");
    }

    render(
      <AppErrorBoundary>
        <BrokenNativeProvider />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("應用程式啟動失敗：原生診斷")).toBeInTheDocument();
  });
});
