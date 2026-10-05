import assert from "node:assert/strict";
import test from "node:test";

const cameraControl = await import("./camera-control.ts");

test("listCameraDevices unlocks labels and returns physical and virtual cameras", async () => {
  assert.equal(typeof cameraControl.listCameraDevices, "function");
  let enumerateCount = 0;
  let stopped = false;
  const mediaDevices = {
    async enumerateDevices() {
      enumerateCount += 1;
      return enumerateCount === 1
        ? [{ kind: "videoinput", deviceId: "obs", label: "" }]
        : [
            {
              kind: "videoinput",
              deviceId: "obs",
              label: "OBS Virtual Camera",
            },
            {
              kind: "videoinput",
              deviceId: "built-in",
              label: "FaceTime HD Camera",
            },
            {
              kind: "audioinput",
              deviceId: "mic",
              label: "MacBook Microphone",
            },
          ];
    },
    async getUserMedia(constraints) {
      assert.deepEqual(constraints, { video: true, audio: false });
      return { getTracks: () => [{ stop: () => (stopped = true) }] };
    },
  };

  const devices = await cameraControl.listCameraDevices(mediaDevices);

  assert.equal(stopped, true);
  assert.deepEqual(devices, [
    { deviceId: "obs", label: "OBS Virtual Camera" },
    { deviceId: "built-in", label: "FaceTime HD Camera" },
  ]);
});
