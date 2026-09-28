import { describe, expect, it } from "vitest";
import {
  formatUiDate,
  localePunctuation,
  resolveLocale,
} from "./locales";

describe("resolveLocale", () => {
  it("detects Japanese", () => {
    expect(resolveLocale(["ja-JP"])) .toBe("ja");
  });

  it("detects Simplified Chinese", () => {
    expect(resolveLocale(["zh-CN"])) .toBe("zh-Hans");
    expect(resolveLocale(["zh-Hans-SG"])) .toBe("zh-Hans");
  });

  it("detects Traditional Chinese", () => {
    expect(resolveLocale(["zh-TW"])) .toBe("zh-Hant");
    expect(resolveLocale(["zh-Hant-HK"])) .toBe("zh-Hant");
  });

  it("detects English", () => {
    expect(resolveLocale(["en-US"])) .toBe("en");
  });

  it("falls back to English", () => {
    expect(resolveLocale(["fr-FR"])) .toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});

describe("locale-aware UI formatting", () => {
  const date = new Date(Date.UTC(2026, 8, 28, 7, 5));

  it("formats dates using the active i18n locale", () => {
    const english = formatUiDate(date, "en", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const traditionalChinese = formatUiDate(date, "zh-Hant", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    expect(english).toContain("September");
    expect(english).not.toMatch(/[\u3400-\u9fff]/u);
    expect(traditionalChinese).toContain("年");
  });

  it("uses ASCII punctuation for English and preserves full-width punctuation elsewhere", () => {
    expect(localePunctuation("en")).toEqual({
      colon: ": ",
      slash: " / ",
      openParen: " (",
      closeParen: ")",
    });
    expect(localePunctuation("zh-Hant")).toEqual({
      colon: "：",
      slash: "／",
      openParen: "（",
      closeParen: "）",
    });
  });
});
