import { describe, expect, test, vi } from "vitest";
import {
  completeTransferWithRecovery,
  shouldHangUpTransferredCall,
  startTransferCompletionRecovery,
} from "./transfer-completion";

describe("shouldHangUpTransferredCall", () => {
  test("only permits cleanup while the original transferred call is still active", () => {
    expect(shouldHangUpTransferredCall("call-1", "call-1")).toBe(true);
    expect(shouldHangUpTransferredCall("call-2", "call-1")).toBe(false);
    expect(shouldHangUpTransferredCall(undefined, "call-1")).toBe(false);
  });
});

describe("completeTransferWithRecovery", () => {
  test("treats a lost response as success after the server committed", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("network lost"));
    const readStatus = vi.fn().mockResolvedValue("completed");

    await expect(
      completeTransferWithRecovery({ complete, readStatus, retryDelayMs: 0 }),
    ).resolves.toEqual({ outcome: "completed" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  test("retries an incomplete transfer before reporting failure", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    const readStatus = vi.fn().mockResolvedValue("joining");

    await expect(
      completeTransferWithRecovery({ complete, readStatus, retryDelayMs: 0 }),
    ).resolves.toEqual({ outcome: "completed" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  test("keeps the live call unconfirmed when a committed action response and every status read are lost", async () => {
    const responseLostAfterCommit = new Error("action response lost");
    const complete = vi.fn().mockRejectedValue(responseLostAfterCommit);
    const readStatus = vi.fn().mockRejectedValue(new Error("query offline"));

    await expect(
      completeTransferWithRecovery({
        complete,
        readStatus,
        maxAttempts: 3,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({
      outcome: "unconfirmed",
      error: responseLostAfterCommit,
    });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  test.each(["failed", "expired"] as const)(
    "reports the explicit %s state as terminal",
    async (status) => {
      const completionError = new Error("completion rejected");
      const complete = vi.fn().mockRejectedValue(completionError);
      const readStatus = vi.fn().mockResolvedValue(status);

      await expect(
        completeTransferWithRecovery({
          complete,
          readStatus,
          retryDelayMs: 0,
        }),
      ).resolves.toEqual({
        outcome: "terminal",
        status,
        error: completionError,
      });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(readStatus).toHaveBeenCalledTimes(1);
    },
  );

  test("continues an unconfirmed completion in a bounded background reconciliation", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("foreground response 1 lost"))
      .mockRejectedValueOnce(new Error("foreground response 2 lost"))
      .mockRejectedValueOnce(new Error("background response 1 lost"))
      .mockRejectedValueOnce(new Error("background response 2 lost"))
      .mockResolvedValueOnce(undefined);
    const readStatus = vi.fn().mockRejectedValue(new Error("query offline"));

    const recovery = await startTransferCompletionRecovery({
      complete,
      readStatus,
      foregroundAttempts: 2,
      foregroundRetryDelayMs: 0,
      backgroundAttempts: 3,
      backgroundRetryDelayMs: 0,
    });

    expect(recovery.initial.outcome).toBe("unconfirmed");
    await expect(recovery.reconciliation).resolves.toEqual({
      outcome: "completed",
    });
    expect(complete).toHaveBeenCalledTimes(5);
  });

  test("does not start background reconciliation after an explicit terminal state", async () => {
    const recovery = await startTransferCompletionRecovery({
      complete: vi.fn().mockRejectedValue(new Error("completion rejected")),
      readStatus: vi.fn().mockResolvedValue("expired"),
      foregroundRetryDelayMs: 0,
      backgroundRetryDelayMs: 0,
    });

    expect(recovery.initial.outcome).toBe("terminal");
    expect(recovery.reconciliation).toBeUndefined();
  });
});
