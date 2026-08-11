export class OperationTimeoutError extends Error {
  readonly name = "OperationTimeoutError";
  readonly code = "OPERATION_TIMEOUT";

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`${operation} did not finish within ${timeoutMs}ms.`);
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OperationTimeoutError(operation, timeoutMs)),
      timeoutMs,
    );
  });

  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createDeadline(timeoutMs: number, operation: string) {
  const expiresAt = Date.now() + timeoutMs;
  return {
    run<T>(promise: Promise<T>): Promise<T> {
      return withTimeout(
        promise,
        Math.max(1, expiresAt - Date.now()),
        operation,
      );
    },
  };
}
