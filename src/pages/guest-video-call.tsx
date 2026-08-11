import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Room, RoomEvent } from "livekit-client";
import { useParams } from "react-router-dom";
import { PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { LiveKitStage } from "@/components/livekit-stage";
import { uiErrorMessage } from "@/lib/utils";

const getPublicInviteSession = makeFunctionReference<
  "query",
  { inviteId: string },
  | {
      inviteId: string;
      status: "pending" | "active" | "ended" | "expired";
      requiresPassword: boolean;
      available: boolean;
      guestJoined: boolean;
    }
  | null
>("externalVideoInvites:getPublicInviteSession");

export default function GuestVideoCallPage() {
  const { id = "" } = useParams<{ id: string }>();
  const joinInvite = useAction(api.calls.joinFaceSwapInvite);
  const invite = useQuery(getPublicInviteSession, id ? { inviteId: id } : "skip");
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
    try {
      const join = await joinInvite({ inviteId: id, password: password.trim() });
      const nextRoom = new Room({
        adaptiveStream: false,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 24 },
          facingMode: "user",
        },
      });
      nextRoom.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setCallEnded(true);
      });
      await nextRoom.connect(join.serverUrl, join.token, { autoSubscribe: true });
      await nextRoom.startAudio().catch(() => undefined);
      await nextRoom.localParticipant.setMicrophoneEnabled(true);
      await nextRoom.localParticipant.setCameraEnabled(true, {
        resolution: { width: 1280, height: 720, frameRate: 24 },
        facingMode: "user",
      });
      setRoom(nextRoom);
      setConnected(true);
      setCallEnded(false);
    } catch (error) {
      toast.error(uiErrorMessage(error, "ビデオ通話に参加できません。"));
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
        無効な通話リンクです。
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0d1525] text-white">
      {!connected ? (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-10">
          <div className="rounded-3xl border border-white/10 bg-[#101827] p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-red-500/15 p-3 text-red-300">
                <Video size={20} />
              </div>
              <div>
                <h1 className="text-xl font-semibold">通話パスワードを入力</h1>
                <p className="mt-1 text-sm text-white/55">
                  正しいパスワードを入力すると、1 対 1 のビデオ通話に参加できます。
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
                placeholder="通話パスワード"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base outline-none"
              />
              <button
                type="button"
                disabled={joining || !password.trim() || invite?.available === false}
                onClick={() => void handleJoin()}
                className="w-full rounded-2xl bg-red-500 px-4 py-3 text-base font-semibold disabled:opacity-50"
              >
                {joining ? "参加中..." : "通話に参加"}
              </button>
            </div>

            {invite && !invite.available && (
              <p className="mt-4 text-sm text-amber-300">
                {invite.status === "ended" || invite.status === "expired"
                  ? "この通話リンクは失効しています。"
                  : invite.guestJoined
                    ? "この通話リンクはすでに使用されています。"
                    : "現在この通話には参加できません。"}
              </p>
            )}
            {callEnded && (
              <p className="mt-4 text-sm text-white/60">通話は終了しました。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[100dvh] flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <div className="text-sm font-semibold">1 対 1 ビデオ通話</div>
              <div className="text-xs text-white/50">接続済み</div>
            </div>
            <button
              type="button"
              onClick={() => void hangUp()}
              className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold"
            >
              <PhoneOff size={14} />
              終了
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {room && <LiveKitStage room={room} mode="p2p" showSelfPreview />}
          </div>
        </div>
      )}
    </main>
  );
}
