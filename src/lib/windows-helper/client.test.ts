import { describe, expect, it, vi } from "vitest";
import { HelperClientError, WindowsHelperClient } from "./client";

const status = {
  apiVersion: "1",
  helperVersion: "0.1.0",
  engineReady: true,
  virtualCameraReady: true,
  processingState: "idle",
};

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("WindowsHelperClient", () => {
  it("detects the production helper through its fixed loopback HTTPS origin", async () => {
    const fetch = vi.fn().mockResolvedValue(response(status));
    const client = new WindowsHelperClient({ fetch });

    await expect(client.detect()).resolves.toEqual(status);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://127.0.0.1:43821/v1/status");
  });

  it("reports a helper timeout as unavailable", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const client = new WindowsHelperClient({ fetch, timeoutMs: 25 });
    const pending = client.detect();
    const rejection = expect(pending).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    vi.useRealTimers();
  });

  it("reports connection failures as unavailable", async () => {
    const client = new WindowsHelperClient({
      fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await expect(client.detect()).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
    });
  });

  it("rejects an unsupported helper API version", async () => {
    const client = new WindowsHelperClient({
      fetch: vi
        .fn()
        .mockResolvedValue(
          response({ ...status, apiVersion: "2", helperVersion: "9.0.0" }),
        ),
    });
    await expect(client.detect()).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  });

  it("retries session creation once with a fresh assertion after expiry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(
        response({ code: "INVALID_ASSERTION" }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        response({ sessionId: "session-2", expiresAt: 2_000_000_000_000 }),
      );
    const assertionProvider = vi
      .fn()
      .mockResolvedValueOnce({ assertion: "expired" })
      .mockResolvedValueOnce({ assertion: "fresh" });
    const client = new WindowsHelperClient({ fetch });

    const session = await client.createSession({
      deviceId: "desktop-1",
      assertionProvider,
    });

    expect(session.sessionId).toBe("session-2");
    expect(assertionProvider).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    const secondBody = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
    expect(firstBody.assertion).toBe("expired");
    expect(secondBody.assertion).toBe("fresh");
    expect(secondBody.helperNonce).not.toBe(firstBody.helperNonce);
  });

  it("rejects a malformed helper response", async () => {
    const client = new WindowsHelperClient({
      fetch: vi.fn().mockResolvedValue(response({ helperVersion: 7 })),
    });
    await expect(client.detect()).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("sends the face blob only to loopback and only after explicit confirmation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ enrolled: true, faceCount: 1, error: null }),
      );
    const client = new WindowsHelperClient({ fetch });
    client.restoreSessionForPage({
      sessionId: "session-1",
      helperNonce: "nonce-1",
      expiresAt: Date.now() + 60_000,
    });
    const face = new File(["face"], "face.jpg", { type: "image/jpeg" });

    await expect(
      client.enrollFace(face, { confirmed: false }),
    ).rejects.toBeInstanceOf(HelperClientError);
    expect(fetch).not.toHaveBeenCalled();

    await client.enrollFace(face, { confirmed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://127.0.0.1:43821/v1/face");
    expect(fetch.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("nyfbi.org");
  });
});
