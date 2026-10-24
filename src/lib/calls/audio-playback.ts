type AudioRoom = {
  startAudio: () => Promise<void>;
};

const pendingAutomaticAudioStarts = new WeakMap<object, Promise<void>>();
const pendingGestureAudioStarts = new WeakMap<object, Promise<void>>();

/**
 * LiveKit's iOS playback promise can remain pending while the room and local
 * publishing stay healthy. Keep one attempt per room so periodic recovery and
 * media-element events cannot accumulate unresolved startAudio promises.
 */
export function startRoomAudio(
  room: AudioRoom,
  options: { trustedGesture?: boolean } = {},
): Promise<void> {
  const key = room as object;
  const attempts = options.trustedGesture
    ? pendingGestureAudioStarts
    : pendingAutomaticAudioStarts;
  const pending = attempts.get(key);
  if (pending) return pending;

  const attempt = Promise.resolve().then(() => room.startAudio());
  attempts.set(key, attempt);
  const clear = () => {
    if (attempts.get(key) === attempt) attempts.delete(key);
  };
  void attempt.then(clear, clear);
  return attempt;
}
