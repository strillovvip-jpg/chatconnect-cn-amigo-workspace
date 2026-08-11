import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { PIP_HEIGHT, PIP_WIDTH, useCall } from "@/contexts/call-context.tsx";
import { useFeatures } from "@/contexts/feature-context.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import {
  PhoneOff,
  ArrowLeft,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  Maximize2,
  Loader2,
  Users,
  SwitchCamera,
  ArrowRightLeft,
  Film,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { MonitorOff, MonitorUp } from "lucide-react";
import { uiErrorMessage } from "@/lib/utils.ts";

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export function CallOverlay() {
  const { can } = useFeatures();
  const {
    callState,
    callInfo,
    hangUp,
    minimizeCall,
    micOn,
    camOn,
    toggleMic,
    toggleCam,
    flipCamera,
    screenShareOn,
    screenShareSupported,
    toggleScreenShare,
    duration,
    participantCount,
    videoSource,
    switchVideoSource,
    useVideoFile,
    aiVideoSourceAvailable,
  } = useCall();
  if (
    callState !== "connected" &&
    callState !== "loading" &&
    callState !== "ringing" &&
    callState !== "connecting" &&
    callState !== "reconnecting"
  )
    return null;

  const isLoading =
    callState === "loading" ||
    callState === "ringing" ||
    callState === "connecting" ||
    callState === "reconnecting";
  const isGroup = callInfo?.mode === "group";

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col pointer-events-none"
      style={{ background: isLoading ? "#0d1525" : "transparent" }}
    >
      {/* Loading state */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-6 pointer-events-auto"
            style={{
              background: "linear-gradient(180deg,#0d1525 0%,#111e38 100%)",
            }}
          >
            {callState === "ringing" && callInfo?.initialVideoFile?.file ? (
              <WaitingVideoPreview
                file={callInfo.initialVideoFile.file}
                loop={callInfo.initialVideoFile.loop}
              />
            ) : (
              <div className="relative flex items-center justify-center">
                <motion.div
                  className="absolute rounded-full opacity-20"
                  style={{
                    background: "oklch(0.55 0.12 260)",
                    width: 140,
                    height: 140,
                  }}
                  animate={{ scale: [1, 1.18, 1] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <div
                  className="relative w-24 h-24 rounded-full flex items-center justify-center z-10"
                  style={{ background: "oklch(0.3 0.08 260)" }}
                >
                  {isGroup ? (
                    <Users size={38} className="text-white/70" />
                  ) : (
                    <span className="text-3xl font-bold text-white">
                      {(callInfo?.chatName ?? "?").charAt(0)}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold text-white">
                {callInfo?.chatName}
              </p>
              {isGroup && <p className="text-xs text-white/40">グループ通話</p>}
              <div className="flex items-center gap-2 text-sm text-white/50 justify-center">
                <Loader2 size={14} className="animate-spin" />
                {callState === "ringing"
                  ? "相手の応答を待っています..."
                  : callState === "reconnecting"
                    ? "再接続中..."
                    : "接続中..."}
              </div>
            </div>
            <button
              aria-label={callState === "ringing" ? "呼び出しをキャンセル" : "通話を終了"}
              onClick={() => void hangUp()}
              className="mt-2 flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-950/40 transition active:scale-95"
            >
              <PhoneOff size={26} />
            </button>
            <span className="-mt-4 text-xs text-white/70">
              {callState === "ringing" ? "呼び出しをキャンセル" : "通話を終了"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      {!isLoading && (
        <div
          className="absolute top-0 left-0 right-0 grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 pt-[max(1rem,var(--app-safe-area-top))] pb-4 pointer-events-auto"
          style={{
            background:
              "linear-gradient(to bottom,rgba(13,21,37,0.85) 0%,transparent 100%)",
          }}
        >
          <button
            onClick={minimizeCall}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-semibold text-white"
            aria-label="通話を切らずに戻る"
          >
            <ArrowLeft size={18} />
            <span>戻る</span>
          </button>
          <div className="min-w-0 text-center">
            <p className="truncate text-base font-semibold text-white">
              {callInfo?.chatName}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="mx-auto text-xs text-white/50">
                {formatDuration(duration)}
              </p>
              {isGroup && (
                <span className="flex items-center gap-1 text-xs text-white/50">
                  <Users size={11} />
                  {participantCount} 名が通話中
                </span>
              )}
            </div>
          </div>
          <div className="flex min-w-11 justify-end">
            {callInfo?.mode === "p2p" && can("canTransferCall") && (
              <TransferButton compact={false} />
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      {!isLoading && (
        <div
          data-call-controls
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center pb-[max(1.5rem,var(--app-safe-area-bottom))] pt-8 pointer-events-auto"
          style={{
            background:
              "linear-gradient(to top,rgba(13,21,37,0.90) 0%,transparent 100%)",
          }}
        >
          <div className="flex max-w-[98vw] flex-wrap items-end justify-center gap-1 rounded-2xl border border-white/10 bg-black/35 p-1.5 backdrop-blur-md sm:gap-3 sm:p-3">
            {callInfo?.callType === "video" && can("canVideoSource") && (
              <VideoSourceButton
                source={videoSource.active}
                switching={videoSource.switching}
                aiAvailable={can("canAIFace") && aiVideoSourceAvailable}
                onSwitch={switchVideoSource}
                onFile={useVideoFile}
              />
            )}
            {callInfo?.callType === "video" && can("canVideoCall") && (
              <CallTool
                label={camOn ? "カメラ" : "カメラOFF"}
                active={camOn}
                onClick={() => void toggleCam()}
              >
                {camOn ? <Camera size={19} /> : <CameraOff size={19} />}
              </CallTool>
            )}
            {callInfo?.callType === "video" && camOn && (
              <CallTool label="カメラ切替" onClick={() => void flipCamera()}>
                <SwitchCamera size={19} />
              </CallTool>
            )}
            <CallTool
              label={micOn ? "マイク" : "マイクOFF"}
              active={micOn}
              onClick={() => void toggleMic()}
            >
              {micOn ? <Mic size={19} /> : <MicOff size={19} />}
            </CallTool>
            {callInfo?.callType === "video" && can("canScreenShare") && (
              <CallTool
                label={screenShareOn ? "共有停止" : "画面共有"}
                active={screenShareOn}
                disabled={!screenShareOn && !screenShareSupported}
                onClick={() =>
                  void toggleScreenShare().catch((error) =>
                    toast.error(uiErrorMessage(error, "この端末では画面共有できません。")),
                  )
                }
              >
                {screenShareOn ? (
                  <MonitorOff size={19} />
                ) : (
                  <MonitorUp size={19} />
                )}
              </CallTool>
            )}
            <CallTool label="通話終了" danger onClick={() => void hangUp()}>
              <PhoneOff size={20} />
            </CallTool>
          </div>
        </div>
      )}
    </div>
  );
}

function WaitingVideoPreview({ file, loop }: { file: File; loop: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return (
    <div className="relative h-[min(52dvh,420px)] w-[min(92vw,680px)] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
      {url && (
        <video
          src={url}
          autoPlay
          muted
          playsInline
          loop={loop}
          className="h-full w-full object-contain"
          aria-label="通話前の動画プレビュー"
        />
      )}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 backdrop-blur">
        送信予定の動画を再生中
      </div>
    </div>
  );
}

function VideoSourceButton({
  source,
  switching,
  onSwitch,
  onFile,
  aiAvailable,
}: {
  source: "camera" | "video-file" | "ai" | "screen-share";
  switching: boolean;
  onSwitch: (source: "camera" | "ai" | "screen-share") => Promise<void>;
  onFile: (options: {
    file?: File;
    url?: string;
    loop: boolean;
  }) => Promise<void>;
  aiAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const labels = {
    camera: "カメラ",
    "video-file": "動画",
    ai: "AI 换脸",
    "screen-share": "画面共有",
  } as const;
  const run = async (task: () => Promise<void>, close = true) => {
    setBusy(true);
    try {
      await task();
      if (close) setOpen(false);
    } catch (error) {
      toast.error(uiErrorMessage(error, "映像ソースを切り替えられません。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <CallTool
        label={`视频：${labels[source]}`}
        active={source !== "camera"}
        disabled={switching}
        onClick={() => setOpen(true)}
      >
        {switching ? (
          <Loader2 size={19} className="animate-spin" />
        ) : (
          <Film size={19} />
        )}
      </CallTool>
      {open && (
        <div
          className="fixed inset-0 z-[62000] flex items-end justify-center bg-black/55 p-3 pb-[max(1rem,var(--app-safe-area-bottom))] sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#101827] p-5 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">映像ソース</h2>
                <p className="mt-1 text-xs text-white/55">
                  通話を切らずに映像ソースを切り替えます
                </p>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-white/70"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <SourceOption
                active={source === "camera"}
                disabled={busy}
                label="カメラ"
                onClick={() => void run(() => onSwitch("camera"))}
              />
              <SourceOption
                active={source === "screen-share"}
                disabled={busy}
                label="画面共有"
                onClick={() => void run(() => onSwitch("screen-share"))}
              />
              <SourceOption
                active={source === "video-file"}
                disabled={busy}
                label="動画ファイルを選択"
                onClick={() => fileRef.current?.click()}
              />
              {aiAvailable && (
                <SourceOption
                  active={source === "ai"}
                  disabled={busy}
                  label="AI 换脸"
                  onClick={() => void run(() => onSwitch("ai"))}
                />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void run(() => onFile({ file, loop: true }));
              }}
            />
            <p className="mt-4 rounded-xl bg-white/7 px-3 py-3 text-sm text-white/65">
              選択した動画は、別の動画に切り替えるかカメラに戻すまでループ再生されます。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                inputMode="url"
                placeholder="アップロード済み動画のURL"
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/7 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="button"
                disabled={!url.trim() || busy}
                onClick={() =>
                  void run(() => onFile({ url: url.trim(), loop: true }))
                }
                className="rounded-xl bg-blue-600 px-4 text-sm font-semibold disabled:opacity-40"
              >
                再生
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceOption({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-14 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40 ${active ? "border-blue-400 bg-blue-600/35" : "border-white/10 bg-white/7"}`}
    >
      {label}
    </button>
  );
}

function CallTool({
  label,
  children,
  onClick,
  active = false,
  danger = false,
  disabled = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className={`flex min-w-[48px] flex-col items-center gap-1 text-[8px] text-white disabled:cursor-not-allowed disabled:opacity-35 sm:min-w-[64px] sm:text-[10px] ${className}`}
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15"
        style={{
          background: danger
            ? "#dc2626"
            : active
              ? "#2563eb"
              : "rgba(255,255,255,.12)",
        }}
      >
        {children}
      </span>
      <span className="max-w-[68px] truncate">{label}</span>
    </motion.button>
  );
}

export function CallPiP() {
  const { can } = useFeatures();
  const {
    callState,
    callInfo,
    hangUp,
    expandCall,
    duration,
    micOn,
    camOn,
    screenShareOn,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    participantCount,
    pipPosition,
    setPipPosition,
  } = useCall();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  if (callState !== "minimized") return null;

  const isGroup = callInfo?.mode === "group";

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label="全画面通話に戻る"
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="fixed z-[50001] cursor-pointer select-none"
      style={{
        left: pipPosition.x,
        top: pipPosition.y,
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: pipPosition.x,
          originY: pipPosition.y,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.hypot(dx, dy) >= 6) {
          drag.moved = true;
          suppressClickRef.current = true;
        }
        if (drag.moved)
          setPipPosition({ x: drag.originX + dx, y: drag.originY + dy });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        dragRef.current = null;
        if (!drag.moved) expandCall();
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        expandCall();
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          expandCall();
        }
      }}
    >
      <div
        style={{
          width: PIP_WIDTH,
          height: PIP_HEIGHT,
          borderRadius: 14,
          overflow: "hidden",
          position: "relative",
          boxShadow: "0 12px 36px rgba(0,0,0,.45)",
          border: "1px solid rgba(255,255,255,.2)",
        }}
      >
        <div
          className="absolute inset-0 flex flex-col justify-between p-2"
          style={{
            background:
              "linear-gradient(to bottom, rgba(13,21,37,0.5) 0%, transparent 40%, rgba(13,21,37,0.7) 100%)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/90 font-semibold truncate">
              {callInfo?.chatName}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/70">
                {formatDuration(duration)}
              </span>
              <button
                aria-label="全画面に戻る"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  expandCall();
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,.35)" }}
              >
                <Maximize2 size={12} className="text-white" />
              </button>
            </div>
          </div>
          {isGroup && (
            <div className="flex items-center gap-1 text-[9px] text-white/50">
              <Users size={9} />
              {participantCount} 名
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {callInfo?.mode === "p2p" && can("canTransferCall") && (
              <TransferButton compact />
            )}
            <button
              aria-label="マイク切替"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void toggleMic();
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
              style={{
                background: micOn
                  ? "rgba(255,255,255,0.2)"
                  : "oklch(0.55 0.22 25)",
              }}
            >
              {micOn ? (
                <Mic size={12} className="text-white" />
              ) : (
                <MicOff size={12} className="text-white" />
              )}
            </button>
            {callInfo?.callType === "video" && can("canScreenShare") && (
              <button
                aria-label="カメラ切替"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleCam();
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  background: camOn
                    ? "rgba(255,255,255,0.2)"
                    : "oklch(0.55 0.22 25)",
                }}
              >
                {camOn ? (
                  <Camera size={12} className="text-white" />
                ) : (
                  <CameraOff size={12} className="text-white" />
                )}
              </button>
            )}
            {callInfo?.callType === "video" && (
              <button
                aria-label={screenShareOn ? "画面共有を停止" : "画面を共有"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleScreenShare().catch((error) =>
                    toast.error(
                      uiErrorMessage(error, "この端末は画面共有に対応していません。"),
                    ),
                  );
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  background: screenShareOn
                    ? "#2563eb"
                    : "rgba(255,255,255,0.2)",
                }}
              >
                {screenShareOn ? (
                  <MonitorOff size={12} className="text-white" />
                ) : (
                  <MonitorUp size={12} className="text-white" />
                )}
              </button>
            )}
            <button
              aria-label="通話終了"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void hangUp();
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
              style={{ background: "oklch(0.55 0.22 25)" }}
            >
              <PhoneOff size={12} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function credentials() {
  return {
    code: localStorage.getItem("ksc_session_code") ?? "",
    deviceId: localStorage.getItem("ksc_device_id") ?? "",
  };
}

function TransferButton({ compact }: { compact: boolean }) {
  const { callInfo } = useCall();
  const creds = credentials();
  const contacts = useQuery(
    api.contacts.getContacts,
    creds.code && creds.deviceId
      ? { ownerCode: creds.code, deviceId: creds.deviceId }
      : "skip",
  );
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [targetCode, setTargetCode] = useState("");
  const [busy, setBusy] = useState(false);
  const initiate = useMutation(api.callState.initiateTransfer);
  const cancel = useMutation(api.callState.cancelTransfer);
  const outgoing = useQuery(
    api.callState.myOutgoingTransfer,
    creds.code && creds.deviceId && callInfo?.callId
      ? { ...creds, callId: callInfo.callId }
      : "skip",
  );
  const transferInProgress =
    outgoing && ["pending", "accepted", "joining"].includes(outgoing.status);
  const searchResults = useQuery(
    api.contacts.searchUser,
    open && !transferInProgress && debouncedSearch.trim()
      ? {
          query: debouncedSearch.trim(),
          requesterCode: creds.code,
          deviceId: creds.deviceId,
        }
      : "skip",
  );
  const selectableResults = (searchResults ?? []).filter(
    (result) => result.code !== callInfo?.remoteCode,
  );
  if (!callInfo?.callId) return null;
  return (
    <>
      <button
        aria-label="转接通话"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          compact
            ? "w-7 h-7 rounded-full flex items-center justify-center"
            : "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
        }
        style={{ background: "rgba(255,255,255,.18)", color: "white" }}
      >
        <ArrowRightLeft size={compact ? 12 : 14} />
        {!compact && (transferInProgress ? "転送中" : "転送")}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[60000] flex items-center justify-center bg-black/70 p-4 pointer-events-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#16233b] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">转接通话</h3>
              <button onClick={() => setOpen(false)}>
                <X className="text-white" size={18} />
              </button>
            </div>
            {transferInProgress ? (
              <div className="rounded-xl bg-white/10 p-4 text-center">
                <p className="text-sm font-semibold text-white">
                  正在等待新的接听人接听
                </p>
                <p className="mt-1 text-xs text-white/60">
                  转接完成前，当前通话会保持连接。
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await cancel({
                        ...credentials(),
                        transferId: outgoing._id,
                      });
                      toast.success("已取消通话转接。");
                      setOpen(false);
                    } catch (error) {
                      toast.error(
                        error instanceof ConvexError
                          ? ((error.data as { message?: string }).message ??
                              "无法取消通话转接。")
                          : "无法取消通话转接。",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="mt-4 w-full rounded-xl bg-white/10 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  取消转接
                </button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-white/60">
                  可按授权码或姓名搜索。新接听人接听并加入前，当前通话会保持连接。
                </p>
                {(contacts?.length ?? 0) > 0 && (
                  <div className="mb-3 max-h-36 space-y-1 overflow-auto">
                    {contacts
                      ?.filter(
                        (contact) => contact.targetCode !== callInfo.remoteCode,
                      )
                      .map((contact) => (
                        <button
                          key={contact._id}
                          onClick={() => setTargetCode(contact.targetCode)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${targetCode === contact.targetCode ? "bg-blue-600" : "bg-white/5"}`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${contact.online ? "bg-green-400" : "bg-white/25"}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {contact.targetName}
                          </span>
                          <span className="text-white/45">
                            {contact.targetCode}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
                <input
                  value={searchInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchInput(value);
                    const normalized = value
                      .normalize("NFKC")
                      .replace(/\s/g, "")
                      .toUpperCase();
                    setTargetCode(
                      /^[A-Z]{5}$/.test(normalized) ? normalized : "",
                    );
                  }}
                  placeholder="授权码或姓名"
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none"
                />
                {debouncedSearch.trim() && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {selectableResults.map((result) => (
                      <button
                        key={result.code}
                        type="button"
                        onClick={() => {
                          setTargetCode(result.code);
                          setSearchInput(`${result.name} (${result.code})`);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${targetCode === result.code ? "bg-blue-600" : "bg-white/5"}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-white">
                          {result.name}
                        </span>
                        <span className="ml-2 font-mono text-white/55">
                          {result.code}
                        </span>
                      </button>
                    ))}
                    {searchResults !== undefined &&
                      selectableResults.length === 0 && (
                        <p className="px-2 py-3 text-center text-xs text-white/45">
                          未找到匹配的接听人。
                        </p>
                      )}
                  </div>
                )}
                <button
                  disabled={busy || !targetCode.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await initiate({
                        ...credentials(),
                        callId: callInfo.callId!,
                        targetCode,
                      });
                      toast.success("转接请求已发送，正在等待接听人接听。");
                    } catch (error) {
                      toast.error(
                        error instanceof ConvexError
                          ? ((error.data as { message?: string }).message ??
                              "无法转接通话。")
                          : "无法转接通话。",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "正在发送..." : "发送转接请求"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function GlobalTransferNotification() {
  const creds = credentials();
  const { callInfo, startCall, hangUp, waitForTransferReady } = useCall();
  const pending = useQuery(
    api.callState.pendingTransfer,
    creds.code && creds.deviceId ? creds : "skip",
  );
  const outgoing = useQuery(
    api.callState.myOutgoingTransfer,
    creds.code && creds.deviceId
      ? { ...creds, callId: callInfo?.callId }
      : "skip",
  );
  const respond = useMutation(api.callState.respondTransfer);
  const confirm = useMutation(api.callState.confirmTransferJoined);
  const failJoin = useMutation(api.callState.failTransferJoin);
  const join = useAction(api.calls.joinTransferredRoom);
  const [busy, setBusy] = useState(false);
  const handledStatus = useRef<string | null>(null);

  useEffect(() => {
    if (!outgoing) return;
    const key = `${outgoing._id}:${outgoing.status}`;
    if (handledStatus.current === key) return;
    if (outgoing.status === "completed") {
      handledStatus.current = key;
      toast.success("通话已转接");
      void hangUp();
    } else if (outgoing.status === "rejected") {
      handledStatus.current = key;
      toast.error("对方拒绝了通话转接");
    } else if (outgoing.status === "expired") {
      handledStatus.current = key;
      toast.error("转接对象未接听");
    } else if (outgoing.status === "failed") {
      handledStatus.current = key;
      toast.error("新接听人无法加入，将继续原通话");
    }
  }, [outgoing, hangUp]);

  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-[61000] flex items-center justify-center bg-[#0d1525]/95 p-5 text-white backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#16233b] p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/25">
          <ArrowRightLeft size={34} />
        </div>
        <p className="mt-5 text-xl font-semibold">收到通话转接请求</p>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {pending.fromName} 请求将其与 {pending.remoteName}
          的通话转接给您
        </p>
        <div className="mt-6 flex gap-3">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await respond({
                  ...creds,
                  transferId: pending._id,
                  accept: false,
                });
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-xl bg-red-600 py-3 font-semibold"
          >
            拒绝
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await respond({
                  ...creds,
                  transferId: pending._id,
                  accept: true,
                });
                let joined = false;
                let lastError: unknown;
                for (let attempt = 0; attempt < 3 && !joined; attempt += 1) {
                  try {
                    const details = await join({
                      ...creds,
                      transferId: pending._id,
                    });
                    await startCall({
                      ...details,
                      myName: creds.code,
                      chatName: pending.remoteName,
                      callType: details.callType,
                      mode: "p2p",
                    });
                    joined = true;
                  } catch (error) {
                    lastError = error;
                    if (attempt < 2)
                      await new Promise((resolve) =>
                        window.setTimeout(resolve, 700 * (attempt + 1)),
                      );
                  }
                }
                if (!joined)
                  throw lastError instanceof Error
                    ? lastError
                    : new Error("无法连接转接通话。");
                await waitForTransferReady();
                await confirm({ ...creds, transferId: pending._id });
                toast.success("已加入转接通话");
              } catch (error) {
                await failJoin({
                  ...creds,
                  transferId: pending._id,
                  reason: uiErrorMessage(error, "加入转接通话失败"),
                }).catch(() => undefined);
                await hangUp();
                toast.error("加入或确认转接通话失败，原通话将继续");
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-xl bg-green-600 py-2 font-semibold"
          >
            接听
          </button>
        </div>
      </div>
    </div>
  );
}
