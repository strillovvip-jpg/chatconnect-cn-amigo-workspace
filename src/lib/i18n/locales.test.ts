import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locales";

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
