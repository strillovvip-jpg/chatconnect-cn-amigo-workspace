import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildActivationBundle,
  persistPrivateJson,
} from "./activation-credentials.mjs";

export function buildAuthorizationImport(codes, adminCodes, randomCharacter) {
  const normalizedCodes = codes.map((code) =>
    String(code).normalize("NFKC").trim().toUpperCase(),
  );
  const normalizedAdmins = new Set(
    [...adminCodes].map((code) =>
      String(code).normalize("NFKC").trim().toUpperCase(),
    ),
  );
  if (
    normalizedCodes.length !== 50 ||
    new Set(normalizedCodes).size !== 50 ||
    normalizedCodes.some((code) => !/^[A-Z0-9]{4,20}$/.test(code))
  )
    throw new Error("授权码文件必须正好包含 50 个互不重复的授权码。");
  const bundle = buildActivationBundle(normalizedCodes, randomCharacter);
  const hashByCode = new Map(
    bundle.claimSecretHashes.map(({ code, hash }) => [code, hash]),
  );
  return {
    requestCodes: normalizedCodes.map((code) => ({
      code,
      role: normalizedAdmins.has(code) ? "admin" : "user",
      claimSecretHash: hashByCode.get(code),
    })),
    credentials: normalizedCodes.map((code) => ({
      code,
      role: normalizedAdmins.has(code) ? "admin" : "user",
      credential: bundle.credentials[code],
    })),
  };
}

function main() {
  const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
  if (!importSecret)
    throw new Error("导入授权码前必须设置 AUTH_CODE_IMPORT_SECRET。");
  const codesPath =
    process.env.AUTH_CODES_FILE ??
    process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!codesPath)
    throw new Error(
      "请通过 AUTH_CODES_FILE 或命令参数指定独立授权码文件的绝对路径。",
    );
  const adminCodes = new Set(
    (process.env.INITIAL_ADMIN_CODES ?? "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
  const codes = readFileSync(codesPath, "utf8")
    .split(/\r?\n/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const bundle = buildAuthorizationImport(codes, adminCodes);
  const outputPath = resolve(
    process.env.AUTH_CODES_OUTPUT ?? `${codesPath}.activation-credentials.json`,
  );
  persistPrivateJson(outputPath, {
    createdAt: new Date().toISOString(),
    credentials: bundle.credentials,
  });

  const payload = JSON.stringify({
    password: importSecret,
    codes: bundle.requestCodes,
  });
  const args = ["convex", "run", "authCodes:importAllowedCodes", payload];
  if (process.argv.includes("--prod")) args.push("--prod");

  const result = spawnSync("npx", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
