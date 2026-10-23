import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const LETTER_CODE_PATTERN = /^[A-Z]{5}$/;
const RESERVED_COMPANY_CODES = ["NYFBI", "AICHIJP"];
const CLAIM_SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CLAIM_HASH_PREFIX = "auth-code-claim:v1";

export function redactSecret(message, secret) {
  const text = String(message);
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

export function generateUniqueLetterCode(
  reserved,
  randomLetter = () => String.fromCharCode(65 + randomInt(26)),
) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const code = Array.from({ length: 5 }, () => randomLetter()).join("");
    if (!LETTER_CODE_PATTERN.test(code))
      throw new Error("The code generator must return uppercase A-Z letters.");
    if (reserved.has(code)) continue;
    reserved.add(code);
    return code;
  }
  throw new Error(
    "Unable to generate a unique five-letter authorization code.",
  );
}

export function generateClaimSecret(
  randomCharacter = () => CLAIM_SECRET_ALPHABET[randomInt(32)],
) {
  const secret = Array.from({ length: 32 }, () => randomCharacter()).join("");
  if (!/^[A-Z2-7]{32}$/.test(secret))
    throw new Error("The claim-secret generator must return Base32 characters.");
  return secret;
}

function hashClaimSecret(code, secret) {
  return createHash("sha256")
    .update(`${CLAIM_HASH_PREFIX}:${code}:${secret}`)
    .digest("hex");
}

export function buildCompanyProvisioningPayload(
  companyNames,
  randomLetter,
  randomClaimCharacter,
) {
  if (!Array.isArray(companyNames) || companyNames.length !== 2)
    throw new Error("Exactly two company names are required.");
  const normalizedNames = companyNames.map((name) =>
    String(name).normalize("NFKC").trim(),
  );
  if (normalizedNames.some((name) => !name || name.length > 100))
    throw new Error("Each company name must contain 1-100 characters.");

  const reserved = new Set(RESERVED_COMPANY_CODES);
  return normalizedNames.map((companyName) => {
    const adminCode = generateUniqueLetterCode(reserved, randomLetter);
    const fullCodes = Array.from({ length: 10 }, () =>
      generateUniqueLetterCode(reserved, randomLetter),
    );
    const limitedCodes = Array.from({ length: 50 }, () =>
      generateUniqueLetterCode(reserved, randomLetter),
    );
    const activationSecrets = Object.fromEntries(
      [adminCode, ...fullCodes, ...limitedCodes].map((code) => [
        code,
        generateClaimSecret(randomClaimCharacter),
      ]),
    );
    return {
      companyName,
      adminCode,
      fullCodes,
      limitedCodes,
      activationSecrets,
    };
  });
}

export function buildCompanyProvisioningRequest(companies) {
  return companies.map(({ activationSecrets, ...company }) => ({
    ...company,
    claimSecretHashes: [
      company.adminCode,
      ...company.fullCodes,
      ...company.limitedCodes,
    ].map((code) => ({
      code,
      hash: hashClaimSecret(code, activationSecrets[code]),
    })),
  }));
}

function fsyncParentDirectory(outputPath) {
  let directory;
  try {
    directory = openSync(dirname(outputPath), "r");
    fsyncSync(directory);
  } catch {
    // Some platforms do not allow directory handles. The file itself has
    // already been fsynced; keep the portable path usable there.
  } finally {
    if (directory !== undefined) closeSync(directory);
  }
}

export function persistProvisioningArtifact(outputPath, payload) {
  const outputFile = openSync(outputPath, "wx", 0o600);
  try {
    writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
    });
    fsyncSync(outputFile);
  } finally {
    closeSync(outputFile);
  }
  chmodSync(outputPath, 0o600);
  fsyncParentDirectory(outputPath);
}

export function persistProvisioningStatus(outputPath, payload) {
  // Status is append-only. The credential artifact itself is never truncated
  // after its first durable write, even if the process or disk fails later.
  const statusPath = `${outputPath}.status-${Date.now()}-${randomUUID()}.json`;
  persistProvisioningArtifact(statusPath, payload);
  return statusPath;
}

export function validateConvexDeploymentUrl(value, deployment) {
  if (!/^[a-z0-9-]+$/.test(deployment))
    throw new Error("CONVEX_DEPLOYMENT_NAME is invalid.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CONVEX_URL must be a valid Convex deployment URL.");
  }
  const expectedHost = `${deployment}.convex.cloud`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  )
    throw new Error(`Convex deployment URL does not match ${expectedHost}.`);
  return url.origin;
}

async function main() {
  const secret = process.env.AUTH_CODE_IMPORT_SECRET;
  const deployment = process.env.CONVEX_DEPLOYMENT_NAME;
  const configuredConvexUrl =
    process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  const namesJson = process.env.COMPANY_NAMES_JSON;
  const outputPath = process.env.COMPANY_CODES_OUTPUT;
  if (!secret) throw new Error("AUTH_CODE_IMPORT_SECRET is required.");
  if (!deployment) throw new Error("CONVEX_DEPLOYMENT_NAME is required.");
  if (!configuredConvexUrl) throw new Error("CONVEX_URL is required.");
  const convexUrl = validateConvexDeploymentUrl(
    configuredConvexUrl,
    deployment,
  );
  if (!namesJson) throw new Error("COMPANY_NAMES_JSON is required.");
  if (!outputPath) throw new Error("COMPANY_CODES_OUTPUT is required.");

  const companies = buildCompanyProvisioningPayload(JSON.parse(namesJson));
  const resolvedOutput = resolve(outputPath);
  // Persist the generated codes before the remote transaction. If the remote
  // write succeeds but this process is interrupted before the final status
  // update, the operator still retains the only copy of the credentials.
  const createdAt = new Date().toISOString();
  persistProvisioningArtifact(resolvedOutput, {
    createdAt,
    status: "pending",
    companies,
  });
  const client = new ConvexHttpClient(convexUrl);
  try {
    await client.mutation(
      api.roleManagement.provisionCompaniesWithImportSecret,
      {
        password: secret,
        companies: buildCompanyProvisioningRequest(companies),
      },
    );
  } catch (error) {
    const message =
      (error instanceof Error ? error.message : String(error)) ||
      "Company provisioning failed.";
    const safeMessage = redactSecret(message, secret);
    // A lost response can happen after the server transaction committed. Keep
    // the credential artifact and mark it for verification instead of deleting
    // the only recoverable copy and generating a conflicting replacement set.
    const statusPath = persistProvisioningStatus(resolvedOutput, {
      createdAt,
      updatedAt: new Date().toISOString(),
      status: "verification_required",
      deploymentError: safeMessage,
    });
    throw new Error(
      `${safeMessage}\nGenerated credentials were retained at ${resolvedOutput}; verify the deployment before retrying. Status: ${statusPath}`,
    );
  }

  const statusPath = persistProvisioningStatus(resolvedOutput, {
    createdAt,
    provisionedAt: new Date().toISOString(),
    status: "provisioned",
  });
  process.stdout.write(
    `Company authorization codes saved to ${resolvedOutput}\nProvisioning status saved to ${statusPath}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
