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

  assert.ok(cacheVersion?.startsWith("usa-filing-nyfbi-en-"));
  assert.equal(registrationVersion, cacheVersion);
});

test("nyfbi install manifest is English", () => {
  assert.equal(manifest.lang, "en");
  assert.match(manifest.description, /^[\x20-\x7E]+$/);
  assert.ok(manifest.description.length > 20);
});

test("nyfbi notification and install icons use the USA.Filing artwork", () => {
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/icon/usa-192.png?v=4", "/icon/usa-512.png?v=4"],
  );
  assert.match(serviceWorker, /\/icon\/usa-192\.png\?v=4/);
  assert.match(serviceWorker, /icon:\s*"\/icon\/usa-192\.png\?v=4"/);
  for (const size of [180, 192, 512]) {
    assert.ok(
      readFileSync(
        new URL(`../public/icon/usa-${size}.png`, import.meta.url),
      ).length > 1_000,
    );
  }
  const source = readFileSync(
    new URL("../assets/branding/usa-flag-app-icon.svg", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/<use /g) ?? []).length, 50);
  assert.equal((source.match(/<rect width="1000" height="(?:76|77)"/g) ?? []).length, 7);
});
