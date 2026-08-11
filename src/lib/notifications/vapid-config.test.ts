import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production push configuration", () => {
  it("ships the public VAPID key but never a private key", () => {
    const path = resolve(process.cwd(), ".env.production");
    expect(existsSync(path)).toBe(true);

    const env = readFileSync(path, "utf8");
    const publicKey = env.match(/^VITE_VAPID_PUBLIC_KEY=(.+)$/m)?.[1] ?? "";
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(env).not.toMatch(/VAPID_PRIVATE|PRIVATE_KEY|SECRET/i);
  });
});
