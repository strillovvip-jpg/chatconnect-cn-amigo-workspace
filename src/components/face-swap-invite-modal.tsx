import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Copy, Share2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { useI18n } from "@/lib/i18n";
import { nativeAmigoRoom } from "@/lib/amigo/native-room";
import { uiErrorMessage } from "@/lib/utils";
import { OVERLAY_LAYERS } from "@/lib/ui/overlay-layers";
import { SavedFaceValidationError } from "@/lib/amigo/saved-face";
import { OperationTimeoutError, withTimeout } from "@/lib/async/with-timeout";

const NETWORK_STEP_TIMEOUT_MS = 90_000;

type CreatedInvite = {
  inviteId: string;
  inviteUrl: string;
  password: string;
  roomName: string;
  serverUrl: string;
  operatorToken: string;
  operatorIdentity: string;
};

type FaceErrorCopy = {
  uploadFaceFirst: string;
  photoEnrollFailed: string;
  photoErrorFileRead: string;
  photoErrorDecode: string;
  photoErrorFormat: string;
  photoErrorNoFace: string;
  photoErrorSdkNotReady: string;
  photoErrorAuthorization: string;
  photoErrorNetwork: string;
  photoErrorQuota: string;
  photoErrorEnroll: string;
  operationTimedOut: string;
};

export function FaceSwapInviteModal({
  open,
  onClose,
  userCode,
  deviceId,
  faceReady,
  onFaceReadyChange,
}: {
  open: boolean;
  onClose: () => void;
  userCode: string;
  deviceId: string;
  faceReady: boolean;
  onFaceReadyChange: (ready: boolean) => void;
}) {
  const { messages } = useI18n();
  const copy = messages.faceSwapInvite;
  const createInvite = useAction(api.calls.createFaceSwapInvite);
  const endInvite = useAction(api.calls.endFaceSwapInvite);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);

  useEffect(() => {
    if (!open || !nativeAmigoRoom.isAvailable) {
      if (open) onFaceReadyChange(false);
      return;
    }
    void nativeAmigoRoom.getStatus()
      .then((status) => onFaceReadyChange(status.hasTargetFace === true))
      .catch((error) => {
        onFaceReadyChange(false);
        console.error("[FaceSwap:status] native readiness check failed", error);
      });
  }, [onFaceReadyChange, open]);

  if (!open) return null;

  const handleCreate = async () => {
    if (creating) return;
    if (!nativeAmigoRoom.isAvailable) {
      toast.error(copy.nativeOnly);
      return;
    }
    if (!faceReady) {
      toast.error(copy.uploadFaceFirst);
      return;
    }
    setCreating(true);
    try {
      const permissions = await withTimeout(
        nativeAmigoRoom.requestMediaPermissions({
          openSettingsIfDenied: true,
        }),
        NETWORK_STEP_TIMEOUT_MS,
        "request-media-permissions",
      );
      if (
        permissions.camera !== "authorized" ||
        permissions.microphone !== "authorized"
      ) {
        throw new Error(copy.mediaPermissionRequired);
      }
      const nativeStatus = await nativeAmigoRoom.getStatus();
      if (!nativeStatus.hasTargetFace) {
        onFaceReadyChange(false);
        throw new SavedFaceValidationError(
          "NATIVE_FACE_STATE_MISSING",
          "The native FaceLatent is no longer available. Select the photo again.",
        );
      }
      const created = await withTimeout(
        createInvite({
          code: userCode,
          deviceId,
          origin: window.location.origin,
        }),
        NETWORK_STEP_TIMEOUT_MS,
        "create-face-swap-invite",
      );
      try {
        await withTimeout(
          nativeAmigoRoom.setFaceSwapEnabled(true),
          NETWORK_STEP_TIMEOUT_MS,
          "enable-native-face-swap",
        );
        await withTimeout(
          nativeAmigoRoom.connect({
            url: created.serverUrl,
            token: created.operatorToken,
            enableMicrophone: true,
            enableCamera: true,
          }),
          NETWORK_STEP_TIMEOUT_MS,
          "connect-native-room",
        );
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
      toast.error(
        error instanceof OperationTimeoutError
          ? copy.operationTimedOut
          : isFacePipelineError(error)
            ? facePipelineErrorMessage(error, copy)
            : uiErrorMessage(error, copy.createFailed),
      );
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
      className="fixed inset-0 flex items-end justify-center bg-black/70 p-3 pb-[max(1rem,var(--app-safe-area-bottom))] sm:items-center"
      style={{ zIndex: OVERLAY_LAYERS.featureModal }}
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
            <p className="mt-1 text-xs text-white/55">{copy.subtitle}</p>
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
              disabled={creating || !faceReady}
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
              <div className="break-all text-sm text-white">
                {invite.inviteUrl}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(invite.inviteUrl, copy.linkLabel)
                  }
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
                onClick={() =>
                  void handleCopy(invite.password, copy.passwordLabel)
                }
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

function isFacePipelineError(
  error: unknown,
): error is Error & { code: string } {
  return (
    (error instanceof SavedFaceValidationError ||
      (typeof error === "object" && error !== null && "code" in error)) &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function facePipelineErrorMessage(
  error: Error & { code: string },
  copy: FaceErrorCopy,
): string {
  if (
    error.code.startsWith("SDK_") ||
    error.code === "FACE_NOT_DETECTED" ||
    error.code === "FACE_ENROLL_FAILED"
  ) {
    return `[${error.code}] ${error.message}`;
  }
  switch (error.code) {
    case "FACE_IMAGE_NOT_FOUND":
      return copy.uploadFaceFirst;
    case "FACE_IMAGE_READ_FAILED":
    case "FACE_IMAGE_EMPTY":
      return copy.photoErrorFileRead;
    case "FACE_IMAGE_DECODE_FAILED":
      return copy.photoErrorDecode;
    case "FACE_IMAGE_FORMAT_UNSUPPORTED":
      return copy.photoErrorFormat;
    case "FACE_NOT_DETECTED":
      return copy.photoErrorNoFace;
    case "NATIVE_BRIDGE_UNAVAILABLE":
    case "SDK_API_KEY_MISSING":
    case "SDK_NOT_INITIALIZED":
    case "SDK_INITIALIZATION_FAILED":
    case "SDK_MODEL_LOAD_FAILED":
    case "SDK_MODEL_DECRYPTION_FAILED":
      return copy.photoErrorSdkNotReady;
    case "SDK_AUTHORIZATION_FAILED":
    case "SDK_INVALID_API_KEY":
    case "SDK_REVOKED_API_KEY":
      return copy.photoErrorAuthorization;
    case "SDK_NETWORK_REQUIRED":
    case "SDK_MODEL_DOWNLOAD_FAILED":
    case "SDK_SERVER_ERROR":
      return copy.photoErrorNetwork;
    case "SDK_QUOTA_EXCEEDED":
      return copy.photoErrorQuota;
    case "FACE_ENROLL_TIMEOUT":
    case "FACE_ENROLL_FAILED":
    case "SDK_INFERENCE_FAILURE":
    case "SDK_INVALID_INPUT":
    case "NATIVE_FACE_STATE_MISSING":
      return copy.photoErrorEnroll;
    default:
      return copy.photoEnrollFailed;
  }
}
