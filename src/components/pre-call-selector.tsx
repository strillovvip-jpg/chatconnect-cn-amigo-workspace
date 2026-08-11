import { useRef, useState } from "react";
import { Camera, Film, Phone, X } from "lucide-react";
import { useFeatures } from "@/contexts/feature-context.tsx";
import { useI18n } from "@/lib/i18n";
import type { VideoFileOptions } from "@/lib/video-sources/types.ts";

export type OutgoingCallSelection =
  { callType: "audio" } | { callType: "video"; videoFile?: VideoFileOptions };

type Props = {
  contactName: string;
  initialMode?: "camera" | "audio";
  busy?: boolean;
  onClose: () => void;
  onConfirm: (selection: OutgoingCallSelection) => Promise<void>;
};

export function PreCallSelector({
  contactName,
  initialMode = "camera",
  busy,
  onClose,
  onConfirm,
}: Props) {
  const { can } = useFeatures();
  const { messages } = useI18n();
  const copy = messages.preCall;
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"camera" | "video-file" | "audio">(
    initialMode,
  );
  const [file, setFile] = useState<File | null>(null);

  const videoFileAllowed =
    can("canVideoCall") && can("canVideoSource") && can("canPlayVideo");
  const submit = async () => {
    if (mode === "video-file" && !file) {
      inputRef.current?.click();
      return;
    }
    await onConfirm(
      mode === "audio"
        ? { callType: "audio" }
        : {
            callType: "video",
            videoFile:
              mode === "video-file" && file ? { file, loop: true } : undefined,
          },
    );
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/75 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={copy.dialogLabel}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101827] p-5 pb-[max(1.25rem,var(--app-safe-area-bottom))] shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{copy.title}</h2>
            <p className="mt-1 text-sm text-white/55">
              {copy.callPrefix} {contactName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="rounded-full p-2 text-white/60 hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <ModeButton
            active={mode === "camera"}
            disabled={!can("canVideoCall")}
            icon={<Camera size={22} />}
            label={copy.camera}
            onClick={() => setMode("camera")}
          />
          <ModeButton
            active={mode === "video-file"}
            disabled={!videoFileAllowed}
            icon={<Film size={22} />}
            label={copy.videoFile}
            onClick={() => setMode("video-file")}
          />
          <ModeButton
            active={mode === "audio"}
            disabled={!can("canVoiceCall")}
            icon={<Phone size={22} />}
            label={copy.audioOnly}
            onClick={() => setMode("audio")}
          />
        </div>

        {mode === "video-file" && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/*"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-white/20 px-3 py-3 text-sm text-white/75"
            >
              {file ? file.name : copy.chooseVideo}
            </button>
            <p className="mt-3 text-xs text-white/55">
              {copy.videoLoopHint}
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={busy || (mode === "video-file" && !file)}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-xl bg-blue-600 py-3.5 font-semibold text-white disabled:opacity-40"
        >
          {busy ? copy.preparing : copy.start}
        </button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border text-sm transition-colors disabled:opacity-30 ${active ? "border-blue-500 bg-blue-600/20 text-blue-200" : "border-white/10 bg-white/5 text-white/65"}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
