import { createHash, randomInt } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";

const CLAIM_SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CLAIM_HASH_PREFIX = "auth-code-claim:v1";

export function generateActivationSecret(
  randomCharacter = () => CLAIM_SECRET_ALPHABET[randomInt(32)],
) {
  const secret = Array.from({ length: 32 }, () => randomCharacter()).join("");
  if (!/^[A-Z2-7]{32}$/.test(secret))
    throw new Error("Activation secrets must contain 32 Base32 characters.");
  return secret;
}

export function buildActivationBundle(codes, randomCharacter) {
  const normalizedCodes = codes.map((value) =>
    String(value).normalize("NFKC").trim().toUpperCase(),
  );
  if (new Set(normalizedCodes).size !== normalizedCodes.length)
    throw new Error("Authorization codes must be unique.");

  const credentials = {};
  const claimSecretHashes = normalizedCodes.map((code) => {
    const secret = generateActivationSecret(randomCharacter);
    credentials[code] = `${code}.${secret}`;
    return {
      code,
      hash: createHash("sha256")
        .update(`${CLAIM_HASH_PREFIX}:${code}:${secret}`)
        .digest("hex"),
    };
  });
  return { credentials, claimSecretHashes };
}

export function persistPrivateJson(outputPath, payload) {
  const descriptor = openSync(outputPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
    });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(outputPath, 0o600);
}
