import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const importSecret = process.env.AUTH_CODE_IMPORT_SECRET;
if (!importSecret) {
  throw new Error("导入授权码前必须设置 AUTH_CODE_IMPORT_SECRET。");
}
const codesPath =
  process.env.AUTH_CODES_FILE ??
  process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!codesPath) {
  throw new Error(
    "请通过 AUTH_CODES_FILE 或命令参数指定独立授权码文件的绝对路径。",
  );
}
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

if (codes.length !== 50 || new Set(codes).size !== 50) {
  throw new Error("授权码文件必须正好包含 50 个互不重复的授权码。");
}

const payload = JSON.stringify({
  password: importSecret,
  codes: codes.map((code) => ({
    code,
    role: adminCodes.has(code) ? "admin" : "user",
  })),
});
const args = ["convex", "run", "authCodes:importAllowedCodes", payload];
if (process.argv.includes("--prod")) args.push("--prod");

const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
