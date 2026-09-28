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

test("production web and iOS builds use the US Convex deployment", () => {
  assert.match(
    productionEnv,
    /^VITE_CONVEX_URL=https:\/\/impressive-elk-45\.convex\.cloud$/m,
  );
  assert.match(
    convexProvider,
    /DEFAULT_CONVEX_URL = "https:\/\/impressive-elk-45\.convex\.cloud"/,
  );
  assert.doesNotMatch(productionEnv, /adorable-parakeet-350/);
  assert.doesNotMatch(convexProvider, /adorable-parakeet-350/);
});
