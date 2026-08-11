import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const appDir = resolve("ios/App/App");
const capJSONPath = resolve(appDir, "capacitor.config.json");
const packagePath = resolve("ios/App/CapApp-SPM/Package.swift");
const vendorDir = resolve("ios/App/CapApp-SPM/Vendor");

const AMIGO_CLASS = "AmigoFaceSwapPlugin";
const AMIGO_BINARY_NAME = "AmigoFaceSwapSDK";
const AMIGO_BINARY_PATH = "Vendor/AmigoFaceSwapSDK.xcframework";
const LIVEKIT_DEP = '.package(name: "LiveKit", url: "https://github.com/livekit/client-sdk-swift.git", .upToNextMajor(from: "2.16.0"))';
const LIVEKIT_PRODUCT = '.product(name: "LiveKit", package: "LiveKit")';

let changed = false;

if (exists(capJSONPath)) {
  const capJSON = JSON.parse(readFileSync(capJSONPath, "utf8"));
  const list = Array.isArray(capJSON.packageClassList) ? capJSON.packageClassList : [];
  if (!list.includes(AMIGO_CLASS)) {
    list.push(AMIGO_CLASS);
    capJSON.packageClassList = list;
    writeFileSync(capJSONPath, JSON.stringify(capJSON, null, "\t") + "\n");
    changed = true;
    console.log(`[patch] added ${AMIGO_CLASS} to packageClassList`);
  } else {
    console.log(`[patch] ${AMIGO_CLASS} already registered`);
  }
} else {
  console.error(`[patch] capacitor.config.json not found at ${capJSONPath}`);
}

mkdirSync(vendorDir, { recursive: true });

if (exists(packagePath)) {
  const current = readFileSync(packagePath, "utf8");
  const swiftToolsVersion = current.match(/^\/\/ swift-tools-version:\s*([^\n]+)/m)?.[1]?.trim() ?? "5.9";
  const capacitorVersion = current.match(/capacitor-swift-pm\.git", exact: "([^"]+)"/)?.[1] ?? "8.5.0";
  const desired = `// swift-tools-version: ${swiftToolsVersion}
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${capacitorVersion}"),
        ${LIVEKIT_DEP}
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "${AMIGO_BINARY_NAME}",
                ${LIVEKIT_PRODUCT}
            ]
        ),
        .binaryTarget(
            name: "${AMIGO_BINARY_NAME}",
            path: "${AMIGO_BINARY_PATH}"
        )
    ]
)
`;

  if (current !== desired) {
    writeFileSync(packagePath, desired);
    changed = true;
    console.log("[patch] rewrote Package.swift for local Amigo xcframework");
  } else {
    console.log("[patch] local Amigo xcframework already configured in Package.swift");
  }
} else {
  console.error(`[patch] Package.swift not found at ${packagePath}`);
}

if (!changed) console.log("[patch] nothing to fix");

function exists(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
