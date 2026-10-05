import assert from "node:assert/strict";
import test from "node:test";

const ringtone = await import("./ringtone.ts");
const nativeNotifications = await import("./native-notifications.ts");

test("the installed app exposes separate bundled call and message sounds", () => {
  assert.deepEqual(ringtone.BUILT_IN_SOUNDS, {
    incomingCall: {
      web: "/sounds/incoming-call.wav",
      native: "incoming-call.caf",
    },
    message: {
      web: "/sounds/message-notification.wav",
      native: "message-notification.caf",
    },
  });
});

test("incoming calls loop the bundled ringtone and release it on stop", () => {
  const previousAudio = globalThis.Audio;
  const instances = [];
  globalThis.Audio = class Audio {
    constructor(source) {
      this.src = source;
      this.currentTime = 0;
      this.loop = false;
      this.volume = 0;
      this.played = false;
      this.paused = false;
      instances.push(this);
    }
    play() {
      this.played = true;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  };
  try {
    const player = ringtone.startRingtone(0.7);
    assert.equal(instances[0].src, "/sounds/incoming-call.wav");
    assert.equal(instances[0].loop, true);
    assert.equal(instances[0].volume, 0.7);
    assert.equal(instances[0].played, true);
    player.stop();
    assert.equal(instances[0].paused, true);
    assert.equal(instances[0].src, "");
  } finally {
    globalThis.Audio = previousAudio;
  }
});

test("message alerts play the bundled message sound once", () => {
  const previousAudio = globalThis.Audio;
  const instances = [];
  globalThis.Audio = class Audio {
    constructor(source) {
      this.src = source;
      this.loop = false;
      this.volume = 0;
      instances.push(this);
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
  };
  try {
    ringtone.startMessageSound(0.5);
    assert.equal(instances[0].src, "/sounds/message-notification.wav");
    assert.equal(instances[0].loop, false);
    assert.equal(instances[0].volume, 0.5);
  } finally {
    globalThis.Audio = previousAudio;
  }
});

test("native alerts preserve the bundled sound filename", async () => {
  let scheduled;
  const plugin = {
    schedule: async (options) => {
      scheduled = options;
    },
  };
  await nativeNotifications.scheduleNativeAlert(plugin, {
    id: 1,
    title: "Incoming call",
    body: "Caller",
    sound: "incoming-call.caf",
  });
  assert.equal(
    scheduled.notifications[0].title,
    "U.S.A · Incoming call",
  );
  assert.equal(
    scheduled.notifications[0].sound,
    "incoming-call.caf",
  );
});
