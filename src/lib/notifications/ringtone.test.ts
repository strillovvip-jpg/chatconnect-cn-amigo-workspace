import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio extends EventTarget {
  loop = false;
  volume = 0;
  currentTime = 0;
  preload = "";
  src = "";
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
}

function stubAudioFactory(audios: FakeAudio[]) {
  vi.stubGlobal("Audio", function AudioMock(source?: string) {
    const audio = new FakeAudio();
    audio.src = source ?? "";
    audios.push(audio);
    return audio;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ringtone playback", () => {
  it("clamps persisted volume to the browser audio range", async () => {
    const { normalizeRingtoneVolume } = await import("./ringtone");
    expect(normalizeRingtoneVolume(-1)).toBe(0);
    expect(normalizeRingtoneVolume(0.45)).toBe(0.45);
    expect(normalizeRingtoneVolume(2)).toBe(1);
    expect(normalizeRingtoneVolume(Number.NaN)).toBe(0.8);
  });

  it("primes and reuses the same iOS-unlocked incoming-call audio element", async () => {
    const audios: FakeAudio[] = [];
    stubAudioFactory(audios);
    const { BUILT_IN_SOUNDS, primeRingtoneAudio, startRingtone } =
      await import("./ringtone");

    await primeRingtoneAudio();
    expect(audios).toHaveLength(2);
    expect(audios[0].src).toBe(BUILT_IN_SOUNDS.incomingCall.web);
    expect(audios[0].play).toHaveBeenCalledOnce();

    const player = startRingtone(1.5);
    expect(audios).toHaveLength(2);
    expect(audios[0].loop).toBe(true);
    expect(audios[0].volume).toBe(1);
    expect(audios[0].play).toHaveBeenCalledTimes(2);

    player.stop();
    expect(audios[0].pause).toHaveBeenCalledTimes(3);
    expect(audios[0].currentTime).toBe(0);
    expect(audios[0].src).toBe(BUILT_IN_SOUNDS.incomingCall.web);
  });

  it("plays the bundled message sound on its primed audio element", async () => {
    const audios: FakeAudio[] = [];
    stubAudioFactory(audios);
    const { BUILT_IN_SOUNDS, primeRingtoneAudio, startMessageSound } =
      await import("./ringtone");

    await primeRingtoneAudio();
    const player = startMessageSound(0.6);

    expect(audios).toHaveLength(2);
    expect(audios[1].src).toBe(BUILT_IN_SOUNDS.message.web);
    expect(audios[1].loop).toBe(false);
    expect(audios[1].volume).toBe(0.6);
    expect(audios[1].play).toHaveBeenCalledTimes(2);

    player.stop();
    expect(audios[1].pause).toHaveBeenCalledTimes(3);
    expect(audios[1].src).toBe(BUILT_IN_SOUNDS.message.web);
  });
});
