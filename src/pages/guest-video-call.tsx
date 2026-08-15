import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  createLocalTracks,
  type LocalTrack,
  Room,
  RoomEvent,
} from "livekit-client";
import { useParams } from "react-router-dom";
import { PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { LiveKitStage } from "@/components/livekit-stage";
import { uiErrorMessage } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";
import {
  createDeadline,
  OperationTimeoutError,
} from "@/lib/async/with-timeout";

const GUEST_JOIN_TIMEOUT_MS = 60_000;

const getPublicInviteSession = makeFunctionReference<
  "query",
  { inviteId: string },
  {
    inviteId: string;
    status: "pending" | "active" | "ended" | "expired";
    requiresPassword: boolean;
    available: boolean;
    guestJoined: boolean;
  } | null
>("externalVideoInvites:getPublicInviteSession");

export default function GuestVideoCallPage() {
  const { messages } = useI18n();
  const copy = messages.guest;
  const { id = "" } = useParams<{ id: string }>();
  const joinInvite = useAction(api.calls.joinFaceSwapInvite);
  const confirmInvite = useAction(api.calls.confirmFaceSwapInviteJoin);
  const invite = useQuery(
    getPublicInviteSession,
    id ? { inviteId: id } : "skip",
  );
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [callEnded, setCallEnded] = useState(false);

  useEffect(() => {
    return () => {
      void room?.disconnect();
    };
  }, [room]);

  const handleJoin = async () => {
    if (!id || !password.trim()) return;
    setJoining(true);
    setCallEnded(false);
    const nextRoom = new Room({
      adaptiveStream: false,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: { width: 1280, height: 720, frameRate: 24 },
        facingMode: "user",
      },
    });
    let localTracks: LocalTrack[] = [];
    let disposeLateTracks = false;
    let admissionConfirmed = false;
    let terminallyDisconnected = false;
    nextRoom.on(RoomEvent.Disconnected, () => {
      terminallyDisconnected = true;
      if (admissionConfirmed) {
        setConnected(false);
        setCallEnded(true);
      }
    });
    try {
      const deadline = createDeadline(GUEST_JOIN_TIMEOUT_MS, "guest-join");
      // Keep this first attempt in the direct tap handler for iOS autoplay.
      // Acquire camera and microphone together before consuming an invite.
      // LiveKit documents that this produces one permission prompt on iOS.
      await deadline.run(nextRoom.startAudio());
      const localTracksPromise = createLocalTracks({
        audio: true,
        video: {
          resolution: { width: 1280, height: 720, frameRate: 24 },
          facingMode: "user",
        },
      });
      void localTracksPromise.then(
        (tracks) => {
          if (disposeLateTracks) tracks.forEach((track) => track.stop());
        },
        () => undefined,
      );
      localTracks = await deadline.run(localTracksPromise);
      const join = await deadline.run(
        joinInvite({
          inviteId: id,
          password: password.trim(),
        }),
      );
      await deadline.run(
        nextRoom.connect(join.serverUrl, join.token, {
          autoSubscribe: true,
        }),
      );
      await deadline.run(
        Promise.all(
          localTracks.map((track) =>
            nextRoom.localParticipant.publishTrack(track),
          ),
        ),
      );
      if (terminallyDisconnected) throw new Error(copy.joinError);
      await deadline.run(confirmInvite({ inviteId: id, token: join.token }));
      admissionConfirmed = true;
      if (terminallyDisconnected) throw new Error(copy.joinError);
      setRoom(nextRoom);
      setConnected(true);
      setCallEnded(false);
    } catch (error) {
      disposeLateTracks = true;
      await nextRoom?.disconnect().catch(() => undefined);
      localTracks.forEach((track) => track.stop());
      toast.error(
        error instanceof OperationTimeoutError
          ? copy.joinTimeout
          : uiErrorMessage(error, copy.joinError),
      );
    } finally {
      setJoining(false);
    }
  };

  const hangUp = async () => {
    if (!room) return;
    await room.disconnect();
    setRoom(null);
    setConnected(false);
    setCallEnded(true);
  };

  if (!id) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d1525] px-6 text-white">
        {copy.invalidLink}
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0d1525] text-white">
      {!connected ? (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-10">
          <div className="rounded-3xl border border-white/10 bg-[#101827] p-6 shadow-2xl">
            <div className="mb-4 flex justify-end">
              <LanguageSelector />
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-red-500/15 p-3 text-red-300">
                <Video size={20} />
              </div>
              <div>
                <h1 className="text-xl font-semibold">
                  {copy.enterPasswordTitle}
                </h1>
                <p className="mt-1 text-sm text-white/55">
                  {copy.enterPasswordBody}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={copy.passwordPlaceholder}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base outline-none"
              />
              <button
                type="button"
                disabled={
                  joining || !password.trim() || invite?.available === false
                }
                onClick={() => void handleJoin()}
                className="w-full rounded-2xl bg-red-500 px-4 py-3 text-base font-semibold disabled:opacity-50"
              >
                {joining ? copy.joinBusy : copy.joinIdle}
              </button>
            </div>

            {invite && !invite.available && (
              <p className="mt-4 text-sm text-amber-300">
                {invite.status === "ended" || invite.status === "expired"
                  ? copy.unavailableEnded
                  : invite.guestJoined
                    ? copy.unavailableUsed
                    : copy.unavailableGeneric}
              </p>
            )}
            {callEnded && (
              <p className="mt-4 text-sm text-white/60">{copy.callEnded}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-[100dvh] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <div className="text-sm font-semibold">{copy.oneToOneTitle}</div>
              <div className="text-xs text-white/50">{copy.connected}</div>
            </div>
            <button
              type="button"
              onClick={() => void hangUp()}
              className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold"
            >
              <PhoneOff size={14} />
              {copy.end}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {room && (
              <LiveKitStage
                room={room}
                mode="p2p"
                showSelfPreview
                remoteVideoIdentityPrefix="host-publisher-"
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
