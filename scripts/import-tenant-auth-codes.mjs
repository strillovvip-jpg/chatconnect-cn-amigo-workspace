import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

function normalizeCodes(values, label, expectedCount) {
  if (!Array.isArray(values) || values.length !== expectedCount)
    throw new Error(`Expected exactly ${expectedCount} ${label} codes.`);
  const normalized = values.map((value) =>
    String(value).normalize("NFKC").trim().toUpperCase(),
  );
  if (normalized.some((code) => !CODE_PATTERN.test(code)))
    throw new Error(`${label} codes must contain 4-20 letters or digits.`);
  if (new Set(normalized).size !== normalized.length)
    throw new Error(`${label} codes must be unique.`);
  return normalized;
}

export function normalizeTenantImportPayload(input) {
  const companyId = String(input?.companyId ?? "")
    .trim()
    .toLowerCase();
  if (companyId !== "aichijp")
    throw new Error("This importer only accepts the aichijp tenant.");
  const fullCodes = normalizeCodes(input.fullCodes, "full", 20);
  const limitedCodes = normalizeCodes(input.limitedCodes, "limited", 50);
  if (fullCodes.some((code) => limitedCodes.includes(code)))
    throw new Error("Full and limited codes must not overlap.");

  if (!Array.isArray(input.administrators) || input.administrators.length !== 1)
    throw new Error("Exactly one tenant administrator is required.");
  const administrators = input.administrators.map((administrator) => {
    const code = String(administrator.code ?? "")
      .normalize("NFKC")
      .trim()
      .toUpperCase();
    const adminCompanyId = String(administrator.companyId ?? "")
      .trim()
      .toLowerCase();
    if (!CODE_PATTERN.test(code))
      throw new Error(
        "Administrator codes must contain 4-20 letters or digits.",
      );
    if (adminCompanyId !== companyId)
      throw new Error("Administrators must belong to the same tenant.");
    if (administrator.role !== "super_admin" && administrator.role !== "admin")
      throw new Error("Administrator role is invalid.");
    return {
      code,
      role: administrator.role,
      companyId: adminCompanyId,
      ...(administrator.unlimitedDevices === undefined
        ? {}
        : { unlimitedDevices: Boolean(administrator.unlimitedDevices) }),
    };
  });
  if (
    !administrators.some(
      (administrator) => administrator.role === "super_admin",
    )
  )
    throw new Error("A tenant super administrator is required.");

  return { companyId, fullCodes, limitedCodes, administrators };
}

function main() {
  const secret = process.env.AUTH_CODE_IMPORT_SECRET;
  const sourcePath = process.env.TENANT_AUTH_CODES_FILE ?? process.argv[2];
  const deployment = process.env.CONVEX_DEPLOYMENT_NAME;
  if (!secret) throw new Error("AUTH_CODE_IMPORT_SECRET is required.");
  if (!sourcePath) throw new Error("TENANT_AUTH_CODES_FILE is required.");
  if (!deployment) throw new Error("CONVEX_DEPLOYMENT_NAME is required.");

  const input = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
  const payload = normalizeTenantImportPayload(input);
  const result = spawnSync(
    "npx",
    [
      "convex",
      "run",
      "authCodes:replaceAuthorizationCodes",
      JSON.stringify({ password: secret, ...payload }),
      "--deployment",
      deployment,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
