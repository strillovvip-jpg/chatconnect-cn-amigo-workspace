import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Room } from "livekit-client";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { api } from "@/convex/_generated/api.js";
import { Circle, Mic } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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

export function CallComplianceAgent({
  room,
  callId,
}: {
  room: Room;
  callId: string;
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
  const generateUploadUrl = useMutation(api.callCompliance.generateUploadUrl);
  const saveRecording = useMutation(api.callCompliance.saveRecording);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState("en-US");

  useEffect(() => {
    if (status?.status !== "active" || recorderRef.current) return;
    const tracks: MediaStreamTrack[] = [];
    for (const publication of room.localParticipant.trackPublications.values())
      if (publication.kind === "audio" && publication.track?.mediaStreamTrack)
        tracks.push(publication.track.mediaStreamTrack);
    for (const remote of room.remoteParticipants.values())
      for (const publication of remote.trackPublications.values())
        if (publication.kind === "audio" && publication.track?.mediaStreamTrack)
          tracks.push(publication.track.mediaStreamTrack);
    if (!tracks.length || typeof MediaRecorder === "undefined") return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      void (async () => {
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: mimeType });
        const uploadUrl = await generateUploadUrl({ code, deviceId, callId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: blob,
        });
        const data = (await response.json()) as { storageId: Id<"_storage"> };
        await saveRecording({
          code,
          deviceId,
          callId,
          storageId: data.storageId,
          mimeType,
        });
      })().catch(() => undefined);
    };
    recorder.start(5000);
    recorderRef.current = recorder;
    return () => {
      if (recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
    };
  }, [
    status?.status,
    room,
    callId,
    code,
    deviceId,
    generateUploadUrl,
    saveRecording,
  ]);

  useEffect(() => {
    if (status?.status !== "active" || !status.translationEnabled) return;
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
          <p className="text-sm leading-6 text-white/70">
            {copy.body}
          </p>
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
  return (
    <div
      className={`fixed left-1/2 top-3 z-[65000] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg ${status.status === "active" ? "bg-red-600" : "bg-amber-600"}`}
    >
      <Circle size={9} fill="currentColor" />
      {status.status === "active" ? (
        <span>{copy.recording}</span>
      ) : status.status === "declined" ? (
        copy.declined
      ) : (
        copy.waiting
      )}
    </div>
  );
}
