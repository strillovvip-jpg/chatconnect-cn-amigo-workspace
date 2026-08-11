export function resolveAutoLoginSession(input: {
  isDev: boolean;
  code?: string;
  name?: string;
  savedCode?: string;
  hasSavedSession: boolean;
}) {
  if (!input.isDev || input.savedCode || input.hasSavedSession) {
    return null;
  }

  const code = input.code?.trim().toUpperCase() || "";
  if (!code) {
    return null;
  }

  return {
    code,
    name: input.name?.trim() || "RAVE",
  };
}
