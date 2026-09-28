const NYFBI_WEB_HOSTS = new Set(["nyfbi.org", "www.nyfbi.org"]);

export function isNyfbiWebRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
  return NYFBI_WEB_HOSTS.has(hostname);
}
