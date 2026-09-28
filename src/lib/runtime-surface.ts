const NYFBI_WEB_HOSTS = new Set(["nyfbi.org", "www.nyfbi.org"]);
const AICHIJP_WEB_HOSTS = new Set(["aichijp.com", "www.aichijp.com"]);

export function isNyfbiWebRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
  return NYFBI_WEB_HOSTS.has(hostname);
}

export function isAichijpWebRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
  return AICHIJP_WEB_HOSTS.has(hostname);
}
