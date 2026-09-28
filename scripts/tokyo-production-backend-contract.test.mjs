import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productionEnv = readFileSync(
  new URL("../.env.production", import.meta.url),
  "utf8",
);
const convexProvider = readFileSync(
  new URL("../src/components/providers/convex.tsx", import.meta.url),
  "utf8",
);

test("production web and iOS builds keep using the Tokyo Convex deployment", () => {
  assert.match(
    productionEnv,
    /^VITE_CONVEX_URL=https:\/\/adorable-parakeet-350\.convex\.cloud$/m,
  );
  assert.match(
    convexProvider,
    /DEFAULT_CONVEX_URL = "https:\/\/adorable-parakeet-350\.convex\.cloud"/,
  );
  assert.doesNotMatch(productionEnv, /impressive-elk-45/);
  assert.doesNotMatch(convexProvider, /impressive-elk-45/);
});
