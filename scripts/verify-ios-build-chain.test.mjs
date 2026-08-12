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

test("Capacitor and every Xcode configuration use the established TestFlight bundle identifier", () => {
  const capacitorConfig = read("capacitor.config.ts");
  const xcodeProject = read("ios/App/App.xcodeproj/project.pbxproj");
  const productionBundleIdentifier = "com.tokoyochet.amigoswaptest";
  const xcodeBundleIdentifiers = [
    ...xcodeProject.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g),
  ].map((match) => match[1]);

  assert.match(
    capacitorConfig,
    new RegExp(`appId:\\s*[\"']${productionBundleIdentifier}[\"']`),
  );
  assert.deepEqual(xcodeBundleIdentifiers, [
    productionBundleIdentifier,
    productionBundleIdentifier,
  ]);
  assert.doesNotMatch(xcodeProject, /com\.chatconnect\.cn/);
});

test("every Xcode configuration uses a build number newer than App Store Connect build 19", () => {
  const xcodeProject = read("ios/App/App.xcodeproj/project.pbxproj");
  const buildNumbers = [
    ...xcodeProject.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g),
  ].map((match) => Number(match[1]));

  assert.equal(buildNumbers.length, 2);
  assert.ok(buildNumbers.every((buildNumber) => buildNumber > 19));
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

test("Xcode Cloud refuses to archive without the native face SDK key", () => {
  const cloudScript = read("ci_scripts/ci_post_clone.sh");
  const dependencyInstallIndex = cloudScript.indexOf("npm ci");
  const secretValidationIndex = cloudScript.indexOf(
    'if [ -z "${VITE_AMIGO_API_KEY:-}" ]',
  );

  assert.match(cloudScript, /VITE_AMIGO_API_KEY/);
  assert.match(cloudScript, /required secret/i);
  assert.doesNotMatch(cloudScript, /ak_live_[a-z0-9]+/i);
  assert.ok(dependencyInstallIndex >= 0);
  assert.ok(secretValidationIndex >= 0);
  assert.ok(
    dependencyInstallIndex < secretValidationIndex,
    "npm dependencies must exist before Xcode Cloud validates secrets so the project can be cataloged even when a secret is missing",
  );
});

test("native face enrollment awaits the official async SDK without blocking it", () => {
  const plugin = read(
    "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift",
  );

  assert.match(plugin, /case \.noFaceDetected/);
  assert.match(plugin, /FACE_NOT_DETECTED/);
  assert.match(plugin, /case \.invalidAPIKey/);
  assert.match(plugin, /SDK_INVALID_API_KEY/);
  assert.match(plugin, /case \.revokedAPIKey/);
  assert.match(plugin, /SDK_REVOKED_API_KEY/);
  assert.match(plugin, /case \.quotaExceeded/);
  assert.match(plugin, /SDK_QUOTA_EXCEEDED/);
  assert.match(plugin, /case \.networkRequired/);
  assert.match(plugin, /SDK_NETWORK_REQUIRED/);
  assert.match(plugin, /FACE_IMAGE_DECODE_FAILED/);
  assert.doesNotMatch(plugin, /DispatchSemaphore/);
  assert.doesNotMatch(plugin, /\.wait\(timeout:/);
  assert.match(plugin, /imageByteLength/);
  assert.match(plugin, /imageWidth/);
  assert.match(plugin, /imageHeight/);
  assert.match(
    plugin,
    /AmigoFaceSwap\.enrollFace\(from:\s*decodedImage\)/,
  );
  assert.match(
    plugin,
    /try await AmigoFaceSwap\.initialize\(apiKey:\s*apiKey/,
  );
  assert.doesNotMatch(plugin, /normalizedEnrollmentImage/);
  assert.match(plugin, /enrollmentGeneration/);
  assert.match(plugin, /guard requestGeneration == self\.enrollmentGeneration/);
  assert.match(plugin, /FACE_ENROLL_SUPERSEDED/);
  assert.match(
    plugin,
    /self\.targetLatent = latent[\s\S]{0,500}self\.nativeSession\.setTargetLatent\(latent\)[\s\S]{0,160}self\.enrollmentStateLock\.unlock\(\)/,
  );
  assert.match(
    plugin,
    /targetLatent = nil[\s\S]{0,160}nativeSession\.setTargetLatent\(nil\)[\s\S]{0,160}enrollmentStateLock\.unlock\(\)/,
  );
});

test("native external face-swap track fails closed instead of publishing raw camera frames", () => {
  const plugin = read(
    "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift",
  );
  const processor = plugin.slice(
    plugin.indexOf("private final class AmigoRealtimeVideoProcessor"),
  );

  assert.match(
    plugin,
    /guard faceSwapEnabled, targetLatent != nil else \{[\s\S]{0,400}completion\("FACE_SWAP_NOT_READY"\)[\s\S]{0,80}return\s*\}/,
  );
  assert.match(
    processor,
    /guard enabled, let latent, let inputBuffer = frame\.toCVPixelBuffer\(\) else \{[\s\S]{0,500}return nil\s*\}/,
  );
  assert.doesNotMatch(processor, /return frame/);
  assert.match(
    processor,
    /stage=realtimeProcessFrame result=dropped[\s\S]*reason=processorNotReady/,
  );
});
