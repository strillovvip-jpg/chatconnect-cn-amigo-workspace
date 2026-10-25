// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAdminRecording } from "./recording-download";

const nativeMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => "web"),
  writeFile: vi.fn(),
  getUri: vi.fn(),
  deleteFile: vi.fn(),
  share: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: nativeMocks.isNativePlatform,
    getPlatform: nativeMocks.getPlatform,
  },
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    writeFile: nativeMocks.writeFile,
    getUri: nativeMocks.getUri,
    deleteFile: nativeMocks.deleteFile,
  },
}));

vi.mock("@capacitor/share", () => ({
  Share: { share: nativeMocks.share },
}));

function recordingResponse(
  body: BlobPart = new Uint8Array([1, 2, 3]),
  disposition = 'attachment; filename="call-001_ALICE_20261025T010203.webm"',
) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Disposition": disposition,
      "Content-Type": "audio/webm",
    },
  });
}

describe("saveAdminRecording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://tenant.convex.site/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => recordingResponse()),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "fixed-uuid" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("downloads on the web using auth headers and the response filename", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:recording-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("call-001_ALICE_20261025T010203.webm");
        expect(this.href).toBe("blob:recording-download");
      });

    const result = await saveAdminRecording({
      recordingId: "recording-alice",
      authorizationCode: "ACADM",
      deviceId: "admin-device",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://tenant.convex.site/api/call-recordings/download?recordingId=recording-alice",
      {
        method: "GET",
        headers: {
          "X-Authorization-Code": "ACADM",
          "X-Device-Id": "admin-device",
        },
        cache: "no-store",
      },
    );
    expect(result).toBe("saved");
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording-download");
  });

  it("rejects a filename that is missing or unsafe instead of inventing one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      recordingResponse(undefined, 'attachment; filename="../../secret.webm"'),
    );

    await expect(
      saveAdminRecording({
        recordingId: "recording-alice",
        authorizationCode: "ACADM",
        deviceId: "admin-device",
      }),
    ).rejects.toThrow("safe filename");
  });

  it("writes iOS bytes as chunk-safe base64, shares the cache URI, then deletes it", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");
    const bytes = Uint8Array.from(
      { length: 30_001 },
      (_, index) => index % 251,
    );
    vi.mocked(fetch).mockResolvedValueOnce(recordingResponse(bytes));
    nativeMocks.writeFile.mockResolvedValue(undefined);
    nativeMocks.getUri.mockResolvedValue({
      uri: "file:///cache/recording.webm",
    });
    nativeMocks.share.mockResolvedValue({
      activityType: "com.apple.CloudDocs",
    });
    nativeMocks.deleteFile.mockResolvedValue(undefined);

    const result = await saveAdminRecording({
      recordingId: "recording-alice",
      authorizationCode: "ACADM",
      deviceId: "admin-device",
    });

    const expectedPath =
      "admin-recordings/fixed-uuid-call-001_ALICE_20261025T010203.webm";
    expect(nativeMocks.writeFile).toHaveBeenCalledWith({
      path: expectedPath,
      data: Buffer.from(bytes).toString("base64"),
      directory: "CACHE",
      recursive: true,
    });
    expect(nativeMocks.getUri).toHaveBeenCalledWith({
      path: expectedPath,
      directory: "CACHE",
    });
    expect(nativeMocks.share).toHaveBeenCalledWith({
      files: ["file:///cache/recording.webm"],
      title: "call-001_ALICE_20261025T010203.webm",
    });
    expect(nativeMocks.deleteFile).toHaveBeenCalledWith({
      path: expectedPath,
      directory: "CACHE",
    });
    expect(result).toBe("saved");
  });

  it("treats iOS share cancellation as cancellation and still deletes the temp file", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");
    nativeMocks.writeFile.mockResolvedValue(undefined);
    nativeMocks.getUri.mockResolvedValue({
      uri: "file:///cache/recording.webm",
    });
    nativeMocks.share.mockRejectedValue(new Error("User cancelled share"));
    nativeMocks.deleteFile.mockResolvedValue(undefined);

    await expect(
      saveAdminRecording({
        recordingId: "recording-alice",
        authorizationCode: "ACADM",
        deviceId: "admin-device",
      }),
    ).resolves.toBe("cancelled");
    expect(nativeMocks.deleteFile).toHaveBeenCalledTimes(1);
  });
});
