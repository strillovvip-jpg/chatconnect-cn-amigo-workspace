import type {
  AssertionProvider,
  EnrollFaceResult,
  HelperSession,
  HelperStatus,
  ProcessingStatus,
} from "./contracts";

const DEFAULT_BASE_URL = "https://127.0.0.1:43821";
const CURRENT_API_VERSION = "1";

export class HelperClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable = true,
  ) {
    super(message);
    this.name = "HelperClientError";
  }
}

type ClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

function nonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function helperStatus(value: unknown): HelperStatus | null {
  if (
    !object(value) ||
    typeof value.apiVersion !== "string" ||
    typeof value.helperVersion !== "string" ||
    typeof value.engineReady !== "boolean" ||
    typeof value.virtualCameraReady !== "boolean" ||
    typeof value.processingState !== "string"
  )
    return null;
  return value as HelperStatus;
}

export class WindowsHelperClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private session: HelperSession | null = null;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 2_500;
  }

  async detect() {
    const value = await this.requestUnknown(
      "/v1/status",
      { method: "GET" },
      false,
    );
    const status = helperStatus(value);
    if (!status)
      throw new HelperClientError(
        "MALFORMED_RESPONSE",
        "The helper returned an invalid status.",
      );
    if (status.apiVersion !== CURRENT_API_VERSION)
      throw new HelperClientError(
        "UNSUPPORTED_VERSION",
        "The helper must be updated.",
      );
    return status;
  }

  async createSession(input: {
    deviceId: string;
    assertionProvider: AssertionProvider;
  }) {
    await this.detect();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const helperNonce = nonce();
      const { assertion } = await input.assertionProvider({ helperNonce });
      try {
        const value = await this.requestUnknown(
          "/v1/session",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              assertion,
              helperNonce,
              deviceId: input.deviceId,
            }),
          },
          false,
        );
        if (
          !object(value) ||
          typeof value.sessionId !== "string" ||
          typeof value.expiresAt !== "number"
        )
          throw new HelperClientError(
            "MALFORMED_RESPONSE",
            "The helper returned an invalid session.",
          );
        this.session = {
          sessionId: value.sessionId,
          expiresAt: value.expiresAt,
          helperNonce,
        };
        return this.session;
      } catch (error) {
        if (
          !(error instanceof HelperClientError) ||
          error.code !== "INVALID_ASSERTION" ||
          attempt === 1
        )
          throw error;
      }
    }
    throw new HelperClientError(
      "INVALID_ASSERTION",
      "Unable to create a helper session.",
    );
  }

  restoreSessionForPage(session: HelperSession) {
    this.session = session;
  }

  async enrollFace(face: Blob, options: { confirmed: boolean }) {
    if (!options.confirmed)
      throw new HelperClientError(
        "CONSENT_REQUIRED",
        "Local processing confirmation is required.",
      );
    const form = new FormData();
    form.append("face", face);
    return this.requestJson<EnrollFaceResult>("/v1/face", {
      method: "POST",
      body: form,
    });
  }

  start(cameraId = "default") {
    return this.requestJson<ProcessingStatus>("/v1/processing/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cameraId }),
    });
  }

  stop() {
    return this.requestJson<ProcessingStatus>("/v1/processing/stop", {
      method: "POST",
    });
  }

  clearFace() {
    return this.requestJson<ProcessingStatus>("/v1/face", { method: "DELETE" });
  }

  private async requestJson<T>(path: string, init: RequestInit) {
    return (await this.requestUnknown(path, init, true)) as T;
  }

  private async requestUnknown(
    path: string,
    init: RequestInit,
    authenticated: boolean,
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (authenticated) {
        if (!this.session || this.session.expiresAt <= Date.now())
          throw new HelperClientError(
            "INVALID_SESSION",
            "The helper session is invalid or expired.",
          );
        headers.set("x-helper-session", this.session.sessionId);
        headers.set("x-helper-nonce", this.session.helperNonce);
      }
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          object(value) && typeof value.code === "string"
            ? value.code
            : response.status === 401
              ? "INVALID_ASSERTION"
              : "HELPER_ERROR";
        throw new HelperClientError(
          code,
          "The local helper rejected the request.",
        );
      }
      return value;
    } catch (error) {
      if (error instanceof HelperClientError) throw error;
      throw new HelperClientError(
        "HELPER_UNAVAILABLE",
        error instanceof DOMException && error.name === "AbortError"
          ? "The local helper timed out."
          : "The local helper is unavailable.",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
