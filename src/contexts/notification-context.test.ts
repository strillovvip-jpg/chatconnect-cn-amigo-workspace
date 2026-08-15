import { describe, expect, it, vi } from "vitest";
import { connectAcceptedOutgoingCall } from "./notification-context";

describe("connectAcceptedOutgoingCall", () => {
  it("retries token authorization but starts media only once", async () => {
    const details = { token: "browser-token" };
    const join = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary auth failure"))
      .mockResolvedValue(details);
    const start = vi.fn().mockResolvedValue(undefined);

    await connectAcceptedOutgoingCall({
      join,
      start,
      waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
    });

    expect(join).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledExactlyOnceWith(details);
  });

  it("does not mint another token after media setup rolls back", async () => {
    const details = {
      token: "browser-token",
      localMediaMode: "face-swap" as const,
    };
    const join = vi.fn().mockResolvedValue(details);
    const start = vi.fn().mockRejectedValue(new Error("native failed"));

    await expect(
      connectAcceptedOutgoingCall({
        join,
        start,
        waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
        shouldRetryStart: (joined) =>
          joined.localMediaMode !== "face-swap",
      }),
    ).rejects.toThrow("native failed");

    expect(join).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-retryable media failure even when its cleanup changes call state", async () => {
    let cancelled = false;
    let backendCallActive = true;
    const mediaError = new Error("native processed camera failed");

    await expect(
      connectAcceptedOutgoingCall({
        join: vi.fn().mockResolvedValue({
          token: "browser-token",
          localMediaMode: "face-swap" as const,
        }),
        start: vi.fn().mockImplementation(async () => {
          cancelled = true;
          throw mediaError;
        }),
        waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
        shouldRetryStart: () => false,
        isCancelled: () => cancelled,
        onTerminalFailure: async () => {
          backendCallActive = false;
        },
      }),
    ).rejects.toBe(mediaError);

    expect(backendCallActive).toBe(false);
  });

  it("preserves the existing retry behavior for ordinary calls", async () => {
    const details = {
      token: "browser-token",
      localMediaMode: "camera" as const,
    };
    const join = vi.fn().mockResolvedValue(details);
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary browser failure"))
      .mockResolvedValue(undefined);

    await connectAcceptedOutgoingCall({
      join,
      start,
      waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
      shouldRetryStart: (joined) => joined.localMediaMode !== "face-swap",
    });

    expect(join).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("stops before another join when the call is cancelled during retry wait", async () => {
    let cancelled = false;
    const join = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary auth failure"))
      .mockResolvedValue({ token: "unused-token" });
    const start = vi.fn().mockResolvedValue(undefined);

    const connected = await connectAcceptedOutgoingCall({
      join,
      start,
      waitBeforeRetry: async () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });

    expect(connected).toBe(false);
    expect(join).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start media when the call is cancelled while authorization resolves", async () => {
    let cancelled = false;
    const join = vi.fn().mockImplementation(async () => {
      cancelled = true;
      return { token: "stale-token" };
    });
    const start = vi.fn().mockResolvedValue(undefined);

    const connected = await connectAcceptedOutgoingCall({
      join,
      start,
      waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
      isCancelled: () => cancelled,
    });

    expect(connected).toBe(false);
    expect(join).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("clears the backend call after a terminal join failure", async () => {
    let backendCallActive = true;
    const terminalError = new Error("authorization permanently failed");

    await expect(
      connectAcceptedOutgoingCall({
        join: vi.fn().mockRejectedValue(terminalError),
        start: vi.fn().mockResolvedValue(undefined),
        waitBeforeRetry: vi.fn().mockResolvedValue(undefined),
        onTerminalFailure: async () => {
          backendCallActive = false;
        },
      }),
    ).rejects.toBe(terminalError);

    expect(backendCallActive).toBe(false);
  });
});
