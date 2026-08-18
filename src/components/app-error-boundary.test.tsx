import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./app-error-boundary.tsx";

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
});
