import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import { LiveKitStage } from "@/components/livekit-stage.tsx";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import { VideoSourceManager } from "@/lib/video-sources/video-source-manager.ts";
import type {
  VideoFileOptions,
  VideoSourceKind,
  VideoSourceSnapshot,
} from "@/lib/video-sources/types.ts";
import { useFeatures } from "@/contexts/feature-context.tsx";
import { CallComplianceAgent } from "@/components/call-compliance-agent.tsx";
import { useI18n } from "@/lib/i18n";

type CallMode = "p2p" | "group";
type CallState =
  | "idle"
  | "loading"
  | "ringing"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "minimized";

type CallInfo = {
  serverUrl: string;
  token: string;
  roomName?: string;
  myName: string;
  chatName: string;
  callType: "audio" | "video";
  mode: CallMode;
  callId?: string;
  myCode?: string;
  remoteCode?: string;
  groupCallId?: string;
  initialVideoFile?: VideoFileOptions;
};

export type PipPosition = { x: number; y: number };

export const PIP_WIDTH = 224;
export const PIP_HEIGHT = 140;
const PIP_MARGIN = 12;
const PIP_BOTTOM_RESERVE = 88;

type StartCallArgs = Omit<CallInfo, "mode"> & {
  mode?: CallMode;
  waitForAnswer?: boolean;
};

type CallContextType = {
  callState: CallState;
  callInfo: CallInfo | null;
  startCall: (info: StartCallArgs) => Promise<void>;
  connectPendingCall: () => Promise<void>;
  minimizeCall: () => void;
  expandCall: () => void;
  hangUp: () => Promise<void>;
  micOn: boolean;
  camOn: boolean;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  screenShareOn: boolean;
  screenShareSupported: boolean;
  toggleScreenShare: () => Promise<void>;
  flipCamera: () => Promise<void>;
  duration: number;
  participantCount: number;
  pipPosition: PipPosition;
  setPipPosition: (position: PipPosition) => void;
  clampPipPosition: (position: PipPosition) => PipPosition;
  waitForTransferReady: (timeoutMs?: number) => Promise<void>;
  showSelfPreview: boolean;
  setShowSelfPreview: (show: boolean) => void;
  restoreMedia: () => Promise<void>;
  videoSource: VideoSourceSnapshot;
  aiVideoSourceAvailable: boolean;
  switchVideoSource: (
    source: Exclude<VideoSourceKind, "video-file">,
  ) => Promise<void>;
  useVideoFile: (options: VideoFileOptions) => Promise<void>;
  pauseVideoFile: () => Promise<void>;
  resumeVideoFile: () => Promise<void>;
  stopVideoFile: () => Promise<void>;
};

