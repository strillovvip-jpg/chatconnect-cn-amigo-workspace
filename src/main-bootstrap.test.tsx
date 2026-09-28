import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => {
    throw new Error("应用启动失败：初始化错误");
  }),
}));

vi.mock("./lib/runtime-surface.ts", () => ({
  isNyfbiWebRuntime: () => true,
}));

vi.mock("./App.tsx", () => ({
  default: () => null,
}));

describe("application bootstrap fatal fallback", () => {
  it("renders the fatal page when the root cannot be created", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("./main.tsx");

    expect(document.getElementById("root")?.textContent).toContain(
      "An unexpected application error occurred.",
    );
    expect(document.getElementById("root")?.textContent).not.toContain(
      "应用启动失败",
    );
  });
});
