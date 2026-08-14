import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pluginPath =
  "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift";
const plugin = readFileSync(pluginPath, "utf8");
const helperStart = plugin.indexOf(
  "private static func primeVisionCPUContext(for image: UIImage)",
);
const helperEnd = plugin.indexOf("@objc func enrollFace", helperStart);
const helper = plugin.slice(helperStart, helperEnd);

test("enrollment primes Apple Vision on CPU before calling the vendor SDK", () => {
  assert.match(
    plugin,
    /private static func primeVisionCPUContext\(for image: UIImage\)/,
  );
  assert.match(plugin, /let request = VNDetectFaceLandmarksRequest\(\)/);
  assert.match(plugin, /request\.usesCPUOnly = true/);
  assert.match(plugin, /try handler\.perform\(\[request\]\)/);
  assert.match(helper, /durationMs=/);
  assert.match(
    plugin,
    /primeVisionCPUContext\(for: decodedImage\)[\s\S]{0,300}AmigoFaceSwap\.enrollFace\(from: decodedImage\)/,
  );
  assert.equal(
    [...plugin.matchAll(/primeVisionCPUContext\(for: decodedImage\)/g)].length,
    1,
  );
  assert.equal(
    [...plugin.matchAll(/AmigoFaceSwap\.enrollFace\(from: decodedImage\)/g)]
      .length,
    1,
  );
});

test("CPU preflight remains a compatibility warm-up and does not replace SDK errors", () => {
  assert.match(
    plugin,
    /catch \{[\s\S]{0,300}AmigoSDKDiagnostics\.recordError\(\s*stage: "visionCPUPreflight"/,
  );
  assert.doesNotMatch(plugin, /AmigoVisionLandmarksCompatibility/);
  assert.doesNotMatch(plugin, /method_exchangeImplementations/);
  assert.doesNotMatch(helper, /call\.(?:resolve|reject)/);
  assert.doesNotMatch(helper, /FACE_NOT_DETECTED/);
  assert.doesNotMatch(helper, /VNDetectFaceRectanglesRequest/);
  assert.doesNotMatch(helper, /throw /);
});
