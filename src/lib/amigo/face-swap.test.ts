import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmigoFaceSwapService } from "./face-swap";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  enrollFace: vi.fn(),
}));

vi.mock("./bridge.ts", () => ({
  amigoBridge: {
    available: true,
    initialize: mocks.initialize,
    enrollFace: mocks.enrollFace,
    processFrame: vi.fn(),
  },
}));

describe("AmigoFaceSwapService", () => {
  beforeEach(() => {
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.enrollFace.mockReset().mockResolvedValue(true);
    vi.stubGlobal("localStorage", {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("initializes and enrolls a selected file as one awaited operation", async () => {
    const service = new AmigoFaceSwapService("api-key");
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });

    await expect(service.enrollFaceFile(file)).resolves.toBe(true);

    expect(mocks.initialize).toHaveBeenCalledWith("api-key");
    expect(mocks.enrollFace).toHaveBeenCalledTimes(1);
    expect(service.hasTargetFace).toBe(true);
  });
});
