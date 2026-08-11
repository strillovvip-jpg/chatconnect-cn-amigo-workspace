const SESSION_KEYS = [
  "ksc_session_code",
  "ksc_session_name",
  "ksc_session_role",
] as const;

export function clearPersistedSession(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
) {
  for (const key of SESSION_KEYS) storage.removeItem(key);
}

export function logoutToLogin() {
  clearPersistedSession();
  window.dispatchEvent(new Event("chatconnect-session-changed"));
  window.location.replace("/?reauth=1");
}
