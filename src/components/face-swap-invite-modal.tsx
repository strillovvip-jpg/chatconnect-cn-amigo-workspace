import { useState } from "react";
import { useAction } from "convex/react";
import { Copy, Share2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { nativeAmigoRoom } from "@/lib/amigo/native-room";
import { uiErrorMessage } from "@/lib/utils";

type CreatedInvite = {
  inviteId: string;
  inviteUrl: string;
  password: string;
  roomName: string;
  serverUrl: string;
  operatorToken: string;
  operatorIdentity: string;
};

export function FaceSwapInviteModal({
  open,
  onClose,
  userCode,
  deviceId,
}: {
  open: boolean;
  onClose: () => void;
  userCode: string;
  deviceId: string;
}) {
  const createInvite = useAction(api.calls.createFaceSwapInvite);
  const endInvite = useAction(api.calls.endFaceSwapInvite);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!nativeAmigoRoom.isAvailable) {
      toast.error("顔交換通話は iPhone App 内でのみ利用できます。");
      return;
    }
    setCreating(true);
    try {
      const status = await nativeAmigoRoom.getStatus();
      if (!status.hasTargetFace)
        throw new Error("先に App 内で顔写真をアップロードして保存してください。");
      const created = await createInvite({
        code: userCode,
        deviceId,
        origin: window.location.origin,
      });
      try {
        await nativeAmigoRoom.setFaceSwapEnabled(true);
        await nativeAmigoRoom.connect({
          url: created.serverUrl,
          token: created.operatorToken,
          enableMicrophone: true,
          enableCamera: true,
        });
      } catch (error) {
        await nativeAmigoRoom.setFaceSwapEnabled(false).catch(() => undefined);
        await nativeAmigoRoom.disconnect().catch(() => undefined);
        await endInvite({
          code: userCode,
          deviceId,
          inviteId: created.inviteId,
        }).catch(() => undefined);
        throw error;
      }
      setInvite(created);
      toast.success("顔交換通話を作成しました。");
    } catch (error) {
      toast.error(uiErrorMessage(error, "顔交換通話を作成できません。"));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}をコピーしました。`);
    } catch {
      toast.error(`${label}をコピーできません。`);
    }
  };

  const handleShare = async () => {
    if (!invite) return;
    const text = `通話リンク：${invite.inviteUrl}\n通話パスワード：${invite.password}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "顔交換通話の招待",
          text,
          url: invite.inviteUrl,
        });
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast.success("招待情報を準備しました。");
    } catch {
      toast.error("共有に失敗しました。");
    }
  };

  const handleEnd = async () => {
    if (!invite) {
      onClose();
      return;
    }
    setEnding(true);
    try {
      await endInvite({
        code: userCode,
        deviceId,
        inviteId: invite.inviteId,
      });
      await nativeAmigoRoom.disconnect().catch(() => undefined);
      setInvite(null);
      toast.success("顔交換通話を終了しました。");
      onClose();
    } catch (error) {
      toast.error(uiErrorMessage(error, "顔交換通話を終了できません。"));
    } finally {
      setEnding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[61000] flex items-end justify-center bg-black/70 p-3 pb-[max(1rem,var(--app-safe-area-bottom))] sm:items-center"
      onClick={() => {
        if (!invite) onClose();
      }}
    >
      <section
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101827] p-5 text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">顔交換通話</h2>
            <p className="mt-1 text-xs text-white/55">
              全機能認証コードのみ、外部向け 1 対 1 の顔交換通話招待を作成できます。
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => void handleEnd()}
            className="rounded-full p-2 text-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {!invite ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/75">
              App に保存済みの顔写真を利用し、iPhone ネイティブ側から
              Amigo 処理後の映像トラックを公開します。
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreate()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold disabled:opacity-50"
            >
              <Video size={16} />
              {creating ? "作成中..." : "通話を作成"}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                招待リンク
              </p>
              <div className="break-all text-sm text-white">{invite.inviteUrl}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(invite.inviteUrl, "リンク")}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
                >
                  <Copy size={14} />
                  リンクをコピー
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
                >
                  <Share2 size={14} />
                  共有
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                通話パスワード
              </p>
              <div className="text-2xl font-bold tracking-[0.3em] text-white">
                {invite.password}
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(invite.password, "パスワード")}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
              >
                <Copy size={14} />
                パスワードをコピー
              </button>
            </div>

            <button
              type="button"
              disabled={ending}
              onClick={() => void handleEnd()}
              className="w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold disabled:opacity-50"
            >
              {ending ? "終了中..." : "通話を終了"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
