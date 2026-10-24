import { useEffect, useRef, useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import type { Room } from "livekit-client";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Circle, Mic } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { participantIdentityMatchesCode } from "@/lib/calls/participant-identity";
import { toast } from "sonner";

type RecordingController = {
  hangup: () => Promise<void>;
  transfer: (transferId: Id<"call_transfers">) => Promise<void>;
  resume: () => Promise<void>;
};

type PendingRecordingUpload = {
  segmentId: Id<"call_recording_segments">;
  blob: Blob;
  mimeType: string;
  terminal?: boolean;
};

class TerminalRecordingUploadError extends Error {}

const recordingControllers = new WeakMap<Room, RecordingController>();
const transferSuspendedRooms = new WeakSet<Room>();
const pendingRecordingUploads = new WeakMap<Room, PendingRecordingUpload[]>();
const pendingRecordingDrainTails = new WeakMap<Room, Promise<void>>();
const recordingSaveError =
  "The final recording segment could not be saved. Please contact your administrator.";
const RECORDING_DRAIN_TIMEOUT_MS = 20_000;
const RECORDING_CONTROLLER_WAIT_MS = 250;
const RECORDING_UPLOAD_ATTEMPT_TIMEOUT_MS = 3_000;
const RECORDING_UPLOAD_RETRY_DELAYS_MS = [0, 100, 250] as const;

