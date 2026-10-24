import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallComplianceAgent,
  flushCallRecording,
  flushCallRecordingForTransfer,
  resumeCallRecording,
} from "./call-compliance-agent";

const mocks = vi.hoisted(() => ({
  status: null as null | {
    status: "requested" | "active" | "stopping" | "stopped";
    myConsent: boolean;
    translationEnabled: boolean;
    consentedCodes: string[];
    stopDeadline?: number;
  },
  recorderStreams: [] as Array<{ tracks: MediaStreamTrack[] }>,
  recognitionStarts: vi.fn(),
  generateUploadUrl: vi.fn().mockResolvedValue({ uploadToken: "upload-token" }),
  fetch: vi.fn().mockResolvedValue({ ok: true }),
  toastError: vi.fn(),
  prepareRecordingHangup: vi.fn().mockResolvedValue(undefined),
  acknowledgeTransferRecordingDrain: vi
    .fn()
    .mockResolvedValue({ acknowledged: true }),
  query: vi.fn().mockResolvedValue({ status: "stopped" }),
  beginRecordingSegment: vi.fn().mockResolvedValue({
    segmentId: "segment-1",
    expiresAt: Date.now() + 600_000,
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.status,
  useConvex: () => ({ query: mocks.query }),
  useMutation: (reference: string) =>
    reference === "beginRecordingSegment"
      ? mocks.beginRecordingSegment
      : reference === "generateUploadUrl"
        ? mocks.generateUploadUrl
        : reference === "prepareRecordingHangup"
          ? mocks.prepareRecordingHangup
          : reference === "acknowledgeTransferRecordingDrain"
            ? mocks.acknowledgeTransferRecordingDrain
            : vi.fn().mockResolvedValue(undefined),
  useAction: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    callCompliance: {
      status: "status",
      recordingSegmentUploadStatus: "recordingSegmentUploadStatus",
      respond: "respond",
      beginRecordingSegment: "beginRecordingSegment",
      generateUploadUrl: "generateUploadUrl",
      saveRecording: "saveRecording",
      prepareRecordingHangup: "prepareRecordingHangup",
      acknowledgeTransferRecordingDrain: "acknowledgeTransferRecordingDrain",
    },
    callTranslation: { translateToChinese: "translateToChinese" },
  },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      compliance: {
        title: "Recording consent",
        body: "Allow recording?",
        callLanguage: "Language",
        languages: {
          enUs: "English",
          zhTw: "Traditional Chinese",
          zhCn: "Simplified Chinese",
          jaJp: "Japanese",
          esUs: "Spanish",
          koKr: "Korean",
        },
        decline: "Decline",
        consent: "Consent",
        recording: "Recording",
        declined: "Declined",
        waiting: "Waiting",
      },
    },
  }),
}));

function audioPublication(track: MediaStreamTrack) {
  return {
    kind: "audio",
    track: { mediaStreamTrack: track },
  };
}

function roomWithTracks() {
  const local = { id: "local" } as unknown as MediaStreamTrack;
  const consented = { id: "consented" } as unknown as MediaStreamTrack;
  const unconsented = { id: "unconsented" } as unknown as MediaStreamTrack;
  return {
    tracks: { local, consented, unconsented },
    room: {
      localParticipant: {
        trackPublications: new Map([["local", audioPublication(local)]]),
      },
      remoteParticipants: new Map([
        [
          "BBBBB-browser",
          {
            identity: "BBBBB-browser",
            trackPublications: new Map([
              ["consented", audioPublication(consented)],
            ]),
          },
        ],
        [
          "CCCCC-joining",
          {
            identity: "CCCCC-joining",
            trackPublications: new Map([
              ["unconsented", audioPublication(unconsented)],
            ]),
          },
        ],
      ]),
    },
  };
}

function roomDuringSameCodeHandoff() {
  const local = { id: "local" } as unknown as MediaStreamTrack;
  const oldDevice = { id: "old-device" } as unknown as MediaStreamTrack;
  const newDevice = { id: "new-device" } as unknown as MediaStreamTrack;
  return {
    tracks: { local, oldDevice, newDevice },
    room: {
      localParticipant: {
        trackPublications: new Map([["local", audioPublication(local)]]),
      },
      remoteParticipants: new Map([
        [
          "AAAAA-old-desktop",
          {
            identity: "AAAAA-old-desktop",
            trackPublications: new Map([
              ["old-device", audioPublication(oldDevice)],
            ]),
          },
        ],
        [
          "AAAAA-new-mobile",
          {
            identity: "AAAAA-new-mobile",
            trackPublications: new Map([
              ["new-device", audioPublication(newDevice)],
            ]),
          },
        ],
      ]),
    },
  };
}

