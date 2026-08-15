import { fireEvent, render, screen } from "@testing-library/react";
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

  it("drags the self preview and clamps it within the stage", () => {
    const remote = participant("callee", "Callee");
    const local = participant("guest", "Guest");
    const room = {
      remoteParticipants: new Map([[remote.identity, remote]]),
      localParticipant: local,
      startAudio: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    const { container } = render(
      <LiveKitStage room={room as never} mode="p2p" showSelfPreview />,
    );

    const preview = screen.getByTestId("self-preview");
    const stage = preview.parentElement;
    if (!stage) throw new Error("Expected self preview stage parent");
    Object.defineProperty(stage, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 300,
        height: 500,
        right: 300,
        bottom: 500,
      }),
    });
    Object.defineProperty(preview, "getBoundingClientRect", {
      value: () => ({
        left: 200,
        top: 350,
        width: 100,
        height: 150,
        right: 300,
        bottom: 500,
      }),
    });

    fireEvent.pointerDown(preview, { pointerId: 7, clientX: 250, clientY: 400 });
    fireEvent.pointerMove(preview, {
      pointerId: 7,
      clientX: -100,
      clientY: -100,
    });
    expect(preview).toHaveStyle({ left: "0px", top: "0px" });

    fireEvent.pointerMove(preview, {
      pointerId: 7,
      clientX: 1000,
      clientY: 1000,
    });
    expect(preview).toHaveStyle({ left: "200px", top: "350px" });
    fireEvent.pointerUp(preview, { pointerId: 7 });

    const remoteTile = container.querySelector("button");
    expect(remoteTile).toBeInTheDocument();
    expect(remoteTile?.style.left).toBe("");
    expect(remoteTile?.style.top).toBe("");
    const remoteTileWrapper = remoteTile?.parentElement;
    expect(remoteTileWrapper).toBeInTheDocument();
    expect(remoteTileWrapper?.style.left).toBe("");
    expect(remoteTileWrapper?.style.top).toBe("");
  });

  it("does not produce negative coordinates when the stage is smaller than the preview", () => {
    const remote = participant("callee", "Callee");
    const room = {
      remoteParticipants: new Map([[remote.identity, remote]]),
      localParticipant: participant("guest", "Guest"),
      startAudio: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    render(<LiveKitStage room={room as never} mode="p2p" showSelfPreview />);

    const preview = screen.getByTestId("self-preview");
    const stage = preview.parentElement;
    if (!stage) throw new Error("Expected self preview stage parent");
    Object.defineProperty(stage, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 80,
        height: 100,
        right: 80,
        bottom: 100,
      }),
    });
    Object.defineProperty(preview, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 150,
        right: 100,
        bottom: 150,
      }),
    });

    fireEvent.pointerDown(preview, { pointerId: 8, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(preview, {
      pointerId: 8,
      clientX: 20,
      clientY: 20,
    });

    expect(preview).toHaveStyle({ left: "0px", top: "0px" });
  });
});
