import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

test("Xcode Cloud writes its build number into the actual iOS bundle version", () => {
  const cloudScript = read("ci_scripts/ci_post_clone.sh");
  const buildNumberScript = read("scripts/set-ios-build-number.mjs");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ios-build-number-"));
  const temporaryProject = join(temporaryDirectory, "project.pbxproj");

  writeFileSync(
    temporaryProject,
    "CURRENT_PROJECT_VERSION = 23;\nCURRENT_PROJECT_VERSION = 23;\n",
  );

  try {
    execFileSync(
      process.execPath,
      [
        new URL("./set-ios-build-number.mjs", import.meta.url).pathname,
        "32",
        temporaryProject,
      ],
      { encoding: "utf8" },
    );

    assert.equal(
      readFileSync(temporaryProject, "utf8"),
      "CURRENT_PROJECT_VERSION = 32;\nCURRENT_PROJECT_VERSION = 32;\n",
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  assert.match(
    cloudScript,
    /node scripts\/set-ios-build-number\.mjs "\$CI_BUILD_NUMBER"/,
  );
  assert.match(buildNumberScript, /CURRENT_PROJECT_VERSION/);
  assert.match(buildNumberScript, /CI build number/i);
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

test("every vendored Amigo framework slice declares its iOS deployment target", () => {
  const frameworkPlists = [
    "ios/App/CapApp-SPM/Vendor/AmigoFaceSwapSDK.xcframework/ios-arm64/AmigoFaceSwapSDK.framework/Info.plist",
    "ios/App/CapApp-SPM/Vendor/AmigoFaceSwapSDK.xcframework/ios-arm64_x86_64-simulator/AmigoFaceSwapSDK.framework/Info.plist",
  ];

  for (const relativePath of frameworkPlists) {
    const minimumOSVersion = execFileSync(
      "/usr/libexec/PlistBuddy",
      [
        "-c",
        "Print :MinimumOSVersion",
        new URL(`../${relativePath}`, import.meta.url).pathname,
      ],
      { encoding: "utf8" },
    ).trim();

    assert.equal(minimumOSVersion, "16.0", relativePath);
  }
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
    "generate-amigo-xcconfig.sh",
  );

  assert.match(cloudScript, /generate-amigo-xcconfig\.sh/);
  assert.match(
    cloudScript,
    /AMIGO_API_KEY="\$VITE_AMIGO_API_KEY"/,
  );
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
    /latent = try await AmigoFaceSwap\.enrollFace\(from:\s*decodedImage\)/,
  );
  assert.doesNotMatch(plugin, /latent = try await Self\.enrollWithFallbacks\(/);
  assert.doesNotMatch(plugin, /private static func enrollWithFallbacks/);
  assert.match(plugin, /try await AmigoFaceSwap\.initialize\(apiKey:\s*apiKey/);
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
  assert.match(
    plugin,
    /success\["success"\] = true[\s\S]{0,200}success\["enrolled"\] = true[\s\S]{0,200}success\["hasTargetFace"\] = true/,
    "Capacitor must resolve success only after the FaceLatent is retained",
  );
});

test("app restart and call creation never silently re-enroll an old saved photo", () => {
  const boot = read("src/lib/amigo/amigo-boot.tsx");
  const inviteModal = read("src/components/face-swap-invite-modal.tsx");

  assert.doesNotMatch(boot, /useQuery/);
  assert.doesNotMatch(boot, /enrollFace\(/);
  assert.doesNotMatch(inviteModal, /preparePersistedFace\("create"\)/);
  assert.match(inviteModal, /disabled=\{[^}]*!faceReady/);
});

test("native external face-swap track publishes a black privacy frame until a swapped frame is ready", () => {
  const plugin = read(
    "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift",
  );
  const processor = plugin.slice(
    plugin.indexOf("private final class AmigoRealtimeVideoProcessor"),
  );
  const nativeSession = plugin.slice(
    plugin.indexOf("private final class NativeLiveKitSession"),
    plugin.indexOf(
      "#if DEBUG",
      plugin.indexOf("private final class NativeLiveKitSession"),
    ),
  );

  assert.match(
    plugin,
    /if enableCamera && \(!currentEnabled \|\| currentLatent == nil\) \{[\s\S]{0,700}NativeRoomConnectFailure\([\s\S]{0,200}code: "FACE_SWAP_NOT_READY"[\s\S]{0,120}return\s*\}/,
  );
  assert.match(
    nativeSession,
    /processor\.prepareForPublish\(\)[\s\S]{0,300}LocalVideoTrack\.createCameraTrack/,
  );
  assert.match(
    nativeSession,
    /let processor = AmigoRealtimeVideoProcessor\(\)/,
  );
  assert.doesNotMatch(
    nativeSession,
    /private let processor = AmigoRealtimeVideoProcessor\(\)/,
  );
  assert.match(nativeSession, /private var connectionGeneration: UInt64/);
  assert.match(nativeSession, /private var pendingRoom: Room\?/);
  assert.match(
    nativeSession,
    /private var pendingConnectTask: Task<Void, Never>\?/,
  );
  assert.match(
    nativeSession,
    /private var pendingProcessor: AmigoRealtimeVideoProcessor\?/,
  );
  assert.match(nativeSession, /pendingProcessor\?\.setTargetLatent\(latent\)/);
  assert.match(nativeSession, /pendingProcessor\?\.setEnabled\(enabled\)/);
  assert.match(nativeSession, /pendingProcessor = processor/);
  assert.match(
    nativeSession,
    /stateLock\.lock\(\)\s*let currentEnabled = faceSwapEnabled\s*let currentLatent = targetLatent\s*processor\.setTargetLatent\(currentLatent\)\s*processor\.setEnabled\(currentEnabled\)/,
  );
  assert.match(nativeSession, /let connectingProcessor = pendingProcessor/);
  assert.match(nativeSession, /let activeProcessor = publishedProcessor/);
  assert.match(
    nativeSession,
    /Task \{ \[connectingProcessor, activeProcessor\] in[\s\S]{0,900}_ = connectingProcessor[\s\S]{0,120}_ = activeProcessor/,
  );
  assert.match(nativeSession, /let pendingTask = pendingConnectTask/);
  assert.match(nativeSession, /pendingTask\?\.cancel\(\)/);
  assert.match(nativeSession, /guard !Task\.isCancelled/);
  assert.match(nativeSession, /generation == connectionGeneration/);
  assert.match(
    processor,
    /shouldEmitPublishBootstrap[\s\S]{0,500}reason: "trackDimensionBootstrap"/,
  );
  assert.doesNotMatch(processor, /return frame/);
  assert.match(
    processor,
    /stage=realtimeProcessFrame result=privacyPlaceholder[\s\S]*rawCameraPublished=false/,
  );
  for (const reason of [
    "processorNotReady",
    "trackDimensionBootstrap",
    "inputPixelBufferUnavailable",
    "noFaceDetectedInFrame",
    "outputBufferAllocationFailed",
    "sdkProcessingFailed",
  ]) {
    assert.match(
      processor,
      new RegExp(
        `privacyPlaceholderFrame\\(\\s*for: frame,\\s*reason: "${reason}"\\s*\\)`,
      ),
    );
  }
  assert.match(
    processor,
    /private func privacyPlaceholderFrame\(for frame: VideoFrame[\s\S]{0,1600}CIImage\(\s*color: CIColor\(red: 0, green: 0, blue: 0, alpha: 1\)\s*\)/,
  );
});
