import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(
  new URL("../src/pages/ChinesePortal.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const messages = readFileSync(
  new URL("../src/lib/i18n/messages.ts", import.meta.url),
  "utf8",
);

test("the private login shell has responsive nyfbi hero assets with CSS fallbacks", () => {
  assert.match(styles, /nyfbi-login/);
  assert.match(styles, /nyfbi-secure-hero-landscape\.webp/);
  assert.match(styles, /nyfbi-secure-hero-portrait\.webp/);
  assert.match(styles, /env\(safe-area-inset-top/);
});

test("the flag background remains visible behind a restrained private portal overlay", () => {
  const shellRule =
    styles.match(/\.nyfbi-login__shell\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(shellRule, /nyfbi-secure-hero-portrait\.webp/);
  assert.doesNotMatch(shellRule, /repeating-linear-gradient/);
});

test("the private-service notice remains legible over the flag background", () => {
  const footerRule =
    styles.match(/\.nyfbi-login__footer\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(footerRule, /background:/);
});

test("the redesigned login names no official agency and uses the private-service notice", () => {
  assert.match(
    messages,
    /Private service — Not affiliated with any government agency\./,
  );
  assert.doesNotMatch(
    `${portal}\n${messages}`,
    /Department of Justice|Federal Bureau of Investigation|U\.S\. government/i,
  );
});

test("the login uses the secure portal masthead and independent trust panel", () => {
  assert.match(portal, /nyfbi-login__masthead/);
  assert.match(portal, /SECURE COMMUNICATIONS PORTAL/);
  assert.match(portal, /nyfbi-login__trust-grid/);
  assert.match(portal, /INDEPENDENT SECURE ACCESS/);
  assert.doesNotMatch(portal, /APPROVED BY THE FCC|OFFICIAL GOVERNMENT/);
});
