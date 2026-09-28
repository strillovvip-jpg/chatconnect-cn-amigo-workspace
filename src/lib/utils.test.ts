import { afterEach, describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { localizedUiData, uiErrorMessage } from "./utils";

describe("localized UI errors", () => {
  const originalLanguage = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = originalLanguage;
  });

  it("uses the English fallback instead of exposing a Chinese Convex error", () => {
    document.documentElement.lang = "en";
    const error = new ConvexError({
      code: "FORBIDDEN",
      message: "此授权码已停用。",
    });

    expect(uiErrorMessage(error, "This authorization code is disabled.")).toBe(
      "This authorization code is disabled.",
    );
  });

  it("preserves an English backend error for an English interface", () => {
    document.documentElement.lang = "en";

    expect(
      uiErrorMessage(
        new ConvexError({
          code: "CONFLICT",
          message: "The code is already in use.",
        }),
        "The request failed.",
      ),
    ).toBe("The code is already in use.");
  });

  it("preserves a Chinese backend error for a Chinese interface", () => {
    document.documentElement.lang = "zh-TW";

    expect(
      uiErrorMessage(
        new ConvexError({ code: "FORBIDDEN", message: "此授權碼已停用。" }),
        "操作失敗。",
      ),
    ).toBe("此授權碼已停用。");
  });
});

describe("localized backend-owned UI data", () => {
  it.each([
    ["高级授权码-全部功能", "Full-feature authorization code"],
    [
      "高级授权码-无6、9及11",
      "Limited authorization code (without features 6, 9, and 11)",
    ],
    [
      "高级授权码-无9及11",
      "Limited authorization code (without features 9 and 11)",
    ],
    ["管理员", "Administrator"],
    ["管理員", "Administrator"],
    ["标准", "Standard"],
    ["標準", "Standard"],
    ["一般", "General"],
    ["其他", "Other"],
  ])("maps %s to English without changing stored data", (stored, expected) => {
    expect(localizedUiData(stored, "en")).toBe(expected);
  });

  it("keeps unknown user-authored values and non-English displays unchanged", () => {
    expect(localizedUiData("Custom profile", "en")).toBe("Custom profile");
    expect(localizedUiData("标准", "zh-Hans")).toBe("标准");
  });

  it.each([
    ["__system_deleted_group__", "Deleted group", "已刪除的群組"],
    ["__system_unknown_user__", "Unknown", "未知"],
    ["__system_unknown_caller__", "Unknown caller", "未知來電"],
    ["__system_group_call__", "Group call", "群組通話"],
    ["__system_group__", "Group", "群組"],
  ])(
    "localizes the %s system fallback without exposing its sentinel",
    (stored, english, traditionalChinese) => {
      expect(localizedUiData(stored, "en")).toBe(english);
      expect(localizedUiData(stored, "zh-Hant")).toBe(traditionalChinese);
    },
  );

  it("keeps system fallbacks localized for the native Japanese and Simplified Chinese UIs", () => {
    expect(localizedUiData("__system_deleted_group__", "ja")).toBe(
      "削除されたグループ",
    );
    expect(localizedUiData("__system_deleted_group__", "zh-Hans")).toBe(
      "已删除的群组",
    );
  });
});
