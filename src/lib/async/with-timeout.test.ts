import { describe, expect, it, vi } from "vitest";
import { OperationTimeoutError, withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("rejects a pending operation at the deadline", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      new Promise(() => undefined),
      1_000,
      "save-face",
    );
    const rejection = expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<OperationTimeoutError>>({
        name: "OperationTimeoutError",
        operation: "save-face",
      }),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    vi.useRealTimers();
  });
});
