import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeRingtoneVolume,
  startRingtone,
  validateRingtoneSource,
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
  vi.stubGlobal("Audio", function AudioMock() {
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

  it("plays and fully releases a custom ringtone", () => {
    const audio = new FakeAudio();
    stubAudio(audio);

    const player = startRingtone(1.5, "data:audio/mpeg;base64,AA==");
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(1);
    expect(audio.play).toHaveBeenCalledOnce();

    player.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe("");
  });
});

describe("custom ringtone validation", () => {
  it("resolves only after the selected audio can be decoded", async () => {
    const audio = new FakeAudio();
    stubAudio(audio);

    const validation = validateRingtoneSource("data:audio/mpeg;base64,AA==");
    audio.dispatchEvent(new Event("canplaythrough"));

    await expect(validation).resolves.toBeUndefined();
  });

  it("rejects an invalid custom audio payload", async () => {
    const audio = new FakeAudio();
    stubAudio(audio);

    const validation = validateRingtoneSource("data:audio/mpeg;base64,broken");
    audio.dispatchEvent(new Event("error"));

    await expect(validation).rejects.toThrow("Custom ringtone cannot be decoded");
  });
});
