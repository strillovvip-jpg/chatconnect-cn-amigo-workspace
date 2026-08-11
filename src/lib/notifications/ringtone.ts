export type RingtonePlayer = { stop: () => void };

type WebkitAudioWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedAudioContext: AudioContext | null = null;

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
  customSource: string | null,
): RingtonePlayer {
  const normalizedVolume = normalizeRingtoneVolume(volume);
  if (customSource) {
    const audio = new Audio(customSource);
    audio.loop = true;
    audio.volume = normalizedVolume;
    void audio.play().catch((error) =>
      console.warn("[notifications] custom ringtone playback failed", error),
    );
    return {
      stop: () => {
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
      },
    };
  }

  const context = audioContext();
  if (!context) return { stop: () => undefined };
  const gain = context.createGain();
  gain.gain.value = Math.max(0.0001, normalizedVolume * 0.18);
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
  void context.resume().then(playPulse).catch((error) =>
    console.warn("[notifications] ringtone audio resume failed", error),
  );
  const interval = window.setInterval(playPulse, 1400);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(interval);
      gain.disconnect();
    },
  };
}

export function validateRingtoneSource(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const timeout = window.setTimeout(
      () => finish(new Error("Custom ringtone validation timed out")),
      8_000,
    );
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("error", onError);
      audio.src = "";
      audio.load();
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () =>
      finish(new Error("Custom ringtone cannot be decoded"));
    audio.preload = "auto";
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("loadeddata", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.src = source;
    audio.load();
  });
}
