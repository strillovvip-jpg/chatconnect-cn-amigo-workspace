import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceWorker = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const registration = readFileSync(
  new URL("../src/hooks/use-service-worker.ts", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
);

test("nyfbi web cache and registration use the same fresh English-site version", () => {
  const cacheVersion = serviceWorker.match(
    /const CACHE_NAME = "([^"]+)";/,
  )?.[1];
  const registrationVersion = registration.match(
    /register\("\/sw\.js\?v=([^"]+)"/,
  )?.[1];

  assert.ok(cacheVersion?.startsWith("songjin-nyfbi-en-"));
  assert.equal(registrationVersion, cacheVersion);
});

test("nyfbi install manifest is English", () => {
  assert.equal(manifest.lang, "en");
  assert.match(manifest.description, /^[\x20-\x7E]+$/);
  assert.ok(manifest.description.length > 20);
});
