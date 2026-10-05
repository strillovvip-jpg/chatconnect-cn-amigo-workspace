export type RingtonePlayer = { stop: () => void };

type WebkitAudioWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedAudioContext: AudioContext | null = null;

export const BUILT_IN_SOUNDS = {
  incomingCall: {
    web: "/sounds/incoming-call.wav",
    native: "incoming-call.caf",
  },
  message: {
    web: "/sounds/message-notification.wav",
    native: "message-notification.caf",
  },
} as const;

export function normalizeRingtoneVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8;
  return Math.min(1, Math.max(0, volume));
}

function audioContext(): AudioContext | null {
  const AudioContextClass =
    window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
  if (!AudioContextClass) return null;
  sharedAudioContext ??= new AudioContextClass();
  return sharedAudioContext;
}

export async function primeRingtoneAudio(): Promise<void> {
  const context = audioContext();
  if (!context) return;
  await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.01);
}

export function startRingtone(
  volume: number,
): RingtonePlayer {
  const normalizedVolume = normalizeRingtoneVolume(volume);
  const audio = new Audio(BUILT_IN_SOUNDS.incomingCall.web);
  audio.loop = true;
  audio.volume = normalizedVolume;
  void audio.play().catch((error) =>
    console.warn("[notifications] built-in ringtone playback failed", error),
  );
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    },
  };
}

export function startMessageSound(volume: number): RingtonePlayer {
  const audio = new Audio(BUILT_IN_SOUNDS.message.web);
  audio.loop = false;
  audio.volume = normalizeRingtoneVolume(volume);
  void audio.play().catch((error) =>
    console.warn(
      "[notifications] built-in message sound playback failed",
      error,
    ),
  );
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    },
  };
}
