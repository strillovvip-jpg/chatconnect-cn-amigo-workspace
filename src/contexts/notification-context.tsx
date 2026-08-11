import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Bell,
  CheckCheck,
  Clock,
  Phone,
  PhoneOff,
  Settings,
  Trash2,
  UserCheck,
  UserPlus,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { localeToHtmlLang, useI18n } from "@/lib/i18n";
import { uiErrorMessage } from "@/lib/utils.ts";
import { useCall } from "@/contexts/call-context.tsx";
import type { Id } from "@/convex/_generated/dataModel.js";
import { useLocation, useNavigate } from "react-router-dom";
import { getNotificationChannel } from "@/lib/notifications/capabilities";

type NotificationContextValue = { unreadCount: number; openCenter: () => void };
const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  openCenter: () => undefined,
});
export const useNotifications = () => useContext(NotificationContext);

function useNotificationCopy() {
  const { messages } = useI18n();
  return messages.notification;
}

export function NotificationBellButton() {
  const copy = useNotificationCopy();
  const { unreadCount, openCenter } = useNotifications();
  return (
    <button
      aria-label={copy.openCenter}
      onClick={openCenter}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#16233b] text-white shadow-md"
    >
      <Bell size={17} />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold">
          {Math.min(unreadCount, 99)}
        </span>
      )}
    </button>
  );
}

function session() {
  return {
    code: localStorage.getItem("ksc_session_code") ?? "",
    deviceId: localStorage.getItem("ksc_device_id") ?? "",
  };
}
function timeLabel(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
const RINGTONE_ENABLED_KEY = "chatconnect-ringtone-enabled";
const RINGTONE_VOLUME_KEY = "chatconnect-ringtone-volume";
const RINGTONE_CUSTOM_KEY = "chatconnect-ringtone-custom";
const NOTIFICATION_SOUND_KEY = "chatconnect-notification-sound-enabled";
const NATIVE_NOTIFICATION_ENABLED_KEY =
  "chatconnect-native-notifications-enabled";

type RingtonePlayer = { stop: () => void };
function startRingtone(
  volume: number,
  customSource: string | null,
): RingtonePlayer {
  if (customSource) {
    const audio = new Audio(customSource);
    audio.loop = true;
    audio.volume = volume;
    void audio.play().catch(() => undefined);
    return {
      stop: () => {
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
      },
    };
  }
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return { stop: () => undefined };
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = Math.max(0.01, volume * 0.18);
  gain.connect(context.destination);
  let stopped = false;
  const playPulse = () => {
    if (stopped) return;
    const now = context.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.22, 660],
    ] as const) {
      const oscillator = context.createOscillator();
      const pulseGain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      pulseGain.gain.setValueAtTime(0.0001, now + offset);
      pulseGain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
      pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      oscillator.connect(pulseGain).connect(gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.2);
    }
  };
  void context
    .resume()
    .then(playPulse)
    .catch(() => undefined);
  const interval = window.setInterval(playPulse, 1400);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(interval);
      void context.close().catch(() => undefined);
    },
  };
}

