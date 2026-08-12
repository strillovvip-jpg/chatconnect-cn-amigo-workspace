import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pluginPath =
  "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift";
const plugin = readFileSync(pluginPath, "utf8");
const cloudScript = readFileSync("ci_scripts/ci_post_clone.sh", "utf8");

test("native initialization shares one SDK task and does not run on MainActor", () => {
  assert.match(plugin, /private var initializationTask: Task<Void, Error>\?/);
  assert.match(plugin, /Task\.detached\(priority: \.userInitiated\)/);
  assert.match(plugin, /try await task\.value/);
  assert.doesNotMatch(
    plugin,
    /Task \{ @MainActor[\s\S]{0,300}AmigoFaceSwap\.initialize/,
  );
});

test("model download diagnostics are throttled instead of writing every callback", () => {
  assert.match(plugin, /AmigoInitializationProgressLogger/);
  assert.match(plugin, /progressLogger\.record\(progress\)/);
  assert.match(plugin, /let bucket = min\(100, max\(0, Int\(progress \* 100\)\)\) \/ 5 \* 5/);
});

test("native enrollment installs the verified Vision revision 2 compatibility before SDK use", () => {
  assert.match(plugin, /import Vision/);
  assert.match(plugin, /import ObjectiveC\.runtime/);
  assert.match(
    plugin,
    /VNDetectFaceLandmarksRequest[\s\S]*initWithCompletionHandler:/,
  );
  assert.match(plugin, /request\.revision = 2/);
  assert.match(
    plugin,
    /AmigoRealtimeVideoProcessor: NSObject, LiveKit\.VideoProcessor/,
    "importing Vision must not make the LiveKit VideoProcessor conformance ambiguous",
  );
  assert.match(
    plugin,
    /AmigoVisionLandmarksCompatibility\.install\(\)[\s\S]*AmigoFaceSwap\.initialize/,
  );

  const compatibility = plugin.match(
    /private enum AmigoVisionLandmarksCompatibility[\s\S]*?\n}\n/,
  )?.[0];
  assert.ok(compatibility, "Vision compatibility implementation is missing");
  assert.doesNotMatch(
    compatibility,
    /supportedRevisions/,
    "checking supportedRevisions inside the swizzled initializer recurses in Vision",
  );
});

test("Xcode Cloud rejects a missing or malformed Amigo production key", () => {
  assert.match(cloudScript, /case "\$VITE_AMIGO_API_KEY" in/);
  assert.match(cloudScript, /ak_live_\[0-9A-Fa-f\]\[0-9A-Fa-f\]\*/);
  assert.match(cloudScript, /native image processor secret has an invalid format/);
});
