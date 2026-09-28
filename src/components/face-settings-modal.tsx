import { useEffect, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel";
import { formatUiDate, useI18n } from "@/lib/i18n";
import { amigoFaceSwap } from "@/lib/amigo/face-swap";
import { nativeAmigoRoom } from "@/lib/amigo/native-room";
import { SavedFaceValidationError } from "@/lib/amigo/saved-face";
import { OperationTimeoutError, withTimeout } from "@/lib/async/with-timeout";
import { uiErrorMessage } from "@/lib/utils";
import { OVERLAY_LAYERS } from "@/lib/ui/overlay-layers";

const NETWORK_STEP_TIMEOUT_MS = 90_000;
const LOCAL_STEP_TIMEOUT_MS = 15_000;
const PERSISTENCE_ACK_TIMEOUT_MS = 15_000;
const PERSISTENCE_ACK_POLL_MS = 500;

export function FaceSettingsModal({
  open,
  onClose,
  userCode,
  deviceId,
  onReadyChange,
}: {
  open: boolean;
  onClose: () => void;
  userCode: string;
  deviceId: string;
  onReadyChange: (ready: boolean) => void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.faceSwapInvite;
  const chatCopy = messages.chatPage;
  const generateFaceUploadUrl = useMutation(api.faceLibrary.generateUploadUrl);
  const addFace = useMutation(api.faceLibrary.addFace);
  const convex = useConvex();
  const [saving, setSaving] = useState(false);
  const [faceName, setFaceName] = useState("");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [initializationProgress, setInitializationProgress] = useState<
    number | null
  >(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setInitializationProgress(null);
      return;
    }
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    void amigoFaceSwap
      .addInitializationProgressListener(({ percent }) => {
        if (!disposed) setInitializationProgress(percent);
      })
      .then((remove) => {
        if (disposed) void remove();
        else removeListener = remove;
      });
    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [open]);

  if (!open) return null;

  const handleEnroll = async () => {
    if (saving || !faceFile) {
      if (!faceFile) toast.error(chatCopy.chooseImageFile);
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

    setSaving(true);
    setInitializationProgress(null);
    onReadyChange(false);
    try {
      await withTimeout(
        verifySelectedImageDecodes(faceFile),
        LOCAL_STEP_TIMEOUT_MS,
        "decode-face-photo",
      );
      const enrolled = await amigoFaceSwap.enrollFaceFile(faceFile);
      if (!enrolled)
        throw new SavedFaceValidationError(
          "NATIVE_FACE_STATE_MISSING",
          "Native enrollment did not retain a FaceLatent.",
        );
      const status = await withTimeout(
        nativeAmigoRoom.getStatus(),
        LOCAL_STEP_TIMEOUT_MS,
        "read-native-face-status",
      );
      if (!status.hasTargetFace)
        throw new SavedFaceValidationError(
          "NATIVE_FACE_STATE_MISSING",
          "Native enrollment completed without a retained FaceLatent.",
        );
      await withTimeout(
        nativeAmigoRoom.setFaceSwapEnabled(true),
        LOCAL_STEP_TIMEOUT_MS,
        "enable-native-face-swap",
      );

      const uploadResult = (await withTimeout(
        generateFaceUploadUrl({ code: userCode, deviceId }),
        NETWORK_STEP_TIMEOUT_MS,
        "create-face-upload-url",
      )) as
        | string
        | {
            uploadUrl: string;
            requestId: Id<"face_upload_requests">;
          };
      const uploadUrl =
        typeof uploadResult === "string"
          ? uploadResult
          : uploadResult.uploadUrl;
      const uploadRequestId =
        typeof uploadResult === "string" ? undefined : uploadResult.requestId;
      const uploadDeadline = Date.now() + NETWORK_STEP_TIMEOUT_MS;
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
      const { storageId } = (await withTimeout(
        response.json(),
        Math.max(
          1,
          Math.min(LOCAL_STEP_TIMEOUT_MS, uploadDeadline - Date.now()),
        ),
        "read-face-upload-response",
      )) as {
        storageId?: Id<"_storage">;
      };
      if (!storageId) throw new Error(chatCopy.imageIdMissing);
      if (!uploadRequestId) throw new Error(chatCopy.uploadRequestMissing);
      const persistArgs = {
        code: userCode,
        deviceId,
        name:
          faceName.trim() ||
          `Face ${formatUiDate(new Date(), locale, { dateStyle: "short" })}`,
        storageId,
        uploadRequestId,
        hasConsent: true,
        subjectIsAdult: true,
      };
      try {
        await withTimeout(
          addFace(persistArgs),
          PERSISTENCE_ACK_TIMEOUT_MS,
          "persist-face-photo",
        );
      } catch (error) {
        if (!(error instanceof OperationTimeoutError)) throw error;
        const confirmationDeadline = Date.now() + PERSISTENCE_ACK_TIMEOUT_MS;
        let consumed = false;
        while (!consumed) {
          const remainingMs = confirmationDeadline - Date.now();
          if (remainingMs <= 0) throw error;
          const acknowledgement = await withTimeout(
            convex.query(api.faceLibrary.getUploadRequestStatus, {
              code: userCode,
              deviceId,
              uploadRequestId,
            }),
            remainingMs,
            "confirm-persisted-face-photo",
          );
          consumed = acknowledgement.consumed;
          if (!consumed) {
            const pauseMs = Math.min(
              PERSISTENCE_ACK_POLL_MS,
              confirmationDeadline - Date.now(),
            );
            if (pauseMs <= 0) throw error;
            await wait(pauseMs);
          }
        }
      }

      onReadyChange(true);
      setFaceFile(null);
      setFaceName("");
      if (faceInputRef.current) faceInputRef.current.value = "";
      toast.success(copy.photoReady);
    } catch (error) {
      onReadyChange(false);
      toast.error(
        error instanceof OperationTimeoutError
          ? copy.operationTimedOut
          : (faceSettingsErrorMessage(error, copy) ??
              uiErrorMessage(error, chatCopy.faceAddFailed)),
      );
    } finally {
      setSaving(false);
      setInitializationProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-end justify-center bg-black/70 p-3 pb-[max(1rem,var(--app-safe-area-bottom))] sm:items-center"
      style={{ zIndex: OVERLAY_LAYERS.featureModal }}
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <section
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101827] p-5 text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{copy.manageFaces}</h2>
            <p className="mt-1 text-xs text-white/55">{copy.manageFacesHint}</p>
          </div>
          <button
            type="button"
            disabled={saving}
            aria-label={messages.common.close}
            onClick={onClose}
            className="rounded-full p-2 text-white/70 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
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
            onChange={(event) => setFaceFile(event.target.files?.[0] ?? null)}
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
            disabled={!faceFile || saving}
            onClick={() => void handleEnroll()}
            className="w-full rounded-xl bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving
              ? initializationProgress === null
                ? copy.photoSaveBusy
                : `${copy.photoSaveBusy} ${initializationProgress}%`
              : copy.photoSaveIdle}
          </button>
        </div>
      </section>
    </div>
  );
}

function faceSettingsErrorMessage(
  error: unknown,
  copy: ReturnType<typeof useI18n>["messages"]["faceSwapInvite"],
): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  )
    return null;
  if (
    error.code.startsWith("SDK_") ||
    error.code === "FACE_NOT_DETECTED" ||
    error.code === "FACE_ENROLL_TIMEOUT" ||
    error.code === "FACE_ENROLL_FAILED"
  ) {
    return `[${error.code}] ${error instanceof Error ? error.message : copy.photoErrorEnroll}`;
  }
  const messages: Record<string, string> = {
    FACE_IMAGE_READ_FAILED: copy.photoErrorFileRead,
    FACE_IMAGE_EMPTY: copy.photoErrorFileRead,
    FACE_IMAGE_DECODE_FAILED: copy.photoErrorDecode,
    FACE_IMAGE_FORMAT_UNSUPPORTED: copy.photoErrorFormat,
    NATIVE_FACE_STATE_MISSING: copy.photoErrorEnroll,
  };
  return messages[error.code] ?? copy.photoEnrollFailed;
}

async function verifySelectedImageDecodes(file: File): Promise<void> {
  try {
    const valid =
      typeof createImageBitmap === "function"
        ? await decodeWithImageBitmap(file)
        : await decodeWithImageElement(file);
    if (!valid) throw new Error("Decoded image has no pixels.");
  } catch (error) {
    throw new SavedFaceValidationError(
      "FACE_IMAGE_DECODE_FAILED",
      "The selected photo could not be decoded.",
      { cause: error },
    );
  }
}

async function decodeWithImageBitmap(file: File): Promise<boolean> {
  const bitmap = await createImageBitmap(file);
  const valid = bitmap.width > 0 && bitmap.height > 0;
  bitmap.close();
  return valid;
}

async function decodeWithImageElement(file: File): Promise<boolean> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
      image.onerror = () =>
        reject(new Error("Image element could not decode the selected file."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
