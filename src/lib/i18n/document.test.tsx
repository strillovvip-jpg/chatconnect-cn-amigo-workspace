import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "./context";

describe("document localization ownership", () => {
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
    document.documentElement.removeAttribute("translate");
    document.documentElement.className = "dark";
  });

  it("opts the static HTML shell out of browser translation before React starts", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toMatch(/<html[^>]*\btranslate="no"/);
    expect(html).toMatch(/<html[^>]*\bnotranslate\b/);
  });

  it("keeps browser translation disabled when the active locale changes", async () => {
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });

    render(
      <I18nProvider>
        <div>content</div>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
      expect(document.documentElement.translate).toBe(false);
      expect(document.documentElement.classList.contains("notranslate")).toBe(
        true,
      );
    });
  });
});
