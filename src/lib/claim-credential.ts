const CLAIM_SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CLAIM_HASH_PREFIX = "auth-code-claim:v1";

export function generateClaimSecret() {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(
    random,
    (byte) => CLAIM_SECRET_ALPHABET[byte & 31],
  ).join("");
}

export async function createClaimCredential(rawCode: string) {
  const code = rawCode.normalize("NFKC").trim().toUpperCase();
  const claimSecret = generateClaimSecret();
  const bytes = new TextEncoder().encode(
    `${CLAIM_HASH_PREFIX}:${code}:${claimSecret}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const claimSecretHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    code,
    credential: `${code}.${claimSecret}`,
    claimSecretHash,
  };
}