describe("CallComplianceAgent consent boundaries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as Window & { SpeechRecognition?: unknown })
      .SpeechRecognition;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue({ ok: true });
    mocks.prepareRecordingHangup.mockResolvedValue(undefined);
    mocks.acknowledgeTransferRecordingDrain.mockResolvedValue({
      acknowledged: true,
    });
    mocks.query.mockResolvedValue({ status: "stopped" });
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://example.convex.site");
    mocks.recorderStreams.length = 0;
    const storage = new Map<string, string>([
      ["ksc_session_code", "AAAAA"],
      ["ksc_device_id", "device-a"],
    ]);
    const storageStub = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storageStub,
    });
    vi.stubGlobal("localStorage", storageStub);

    class FakeMediaStream {
      tracks: MediaStreamTrack[];
      constructor(tracks: MediaStreamTrack[]) {
        this.tracks = tracks;
      }
    }
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      state = "recording";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(stream: { tracks: MediaStreamTrack[] }) {
        mocks.recorderStreams.push(stream);
      }
      start() {}
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["final captured audio"], { type: "audio/webm" }),
        });
        this.onstop?.();
      }
    }
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult = null;
      onend = null;
      start() {
        mocks.recognitionStarts();
      }
      stop() {}
    }
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
  });

  it("flushes the final short-call chunk before normal teardown completes", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomWithTracks();
    render(<CallComplianceAgent room={room as never} callId="call-short" />);
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    expect(typeof flushCallRecording).toBe("function");
    await act(async () => {
      await flushCallRecording(room as never);
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].headers["X-Call-Id"]).toBe(
      "call-short",
    );
    expect(mocks.fetch.mock.calls[0][1].body.size).toBeGreaterThan(0);
    expect(mocks.recorderStreams).toHaveLength(1);
  });

  it("flushes an administrator stop and surfaces failed final uploads", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.fetch.mockResolvedValue({ ok: false });
    const { room } = roomWithTracks();
    const { rerender } = render(
      <CallComplianceAgent room={room as never} callId="call-stop" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    mocks.status = { ...mocks.status!, status: "stopping" };
    rerender(<CallComplianceAgent room={room as never} callId="call-stop" />);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining("recording"),
        expect.anything(),
      ),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("signals peer recorders and waits for their drain before completing hangup", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.query
      .mockResolvedValueOnce({ status: "stopping" })
      .mockResolvedValue({ status: "stopped" });
    const { room } = roomWithTracks();
    render(
      <CallComplianceAgent room={room as never} callId="call-peer-drain" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    await act(async () => {
      await flushCallRecording(room as never);
    });
    expect(mocks.prepareRecordingHangup).toHaveBeenCalledWith({
      code: "AAAAA",
      deviceId: "device-a",
      callId: "call-peer-drain",
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("honors the server drain deadline instead of abandoning the final chunk after five seconds", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomWithTracks();
    render(
      <CallComplianceAgent room={room as never} callId="call-long-drain" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    vi.useFakeTimers();
    const stopDeadline = Date.now() + 15_000;
    let drained = false;
    mocks.prepareRecordingHangup.mockResolvedValue({ stopDeadline });
    mocks.query.mockImplementation(async () => ({
      status: drained ? "stopped" : "stopping",
      stopDeadline,
    }));
    let outcome = "pending";
    const flush = flushCallRecording(room as never).then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(outcome).toBe("pending");
    drained = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await flush;
    });
    expect(outcome).toBe("resolved");
  });

  it("flushes and acknowledges a transfer without stopping peer recorders, then resumes after rollback", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomWithTracks();
    render(
      <CallComplianceAgent room={room as never} callId="call-transfer-drain" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    await act(async () => {
      await flushCallRecordingForTransfer(room as never, "transfer-1" as never);
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.prepareRecordingHangup).not.toHaveBeenCalled();
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledWith({
      code: "AAAAA",
      deviceId: "device-a",
      callId: "call-transfer-drain",
      transferId: "transfer-1",
    });
    expect(mocks.recorderStreams).toHaveLength(1);

    await act(async () => {
      await Promise.all([
        resumeCallRecording(room as never),
        resumeCallRecording(room as never),
      ]);
    });
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(2));
    expect(mocks.beginRecordingSegment).toHaveBeenCalledTimes(2);
  });

  it("waits for a recording controller that registers after transfer joining is observed", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomWithTracks();

    const flush = flushCallRecordingForTransfer(
      room as never,
      "transfer-controller-race" as never,
    );
    render(
      <CallComplianceAgent
        room={room as never}
        callId="call-controller-race"
      />,
    );

    await act(async () => {
      await flush;
    });
    expect(mocks.recorderStreams).toHaveLength(0);
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledWith({
      code: "AAAAA",
      deviceId: "device-a",
      callId: "call-controller-race",
      transferId: "transfer-controller-race",
    });
  });

  it("keeps the room suspended when controller waiting falls back to a server acknowledgement", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomWithTracks();
    vi.useFakeTimers();

    const flush = flushCallRecordingForTransfer(
      room as never,
      "transfer-controller-fallback" as never,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await expect(flush).resolves.toBe(false);

    render(
      <CallComplianceAgent
        room={room as never}
        callId="call-controller-fallback"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.beginRecordingSegment).not.toHaveBeenCalled();
    expect(mocks.recorderStreams).toHaveLength(0);
  });

  it("retains a failed final blob and retries that same segment on a later transfer", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.beginRecordingSegment
      .mockResolvedValueOnce({
        segmentId: "segment-transient-old",
        expiresAt: Date.now() + 600_000,
      })
      .mockResolvedValueOnce({
        segmentId: "segment-transient-new",
        expiresAt: Date.now() + 600_000,
      });
    mocks.query.mockResolvedValue({ consumed: false });
    mocks.fetch.mockResolvedValue({ ok: false });
    const { room } = roomWithTracks();
    render(
      <CallComplianceAgent room={room as never} callId="call-transfer-retry" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    await expect(
      flushCallRecordingForTransfer(room as never, "transfer-first" as never),
    ).rejects.toThrow();
    expect(mocks.acknowledgeTransferRecordingDrain).not.toHaveBeenCalled();

    mocks.fetch.mockResolvedValue({ ok: true });
    await act(async () => {
      await resumeCallRecording(room as never);
    });
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(2));
    await act(async () => {
      await flushCallRecordingForTransfer(
        room as never,
        "transfer-second" as never,
      );
    });

    const uploadedSegmentIds = mocks.fetch.mock.calls.map(
      ([, init]) => init.headers["X-Recording-Segment-Id"],
    );
    expect(
      uploadedSegmentIds.filter((id) => id === "segment-transient-old").length,
    ).toBeGreaterThan(1);
    expect(uploadedSegmentIds.at(-1)).toBe("segment-transient-new");
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: "transfer-second" }),
    );
  });

  it("reconciles a consumed segment when the upload response is lost", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.fetch.mockRejectedValue(
      new TypeError("connection closed after save"),
    );
    mocks.query.mockImplementation(async (reference: string) =>
      reference === "recordingSegmentUploadStatus"
        ? { consumed: true }
        : { status: "stopped" },
    );
    const { room } = roomWithTracks();
    render(
      <CallComplianceAgent room={room as never} callId="call-response-loss" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    await act(async () => {
      await flushCallRecordingForTransfer(
        room as never,
        "transfer-response-loss" as never,
      );
    });

    expect(mocks.query).toHaveBeenCalledWith(
      "recordingSegmentUploadStatus",
      expect.objectContaining({ segmentId: "segment-1" }),
    );
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledTimes(1);
  });

  it("retries the remaining peer's final segment when transfer completion rotates consent", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.query.mockResolvedValue({ consumed: false });
    mocks.fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const { room } = roomWithTracks();
    const { rerender } = render(
      <CallComplianceAgent room={room as never} callId="call-peer-transfer" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    mocks.status = {
      status: "requested",
      myConsent: false,
      translationEnabled: false,
      consentedCodes: [],
    };
    rerender(
      <CallComplianceAgent room={room as never} callId="call-peer-transfer" />,
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(mocks.fetch.mock.calls[2][1].headers["X-Recording-Segment-Id"]).toBe(
      "segment-1",
    );
  });

  it("quarantines an expired old-epoch blob without blocking a newer epoch", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    mocks.beginRecordingSegment
      .mockResolvedValueOnce({
        segmentId: "segment-old-epoch",
        expiresAt: Date.now() + 600_000,
      })
      .mockResolvedValueOnce({
        segmentId: "segment-new-epoch",
        expiresAt: Date.now() + 600_000,
      });
    mocks.query.mockResolvedValue({ consumed: false, uploadable: true });
    mocks.fetch.mockResolvedValue({ ok: false });
    const { room } = roomWithTracks();
    const { rerender } = render(
      <CallComplianceAgent room={room as never} callId="call-epoch-recovery" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));

    mocks.status = {
      status: "requested",
      myConsent: false,
      translationEnabled: false,
      consentedCodes: [],
    };
    rerender(
      <CallComplianceAgent room={room as never} callId="call-epoch-recovery" />,
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));

    mocks.generateUploadUrl.mockImplementation(async ({ segmentId }) => {
      if (segmentId === "segment-old-epoch")
        throw new Error("old epoch upload grace expired");
      return { uploadToken: "new-epoch-upload-token" };
    });
    mocks.query.mockImplementation(async (reference: string, args) =>
      reference === "recordingSegmentUploadStatus"
        ? {
            consumed: false,
            uploadable: args.segmentId !== "segment-old-epoch",
          }
        : { status: "stopped" },
    );
    mocks.fetch.mockResolvedValue({ ok: true });
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    rerender(
      <CallComplianceAgent room={room as never} callId="call-epoch-recovery" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(2));

    await act(async () => {
      await flushCallRecordingForTransfer(
        room as never,
        "transfer-after-epoch-reset" as never,
      );
    });
    expect(
      mocks.fetch.mock.calls.at(-1)?.[1].headers["X-Recording-Segment-Id"],
    ).toBe("segment-new-epoch");
    expect(mocks.acknowledgeTransferRecordingDrain).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: "transfer-after-epoch-reset" }),
    );
  });

  it("keeps an administrator-stop upload visible to a concurrent normal hangup", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    let finishUpload!: (response: { ok: boolean }) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const { room } = roomWithTracks();
    const { rerender } = render(
      <CallComplianceAgent room={room as never} callId="call-stop-race" />,
    );
    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    mocks.status = { ...mocks.status!, status: "stopping" };
    rerender(
      <CallComplianceAgent room={room as never} callId="call-stop-race" />,
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    let flushed = false;
    const flush = flushCallRecording(room as never).then(() => {
      flushed = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(flushed).toBe(false);
    finishUpload({ ok: true });
    await act(async () => {
      await flush;
    });
    expect(flushed).toBe(true);
  });

  it("does not capture or recognize speech before this participant consents", async () => {
    mocks.status = {
      status: "active",
      myConsent: false,
      translationEnabled: true,
      consentedCodes: ["BBBBB"],
    };
    const { room } = roomWithTracks();

    render(<CallComplianceAgent room={room as never} callId="call-1" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.recorderStreams).toHaveLength(0);
    expect(mocks.recognitionStarts).not.toHaveBeenCalled();
  });

  it("records only tracks belonging to participants who consented", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: true,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room, tracks } = roomWithTracks();

    render(<CallComplianceAgent room={room as never} callId="call-1" />);

    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    expect(mocks.recorderStreams[0].tracks).toEqual([
      tracks.local,
      tracks.consented,
    ]);
    expect(mocks.recorderStreams[0].tracks).not.toContain(tracks.unconsented);
    expect(mocks.recognitionStarts).toHaveBeenCalledTimes(1);
  });

  it("records only the exact replacement device during a same-code handoff", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room, tracks } = roomDuringSameCodeHandoff();

    render(
      <CallComplianceAgent
        room={room as never}
        callId="call-1"
        remoteParticipantCode="AAAAA"
        remoteParticipantIdentity="AAAAA-new-mobile"
      />,
    );

    await waitFor(() => expect(mocks.recorderStreams).toHaveLength(1));
    expect(mocks.recorderStreams[0].tracks).toEqual([
      tracks.local,
      tracks.newDevice,
    ]);
    expect(mocks.recorderStreams[0].tracks).not.toContain(tracks.oldDevice);
  });

  it("uses a distinct idempotency nonce for each recorder generation", async () => {
    mocks.status = {
      status: "active",
      myConsent: true,
      translationEnabled: false,
      consentedCodes: ["AAAAA", "BBBBB"],
    };
    const { room } = roomDuringSameCodeHandoff();
    const { rerender } = render(
      <CallComplianceAgent
        room={room as never}
        callId="call-1"
        remoteParticipantCode="AAAAA"
        remoteParticipantIdentity="AAAAA-old-desktop"
      />,
    );
    await waitFor(() =>
      expect(mocks.beginRecordingSegment).toHaveBeenCalledTimes(1),
    );

    rerender(
      <CallComplianceAgent
        room={room as never}
        callId="call-1"
        remoteParticipantCode="AAAAA"
        remoteParticipantIdentity="AAAAA-new-mobile"
      />,
    );
    await waitFor(() =>
      expect(mocks.beginRecordingSegment).toHaveBeenCalledTimes(2),
    );
    const firstNonce = mocks.beginRecordingSegment.mock.calls[0][0].clientNonce;
    const secondNonce =
      mocks.beginRecordingSegment.mock.calls[1][0].clientNonce;
    expect(firstNonce).toEqual(expect.any(String));
    expect(secondNonce).toEqual(expect.any(String));
    expect(secondNonce).not.toBe(firstNonce);
  });
});
