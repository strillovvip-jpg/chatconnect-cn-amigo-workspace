import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectPath = resolve(
  process.argv[3] ?? "ios/App/App.xcodeproj/project.pbxproj",
);
const rawBuildNumber = process.argv[2] ?? "";

if (!/^\d+$/.test(rawBuildNumber) || Number(rawBuildNumber) < 1) {
  throw new Error(
    `CI build number must be a positive integer; received ${JSON.stringify(rawBuildNumber)}`,
  );
}

const source = readFileSync(projectPath, "utf8");
const matches = source.match(/CURRENT_PROJECT_VERSION = \d+;/g) ?? [];

if (matches.length === 0) {
  throw new Error(`No CURRENT_PROJECT_VERSION settings found in ${projectPath}`);
}

const updated = source.replace(
  /CURRENT_PROJECT_VERSION = \d+;/g,
  `CURRENT_PROJECT_VERSION = ${rawBuildNumber};`,
);

writeFileSync(projectPath, updated);

const verified =
  updated.match(
    new RegExp(`CURRENT_PROJECT_VERSION = ${rawBuildNumber};`, "g"),
  ) ?? [];

if (verified.length !== matches.length) {
  throw new Error(
    `Failed to set every iOS build configuration to ${rawBuildNumber}`,
  );
}

console.log(
  `[set-ios-build-number] set ${verified.length} configuration(s) to ${rawBuildNumber}`,
);