async function boundedRecordingDrain(task: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(recordingSaveError)),
          RECORDING_DRAIN_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    toast.error(recordingSaveError, { id: "recording-upload-failed" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function flushCallRecording(room: Room | null) {
  if (!room) return;
  const controller = recordingControllers.get(room);
  if (!controller) return;
  await boundedRecordingDrain(controller.hangup);
}

export async function flushCallRecordingForTransfer(
  room: Room | null,
  transferId: Id<"call_transfers">,
) {
  if (!room) return false;
  // Freeze recording before waiting: if the compliance query resolves while a
  // transfer is joining, its controller must not open a new old-epoch segment.
  transferSuspendedRooms.add(room);
  const deadline = Date.now() + RECORDING_CONTROLLER_WAIT_MS;
  let controller = recordingControllers.get(room);
  while (!controller && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    controller = recordingControllers.get(room);
  }
  if (!controller) return false;
  await boundedRecordingDrain(() => controller.transfer(transferId));
  return true;
}

export async function resumeCallRecording(room: Room | null) {
  if (!room) return;
  transferSuspendedRooms.delete(room);
  await recordingControllers.get(room)?.resume();
}

type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

function recordingUploadEndpoint() {
  const explicit = import.meta.env.VITE_CONVEX_SITE_URL?.trim();
  if (explicit)
    return `${explicit.replace(/\/$/, "")}/api/call-recordings/upload`;
  const url = new URL(import.meta.env.VITE_CONVEX_URL);
  if (url.hostname.endsWith(".convex.cloud"))
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  else if (url.port === "3210") url.port = "3211";
  url.pathname = "/api/call-recordings/upload";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function CallComplianceAgent({
  room,
  callId,
  remoteParticipantCode,
  remoteParticipantIdentity,
  remoteParticipantIdentities,
}: {
  room: Room;
  callId: string;
  remoteParticipantCode?: string;
  remoteParticipantIdentity?: string;
  remoteParticipantIdentities?: string[];
}) {
  const { messages } = useI18n();
  const copy = messages.compliance;
  const code = localStorage.getItem("ksc_session_code") ?? "";
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const status = useQuery(
    api.callCompliance.status,
    code && deviceId && callId ? { code, deviceId, callId } : "skip",
  );
  const respond = useMutation(api.callCompliance.respond);
  const translateToChinese = useAction(api.callTranslation.translateToChinese);
  const beginRecordingSegment = useMutation(
    api.callCompliance.beginRecordingSegment,
  );
  const generateUploadUrl = useMutation(api.callCompliance.generateUploadUrl);
  const prepareRecordingHangup = useMutation(
    api.callCompliance.prepareRecordingHangup,
  );
  const acknowledgeTransferRecordingDrain = useMutation(
    api.callCompliance.acknowledgeTransferRecordingDrain,
  );
  const convex = useConvex();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState("en-US");

  useEffect(() => {
    if (status?.status !== "active" || !status.myConsent || recorderRef.current)
      return;
    let cancelled = false;
    let suspended = transferSuspendedRooms.has(room);
    let rotationTimer: number | undefined;
    let explicitDrainRequested = false;
    let completion: Promise<void> | undefined;
    let startInFlight: Promise<void> | undefined;
    let queueStart: () => Promise<void>;
    const pendingUploads = pendingRecordingUploads.get(room) ?? [];
    pendingRecordingUploads.set(room, pendingUploads);
    const recordingUploadStatus = async (
      segmentId: Id<"call_recording_segments">,
    ) => {
      return await convex.query(
        api.callCompliance.recordingSegmentUploadStatus,
        { code, deviceId, callId, segmentId },
      );
    };
    const uploadPendingSegment = async (entry: PendingRecordingUpload) => {
      try {
        const { uploadToken } = await generateUploadUrl({
          code,
          deviceId,
          callId,
          segmentId: entry.segmentId,
        });
        const response = await fetch(recordingUploadEndpoint(), {
          method: "POST",
          headers: {
            "Content-Type": entry.mimeType,
            "X-Authorization-Code": code,
            "X-Device-Id": deviceId,
            "X-Call-Id": callId,
            "X-Recording-Segment-Id": entry.segmentId,
            "X-Recording-Upload-Token": uploadToken,
          },
          body: entry.blob,
        });
        if (!response.ok) throw new Error("Recording upload failed");
      } catch (error) {
        // A dropped HTTP response can hide a successful one-time save. Only
        // the authenticated server status may reconcile that ambiguity.
        const status = await recordingUploadStatus(entry.segmentId).catch(
          () => undefined,
        );
        if (status?.consumed) return;
        if (status?.uploadable === false)
          throw new TerminalRecordingUploadError(recordingSaveError);
        throw error;
      }
    };
    const drainPendingUploads = async (attempts: number) => {
      for (const entry of [...pendingUploads]) {
        if (entry.terminal) continue;
        let lastError: unknown;
        let uploaded = false;
        let terminal = false;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (attempt > 0)
            await new Promise((resolve) =>
              window.setTimeout(
                resolve,
                RECORDING_UPLOAD_RETRY_DELAYS_MS[
                  Math.min(attempt, RECORDING_UPLOAD_RETRY_DELAYS_MS.length - 1)
                ],
              ),
            );
          try {
            let attemptTimer: number | undefined;
            try {
              await Promise.race([
                uploadPendingSegment(entry),
                new Promise<never>((_, reject) => {
                  attemptTimer = window.setTimeout(
                    () => reject(new Error(recordingSaveError)),
                    RECORDING_UPLOAD_ATTEMPT_TIMEOUT_MS,
                  );
                }),
              ]);
            } finally {
              window.clearTimeout(attemptTimer);
            }
            uploaded = true;
            break;
          } catch (error) {
            if (error instanceof TerminalRecordingUploadError) {
              entry.terminal = true;
              terminal = true;
              toast.error(recordingSaveError, {
                id: "recording-upload-failed",
              });
              break;
            }
            lastError = error;
          }
        }
        if (terminal) continue;
        if (!uploaded) throw lastError ?? new Error(recordingSaveError);
        const index = pendingUploads.indexOf(entry);
        if (index >= 0) pendingUploads.splice(index, 1);
      }
    };
    const queuePendingDrain = (attempts: number) => {
      const previous =
        pendingRecordingDrainTails.get(room) ?? Promise.resolve();
      const scheduled = previous
        .catch(() => undefined)
        .then(() => drainPendingUploads(attempts));
      pendingRecordingDrainTails.set(room, scheduled);
      return scheduled;
    };
    const startSegment = async () => {
      if (
        cancelled ||
        suspended ||
        transferSuspendedRooms.has(room) ||
        recorderRef.current
      )
        return;
      const tracks: MediaStreamTrack[] = [];
      for (const publication of room.localParticipant.trackPublications.values())
        if (publication.kind === "audio" && publication.track?.mediaStreamTrack)
          tracks.push(publication.track.mediaStreamTrack);
      const exactRemoteIdentities = remoteParticipantIdentities?.length
        ? new Set(remoteParticipantIdentities)
        : remoteParticipantIdentity
          ? new Set([remoteParticipantIdentity])
          : undefined;
      for (const remote of room.remoteParticipants.values()) {
        if (
          (exactRemoteIdentities
            ? !exactRemoteIdentities.has(remote.identity)
            : remoteParticipantCode
              ? !participantIdentityMatchesCode(
                  remote.identity,
                  remoteParticipantCode,
                )
              : !status.consentedCodes.some((participantCode) =>
                  participantIdentityMatchesCode(
                    remote.identity,
                    participantCode,
                  ),
                )) ||
          (remoteParticipantCode &&
            !status.consentedCodes.includes(remoteParticipantCode))
        )
          continue;
        for (const publication of remote.trackPublications.values())
          if (
            publication.kind === "audio" &&
            publication.track?.mediaStreamTrack
          )
            tracks.push(publication.track.mediaStreamTrack);
      }
      if (!tracks.length || typeof MediaRecorder === "undefined") return;
      const clientNonce = crypto.randomUUID();
      const { segmentId } = await beginRecordingSegment({
        code,
        deviceId,
        callId,
        clientNonce,
      });
      if (cancelled) return;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType,
      });
      let resolveCompletion!: () => void;
      completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (rotationTimer !== undefined) window.clearTimeout(rotationTimer);
        if (recorderRef.current === recorder) recorderRef.current = null;
        void (async () => {
          if (chunks.length)
            pendingUploads.push({
              segmentId,
              blob: new Blob(chunks, { type: mimeType }),
              mimeType,
            });
          // This path also runs when a cross-code transfer rotates consent on
          // the remaining peer, so it needs its own bounded retry budget.
          const initialDrain = queuePendingDrain(
            explicitDrainRequested
              ? 1
              : RECORDING_UPLOAD_RETRY_DELAYS_MS.length,
          );
          resolveCompletion();
          await initialDrain.catch(() =>
            toast.error(recordingSaveError, {
              id: "recording-upload-failed",
            }),
          );
          if (!cancelled && !suspended && !transferSuspendedRooms.has(room))
            await queueStart();
        })().catch(() =>
          toast.error(recordingSaveError, { id: "recording-upload-failed" }),
        );
      };
      recorder.start(5000);
      recorderRef.current = recorder;
      // Segment capabilities expire after ten minutes. Rotate at five minutes
      // so a long call can always finalize the current consent-bound segment.
      rotationTimer = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 5 * 60_000);
    };
    queueStart = () => {
      if (startInFlight) return startInFlight;
      const nextStart = startSegment();
      startInFlight = nextStart;
      void nextStart.then(
        () => {
          if (startInFlight === nextStart) startInFlight = undefined;
        },
        () => {
          if (startInFlight === nextStart) startInFlight = undefined;
        },
      );
      return nextStart;
    };
    const starting = queueStart();
    void starting.catch(() =>
      toast.error("Call recording could not start.", {
        id: "recording-upload-failed",
      }),
    );
    const stopCurrentSegment = async () => {
      await startInFlight;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      await completion;
    };
    const hangup = async () => {
      cancelled = true;
      suspended = true;
      explicitDrainRequested = true;
      if (rotationTimer !== undefined) window.clearTimeout(rotationTimer);
      const prepared = await prepareRecordingHangup({ code, deviceId, callId });
      await stopCurrentSegment();
      await queuePendingDrain(RECORDING_UPLOAD_RETRY_DELAYS_MS.length);
      const deadline = Math.max(
        Date.now(),
        prepared?.stopDeadline ?? Date.now() + 15_000,
      );
      do {
        const drained = await convex.query(api.callCompliance.status, {
          code,
          deviceId,
          callId,
        });
        if (drained?.status === "stopped") return;
        if (!drained || drained.status !== "stopping")
          throw new Error(recordingSaveError);
        if (
          drained.stopDeadline !== undefined &&
          drained.stopDeadline > deadline
        )
          throw new Error(recordingSaveError);
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      } while (Date.now() <= deadline + 1_000);
      throw new Error(recordingSaveError);
    };
    const transfer = async (transferId: Id<"call_transfers">) => {
      suspended = true;
      explicitDrainRequested = true;
      transferSuspendedRooms.add(room);
      if (rotationTimer !== undefined) window.clearTimeout(rotationTimer);
      await stopCurrentSegment();
      await queuePendingDrain(RECORDING_UPLOAD_RETRY_DELAYS_MS.length);
      await acknowledgeTransferRecordingDrain({
        code,
        deviceId,
        callId,
        transferId,
      });
    };
    const resume = async () => {
      if (cancelled) return;
      suspended = false;
      transferSuspendedRooms.delete(room);
      if (!recorderRef.current) await queueStart();
    };
    recordingControllers.set(room, { hangup, transfer, resume });
    return () => {
      cancelled = true;
      // Keep the drain handle through the stopping transition: a concurrent
      // normal hangup must still wait for this upload and the peer recorders.
      // The weak key releases disconnected rooms; a new recording replaces it.
      if (rotationTimer !== undefined) window.clearTimeout(rotationTimer);
      const recorder = recorderRef.current;
      if (recorder?.state !== "inactive") recorder?.stop();
      if (recorderRef.current === recorder) recorderRef.current = null;
    };
  }, [
    status?.status,
    status?.myConsent,
    status?.consentedCodes,
    room,
    remoteParticipantCode,
    remoteParticipantIdentity,
    remoteParticipantIdentities,
    callId,
    code,
    deviceId,
    beginRecordingSegment,
    generateUploadUrl,
    prepareRecordingHangup,
    acknowledgeTransferRecordingDrain,
    convex,
  ]);

  useEffect(() => {
    if (status?.status === "stopped") {
      recordingControllers.delete(room);
      transferSuspendedRooms.delete(room);
      pendingRecordingUploads.delete(room);
      pendingRecordingDrainTails.delete(room);
    }
  }, [room, status?.status]);

  useEffect(() => {
    if (
      status?.status !== "active" ||
      !status.myConsent ||
      !status.translationEnabled
    )
      return;
    const Recognition =
      (window as RecognitionWindow).SpeechRecognition ??
      (window as RecognitionWindow).webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = speechLanguage;
    let running = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1)
        if (event.results[i].isFinal)
          void translateToChinese({
            code,
            deviceId,
            callId,
            text: event.results[i][0].transcript,
            sourceLanguage: speechLanguage,
          }).catch(() => undefined);
    };
    recognition.onend = () => {
      if (running)
        try {
          recognition.start();
        } catch {
          /* browser is stopping */
        }
    };
    try {
      recognition.start();
    } catch {
      return;
    }
    return () => {
      running = false;
      recognition.onend = null;
      recognition.stop();
    };
  }, [
    status?.status,
    status?.myConsent,
    status?.translationEnabled,
    translateToChinese,
    callId,
    code,
    deviceId,
    speechLanguage,
  ]);

  if (!status) return null;
  if (status.status === "requested" && !status.myConsent && !status.myDecline)
    return (
      <div className="fixed inset-0 z-[70000] grid place-items-center bg-black/80 p-5">
        <div className="max-w-sm rounded-2xl border border-amber-400/30 bg-[#111b2d] p-5 text-white shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-amber-300">
            <Mic size={20} />
            <strong>{copy.title}</strong>
          </div>
          <p className="text-sm leading-6 text-white/70">{copy.body}</p>
          <label className="mt-4 block text-xs text-white/60">
            {copy.callLanguage}
          </label>
          <select
            value={speechLanguage}
            onChange={(event) => setSpeechLanguage(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-[#0b1424] p-2 text-sm"
          >
            <option value="en-US">{copy.languages.enUs}</option>
            <option value="zh-TW">{copy.languages.zhTw}</option>
            <option value="zh-CN">{copy.languages.zhCn}</option>
            <option value="ja-JP">{copy.languages.jaJp}</option>
            <option value="es-US">{copy.languages.esUs}</option>
            <option value="ko-KR">{copy.languages.koKr}</option>
          </select>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                void respond({ code, deviceId, callId, consent: false })
              }
              className="rounded-xl bg-white/10 py-3 text-sm"
            >
              {copy.decline}
            </button>
            <button
              onClick={() =>
                void respond({ code, deviceId, callId, consent: true })
              }
              className="rounded-xl bg-amber-500 py-3 text-sm font-bold text-black"
            >
              {copy.accept}
            </button>
          </div>
        </div>
      </div>
    );
  const isRecording = status.status === "active" && status.myConsent;
  return (
    <div
      className={`fixed left-1/2 top-3 z-[65000] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg ${isRecording ? "bg-red-600" : "bg-amber-600"}`}
    >
      <Circle size={9} fill="currentColor" />
      {isRecording ? (
        <span>{copy.recording}</span>
      ) : status.status === "declined" ? (
        copy.declined
      ) : (
        copy.waiting
      )}
    </div>
  );
}
