import { useState } from "react";
import { useAction } from "convex/react";
import { Copy, Share2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { useI18n } from "@/lib/i18n";
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
  const { messages } = useI18n();
  const copy = messages.faceSwapInvite;
  const createInvite = useAction(api.calls.createFaceSwapInvite);
  const endInvite = useAction(api.calls.endFaceSwapInvite);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!nativeAmigoRoom.isAvailable) {
      toast.error(copy.nativeOnly);
      return;
    }
    setCreating(true);
    try {
      const status = await nativeAmigoRoom.getStatus();
      if (!status.hasTargetFace) throw new Error(copy.uploadFaceFirst);
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
      toast.success(copy.created);
    } catch (error) {
      toast.error(uiErrorMessage(error, copy.createFailed));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(copy.copied.replace("{label}", label));
    } catch {
      toast.error(copy.copyFailed.replace("{label}", label));
    }
  };

  const handleShare = async () => {
    if (!invite) return;
    const text = `${copy.shareTextLink}: ${invite.inviteUrl}\n${copy.shareTextPassword}: ${invite.password}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: copy.shareTitle,
          text,
          url: invite.inviteUrl,
        });
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast.success(copy.shareReady);
    } catch {
      toast.error(copy.shareFailed);
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
      toast.success(copy.ended);
      onClose();
    } catch (error) {
      toast.error(uiErrorMessage(error, copy.endFailed));
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
            <h2 className="text-lg font-semibold">{copy.title}</h2>
            <p className="mt-1 text-xs text-white/55">
              {copy.subtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label={messages.common.close}
            onClick={() => void handleEnd()}
            className="rounded-full p-2 text-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {!invite ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/75">
              {copy.body}
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreate()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold disabled:opacity-50"
            >
              <Video size={16} />
              {creating ? copy.createBusy : copy.createIdle}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                {copy.inviteLink}
              </p>
              <div className="break-all text-sm text-white">{invite.inviteUrl}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(invite.inviteUrl, copy.linkLabel)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
                >
                  <Copy size={14} />
                  {copy.copyLink}
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
                >
                  <Share2 size={14} />
                  {copy.share}
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                {copy.password}
              </p>
              <div className="text-2xl font-bold tracking-[0.3em] text-white">
                {invite.password}
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(invite.password, copy.passwordLabel)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium"
              >
                <Copy size={14} />
                {copy.copyPassword}
              </button>
            </div>

            <button
              type="button"
              disabled={ending}
              onClick={() => void handleEnd()}
              className="w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold disabled:opacity-50"
            >
              {ending ? copy.endBusy : copy.endIdle}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
