import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { persistPrivateJson } from "./activation-credentials.mjs";
import { buildAuthorizationImport } from "./import-auth-codes.mjs";

const codes = Array.from(
  { length: 50 },
  (_, index) => `I${String(index).padStart(4, "0")}`,
);

test("legacy import sends one digest per code and keeps raw credentials only in its artifact", () => {
  const bundle = buildAuthorizationImport(
    codes,
    new Set([codes[0]]),
    () => "A",
  );
  const rawSecret = "A".repeat(32);

  assert.equal(bundle.requestCodes.length, 50);
  assert.equal(bundle.credentials.length, 50);
  assert.equal(bundle.requestCodes[0].code, codes[0]);
  assert.equal(bundle.requestCodes[0].role, "admin");
  assert.match(bundle.requestCodes[0].claimSecretHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(bundle.requestCodes).includes(rawSecret), false);
  assert.equal(bundle.credentials[0].credential, `${codes[0]}.${rawSecret}`);
});

test("credential artifact is exclusive and owner-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "auth-code-import-"));
  const outputPath = join(directory, "credentials.json");
  const payload = {
    credentials: [{ credential: `${codes[0]}.${"A".repeat(32)}` }],
  };

  persistPrivateJson(outputPath, payload);

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), payload);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.throws(() => persistPrivateJson(outputPath, payload), /EEXIST/);
});
