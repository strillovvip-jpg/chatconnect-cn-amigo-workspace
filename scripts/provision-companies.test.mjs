import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCompanyProvisioningRequest,
  buildCompanyProvisioningPayload,
  generateUniqueLetterCode,
  persistProvisioningArtifact,
  persistProvisioningStatus,
  redactSecret,
  validateConvexDeploymentUrl,
} from "./provision-companies.mjs";

test("generated company codes contain exactly five uppercase letters and never collide", () => {
  let index = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const deterministicLetter = () => {
    const value = index;
    index += 1;
    return alphabet[value % alphabet.length];
  };
  const reserved = new Set();
  const first = generateUniqueLetterCode(reserved, deterministicLetter);
  const second = generateUniqueLetterCode(reserved, deterministicLetter);

  assert.match(first, /^[A-Z]{5}$/);
  assert.match(second, /^[A-Z]{5}$/);
  assert.notEqual(first, second);
});

test("builds exactly two isolated 61-code companies with 122 globally unique five-letter codes", () => {
  let value = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const deterministicLetter = () => {
    const codeIndex = Math.floor(value / 5);
    const characterIndex = value % 5;
    value += 1;
    return alphabet[
      Math.floor(codeIndex / alphabet.length ** characterIndex) %
        alphabet.length
    ];
  };
  const companies = buildCompanyProvisioningPayload(
    ["Company Alpha", "Company Beta"],
    deterministicLetter,
  );
  const codes = companies.flatMap((company) => [
    company.adminCode,
    ...company.fullCodes,
    ...company.limitedCodes,
  ]);

  assert.equal(companies.length, 2);
  for (const company of companies) {
    assert.equal(company.fullCodes.length, 10);
    assert.equal(company.limitedCodes.length, 50);
  }
  assert.equal(codes.length, 122);
  assert.equal(new Set(codes).size, 122);
  assert.ok(codes.every((code) => /^[A-Z]{5}$/.test(code)));
  for (const company of companies) {
    assert.equal(Object.keys(company.activationSecrets).length, 61);
    for (const code of [
      company.adminCode,
      ...company.fullCodes,
      ...company.limitedCodes,
    ]) {
      assert.match(company.activationSecrets[code], /^[A-Z2-7]{32}$/);
    }
  }
});

test("deployment payload contains only claim-secret hashes while the owner-only artifact retains raw credentials", () => {
  let value = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const deterministicLetter = () => {
    const codeIndex = Math.floor(value / 5);
    const characterIndex = value % 5;
    value += 1;
    return alphabet[
      Math.floor(codeIndex / alphabet.length ** characterIndex) %
        alphabet.length
    ];
  };
  const companies = buildCompanyProvisioningPayload(
    ["Company Alpha", "Company Beta"],
    deterministicLetter,
    () => "A",
  );
  const request = buildCompanyProvisioningRequest(companies);
  const rawSecret = companies[0].activationSecrets[companies[0].adminCode];

  assert.match(rawSecret, /^[A-Z2-7]{32}$/);
  assert.equal(JSON.stringify(request).includes(rawSecret), false);
  assert.equal("activationSecrets" in request[0], false);
  assert.equal(request[0].claimSecretHashes.length, 61);
  assert.ok(
    request[0].claimSecretHashes.every(
      ({ code, hash }) => /^[A-Z]{5}$/.test(code) && /^[a-f0-9]{64}$/.test(hash),
    ),
  );
});

test("generated company administrators skip reserved system tenant codes", () => {
  const injected = [..."NYFBI"];
  let value = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const deterministicLetter = () => {
    const reservedLetter = injected.shift();
    if (reservedLetter) return reservedLetter;
    const codeIndex = Math.floor(value / 5);
    const characterIndex = value % 5;
    value += 1;
    return alphabet[
      Math.floor(codeIndex / alphabet.length ** characterIndex) %
        alphabet.length
    ];
  };

  const companies = buildCompanyProvisioningPayload(
    ["Company Alpha", "Company Beta"],
    deterministicLetter,
  );
  const codes = companies.flatMap((company) => [
    company.adminCode,
    ...company.fullCodes,
    ...company.limitedCodes,
  ]);

  assert.equal(codes.includes("NYFBI"), false);
  assert.equal(new Set(codes).size, 122);
});

test("redacts the import secret from deployment errors", () => {
  assert.equal(
    redactSecret("request failed for top-secret-value", "top-secret-value"),
    "request failed for [REDACTED]",
  );
});

test("keeps the credential artifact immutable and records status in an owner-only sidecar", () => {
  const directory = mkdtempSync(join(tmpdir(), "company-provisioning-"));
  const outputPath = join(directory, "codes.json");
  const payload = {
    status: "pending",
    companies: [{ adminCode: "ABCDE" }],
  };

  persistProvisioningArtifact(outputPath, payload, { exclusive: true });

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), payload);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.throws(
    () => persistProvisioningArtifact(outputPath, payload, { exclusive: true }),
    /EEXIST/,
  );

  const status = { status: "verification_required" };
  const statusPath = persistProvisioningStatus(outputPath, status);
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), payload);
  assert.deepEqual(JSON.parse(readFileSync(statusPath, "utf8")), status);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(statSync(statusPath).mode & 0o777, 0o600);
});

test("provisioning sends secrets in an HTTPS request body instead of a child-process argv", () => {
  const source = readFileSync(
    new URL("./provision-companies.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /ConvexHttpClient/);
  assert.doesNotMatch(source, /spawnSync/);
  assert.doesNotMatch(source, /"convex",\s*"run"/);
});

test("provisioning only sends credentials to the explicitly named Convex deployment", () => {
  assert.equal(
    validateConvexDeploymentUrl(
      "https://adorable-parakeet-350.convex.cloud",
      "adorable-parakeet-350",
    ),
    "https://adorable-parakeet-350.convex.cloud",
  );
  assert.throws(
    () =>
      validateConvexDeploymentUrl(
        "https://evil.example",
        "adorable-parakeet-350",
      ),
    /Convex deployment URL/,
  );
  assert.throws(
    () =>
      validateConvexDeploymentUrl(
        "https://other-deployment.convex.cloud",
        "adorable-parakeet-350",
      ),
    /does not match/,
  );
});
