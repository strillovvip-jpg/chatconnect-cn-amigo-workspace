import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pluginPath =
  "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift";
const plugin = readFileSync(pluginPath, "utf8");

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
  assert.match(
    plugin,
    /let bucket = min\(100, max\(0, Int\(progress \* 100\)\)\) \/ 5 \* 5/,
  );
});
