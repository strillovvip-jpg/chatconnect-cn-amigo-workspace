import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Participant,
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
} from "livekit-client";

function MediaTrack({
  publication,
  fit = "cover",
}: {
  publication: TrackPublication;
  fit?: "cover" | "contain";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = publication.track;
    const container = containerRef.current;
    if (!track || !container) return;
    const element = track.attach();
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.setAttribute("webkit-playsinline", "true");
    // Camera video and audio are separate LiveKit tracks. Muting the video
    // element guarantees visual autoplay on iPhone Safari without muting the
    // separately attached remote audio track.
    if (track.kind === Track.Kind.Video) element.muted = true;
    Object.assign(
      element.style,
      track.kind === Track.Kind.Video
        ? { width: "100%", height: "100%", objectFit: fit }
        : { display: "none" },
    );
    container.appendChild(element);
    const play = () => void element.play().catch(() => undefined);
    play();
    element.addEventListener("loadedmetadata", play);
    return () => {
      element.removeEventListener("loadedmetadata", play);
      track.detach(element);
      element.remove();
    };
  }, [publication, publication.track, fit]);
  return <div ref={containerRef} className="absolute inset-0" />;
}

function ParticipantTile({
  participant,
  selected = false,
  onSelect,
}: {
  participant: Participant;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const screen = participant.getTrackPublication(Track.Source.ScreenShare);
  const camera = participant.getTrackPublication(Track.Source.Camera);
  const video = screen?.track ? screen : camera?.track ? camera : undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-[#111e38] text-left transition-all ${participant.isSpeaking ? "ring-4 ring-emerald-400" : selected ? "ring-2 ring-blue-400" : ""}`}
    >
      {video ? (
        <MediaTrack
          publication={video}
          fit={screen?.track ? "contain" : "cover"}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-3xl font-bold text-white">
            {(participant.name || participant.identity || "?").charAt(0)}
          </div>
        </div>
      )}
    </button>
  );
}

export function LiveKitStage({
  room,
  compact = false,
  mode = "p2p",
  showSelfPreview = false,
}: {
  room: Room;
  compact?: boolean;
  mode?: "p2p" | "group";
  showSelfPreview?: boolean;
}) {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  useEffect(() => {
    const resumeAudio = () => void room.startAudio().catch(() => undefined);
    document.addEventListener("pointerdown", resumeAudio, { once: true });
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackStreamStateChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged,
    ] as const;
    events.forEach((event) => room.on(event, refresh));
    return () => {
      document.removeEventListener("pointerdown", resumeAudio);
      events.forEach((event) => room.off(event, refresh));
    };
  }, [room]);

  const remotes = Array.from(room.remoteParticipants.values());
  useEffect(() => {
    if (pinnedIdentity && !room.remoteParticipants.has(pinnedIdentity))
      setPinnedIdentity(null);
  }, [pinnedIdentity, room, remotes.length]);
  const screenSharer = remotes.find(
    (participant) =>
      participant.getTrackPublication(Track.Source.ScreenShare)?.track,
  );
  const pinned = pinnedIdentity
    ? room.remoteParticipants.get(pinnedIdentity)
    : undefined;
  const activeSpeaker = remotes.find((participant) => participant.isSpeaking);
  const primary = screenSharer ?? pinned ?? activeSpeaker ?? remotes[0];
  const visibleParticipants = useMemo(() => {
    const list: Participant[] = [...remotes];
    if (showSelfPreview) list.push(room.localParticipant);
    return list;
  }, [remotes, room.localParticipant, showSelfPreview]);
  const remoteAudio = remotes.flatMap((participant) =>
    Array.from(participant.audioTrackPublications.values()).filter(
      (publication) => publication.track,
    ),
  );

  let content: React.ReactNode;
  if (compact || mode === "p2p") {
    content = primary ? (
      <ParticipantTile participant={primary} />
    ) : (
      <div className="flex h-full items-center justify-center bg-[#111e38] text-sm text-white/60">
        正在等待对方加入...
      </div>
    );
  } else if (primary) {
    const thumbnails = visibleParticipants.filter(
      (participant) => participant.identity !== primary.identity,
    );
    content = (
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <div className="min-h-0 flex-1">
          <ParticipantTile
            participant={primary}
            selected={Boolean(pinned)}
            onSelect={() => setPinnedIdentity(null)}
          />
        </div>
        {thumbnails.length > 0 && (
          <div className="flex h-24 shrink-0 gap-2 overflow-x-auto pb-1 sm:h-32">
            {thumbnails.map((participant) => (
              <div key={participant.identity} className="w-36 shrink-0 sm:w-48">
                <ParticipantTile
                  participant={participant}
                  onSelect={() =>
                    participant !== room.localParticipant &&
                    setPinnedIdentity(participant.identity)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <div className="flex h-full items-center justify-center bg-[#111e38] text-sm text-white/60">
        正在等待其他参与者加入...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {content}
      {showSelfPreview && mode === "p2p" && (
        <div
          className={
            compact
              ? "absolute bottom-9 right-2 z-20 h-14 w-10 overflow-hidden rounded-md border border-white/50 bg-[#111e38] shadow-xl"
              : "absolute bottom-[calc(7.5rem+env(safe-area-inset-bottom))] right-3 z-20 h-36 w-24 overflow-hidden rounded-xl border border-white/40 bg-[#111e38] shadow-2xl sm:h-44 sm:w-32"
          }
        >
          <ParticipantTile participant={room.localParticipant} />
        </div>
      )}
      {remoteAudio.map((publication) => (
        <MediaTrack key={publication.trackSid} publication={publication} />
      ))}
    </div>
  );
}
