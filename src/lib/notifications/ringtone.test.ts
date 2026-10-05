import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_SOUNDS,
  normalizeRingtoneVolume,
  startMessageSound,
  startRingtone,
} from "./ringtone";

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

function stubAudio(audio: FakeAudio) {
  vi.stubGlobal("Audio", function AudioMock(source?: string) {
    audio.src = source ?? "";
    return audio;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ringtone playback", () => {
  it("clamps persisted volume to the browser audio range", () => {
    expect(normalizeRingtoneVolume(-1)).toBe(0);
    expect(normalizeRingtoneVolume(0.45)).toBe(0.45);
    expect(normalizeRingtoneVolume(2)).toBe(1);
    expect(normalizeRingtoneVolume(Number.NaN)).toBe(0.8);
  });

  it("plays and fully releases the bundled incoming-call ringtone", () => {
    const audio = new FakeAudio();
    stubAudio(audio);

    const player = startRingtone(1.5);
    expect(audio.src).toBe(BUILT_IN_SOUNDS.incomingCall.web);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(1);
    expect(audio.play).toHaveBeenCalledOnce();

    player.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe("");
  });

  it("plays the bundled message sound once", () => {
    const audio = new FakeAudio();
    stubAudio(audio);

    const player = startMessageSound(0.6);
    expect(audio.src).toBe(BUILT_IN_SOUNDS.message.web);
    expect(audio.loop).toBe(false);
    expect(audio.volume).toBe(0.6);
    expect(audio.play).toHaveBeenCalledOnce();

    player.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
  });
});