export function GlobalNotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = useI18n();
  const copy = useNotificationCopy();
  const navigate = useNavigate();
  const location = useLocation();
  const [credentials, setCredentials] = useState(session);
  useEffect(() => {
    const syncSession = () => setCredentials(session());
    window.addEventListener("storage", syncSession);
    window.addEventListener("chatconnect-session-changed", syncSession);
    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("chatconnect-session-changed", syncSession);
    };
  }, []);
  const enabled = Boolean(credentials.code && credentials.deviceId);
  const notifications = useQuery(
    api.notifications.listMine,
    enabled ? { ...credentials, limit: 150 } : "skip",
  );
  const unread = useQuery(
    api.notifications.unreadMine,
    enabled ? credentials : "skip",
  );
  const incomingCall = useQuery(
    api.callState.incomingCall,
    enabled ? credentials : "skip",
  );
  const sessionRole = useQuery(
    api.authCodes.getSessionRole,
    enabled ? credentials : "skip",
  );
  const pushEnabled = useQuery(
    api.pushSubscriptions.status,
    enabled ? credentials : "skip",
  );
  const heartbeat = useMutation(api.presence.heartbeat);
  const savePush = useMutation(api.pushSubscriptions.save);
  const removePush = useMutation(api.pushSubscriptions.remove);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const dismiss = useMutation(api.notifications.dismiss);
  const respondCall = useMutation(api.callState.respondIncomingCall);
  const acceptCall = useAction(api.calls.acceptIncomingCall);
  const joinAcceptedOutgoingCall = useAction(
    api.calls.joinAcceptedOutgoingCall,
  );
  const respondFriend = useMutation(api.contacts.respondFriendRequest);
  const declineGroupCall = useMutation(api.groupCallState.decline);
  const joinGroupCall = useAction(api.secureGroupCalls.join);
  const { callInfo, callState, startCall, hangUp } = useCall();
  const outgoing = useQuery(
    api.callState.outgoingCall,
    enabled && callInfo?.callId
      ? { ...credentials, callId: callInfo.callId }
      : "skip",
  );
  const [centerOpen, setCenterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ringtoneEnabled, setRingtoneEnabled] = useState(
    () => localStorage.getItem(RINGTONE_ENABLED_KEY) !== "false",
  );
  const [ringtoneVolume, setRingtoneVolume] = useState(() =>
    Number(localStorage.getItem(RINGTONE_VOLUME_KEY) ?? "0.8"),
  );
  const [customRingtone, setCustomRingtone] = useState<string | null>(() =>
    localStorage.getItem(RINGTONE_CUSTOM_KEY),
  );
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(
    () => localStorage.getItem(NOTIFICATION_SOUND_KEY) !== "false",
  );
  const [nativePushEnabled, setNativePushEnabled] = useState(
    () => localStorage.getItem(NATIVE_NOTIFICATION_ENABLED_KEY) === "true",
  );
  const [busy, setBusy] = useState(false);
  const toasted = useRef(new Set<string>());
  const outgoingHandled = useRef<string | null>(null);
  const outgoingJoining = useRef<string | null>(null);
  const notificationChannel = getNotificationChannel({
    nativeApp: Capacitor.isNativePlatform(),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotificationApi: "Notification" in window,
  });
  const notificationEnabled =
    notificationChannel === "native" ? nativePushEnabled : Boolean(pushEnabled);

  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState === "visible")
        void heartbeat(credentials).catch(() => undefined);
    };
    send();
    const timer = window.setInterval(send, 30_000);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, [enabled, credentials, heartbeat]);

  const configurePush = async () => {
    if (notificationChannel === "native") {
      if (nativePushEnabled) {
        localStorage.setItem(NATIVE_NOTIFICATION_ENABLED_KEY, "false");
        setNativePushEnabled(false);
        toast.success(copy.pushDisabled);
        return;
      }
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== "granted")
        throw new Error(copy.permissionDenied);
      localStorage.setItem(NATIVE_NOTIFICATION_ENABLED_KEY, "true");
      setNativePushEnabled(true);
      toast.success(copy.pushEnabled);
      return;
    }
    if (
      notificationChannel === "unsupported" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    )
      throw new Error(copy.pushUnsupported);
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing && pushEnabled) {
      await removePush({ ...credentials, endpoint: existing.endpoint });
      await existing.unsubscribe();
      toast.success(copy.pushDisabled);
      return;
    }
    if (existing) {
      const json = existing.toJSON();
      await savePush({
        ...credentials,
        endpoint: existing.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      toast.success(copy.pushEnabled);
      return;
    }
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as
      string | undefined;
    if (!publicKey) throw new Error(copy.vapidMissing);
    if ((await Notification.requestPermission()) !== "granted")
      throw new Error(copy.permissionDenied);
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const bytes = Uint8Array.from(
      atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });
    const json = subscription.toJSON();
    await savePush({
      ...credentials,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
    toast.success(copy.pushEnabled);
  };

  const urgent = unread?.find(
    (item) =>
      item.priority === "urgent" &&
      (!item.expiresAt || item.expiresAt > Date.now()),
  );
  const ringingCall = incomingCall
    ? unread?.find(
        (item) =>
          (item.type === "video_call" || item.type === "audio_call") &&
          String((item.data as Record<string, unknown>).callId ?? "") ===
            incomingCall.callId &&
          (!item.expiresAt || item.expiresAt > Date.now()),
      )
    : undefined;
  const syntheticIncoming = incomingCall
    ? {
        notificationId: `incoming-${incomingCall.callId}`,
        type:
          incomingCall.callType === "video"
            ? ("video_call" as const)
            : ("audio_call" as const),
        title:
          incomingCall.callType === "video"
            ? copy.incomingVideo
            : copy.incomingAudio,
        message: copy.callerMessage(
          incomingCall.callerName,
          incomingCall.callerCode,
        ),
        data: {
          callId: incomingCall.callId,
          callType: incomingCall.callType,
          source: "call",
        },
        priority: "urgent" as const,
        status: "unread" as const,
        createdAt: Date.now(),
      }
    : undefined;
  const ringingNotificationId = incomingCall?.callId;
  const activeUrgent = ringingCall ?? syntheticIncoming ?? urgent;

  useEffect(() => {
    if (incomingCall)
      console.info("[P2P_CALL] incoming ringing call received", {
        callId: incomingCall.callId,
        callType: incomingCall.callType,
      });
  }, [incomingCall]);

  useEffect(() => {
    if (!ringtoneEnabled || !ringingNotificationId) return;
    const player = startRingtone(ringtoneVolume, customRingtone);
    if ("vibrate" in navigator) navigator.vibrate([600, 350, 600, 350, 900]);
    return () => {
      player.stop();
      if ("vibrate" in navigator) navigator.vibrate(0);
    };
  }, [ringingNotificationId, ringtoneEnabled, ringtoneVolume, customRingtone]);

  useEffect(() => {
    let playAlert = false;
    for (const item of unread ?? []) {
      if (
        item.priority === "urgent" ||
        toasted.current.has(item.notificationId)
      )
        continue;
      toasted.current.add(item.notificationId);
      toast(item.title, { description: item.message, duration: 6000 });
      playAlert = true;
    }
    if (playAlert && notificationSoundEnabled) {
      const player = startRingtone(Math.min(ringtoneVolume, 0.65), null);
      window.setTimeout(() => player.stop(), 650);
      if ("vibrate" in navigator) navigator.vibrate([180, 100, 180]);
    }
  }, [unread, notificationSoundEnabled, ringtoneVolume]);

  useEffect(() => {
    if (!outgoing) return;
    const key = `${outgoing.callId}:${outgoing.status}`;
    if (outgoingHandled.current === key) return;
    if (outgoing.status === "rejected") {
      outgoingHandled.current = key;
      toast.error(copy.rejected);
      void hangUp();
    } else if (outgoing.status === "missed" || outgoing.status === "expired") {
      outgoingHandled.current = key;
      toast.error(copy.missed);
      void hangUp();
    } else if (
      ["accepted", "connecting", "connected"].includes(outgoing.status)
    ) {
      // Convex is reactive, so the status may advance from accepted to
      // connecting before this client renders the accepted snapshot. Joining
      // only on the exact accepted state left the caller outside LiveKit and
      // the callee waiting forever with no remote video.
      if (
        callState !== "ringing" ||
        outgoingJoining.current === outgoing.callId
      )
        return;
      outgoingJoining.current = outgoing.callId;
      toast.success(copy.connected(outgoing.calleeName ?? "Other party"));
      void (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const details = await joinAcceptedOutgoingCall({
              ...credentials,
              callId: outgoing.callId,
            });
            await startCall({
              ...details,
              myName: credentials.code,
              chatName: details.chatName,
              callType: details.callType,
              mode: "p2p",
            });
            outgoingHandled.current = key;
            outgoingJoining.current = null;
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 2)
              await new Promise((resolve) =>
                window.setTimeout(resolve, 700 * (attempt + 1)),
              );
          }
        }
        console.error("[P2P_CALL] caller failed to join accepted room", {
          callId: outgoing.callId,
          error: lastError,
        });
        outgoingJoining.current = null;
        toast.error(copy.connectFailed);
      })();
    }
  }, [
    copy,
    outgoing,
    callState,
    credentials,
    joinAcceptedOutgoingCall,
    startCall,
    hangUp,
  ]);

  const handleUrgent = async (accept: boolean) => {
    if (!activeUrgent) return;
    setBusy(true);
    try {
      const data = activeUrgent.data as Record<string, unknown>;
      if (
        activeUrgent.type === "video_call" ||
        activeUrgent.type === "audio_call"
      ) {
        const callId = String(data.callId ?? "");
        if (accept) {
          const details = await acceptCall({ ...credentials, callId });
          await startCall({
            ...details,
            myName: details.myCode,
            chatName: details.chatName,
            callType: details.callType,
            mode: "p2p",
          });
        } else await respondCall({ ...credentials, callId, accept: false });
      } else if (activeUrgent.type === "friend_invite") {
        await respondFriend({
          ...credentials,
          requestId: data.friendRequestId as Id<"friend_requests">,
          accept,
        });
      } else if (activeUrgent.type === "group_video_invite") {
        const groupCallId = data.groupCallId as Id<"chat_group_calls">;
        if (accept) {
          const details = await joinGroupCall({ ...credentials, groupCallId });
          await startCall({
            ...details,
            myName: credentials.code,
            mode: "group",
          });
        } else await declineGroupCall({ ...credentials, groupCallId });
      } else {
        await markRead({
          ...credentials,
          notificationId: activeUrgent.notificationId,
        });
      }
    } catch (error) {
      toast.error(uiErrorMessage(error, copy.handleFailed));
    } finally {
      setBusy(false);
    }
  };

  const openSource = async (
    item: NonNullable<typeof notifications>[number],
  ) => {
    await markRead({ ...credentials, notificationId: item.notificationId });
    const source = String((item.data as Record<string, unknown>)?.source ?? "");
    if (source === "case" || source === "document") {
      if (sessionRole && sessionRole.role !== "user")
        navigate("/consultation", { state: { notificationTab: "docsearch" } });
      else {
        navigate("/consultation", { replace: true });
        toast.error(copy.noAccess);
      }
    } else if (source === "group" || source === "group_call")
      navigate("/consultation", { state: { notificationTab: "groupcall" } });
    else if (source === "friend")
      navigate("/consultation", { state: { notificationTab: "contacts" } });
    else if (source === "message") {
      const data = item.data as Record<string, unknown>;
      const senderCode = String(data.senderCode ?? "");
      if (senderCode)
        navigate(`/consultation/chat/${encodeURIComponent(senderCode)}`, {
          state: {
            chatName: String(data.senderName ?? senderCode),
            myCode: credentials.code,
            myName: localStorage.getItem("ksc_session_name") ?? "",
          },
        });
    }
    setCenterOpen(false);
  };

  const value = useMemo(
    () => ({
      unreadCount: unread?.length ?? 0,
      openCenter: () => setCenterOpen(true),
    }),
    [unread?.length],
  );
  return (
    <NotificationContext.Provider value={value}>
      {children}
      {enabled &&
        callState === "idle" &&
        location.pathname !== "/consultation" && (
          <button
            aria-label={copy.openCenter}
            onClick={() => setCenterOpen(true)}
            className={`fixed top-[max(1rem,var(--app-safe-area-top))] z-[22000] flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#16233b] text-white shadow-xl ${location.pathname.startsWith("/consultation/chat/") ? "right-[5.5rem]" : "right-4"}`}
          >
            <Bell size={19} />
            {(unread?.length ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold">
                {Math.min(unread?.length ?? 0, 99)}
              </span>
            )}
          </button>
        )}
      {centerOpen && (
        <div
          className="fixed inset-0 z-[35000] bg-black/60"
          onClick={() => setCenterOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[#101b30] text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 pb-4 pt-[max(1.25rem,var(--app-safe-area-top))]">
              <div>
                <h2 className="text-lg font-bold">{copy.title}</h2>
                <p className="text-xs text-white/45">
                  {copy.unreadCount(unread?.length ?? 0)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  title={copy.callSettings}
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-lg bg-white/10 p-2"
                >
                  <Settings size={18} />
                </button>
                <button
                  title={copy.markAllRead}
                  onClick={() => void markAllRead(credentials)}
                  className="rounded-lg bg-white/10 p-2"
                >
                  <CheckCheck size={18} />
                </button>
                <button
                  title={copy.close}
                  onClick={() => setCenterOpen(false)}
                  className="rounded-lg bg-white/10 p-2"
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto">
              {notifications?.length === 0 && (
                <div className="py-20 text-center text-sm text-white/35">
                  {copy.empty}
                </div>
              )}
              {notifications?.map((item) => (
                <button
                  key={item._id}
                  onClick={() => void openSource(item)}
                  className={`flex w-full gap-3 border-b border-white/5 px-5 py-4 text-left ${item.status === "unread" ? "bg-blue-500/10" : ""}`}
                >
                  <div className="mt-1">
                    {item.type.includes("call") ? (
                      <Phone size={17} />
                    ) : item.type.startsWith("friend") ? (
                      <UserPlus size={17} />
                    ) : (
                      <Bell size={17} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {item.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[10px] text-white/35">
                        <Clock size={10} />
                        {timeLabel(item.createdAt, localeToHtmlLang(locale))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/60">
                      {item.message}
                    </p>
                    {item.readAt && (
                      <p className="mt-1 text-[10px] text-white/30">
                        {copy.readAt(timeLabel(item.readAt, localeToHtmlLang(locale)))}
                      </p>
                    )}
                  </div>
                  <span
                    role="button"
                    aria-label={copy.deleteNotification}
                    onClick={(event) => {
                      event.stopPropagation();
                      void dismiss({
                        ...credentials,
                        notificationId: item.notificationId,
                      });
                    }}
                    className="mt-1 rounded p-1 text-white/35 hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[37000] flex items-center justify-center bg-black/70 p-5 text-white"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16233b] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 size={19} />
                <h2 className="font-bold">{copy.settingsTitle}</h2>
              </div>
              <button onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <button
              onClick={() =>
                void configurePush().catch((error) =>
                  toast.error(uiErrorMessage(error, copy.pushStatusError)),
                )
              }
              className="mb-3 flex w-full items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-sm"
            >
              <span>{copy.pushToggle}</span>
              <span
                className={notificationEnabled ? "text-green-400" : "text-white/45"}
              >
                {notificationEnabled ? copy.enabled : copy.disabled}
              </span>
            </button>
            <label className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <span className="text-sm">{copy.ringtone}</span>
              <input
                type="checkbox"
                checked={ringtoneEnabled}
                onChange={(event) => {
                  setRingtoneEnabled(event.target.checked);
                  localStorage.setItem(
                    RINGTONE_ENABLED_KEY,
                    String(event.target.checked),
                  );
                }}
                className="h-5 w-5 accent-blue-500"
              />
            </label>
            <label className="mt-3 flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <span className="text-sm">{copy.messageSound}</span>
              <input
                type="checkbox"
                checked={notificationSoundEnabled}
                onChange={(event) => {
                  setNotificationSoundEnabled(event.target.checked);
                  localStorage.setItem(
                    NOTIFICATION_SOUND_KEY,
                    String(event.target.checked),
                  );
                }}
                className="h-5 w-5 accent-blue-500"
              />
            </label>
            <div className="mt-4 rounded-xl bg-white/5 px-4 py-3">
              <div className="mb-2 flex justify-between text-sm">
                <span>{copy.volume}</span>
                <span>{Math.round(ringtoneVolume * 100)}%</span>
              </div>
              <input
                aria-label={copy.volume}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ringtoneVolume}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setRingtoneVolume(value);
                  localStorage.setItem(RINGTONE_VOLUME_KEY, String(value));
                }}
                className="w-full accent-blue-500"
              />
            </div>
            <div className="mt-4 rounded-xl bg-white/5 px-4 py-3">
              <label className="text-sm">{copy.uploadCustom}</label>
              <input
                aria-label={copy.uploadCustomAria}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) {
                    toast.error(copy.ringtoneTooLarge);
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const source = String(reader.result);
                    try {
                      localStorage.setItem(RINGTONE_CUSTOM_KEY, source);
                      setCustomRingtone(source);
                      toast.success(copy.ringtoneSaved);
                    } catch {
                      toast.error(copy.storageFull);
                    }
                  };
                  reader.readAsDataURL(file);
                }}
                className="mt-2 block w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    const preview = startRingtone(
                      ringtoneVolume,
                      customRingtone,
                    );
                    window.setTimeout(() => preview.stop(), 3500);
                  }}
                  className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-semibold"
                >
                  {copy.preview}
                </button>
                <button
                  disabled={!customRingtone}
                  onClick={() => {
                    localStorage.removeItem(RINGTONE_CUSTOM_KEY);
                    setCustomRingtone(null);
                  }}
                  className="flex-1 rounded-lg bg-white/10 py-2 text-xs disabled:opacity-30"
                >
                  {copy.resetDefault}
                </button>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-white/40">
              {copy.autoplayNote}
            </p>
          </div>
        </div>
      )}
      {activeUrgent && callState === "idle" && (
        <div className="fixed inset-0 z-[40000] flex items-center justify-center bg-[#08101f]/95 p-6 text-white">
          <div className="flex w-full max-w-sm flex-col items-center text-center">
            <div className="mb-6 flex h-28 w-28 animate-pulse items-center justify-center rounded-full bg-blue-600/25 ring-8 ring-blue-500/10">
              {activeUrgent.type === "video_call" ? (
                <Video size={44} />
              ) : activeUrgent.type === "friend_invite" ? (
                <UserPlus size={44} />
              ) : (
                <Phone size={44} />
              )}
            </div>
            <p className="text-sm text-white/55">{activeUrgent.title}</p>
            <h2 className="mt-3 text-2xl font-bold">{activeUrgent.message}</h2>
            <div className="mt-12 flex gap-14">
              <div className="flex flex-col items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => void handleUrgent(false)}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 disabled:opacity-40"
                >
                  <PhoneOff size={26} />
                </button>
                <span className="text-xs">{copy.decline}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => void handleUrgent(true)}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 disabled:opacity-40"
                >
                  {activeUrgent.type === "friend_invite" ? (
                    <UserCheck size={26} />
                  ) : (
                    <Phone size={26} />
                  )}
                </button>
                <span className="text-xs">{copy.answer}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}
