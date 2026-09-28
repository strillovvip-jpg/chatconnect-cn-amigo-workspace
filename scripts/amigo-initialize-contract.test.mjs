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

test("native initialization and enrollment settle each Capacitor call exactly once after a watchdog timeout", () => {
  assert.match(plugin, /private final class AmigoPluginCallSettlement/);
  assert.match(plugin, /private static let initializationTimeoutNanoseconds/);
  assert.match(plugin, /private static let enrollmentTimeoutNanoseconds/);
  assert.match(plugin, /private var initializationGeneration = 0/);
  assert.match(
    plugin,
    /guard requestGeneration == self\.initializationGeneration else \{[\s\S]{0,600}self\.didInitialize = true/,
  );
  assert.match(
    plugin,
    /self\.initializationGeneration \+= 1[\s\S]{0,300}self\.initializationTask = nil[\s\S]{0,300}task\.cancel\(\)/,
  );
  assert.match(plugin, /mappedCode=SDK_INITIALIZATION_TIMEOUT/);
  assert.match(plugin, /code: "SDK_INITIALIZATION_TIMEOUT"/);
  assert.match(plugin, /mappedCode=FACE_ENROLL_TIMEOUT/);
  assert.match(plugin, /code: "FACE_ENROLL_TIMEOUT"/);
  assert.match(plugin, /operationTask\.cancel\(\)/);
  assert.match(
    plugin,
    /let sdkTask = Task\.detached\(priority: \.userInitiated\)/,
  );
  assert.match(
    plugin,
    /Task\.detached\(priority: \.userInitiated\)[\s\S]{0,500}primeVisionCPUContext[\s\S]{0,500}AmigoFaceSwap\.enrollFace/,
  );
  assert.match(plugin, /sdkTask\.cancel\(\)/);
  assert.match(
    plugin,
    /guard settlement\.claim\(\) else \{[\s\S]{0,300}lateCompletionIgnored/,
  );
});
