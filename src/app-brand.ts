export const appBrand = {
  downloadName: "USA.Filing",
} as const;

const LEGACY_BRAND_NAMES = new Set(["songjin", "頌進", "颂进"]);

export function normalizeLegacyBrandName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "");
  return LEGACY_BRAND_NAMES.has(normalized) || normalized === "u.s.a"
    ? appBrand.downloadName
    : name;
}
