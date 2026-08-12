import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";
import { amigoFaceSwap } from "@/lib/amigo/face-swap";
import { nativeAmigoRoom } from "@/lib/amigo/native-room";
import { SavedFaceValidationError } from "@/lib/amigo/saved-face";
import { OperationTimeoutError, withTimeout } from "@/lib/async/with-timeout";
import { uiErrorMessage } from "@/lib/utils";
import { OVERLAY_LAYERS } from "@/lib/ui/overlay-layers";

const NETWORK_STEP_TIMEOUT_MS = 90_000;

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
  const { messages } = useI18n();
  const copy = messages.faceSwapInvite;
  const chatCopy = messages.chatPage;
  const generateFaceUploadUrl = useMutation(api.faceLibrary.generateUploadUrl);
  const addFace = useMutation(api.faceLibrary.addFace);
  const [saving, setSaving] = useState(false);
  const [faceName, setFaceName] = useState("");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

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
    onReadyChange(false);
    try {
      await verifySelectedImageDecodes(faceFile);
      const enrolled = await amigoFaceSwap.enrollFaceFile(faceFile);
      if (!enrolled) throw new SavedFaceValidationError("NATIVE_FACE_STATE_MISSING", "Native enrollment did not retain a FaceLatent.");
      const status = await nativeAmigoRoom.getStatus();
      if (!status.hasTargetFace) throw new SavedFaceValidationError("NATIVE_FACE_STATE_MISSING", "Native enrollment completed without a retained FaceLatent.");

      const uploadResult = (await withTimeout(
        generateFaceUploadUrl({ code: userCode, deviceId }),
        NETWORK_STEP_TIMEOUT_MS,
        "create-face-upload-url",
      )) as string | { uploadUrl: string; requestId: string };
      const uploadUrl = typeof uploadResult === "string" ? uploadResult : uploadResult.uploadUrl;
      const uploadRequestId = typeof uploadResult === "string" ? undefined : uploadResult.requestId;
      const response = await withTimeout(
        fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": faceFile.type || "application/octet-stream" },
          body: faceFile,
        }),
        NETWORK_STEP_TIMEOUT_MS,
        "upload-face-photo",
      );
      if (!response.ok) throw new Error(chatCopy.imageUploadFailed(response.status));
      const { storageId } = (await response.json()) as { storageId?: Id<"_storage"> };
      if (!storageId) throw new Error(chatCopy.imageIdMissing);
      if (!uploadRequestId) throw new Error(chatCopy.uploadRequestMissing);
      await withTimeout(
        (addFace as unknown as (args: {
          code: string;
          deviceId: string;
          name: string;
          storageId: Id<"_storage">;
          uploadRequestId: string;
          hasConsent: boolean;
          subjectIsAdult: boolean;
        }) => Promise<unknown>)({
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
          : faceSettingsErrorMessage(error, copy) ?? uiErrorMessage(error, chatCopy.faceAddFailed),
      );
    } finally {
      setSaving(false);
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
          <button type="button" disabled={saving} aria-label={messages.common.close} onClick={onClose} className="rounded-full p-2 text-white/70 disabled:opacity-40">
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
          <button type="button" onClick={() => faceInputRef.current?.click()} className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white">
            {faceFile?.name || copy.manageFaces}
          </button>
          <button
            type="button"
            disabled={!faceFile || saving}
            onClick={() => void handleEnroll()}
            className="w-full rounded-xl bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? copy.photoSaveBusy : copy.photoSaveIdle}
          </button>
        </div>
      </section>
    </div>
  );
}

function faceSettingsErrorMessage(error: unknown, copy: ReturnType<typeof useI18n>["messages"]["faceSwapInvite"]): string | null {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return null;
  if (error.code.startsWith("SDK_") || error.code === "FACE_NOT_DETECTED" || error.code === "FACE_ENROLL_FAILED") {
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
    const valid = typeof createImageBitmap === "function"
      ? await decodeWithImageBitmap(file)
      : await decodeWithImageElement(file);
    if (!valid) throw new Error("Decoded image has no pixels.");
  } catch (error) {
    throw new SavedFaceValidationError("FACE_IMAGE_DECODE_FAILED", "The selected photo could not be decoded.", { cause: error });
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
      image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
      image.onerror = () => reject(new Error("Image element could not decode the selected file."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
