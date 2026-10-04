import assert from "node:assert/strict";
import test from "node:test";

const cameraControl = await import("./camera-control.ts");

test("buildCameraCaptureOptions pins capture to the selected camera", () => {
  assert.equal(typeof cameraControl.buildCameraCaptureOptions, "function");
  assert.deepEqual(cameraControl.buildCameraCaptureOptions("obs-camera"), {
    resolution: { width: 1280, height: 720, frameRate: 24 },
    deviceId: { exact: "obs-camera" },
  });
});

test("listCameraDevices unlocks labels and returns only installed cameras", async () => {
  assert.equal(typeof cameraControl.listCameraDevices, "function");
  let enumerateCount = 0;
  let stopped = false;
  const mediaDevices = {
    async enumerateDevices() {
      enumerateCount += 1;
      return enumerateCount === 1
        ? [
            { kind: "videoinput", deviceId: "obs-camera", label: "" },
            { kind: "audioinput", deviceId: "mic", label: "" },
          ]
        : [
            {
              kind: "videoinput",
              deviceId: "obs-camera",
              label: "OBS Virtual Camera",
            },
            {
              kind: "videoinput",
              deviceId: "built-in",
              label: "FaceTime HD Camera",
            },
          ];
    },
    async getUserMedia(constraints) {
      assert.deepEqual(constraints, { video: true, audio: false });
      return {
        getTracks: () => [{ stop: () => (stopped = true) }],
      };
    },
  };

  const devices = await cameraControl.listCameraDevices(mediaDevices);

  assert.equal(stopped, true);
  assert.deepEqual(devices, [
    { deviceId: "obs-camera", label: "OBS Virtual Camera" },
    { deviceId: "built-in", label: "FaceTime HD Camera" },
  ]);
});
