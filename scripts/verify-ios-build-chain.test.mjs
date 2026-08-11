import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Xcode Cloud rebuilds and syncs web assets from repository source", () => {
  const packageJSON = JSON.parse(read("package.json"));
  const cloudScript = read("ci_scripts/ci_post_clone.sh");
  const xcodeCloudEntry = read("ios/App/ci_scripts/ci_post_clone.sh");

  assert.equal(
    packageJSON.scripts["build:ios"],
    "npm run build && npm run sync:ios && npm run verify:ios-assets",
  );
  assert.match(cloudScript, /npm ci/);
  assert.match(cloudScript, /npm run build:ios/);
  assert.match(cloudScript, /command -v node/);
  assert.match(cloudScript, /command -v npm/);
  assert.match(cloudScript, /brew install node/);
  assert.match(cloudScript, /brew --prefix node/);
  assert.match(xcodeCloudEntry, /ci_scripts\/ci_post_clone\.sh/);
  assert.match(xcodeCloudEntry, /git .*rev-parse --show-toplevel/);
});

test("generated Capacitor public assets are never committed as source", () => {
  const gitignore = read(".gitignore");
  const trackedPublic = execFileSync(
    "git",
    ["ls-files", "ios/App/App/public"],
    { encoding: "utf8" },
  ).trim();

  assert.match(gitignore, /^\/ios\/App\/App\/public\/?$/m);
  assert.doesNotMatch(gitignore, /^!ios\/App\/App\/public/m);
  assert.equal(trackedPublic, "");
});

test("TestFlight export compliance is declared in the iOS bundle", () => {
  const infoPlist = read("ios/App/App/Info.plist");

  assert.match(
    infoPlist,
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/,
  );
});

test("iOS sync preserves native local notifications and hides bundle diagnostics", () => {
  const patchScript = read("scripts/patch-ios-spm.mjs");
  const packageSwift = read("ios/App/CapApp-SPM/Package.swift");
  const app = read("src/App.tsx");
  const cloudScript = read("ci_scripts/ci_post_clone.sh");
  const capacitorConfig = read("capacitor.config.ts");

  for (const source of [patchScript, packageSwift]) {
    assert.match(source, /CapacitorLocalNotifications/);
    assert.match(source, /@capacitor\/local-notifications/);
  }
  assert.doesNotMatch(app, /BundleDiagnosticBadge/);
  assert.doesNotMatch(app, /BUNDLE /);
  assert.match(
    cloudScript,
    /VITE_BUNDLE_DIAGNOSTIC="\$\{VITE_BUNDLE_DIAGNOSTIC:-0\}"/,
  );
  assert.match(capacitorConfig, /LocalNotifications:\s*\{/);
  assert.match(
    capacitorConfig,
    /presentationOptions:\s*\["badge",\s*"sound",\s*"alert"\]/,
  );
});
