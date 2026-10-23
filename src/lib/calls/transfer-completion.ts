type TransferStatus =
  | "pending"
  | "accepted"
  | "joining"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled"
  | "failed"
  | null;

type TerminalFailureStatus = Extract<
  TransferStatus,
  "rejected" | "expired" | "cancelled" | "failed"
>;

export type TransferCompletionResult =
  | { outcome: "completed" }
  | {
      outcome: "terminal";
      status: TerminalFailureStatus;
      error: unknown;
    }
  | { outcome: "unconfirmed"; error: unknown };

const terminalFailureStatuses = new Set<TerminalFailureStatus>([
  "rejected",
  "expired",
  "cancelled",
  "failed",
]);

function isTerminalFailureStatus(
  status: TransferStatus,
): status is TerminalFailureStatus {
  return (
    status !== null &&
    terminalFailureStatuses.has(status as TerminalFailureStatus)
  );
}

export function shouldHangUpTransferredCall(
  activeCallId: string | undefined,
  transferCallId: string,
) {
  return activeCallId === transferCallId;
}

export async function completeTransferWithRecovery({
  complete,
  readStatus,
  maxAttempts = 3,
  retryDelayMs = 700,
}: {
  complete: () => Promise<unknown>;
  readStatus: () => Promise<TransferStatus>;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<TransferCompletionResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await complete();
      return { outcome: "completed" };
    } catch (error) {
      lastError = error;
      const status = await readStatus().catch(() => null);
      if (status === "completed") return { outcome: "completed" };
      if (isTerminalFailureStatus(status))
        return { outcome: "terminal", status, error };
      if (attempt + 1 < maxAttempts && retryDelayMs > 0)
        await new Promise((resolve) =>
          globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)),
        );
    }
  }
  return {
    outcome: "unconfirmed",
    error:
      lastError instanceof Error
        ? lastError
        : new Error("Unable to confirm transferred call"),
  };
}

export async function startTransferCompletionRecovery({
  complete,
  readStatus,
  foregroundAttempts = 3,
  foregroundRetryDelayMs = 700,
  backgroundAttempts = 5,
  backgroundRetryDelayMs = 10_000,
}: {
  complete: () => Promise<unknown>;
  readStatus: () => Promise<TransferStatus>;
  foregroundAttempts?: number;
  foregroundRetryDelayMs?: number;
  backgroundAttempts?: number;
  backgroundRetryDelayMs?: number;
}): Promise<{
  initial: TransferCompletionResult;
  reconciliation?: Promise<TransferCompletionResult>;
}> {
  const initial = await completeTransferWithRecovery({
    complete,
    readStatus,
    maxAttempts: foregroundAttempts,
    retryDelayMs: foregroundRetryDelayMs,
  });
  if (initial.outcome !== "unconfirmed") return { initial };
  return {
    initial,
    reconciliation: completeTransferWithRecovery({
      complete,
      readStatus,
      maxAttempts: backgroundAttempts,
      retryDelayMs: backgroundRetryDelayMs,
    }),
  };
}