const CallContext = createContext<CallContextType | null>(null);

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used within CallProvider");
  return context;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { messages } = useI18n();
  const copy = messages.callContext;
  const { can } = useFeatures();
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);
  const endP2PCall = useMutation(api.callState.endP2PCall);
  const leaveGroupCall = useMutation(api.groupCallState.leave);
  const markP2PConnected = useMutation(api.callState.markParticipantConnected);
  const heartbeatCall = useMutation(api.callState.heartbeatCall);
  const heartbeatGroupCall = useMutation(api.groupCallState.heartbeat);
  const authorizeVideoSource = useMutation(api.features.authorizeVideoSource);
  const roomRef = useRef<Room | null>(null);
  const videoSourceManagerRef = useRef<VideoSourceManager | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [room, setRoom] = useState<Room | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [videoSource, setVideoSource] = useState<VideoSourceSnapshot>({
    active: "camera",
    switching: false,
    videoFileState: "idle",
    lastSwitchMs: null,
    error: null,
  });
  const [aiVideoSourceAvailable, setAiVideoSourceAvailable] = useState(false);
  const [showSelfPreview, setShowSelfPreviewState] = useState(
    () => localStorage.getItem("chatconnect-show-self-preview") === "true",
  );
  const [duration, setDuration] = useState(0);
  const [participantCount, setParticipantCount] = useState(1);
  const disconnectingRef = useRef(false);
  const wantedMicRef = useRef(true);
  const wantedCamRef = useRef(true);
  const callInfoRef = useRef<CallInfo | null>(null);
  const sessionCode = localStorage.getItem("ksc_session_code") ?? "";
  const sessionDeviceId = localStorage.getItem("ksc_device_id") ?? "";
  const backendCall = useQuery(
    api.callState.callStatus,
    callInfo?.mode === "p2p" &&
      callInfo.callId &&
      sessionCode &&
      sessionDeviceId
      ? {
          code: sessionCode,
          deviceId: sessionDeviceId,
          callId: callInfo.callId,
        }
      : "skip",
  );
  const backendGroupCall = useQuery(
    api.groupCallState.callStatus,
    callInfo?.mode === "group" &&
      callInfo.callId &&
      sessionCode &&
      sessionDeviceId
      ? {
          code: sessionCode,
          deviceId: sessionDeviceId,
          callId: callInfo.callId,
        }
      : "skip",
  );
  const clampPipPosition = useCallback((position: PipPosition) => {
    if (typeof window === "undefined") return position;
    const maxX = Math.max(
      PIP_MARGIN,
      window.innerWidth - PIP_WIDTH - PIP_MARGIN,
    );
    const maxY = Math.max(
      PIP_MARGIN,
      window.innerHeight - PIP_HEIGHT - PIP_BOTTOM_RESERVE,
    );
    return {
      x: Math.min(maxX, Math.max(PIP_MARGIN, position.x)),
      y: Math.min(maxY, Math.max(PIP_MARGIN, position.y)),
    };
  }, []);
  const defaultPipPosition = useCallback(
    () =>
      clampPipPosition({
        x:
          typeof window === "undefined"
            ? PIP_MARGIN
            : window.innerWidth - PIP_WIDTH - PIP_MARGIN,
        y:
          typeof window === "undefined"
            ? PIP_MARGIN
            : window.innerHeight - PIP_HEIGHT - PIP_BOTTOM_RESERVE,
      }),
    [clampPipPosition],
  );
  const [pipPosition, setRawPipPosition] = useState<PipPosition>(() => {
    if (typeof window === "undefined") return { x: PIP_MARGIN, y: PIP_MARGIN };
    try {
      const saved = window.localStorage.getItem(
        "chatconnect-call-pip-position",
      );
      return saved
        ? clampPipPosition(JSON.parse(saved) as PipPosition)
        : defaultPipPosition();
    } catch {
      return defaultPipPosition();
    }
  });
  const setPipPosition = useCallback(
    (position: PipPosition) => {
      const clamped = clampPipPosition(position);
      setRawPipPosition(clamped);
      try {
        window.localStorage.setItem(
          "chatconnect-call-pip-position",
          JSON.stringify(clamped),
        );
      } catch {
        /* private mode */
      }
    },
    [clampPipPosition],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const setShowSelfPreview = useCallback((show: boolean) => {
    setShowSelfPreviewState(show);
    localStorage.setItem("chatconnect-show-self-preview", String(show));
  }, []);

  const stopLocalMedia = useCallback(async (activeRoom: Room | null) => {
    if (!activeRoom) return;
    const publications = Array.from(
      activeRoom.localParticipant.trackPublications.values(),
    );
    await Promise.allSettled(
      publications.map(async (publication) => {
        if (publication.track) {
          await activeRoom.localParticipant
            .unpublishTrack(publication.track, true)
            .catch(() => undefined);
          publication.track.stop();
        }
      }),
    );
  }, []);

  const hangUp = useCallback(async () => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    stopTimer();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
    const activeRoom = roomRef.current;
    const activeInfo = callInfoRef.current;
    roomRef.current = null;
    const sourceManager = videoSourceManagerRef.current;
    videoSourceManagerRef.current = null;
    await sourceManager?.dispose();
    await stopLocalMedia(activeRoom);
    activeRoom?.removeAllListeners();
    await activeRoom?.disconnect();
    setRoom(null);
    setCallState("idle");
    setCallInfo(null);
    callInfoRef.current = null;
    setDuration(0);
    setParticipantCount(1);
    setMicOn(true);
    setCamOn(true);
    setScreenShareOn(false);
    setVideoSource({
      active: "camera",
      switching: false,
      videoFileState: "idle",
      lastSwitchMs: null,
      error: null,
    });
    if (activeInfo?.mode === "p2p" && activeInfo.callId) {
      void endP2PCall({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        callId: activeInfo.callId,
      }).catch(() => undefined);
    } else if (activeInfo?.mode === "group" && activeInfo.callId) {
      void leaveGroupCall({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        callId: activeInfo.callId,
      }).catch(() => undefined);
    }
    disconnectingRef.current = false;
  }, [stopTimer, stopLocalMedia, endP2PCall, leaveGroupCall]);

  const startCall = useCallback(
    async (args: StartCallArgs) => {
      if (
        roomRef.current &&
        callInfoRef.current?.roomName &&
        callInfoRef.current.roomName === args.roomName
      ) {
        if (
          roomRef.current.state === ConnectionState.Connected &&
          roomRef.current.remoteParticipants.size > 0
        )
          setCallState("connected");
        return;
      }
      if (roomRef.current) await hangUp();
      disconnectingRef.current = false;
      // The caller receives a fresh LiveKit token after the callee accepts.
      // That response intentionally contains no browser File object, so retain
      // the preselected video for the same call instead of asking for it again.
      const pending = callInfoRef.current;
      const retainedVideoFile =
        args.initialVideoFile ??
        (pending?.callId && pending.callId === args.callId
          ? pending.initialVideoFile
          : undefined);
      const timedVideoFile =
        retainedVideoFile && !retainedVideoFile.startedAt
          ? { ...retainedVideoFile, startedAt: Date.now() }
          : retainedVideoFile;
      const info: CallInfo = {
        ...args,
        mode: args.mode ?? "p2p",
        initialVideoFile: timedVideoFile,
      };
      if (args.waitForAnswer) {
        setCallInfo(info);
        callInfoRef.current = info;
        setCallState("ringing");
        setDuration(0);
        return;
      }
      const nextRoom = new Room({
        // P2P calls always render one remote camera at full size. Disabling
        // adaptive stream here avoids Safari temporarily pausing the only
        // remote video while the global call layer changes from ringing to the
        // full-screen stage. Group calls still benefit from adaptive layers.
        adaptiveStream: info.mode === "group",
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 24 },
          facingMode: "user",
        },
      });
      roomRef.current = nextRoom;
      setRoom(nextRoom);
      setCallInfo(info);
      callInfoRef.current = info;
      setCallState("loading");
      setMicOn(true);
      setCamOn(info.callType === "video");
      wantedMicRef.current = true;
      wantedCamRef.current = info.callType === "video";
      setScreenShareOn(false);

      const updateParticipants = () => {
        setParticipantCount(nextRoom.remoteParticipants.size + 1);
        if (
          nextRoom.remoteParticipants.size > 0 &&
          roomRef.current === nextRoom
        ) {
          console.info("[P2P_CALL] remote participant connected", {
            callId: info.callId,
            remoteParticipants: nextRoom.remoteParticipants.size,
          });
          setCallState("connected");
          if (!timerRef.current)
            timerRef.current = setInterval(
              () => setDuration((value) => value + 1),
              1000,
            );
          if (info.mode === "p2p" && info.callId) {
            void markP2PConnected({
              code: localStorage.getItem("ksc_session_code") ?? "",
              deviceId: localStorage.getItem("ksc_device_id") ?? "",
              callId: info.callId,
            }).catch(() => undefined);
          }
        }
      };
      nextRoom.on(RoomEvent.ParticipantConnected, updateParticipants);
      nextRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      nextRoom.on(RoomEvent.TrackSubscribed, updateParticipants);
      nextRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
        publication.setSubscribed(true);
        console.info("[P2P_CALL] remote track published", {
          callId: info.callId,
          participant: participant.identity,
          source: publication.source,
          kind: publication.kind,
        });
        updateParticipants();
      });
      nextRoom.on(
        RoomEvent.TrackSubscribed,
        (track, publication, participant) => {
          console.info("[P2P_CALL] remote track subscribed", {
            callId: info.callId,
            participant: participant.identity,
            source: publication.source,
            kind: track.kind,
          });
          updateParticipants();
        },
      );
      nextRoom.on(
        RoomEvent.TrackSubscriptionFailed,
        (trackSid, participant, error) => {
          console.error("[P2P_CALL] remote track subscription failed", {
            callId: info.callId,
            trackSid,
            participant: participant.identity,
            error,
          });
          toast.error(copy.remoteVideoFailed, {
            id: "livekit-video-subscription",
          });
        },
      );
      const syncLocalTracks = () => {
        if (roomRef.current !== nextRoom) return;
        setMicOn(nextRoom.localParticipant.isMicrophoneEnabled);
        setCamOn(nextRoom.localParticipant.isCameraEnabled);
        setScreenShareOn(
          videoSourceManagerRef.current?.getSnapshot().active ===
            "screen-share" || nextRoom.localParticipant.isScreenShareEnabled,
        );
      };
      nextRoom.on(RoomEvent.LocalTrackPublished, syncLocalTracks);
      nextRoom.on(RoomEvent.LocalTrackUnpublished, syncLocalTracks);
      nextRoom.on(RoomEvent.TrackMuted, syncLocalTracks);
      nextRoom.on(RoomEvent.TrackUnmuted, syncLocalTracks);
      nextRoom.on(RoomEvent.Reconnecting, () => {
        setCallState("reconnecting");
        toast.loading(copy.reconnecting, {
          id: "livekit-reconnect",
        });
        if (reconnectTimeoutRef.current)
          clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          toast.error(copy.reconnectTimeout, {
            id: "livekit-reconnect",
          });
          void hangUp();
        }, 45_000);
      });
      nextRoom.on(RoomEvent.Reconnected, () => {
        if (reconnectTimeoutRef.current)
          clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        toast.success(copy.reconnected, { id: "livekit-reconnect" });
        setCallState("connected");
      });
      nextRoom.on(RoomEvent.Disconnected, () => {
        if (!disconnectingRef.current) void hangUp();
      });

      try {
        await nextRoom.connect(info.serverUrl, info.token, {
          autoSubscribe: true,
        });
        // Report this participant as soon as its LiveKit connection succeeds.
        // Waiting for a remote participant event creates a circular wait when
        // the other client is also waiting for the backend connection state.
        if (info.mode === "p2p" && info.callId) {
          void markP2PConnected({
            code: localStorage.getItem("ksc_session_code") ?? "",
            deviceId: localStorage.getItem("ksc_device_id") ?? "",
            callId: info.callId,
          }).catch((error) =>
            console.error(
              "[P2P_CALL] failed to mark local participant connected",
              error,
            ),
          );
        }
        for (const participant of nextRoom.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values())
            publication.setSubscribed(true);
        }
        await nextRoom.startAudio().catch(() => undefined);
        setCallState(info.mode === "p2p" ? "connecting" : "connected");
        // Set the initial connecting state before checking existing remote
        // participants. Otherwise an already-connected peer is detected here,
        // changed to connected, and then accidentally overwritten to connecting.
        updateParticipants();
        if (info.mode === "group")
          timerRef.current = setInterval(
            () => setDuration((value) => value + 1),
            1000,
          );

        // Do not finish call setup until the local tracks have actually been
        // created and published. Previously this ran detached, so both clients
        // could appear connected while neither had a usable camera track yet.
        try {
          await nextRoom.localParticipant.setMicrophoneEnabled(true);
        } catch {
          toast.error(copy.microphonePermission, {
            id: "livekit-microphone-permission",
          });
        }
        if (info.callType === "video") {
          try {
            await nextRoom.localParticipant.setCameraEnabled(true, {
              resolution: { width: 1280, height: 720, frameRate: 24 },
              facingMode: "user",
            });
            const camera = nextRoom.localParticipant.getTrackPublication(
              Track.Source.Camera,
            );
            if (
              !camera?.track ||
              camera.track.mediaStreamTrack.readyState !== "live"
            )
              throw new Error("camera track was not published");
            console.info("[P2P_CALL] local camera published", {
              callId: info.callId,
              trackSid: camera.trackSid,
            });
            const sourceManager = new VideoSourceManager(nextRoom);
            videoSourceManagerRef.current = sourceManager;
            sourceManager.subscribe((snapshot) => {
              setVideoSource(snapshot);
              setScreenShareOn(snapshot.active === "screen-share");
            });
            setAiVideoSourceAvailable(sourceManager.isAISourceAvailable());
            if (info.initialVideoFile) {
              await authorizeVideoSource({
                code: localStorage.getItem("ksc_session_code") ?? "",
                deviceId: localStorage.getItem("ksc_device_id") ?? "",
                source: "video-file",
              });
              await sourceManager.useVideoFile(info.initialVideoFile);
            }
            toast.dismiss("livekit-camera-permission");
          } catch (error) {
            wantedCamRef.current = false;
            console.error("[P2P_CALL] local camera publish failed", {
              callId: info.callId,
              error,
            });
            toast.error(copy.cameraPermission, {
              id: "livekit-camera-permission",
              duration: 10_000,
            });
          }
        }
        if (roomRef.current === nextRoom) {
          setMicOn(nextRoom.localParticipant.isMicrophoneEnabled);
          setCamOn(nextRoom.localParticipant.isCameraEnabled);
        }
      } catch (error) {
        await hangUp();
        throw error;
      }
    },
    [authorizeVideoSource, copy, hangUp, markP2PConnected],
  );

  const connectPendingCall = useCallback(async () => {
    const pending = callInfoRef.current;
    if (!pending || callState !== "ringing") return;
    await startCall({ ...pending, mode: pending.mode, waitForAnswer: false });
  }, [callState, startCall]);

  useEffect(
    () => () => {
      stopTimer();
      const activeRoom = roomRef.current;
      activeRoom?.removeAllListeners();
      void stopLocalMedia(activeRoom).finally(
        () => void activeRoom?.disconnect(),
      );
    },
    [stopTimer, stopLocalMedia],
  );

  const restoreMedia = useCallback(async () => {
    const activeRoom = roomRef.current;
    const info = callInfoRef.current;
    if (!activeRoom || !info) return;
    await activeRoom.startAudio().catch(() => undefined);
    if (activeRoom.state !== ConnectionState.Connected) return;
    try {
      const micPublication = activeRoom.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const cameraPublication = activeRoom.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      const micEnded =
        micPublication?.track?.mediaStreamTrack.readyState === "ended";
      const cameraEnded =
        cameraPublication?.track?.mediaStreamTrack.readyState === "ended";
      if (micEnded)
        await activeRoom.localParticipant.setMicrophoneEnabled(false);
      if (cameraEnded)
        await activeRoom.localParticipant.setCameraEnabled(false);
      if (
        wantedMicRef.current &&
        (!activeRoom.localParticipant.isMicrophoneEnabled || micEnded)
      ) {
        await activeRoom.localParticipant.setMicrophoneEnabled(true);
      }
      if (
        info.callType === "video" &&
        wantedCamRef.current &&
        (!activeRoom.localParticipant.isCameraEnabled || cameraEnded)
      ) {
        await activeRoom.localParticipant.setCameraEnabled(true);
      }
    } catch {
      toast.error(copy.mediaStopped, {
        id: "livekit-media-restore",
      });
    } finally {
      setMicOn(activeRoom.localParticipant.isMicrophoneEnabled);
      setCamOn(activeRoom.localParticipant.isCameraEnabled);
    }
  }, [copy]);

  useEffect(() => {
    const resume = () => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return;
      if (navigator.onLine === false) {
        setCallState("reconnecting");
        return;
      }
      void restoreMedia();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") resume();
    };
    const offline = () => {
      if (!roomRef.current) return;
      setCallState("reconnecting");
      toast.loading(copy.autoRestore, {
        id: "livekit-reconnect",
      });
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
    };
  }, [copy, restoreMedia]);

  useEffect(() => {
    if (!callInfo || callInfo.mode !== "p2p" || !backendCall) return;
    if (backendCall.peerCode && backendCall.peerCode !== callInfo.remoteCode) {
      const updated = {
        ...callInfo,
        remoteCode: backendCall.peerCode,
        chatName: backendCall.peerName ?? backendCall.peerCode,
      };
      setCallInfo(updated);
      callInfoRef.current = updated;
      toast.success(copy.transferredTo(updated.chatName));
      return;
    }
    if (
      ["ended", "cancelled", "rejected", "expired", "missed"].includes(
        backendCall.status,
      )
    ) {
      toast.message(
        backendCall.status === "ended" ? copy.remoteEnded : copy.callEnded,
      );
      void hangUp();
    }
  }, [backendCall, callInfo, copy, hangUp]);

  useEffect(() => {
    if (
      !callInfo ||
      callInfo.mode !== "group" ||
      backendGroupCall?.status !== "ended"
    )
      return;
    toast.message(copy.groupEnded);
    void hangUp();
  }, [backendGroupCall, callInfo, copy.groupEnded, hangUp]);

  useEffect(() => {
    const keepPipVisible = () =>
      setRawPipPosition((current) => clampPipPosition(current));
    window.addEventListener("resize", keepPipVisible);
    window.addEventListener("orientationchange", keepPipVisible);
    return () => {
      window.removeEventListener("resize", keepPipVisible);
      window.removeEventListener("orientationchange", keepPipVisible);
    };
  }, [clampPipPosition]);

  useEffect(() => {
    if (
      !callInfo?.callId ||
      !["connecting", "connected", "minimized", "reconnecting"].includes(
        callState,
      )
    )
      return;
    const credentials = {
      code: localStorage.getItem("ksc_session_code") ?? "",
      deviceId: localStorage.getItem("ksc_device_id") ?? "",
      callId: callInfo.callId,
    };
    const send = () => {
      const heartbeat =
        callInfo.mode === "group" ? heartbeatGroupCall : heartbeatCall;
      void heartbeat(credentials).catch(() => undefined);
    };
    send();
    const timer = window.setInterval(send, 20_000);
    return () => window.clearInterval(timer);
  }, [callInfo, callState, heartbeatCall, heartbeatGroupCall]);

  useEffect(() => {
    const routeChanged = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (routeChanged && callState === "connected") {
      setRawPipPosition((current) => clampPipPosition(current));
      setCallState("minimized");
    }
  }, [callState, clampPipPosition, location.pathname, can]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    wantedMicRef.current = next;
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(next);
    } catch {
      wantedMicRef.current = activeRoom.localParticipant.isMicrophoneEnabled;
      toast.error(copy.micAccess);
    } finally {
      setMicOn(activeRoom.localParticipant.isMicrophoneEnabled);
    }
  }, [copy.micAccess, micOn]);

  const toggleCam = useCallback(async () => {
    const next = !camOn;
    wantedCamRef.current = next;
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    try {
      const published = activeRoom.localParticipant.getTrackPublication(
        Track.Source.Camera,
      )?.videoTrack;
      if (published) {
        await (next ? published.unmute() : published.mute());
      } else {
        await activeRoom.localParticipant.setCameraEnabled(next);
      }
      if (
        next &&
        !activeRoom.localParticipant.getTrackPublication(Track.Source.Camera)
          ?.track
      ) {
        throw new Error("camera track was not published");
      }
      if (next) toast.dismiss("livekit-camera-permission");
    } catch {
      wantedCamRef.current = activeRoom.localParticipant.isCameraEnabled;
      toast.error(copy.cameraAccess);
    } finally {
      setCamOn(activeRoom.localParticipant.isCameraEnabled);
    }
  }, [camOn, copy.cameraAccess]);

  const flipCamera = useCallback(async () => {
    const publication = roomRef.current?.localParticipant.getTrackPublication(
      Track.Source.Camera,
    );
    const track = publication?.videoTrack;
    if (!track) return;
    const facingMode = track.mediaStreamTrack.getSettings().facingMode;
    await track.restartTrack({
      facingMode: facingMode === "environment" ? "user" : "environment",
    });
  }, []);

  const screenShareSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);
  const switchVideoSource = useCallback(
    async (source: Exclude<VideoSourceKind, "video-file">) => {
      if (!can("canVideoSource"))
        throw new Error(copy.noVideoSourcePermission);
      if (source === "screen-share" && !can("canScreenShare"))
        throw new Error(copy.noScreenSharePermission);
      if (source === "ai" && !can("canAIFace"))
        throw new Error(copy.noAiPermission);
      await authorizeVideoSource({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        source,
      });
      const manager = videoSourceManagerRef.current;
      if (!manager) throw new Error(copy.switchAfterConnect);
      await manager.switchTo(source);
      wantedCamRef.current = true;
      setCamOn(true);
    },
    [authorizeVideoSource, can, copy],
  );
  const useVideoFile = useCallback(
    async (options: VideoFileOptions) => {
      if (!can("canVideoSource") || !can("canPlayVideo"))
        throw new Error(copy.noVideoFilePermission);
      await authorizeVideoSource({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        source: "video-file",
      });
      const manager = videoSourceManagerRef.current;
      if (!manager) throw new Error(copy.switchAfterConnect);
      await manager.useVideoFile(options);
      wantedCamRef.current = true;
      setCamOn(true);
    },
    [authorizeVideoSource, can, copy.noVideoFilePermission, copy.switchAfterConnect],
  );
  const pauseVideoFile = useCallback(async () => {
    await videoSourceManagerRef.current?.pauseVideoFile();
  }, []);
  const resumeVideoFile = useCallback(async () => {
    await videoSourceManagerRef.current?.resumeVideoFile();
  }, []);
  const stopVideoFile = useCallback(async () => {
    await videoSourceManagerRef.current?.stopVideoFile();
  }, []);
  const toggleScreenShare = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || activeRoom.state !== ConnectionState.Connected)
      throw new Error(copy.connectBeforeShare);
    if (!screenShareOn && !navigator.mediaDevices?.getDisplayMedia)
      throw new Error(copy.shareUnsupported);
    try {
      const next = !screenShareOn;
      await switchVideoSource(next ? "screen-share" : "camera");
      const enabled = next;
      setScreenShareOn(enabled);
      toast.success(enabled ? copy.shareStarted : copy.shareStopped, {
        id: "livekit-screen-share",
      });
    } catch (error) {
      setScreenShareOn(
        videoSourceManagerRef.current?.getSnapshot().active === "screen-share",
      );
      if (error instanceof DOMException && error.name === "NotAllowedError")
        throw new Error(copy.shareCancelled);
      throw new Error(copy.shareFailed);
    }
  }, [copy, screenShareOn, switchVideoSource]);

  const waitForTransferReady = useCallback(async (timeoutMs = 15_000) => {
    const activeRoom = roomRef.current;
    const activeInfo = callInfoRef.current;
    if (!activeRoom || !activeInfo) throw new Error(copy.callNotConnected);
    const ready = () => {
      const hasRemoteMedia = Array.from(
        activeRoom.remoteParticipants.values(),
      ).some((participant) =>
        Array.from(participant.trackPublications.values()).some((publication) =>
          Boolean(publication.track),
        ),
      );
      const localMediaReady =
        activeInfo.callType === "audio"
          ? activeRoom.localParticipant.isMicrophoneEnabled
          : activeRoom.localParticipant.isMicrophoneEnabled ||
            activeRoom.localParticipant.isCameraEnabled;
      return (
        activeRoom.remoteParticipants.size > 0 &&
        hasRemoteMedia &&
        localMediaReady
      );
    };
    if (ready()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(copy.mediaReadyTimeout));
      }, timeoutMs);
      const check = () => {
        if (ready()) {
          cleanup();
          resolve();
        }
      };
      const disconnected = () => {
        cleanup();
        reject(new Error(copy.disconnectedDuringTransfer));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        activeRoom.off(RoomEvent.ParticipantConnected, check);
        activeRoom.off(RoomEvent.TrackSubscribed, check);
        activeRoom.off(RoomEvent.LocalTrackPublished, check);
        activeRoom.off(RoomEvent.Disconnected, disconnected);
      };
      activeRoom.on(RoomEvent.ParticipantConnected, check);
      activeRoom.on(RoomEvent.TrackSubscribed, check);
      activeRoom.on(RoomEvent.LocalTrackPublished, check);
      activeRoom.on(RoomEvent.Disconnected, disconnected);
    });
  }, [copy]);

  const isActive = callState !== "idle";
  const isFullscreen =
    callState === "connected" ||
    callState === "loading" ||
    callState === "ringing" ||
    callState === "connecting" ||
    callState === "reconnecting";

  const contextValue = useMemo(
    () => ({
      callState,
      callInfo,
      startCall,
      connectPendingCall,
      minimizeCall: () => {
        setRawPipPosition((current) => clampPipPosition(current));
        setCallState("minimized");
      },
      expandCall: () => setCallState("connected" as const),
      hangUp,
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
      pipPosition,
      setPipPosition,
      clampPipPosition,
      waitForTransferReady,
      showSelfPreview,
      setShowSelfPreview,
      restoreMedia,
      videoSource,
      aiVideoSourceAvailable,
      switchVideoSource,
      useVideoFile,
      pauseVideoFile,
      resumeVideoFile,
      stopVideoFile,
    }),
    [
      callState,
      callInfo,
      startCall,
      connectPendingCall,
      hangUp,
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
      pipPosition,
      setPipPosition,
      clampPipPosition,
      waitForTransferReady,
      showSelfPreview,
      setShowSelfPreview,
      restoreMedia,
      videoSource,
      aiVideoSourceAvailable,
      switchVideoSource,
      useVideoFile,
      pauseVideoFile,
      resumeVideoFile,
      stopVideoFile,
    ],
  );

  return (
    <CallContext.Provider value={contextValue}>
      {isActive && room && (
        <div
          className="fixed overflow-hidden"
          style={{
            // Full-screen media must stay below CallOverlay controls. The PiP
            // media layer stays directly below the draggable PiP controls.
            zIndex: isFullscreen ? 9999 : 50000,
            ...(isFullscreen
              ? { inset: 0 }
              : {
                  left: pipPosition.x,
                  top: pipPosition.y,
                  width: PIP_WIDTH,
                  height: PIP_HEIGHT,
                  borderRadius: 14,
                }),
          }}
        >
          <LiveKitStage
            room={room}
            compact={!isFullscreen}
            mode={callInfo?.mode ?? "p2p"}
            showSelfPreview={
              callInfo?.mode === "p2p" && callInfo.callType === "video"
                ? true
                : showSelfPreview
            }
          />
        </div>
      )}
      {isActive && room && callInfo?.callId && (
        <CallComplianceAgent room={room} callId={callInfo.callId} />
      )}
      {children}
    </CallContext.Provider>
  );
}
