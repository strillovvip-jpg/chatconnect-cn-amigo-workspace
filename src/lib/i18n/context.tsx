import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { localeToHtmlLang, LOCALE_STORAGE_KEY, readStoredLocalePreference, resolveLocaleFromNavigator, type AppLocale, type LocalePreference } from "./locales";
import { messages, type Messages } from "./messages";

type I18nContextValue = {
  locale: AppLocale;
  preference: LocalePreference;
  setPreference: (next: LocalePreference) => void;
  messages: Messages;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function resolveActiveLocale(): AppLocale {
  const preference = readStoredLocalePreference();
  return preference === "system" ? resolveLocaleFromNavigator() : preference;
}

export function getRuntimeMessages(): Messages {
  return messages[resolveActiveLocale()];
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => readStoredLocalePreference());
  const [systemLocale, setSystemLocale] = useState<AppLocale>(() => resolveLocaleFromNavigator());

  useEffect(() => {
    const update = () => setSystemLocale(resolveLocaleFromNavigator());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  const locale = preference === "system" ? systemLocale : preference;

  useEffect(() => {
    try {
      window.localStorage?.setItem(LOCALE_STORAGE_KEY, preference);
    } catch {
      /* ignore storage unavailability */
    }
  }, [preference]);

  useEffect(() => {
    document.documentElement.lang = localeToHtmlLang(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      preference,
      setPreference: setPreferenceState,
      messages: messages[locale],
    }),
    [locale, preference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

export function useOptionalI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value) return value;
  const locale = resolveActiveLocale();
  return {
    locale,
    preference: readStoredLocalePreference(),
    setPreference: () => undefined,
    messages: messages[locale],
  };
}
