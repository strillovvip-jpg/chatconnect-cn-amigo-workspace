import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => {
    throw new Error("bootstrap exploded");
  }),
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
      "bootstrap exploded",
    );
  });
});
