import { useEffect, useRef, useState } from "react";
import { useAction, useConvex, useMutation } from "convex/react";
import { Copy, Share2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { useI18n } from "@/lib/i18n";
import { amigoFaceSwap } from "@/lib/amigo/face-swap";
import { nativeAmigoRoom } from "@/lib/amigo/native-room";
import { uiErrorMessage } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { OVERLAY_LAYERS } from "@/lib/ui/overlay-layers";
import {
  prepareLatestSavedFace,
  SavedFaceValidationError,
} from "@/lib/amigo/saved-face";
import {
  OperationTimeoutError,
  withTimeout,
} from "@/lib/async/with-timeout";

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
}: {
  open: boolean;
  onClose: () => void;
  userCode: string;
  deviceId: string;
}) {
  const { messages } = useI18n();
  const copy = messages.faceSwapInvite;
  const chatCopy = messages.chatPage;
  const createInvite = useAction(api.calls.createFaceSwapInvite);
  const endInvite = useAction(api.calls.endFaceSwapInvite);
  const generateFaceUploadUrl = useMutation(api.faceLibrary.generateUploadUrl);
  const addFace = useMutation(api.faceLibrary.addFace);
  const convex = useConvex();
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [savingFace, setSavingFace] = useState(false);
  const [faceName, setFaceName] = useState("");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !nativeAmigoRoom.isAvailable) return;
    void nativeAmigoRoom
      .requestMediaPermissions({ openSettingsIfDenied: false })
      .catch((error) =>
        console.error("[FaceSwap:permissions] request failed", error),
      );
  }, [open]);

  if (!open) return null;

  const preparePersistedFace = async (stage: "save" | "create") => {
    const faces = await withTimeout(
      convex.query(api.faceLibrary.listMine, {
        code: userCode,
        deviceId,
      }),
      NETWORK_STEP_TIMEOUT_MS,
      "list-persisted-faces",
    );
    return await prepareLatestSavedFace(faces, stage);
  };

  const handleSaveFace = async () => {
    if (savingFace || creating) return;
    if (!faceFile) {
      toast.error(chatCopy.chooseImageFile);
      return;
    }
    if (!faceFile.type.startsWith("image/")) {
      toast.error(chatCopy.chooseImageFile);
      return;
    }
    if (faceFile.size > 10 * 1024 * 1024) {
      toast.error(chatCopy.imageMaxSize);
      return;
    }
    setSavingFace(true);
    try {
      const uploadResult = (await withTimeout(
        generateFaceUploadUrl({ code: userCode, deviceId }),
        NETWORK_STEP_TIMEOUT_MS,
        "create-face-upload-url",
      )) as string | { uploadUrl: string; requestId: string };
      const uploadUrl =
        typeof uploadResult === "string"
          ? uploadResult
          : uploadResult.uploadUrl;
      const uploadRequestId =
        typeof uploadResult === "string" ? undefined : uploadResult.requestId;
      const response = await withTimeout(
        fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": faceFile.type || "application/octet-stream",
          },
          body: faceFile,
        }),
        NETWORK_STEP_TIMEOUT_MS,
        "upload-face-photo",
      );
      if (!response.ok)
        throw new Error(chatCopy.imageUploadFailed(response.status));
      const { storageId } = (await response.json()) as {
        storageId?: Id<"_storage">;
      };
      if (!storageId) throw new Error(chatCopy.imageIdMissing);
      if (!uploadRequestId) throw new Error(chatCopy.uploadRequestMissing);
      await withTimeout(
        (
          addFace as unknown as (args: {
            code: string;
            deviceId: string;
            name: string;
            storageId: Id<"_storage">;
            uploadRequestId: string;
            hasConsent: boolean;
            subjectIsAdult: boolean;
          }) => Promise<unknown>
        )({
          code: userCode,
          deviceId,
          name: faceName.trim() || `Face ${new Date().toLocaleDateString()}`,
          storageId,
          uploadRequestId,
          hasConsent: true,
          subjectIsAdult: true,
        }),
        NETWORK_STEP_TIMEOUT_MS,
        "persist-face-photo",
      );
      // Do not put first-run model download and official SDK enrollment inside
      // the upload deadline. Await the SDK so its real AmigoError reaches UI.
      const savedFace = await preparePersistedFace("save");
      if (!savedFace)
        throw new SavedFaceValidationError(
          "FACE_IMAGE_NOT_FOUND",
          copy.uploadFaceFirst,
        );
      setFaceName("");
      setFaceFile(null);
      if (faceInputRef.current) faceInputRef.current.value = "";
      toast.success(copy.photoReady);
    } catch (error) {
      toast.error(
        error instanceof OperationTimeoutError
          ? copy.operationTimedOut
          : isFacePipelineError(error)
            ? facePipelineErrorMessage(error, copy)
            : uiErrorMessage(error, chatCopy.faceAddFailed),
      );
    } finally {
      setSavingFace(false);
    }
  };

  const handleCreate = async () => {
    if (creating || savingFace) return;
    if (!nativeAmigoRoom.isAvailable) {
      toast.error(copy.nativeOnly);
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
      const savedFace = await preparePersistedFace("create");
      if (!savedFace) throw new Error(copy.uploadFaceFirst);
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
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    {copy.manageFaces}
                  </p>
                  <p className="mt-1 text-xs text-white/55">
                    {copy.manageFacesHint}
                  </p>
                </div>
                <input
                  type="text"
                  value={faceName}
                  onChange={(event) => setFaceName(event.target.value)}
                  placeholder={copy.photoName}
                  className="w-full rounded-xl border border-white/10 bg-[#0d1524] px-3 py-2 text-sm text-white outline-none"
                />
                <input
                  ref={faceInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) =>
                    setFaceFile(event.target.files?.[0] ?? null)
                  }
                />
                <button
                  type="button"
                  onClick={() => faceInputRef.current?.click()}
                  className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white"
                >
                  {faceFile?.name || copy.manageFaces}
                </button>
                <button
                  type="button"
                  disabled={!faceFile || savingFace || creating}
                  onClick={() => void handleSaveFace()}
                  className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {savingFace ? copy.photoSaveBusy : copy.photoSaveIdle}
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={creating || savingFace}
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
  error: { code: string },
  copy: FaceErrorCopy,
): string {
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
