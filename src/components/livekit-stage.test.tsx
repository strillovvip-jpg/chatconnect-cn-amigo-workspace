import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveKitStage } from "./livekit-stage";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      livekitStage: {
        waitingRemote: "Waiting for remote",
        waitingOthers: "Waiting for others",
      },
    },
  }),
}));

function participant(identity: string, name: string, video = false) {
  const videoTrack = video
    ? {
        kind: "video",
        attach: () => {
          const element = document.createElement("video");
          element.play = vi.fn().mockResolvedValue(undefined);
          return element;
        },
        detach: vi.fn(),
      }
    : undefined;
  return {
    identity,
    name,
    isSpeaking: false,
    getTrackPublication: vi.fn((source: string) =>
      source === "camera" && videoTrack ? { track: videoTrack } : undefined,
    ),
    audioTrackPublications: new Map(),
  };
}

describe("LiveKitStage native publisher filtering", () => {
  it("refreshes once after subscribing so tracks that arrived before the effect are rendered", () => {
    const processedVideo = participant(
      "host-publisher-native",
      "Processed host video",
      true,
    );
    const remoteParticipants = new Map<string, ReturnType<typeof participant>>();
    let populated = false;
    const room = {
      remoteParticipants,
      localParticipant: participant("guest", "Guest"),
      startAudio: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(() => {
        if (!populated) {
          populated = true;
          remoteParticipants.set(processedVideo.identity, processedVideo);
        }
      }),
      off: vi.fn(),
    };

    const { container } = render(
      <LiveKitStage
        room={room as never}
        mode="p2p"
        remoteVideoIdentityPrefix="host-publisher-"
      />,
    );

    expect(container.querySelector("video")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for remote")).not.toBeInTheDocument();
  });

  it("renders the callee as primary and the native publisher as self preview", () => {
    const nativePublisher = participant("caller-native", "Native self");
    const callee = participant("callee-web", "Callee");
    const room = {
      remoteParticipants: new Map([
        [nativePublisher.identity, nativePublisher],
        [callee.identity, callee],
      ]),
      localParticipant: participant("caller-browser", "Browser companion"),
      startAudio: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    render(
      <LiveKitStage
        room={room as never}
        mode="p2p"
        showSelfPreview
        localPublisherIdentity="caller-native"
      />,
    );

    const tiles = screen.getAllByRole("button");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveTextContent("C");
    expect(tiles[1]).toHaveTextContent("N");
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });

  it("prefers the remote processed-video participant over its microphone companion", () => {
    const microphoneCompanion = participant("caller-browser", "Caller voice");
    const processedVideo = participant(
      "CALLER-face-swap-native",
      "Caller processed video",
      true,
    );
    const room = {
      remoteParticipants: new Map([
        [microphoneCompanion.identity, microphoneCompanion],
        [processedVideo.identity, processedVideo],
      ]),
      localParticipant: participant("callee", "Callee"),
      startAudio: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    const { container } = render(
      <LiveKitStage
        room={room as never}
        mode="p2p"
        remoteVideoIdentityPrefix="CALLER-face-swap-"
      />,
    );

    expect(container.querySelector("video")).toBeInTheDocument();
    expect(screen.queryByText("C")).not.toBeInTheDocument();
  });
});
