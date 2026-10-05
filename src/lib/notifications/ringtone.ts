export type RingtonePlayer = { stop: () => void };

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

type SoundKind = keyof typeof BUILT_IN_SOUNDS;

let sharedAudioElements: Partial<Record<SoundKind, HTMLAudioElement>> = {};

export function normalizeRingtoneVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8;
  return Math.min(1, Math.max(0, volume));
}

function bundledAudio(kind: SoundKind): HTMLAudioElement {
  const existing = sharedAudioElements[kind];
  if (existing) return existing;
  const audio = new Audio(BUILT_IN_SOUNDS[kind].web);
  audio.preload = "auto";
  sharedAudioElements[kind] = audio;
  return audio;
}

export async function primeRingtoneAudio(): Promise<void> {
  const audios = [bundledAudio("incomingCall"), bundledAudio("message")];
  const plays = audios.map((audio) => {
    audio.loop = false;
    audio.volume = 0.0001;
    audio.currentTime = 0;
    return audio.play();
  });
  await Promise.allSettled(plays);
  for (const audio of audios) {
    audio.pause();
    audio.currentTime = 0;
  }
}

export function startRingtone(
  volume: number,
): RingtonePlayer {
  const normalizedVolume = normalizeRingtoneVolume(volume);
  const audio = bundledAudio("incomingCall");
  audio.pause();
  audio.currentTime = 0;
  audio.loop = true;
  audio.volume = normalizedVolume;
  void audio.play().catch((error) =>
    console.warn("[notifications] built-in ringtone playback failed", error),
  );
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  };
}

export function startMessageSound(volume: number): RingtonePlayer {
  const audio = bundledAudio("message");
  audio.pause();
  audio.currentTime = 0;
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
    },
  };
}
