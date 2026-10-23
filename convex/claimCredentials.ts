const CLAIM_HASH_PREFIX = "auth-code-claim:v1";

export const DUMMY_CLAIM_SECRET_HASH = "0".repeat(64);

export function splitClaimCredential(value: string) {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const separator = normalized.indexOf(".");
  if (separator < 0)
    return { code: normalized, claimSecret: null as string | null };
  return {
    code: normalized.slice(0, separator),
    claimSecret: normalized.slice(separator + 1),
  };
}

export async function hashClaimSecret(code: string, claimSecret: string) {
  const normalizedCode = code.normalize("NFKC").trim().toUpperCase();
  const normalizedSecret = claimSecret.normalize("NFKC").trim().toUpperCase();
  const bytes = new TextEncoder().encode(
    `${CLAIM_HASH_PREFIX}:${normalizedCode}:${normalizedSecret}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function constantTimeHashEqual(candidate: string, expected: string) {
  const length = Math.max(candidate.length, expected.length, 64);
  let difference = candidate.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    difference |=
      (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isClaimSecretHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}
