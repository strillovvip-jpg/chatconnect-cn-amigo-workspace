// @vitest-environment-options { "url": "https://nyfbi.org/" }

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageSelector } from "@/components/language-selector";
import { I18nProvider, useI18n } from "./context";
import { LOCALE_STORAGE_KEY, resolveLocaleFromNavigator } from "./locales";

function LocaleProbe() {
  const { locale } = useI18n();
  return <output aria-label="active locale">{locale}</output>;
}

describe("nyfbi.org English-only surface", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-Hant");
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["zh-TW"],
    });
  });

  it("forces English and hides language selection", async () => {
    expect(window.location.hostname).toBe("nyfbi.org");
    expect(resolveLocaleFromNavigator()).toBe("en");

    render(
      <I18nProvider>
        <LocaleProbe />
        <LanguageSelector />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("active locale")).toHaveTextContent("en");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });
});
