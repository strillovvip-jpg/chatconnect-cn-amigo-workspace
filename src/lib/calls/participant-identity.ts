export function participantIdentityMatchesCode(
  identity: string,
  code?: string,
) {
  const normalizedCode = code?.trim().toUpperCase();
  if (!normalizedCode) return true;
  const normalizedIdentity = identity.trim().toUpperCase();
  return (
    normalizedIdentity === normalizedCode ||
    normalizedIdentity.startsWith(`${normalizedCode}-`)
  );
}
