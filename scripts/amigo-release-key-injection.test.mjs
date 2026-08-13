import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8");

test("the web bundle never owns or transports the native Amigo production key", () => {
  const faceSwap = read("src/lib/amigo/face-swap.ts");
  const bridge = read("src/lib/amigo/bridge.ts");

  assert.doesNotMatch(faceSwap, /VITE_AMIGO_API_KEY/);
  assert.doesNotMatch(bridge, /initialize\(apiKey/);
  assert.match(bridge, /plugin\.initialize\(\)/);
});

test("the native plugin reads the Release-injected key from the app bundle", () => {
  const infoPlist = read("ios/App/App/Info.plist");
  const plugin = read(
    "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift",
  );

  assert.match(
    infoPlist,
    /<key>AmigoAPIKey<\/key>\s*<string>\$\(AMIGO_API_KEY\)<\/string>/,
  );
  assert.match(
    plugin,
    /Bundle\.main\.object\(forInfoDictionaryKey: "AmigoAPIKey"\)/,
  );
  assert.doesNotMatch(plugin, /call\.getString\("apiKey"\)/);
});

test("the Xcode target consumes a committed config that optionally includes the private generated config", () => {
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  const config = read("ios/App/App/Config/Amigo.xcconfig");
  const gitignore = read(".gitignore");

  assert.match(project, /Amigo\.xcconfig/);
  assert.equal(
    (project.match(/baseConfigurationReference = .*Amigo\.xcconfig/g) ?? [])
      .length,
    2,
  );
  assert.match(config, /#include\? "AmigoSecrets\.generated\.xcconfig"/);
  assert.match(
    gitignore,
    /ios\/App\/App\/Config\/AmigoSecrets\.generated\.xcconfig/,
  );
});

test("the secret generator rejects missing or malformed values and never logs them", () => {
  const script = path.join(root, "scripts/generate-amigo-xcconfig.sh");
  const fakeKey = `ak_live_${"a".repeat(64)}`;
  const outputDir = mkdtempSync(path.join(tmpdir(), "amigo-key-test-"));
  const outputPath = path.join(outputDir, "AmigoSecrets.generated.xcconfig");

  for (const value of [undefined, "not-a-production-key"]) {
    const result = spawnSync("/bin/sh", [script, outputPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        AMIGO_API_KEY: value,
        VITE_AMIGO_API_KEY: "",
      },
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /not-a-production-key/,
    );
  }

  const stdout = execFileSync("/bin/sh", [script, outputPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AMIGO_API_KEY: fakeKey },
  });
  assert.doesNotMatch(stdout, new RegExp(fakeKey));
  assert.equal(
    readFileSync(outputPath, "utf8"),
    `AMIGO_API_KEY = ${fakeKey}\n`,
  );
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
});

test("Xcode Cloud validates and generates the native config before building web assets", () => {
  const cloudScript = read("ci_scripts/ci_post_clone.sh");
  const generateIndex = cloudScript.indexOf("generate-amigo-xcconfig.sh");
  const buildIndex = cloudScript.indexOf("npm run build:ios");

  assert.match(cloudScript, /AMIGO_API_KEY/);
  assert.doesNotMatch(cloudScript, /VITE_AMIGO_API_KEY/);
  assert.ok(generateIndex >= 0);
  assert.ok(buildIndex >= 0);
  assert.ok(generateIndex < buildIndex);
});
