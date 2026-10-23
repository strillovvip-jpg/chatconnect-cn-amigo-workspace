import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallComplianceAgent } from "./call-compliance-agent";

const mocks = vi.hoisted(() => ({
  status: null as null | {
    status: "active";
    myConsent: boolean;
    translationEnabled: boolean;
    consentedCodes: string[];
  },
  recorderStreams: [] as Array<{ tracks: MediaStreamTrack[] }>,
  recognitionStarts: vi.fn(),
  beginRecordingSegment: vi.fn().mockResolvedValue({
    segmentId: "segment-1",
    expiresAt: Date.now() + 600_000,
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.status,
  useMutation: (reference: string) =>
    reference === "beginRecordingSegment"
      ? mocks.beginRecordingSegment
      : vi.fn().mockResolvedValue(undefined),
  useAction: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    callCompliance: {
      status: "status",
      respond: "respond",
      beginRecordingSegment: "beginRecordingSegment",
      generateUploadUrl: "generateUploadUrl",
      saveRecording: "saveRecording",
    },
    callTranslation: { translateToChinese: "translateToChinese" },
  },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      compliance: {
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
    vi.unstubAllGlobals();
    delete (window as Window & { SpeechRecognition?: unknown })
      .SpeechRecognition;
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    const secondNonce = mocks.beginRecordingSegment.mock.calls[1][0].clientNonce;
    expect(firstNonce).toEqual(expect.any(String));
    expect(secondNonce).toEqual(expect.any(String));
    expect(secondNonce).not.toBe(firstNonce);
  });
});
