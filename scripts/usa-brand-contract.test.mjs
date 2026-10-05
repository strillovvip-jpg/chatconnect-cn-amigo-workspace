import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const userFacingFiles = [
  "index.html",
  "public/site.webmanifest",
  "src/pages/consultation/header-layout.ts",
  "src/lib/i18n/messages.ts",
  "ios/App/App/Info.plist",
  "ios/App/App/capacitor.config.json",
  "ios/App/App/en.lproj/InfoPlist.strings",
  "ios/App/App/ja.lproj/InfoPlist.strings",
  "ios/App/App/zh-Hans.lproj/InfoPlist.strings",
  "ios/App/App/zh-Hant.lproj/InfoPlist.strings",
];

test("all user-visible branding is USA.Filing", () => {
  for (const relativePath of userFacingFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /Song Jin|頌進|颂进/,
      `${relativePath} still contains the previous user-visible brand`,
    );
  }

  const appBrand = fs.readFileSync(path.join(root, "src/app-brand.ts"), "utf8");
  assert.match(appBrand, /downloadName:\s*"USA\.Filing"/);
  assert.match(appBrand, /normalizeLegacyBrandName/);

  const infoPlist = fs.readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
  assert.match(infoPlist, /<string>USA\.Filing<\/string>/);
});
