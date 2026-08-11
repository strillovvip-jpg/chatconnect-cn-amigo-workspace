import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const sourceRoot = resolve("dist");
const iosRoot = resolve("ios/App/App/public");

if (!existsSync(resolve(sourceRoot, "index.html"))) {
  throw new Error("dist/index.html is missing; run npm run build first");
}
if (!existsSync(resolve(iosRoot, "index.html"))) {
  throw new Error("ios/App/App/public/index.html is missing; run cap sync ios first");
}

const files = walk(sourceRoot);
for (const sourcePath of files) {
  const rel = relative(sourceRoot, sourcePath);
  const iosPath = resolve(iosRoot, rel);
  if (!existsSync(iosPath)) {
    throw new Error(`Capacitor sync omitted ${rel}`);
  }
  const sourceHash = hash(sourcePath);
  const iosHash = hash(iosPath);
  if (sourceHash !== iosHash) {
    throw new Error(`Capacitor asset mismatch for ${rel}`);
  }
}

const html = readFileSync(resolve(iosRoot, "index.html"), "utf8");
const assetRefs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)/g)].map(
  (match) => match[1],
);
for (const assetRef of assetRefs) {
  if (!existsSync(resolve(iosRoot, assetRef))) {
    throw new Error(`iOS index references missing asset ${assetRef}`);
  }
}

console.log(
  `[verify-ios-assets] ${files.length} dist files exactly match ios/App/App/public`,
);
console.log(`[verify-ios-assets] index sha256 ${hash(resolve(iosRoot, "index.html"))}`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : statSync(path).isFile() ? [path] : [];
  });
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
