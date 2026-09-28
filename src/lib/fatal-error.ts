import { isNyfbiWebRuntime } from "./runtime-surface.ts";

export const NYFBI_FATAL_ERROR_MESSAGE =
  "An unexpected application error occurred.";

const containsCjkText = (value: string) =>
  /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);

export function visibleFatalErrorMessage(
  error: unknown,
  fallback = "",
): string {
  const message =
    (error instanceof Error ? error.message : String(error)) || fallback;
  return isNyfbiWebRuntime() && containsCjkText(message)
    ? NYFBI_FATAL_ERROR_MESSAGE
    : message;
}
