export type AppLocale = "ja" | "zh-Hans" | "zh-Hant" | "en";
export type LocalePreference = "system" | AppLocale;

export const LOCALE_STORAGE_KEY = "songjin_locale_preference";

const HANT_REGIONS = new Set(["TW", "HK", "MO"]);
const HANS_REGIONS = new Set(["CN", "SG"]);

function normalizeTag(tag: string) {
  return tag.trim().replace(/_/g, "-");
}

export function resolveLocale(languages: readonly string[] | undefined): AppLocale {
  const candidates = (languages ?? []).map(normalizeTag).filter(Boolean);

  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("en")) return "en";
    if (lower.startsWith("zh")) {
      const parts = raw.split("-");
      const scriptOrRegion = parts.slice(1);
      if (scriptOrRegion.some((part) => /^hant$/i.test(part))) return "zh-Hant";
      if (scriptOrRegion.some((part) => /^hans$/i.test(part))) return "zh-Hans";
      if (scriptOrRegion.some((part) => HANT_REGIONS.has(part.toUpperCase()))) return "zh-Hant";
      if (scriptOrRegion.some((part) => HANS_REGIONS.has(part.toUpperCase()))) return "zh-Hans";
      return "zh-Hans";
    }
  }

  return "en";
}

export function resolveLocaleFromNavigator(): AppLocale {
  if (typeof navigator === "undefined") return "en";
  const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return resolveLocale(languages);
}

export function localeToHtmlLang(locale: AppLocale): string {
  switch (locale) {
    case "ja":
      return "ja";
    case "zh-Hans":
      return "zh-CN";
    case "zh-Hant":
      return "zh-TW";
    default:
      return "en";
  }
}

export function readStoredLocalePreference(): LocalePreference {
  if (typeof window === "undefined") return "system";
  const storage = window.localStorage;
  if (!storage) return "system";
  let value: string | null = null;
  try {
    value = storage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return "system";
  }
  return value === "ja" || value === "zh-Hans" || value === "zh-Hant" || value === "en"
    ? value
    : "system";
}
