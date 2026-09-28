import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ENGLISH_UI_DATA = new Map<string, string>([
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
]);

const SYSTEM_UI_DATA = new Map<
  string,
  { en: string; ja: string; zhHans: string; zhHant: string }
>([
  [
    "__system_deleted_group__",
    {
      en: "Deleted group",
      ja: "削除されたグループ",
      zhHans: "已删除的群组",
      zhHant: "已刪除的群組",
    },
  ],
  [
    "__system_unknown_user__",
    { en: "Unknown", ja: "不明", zhHans: "未知", zhHant: "未知" },
  ],
  [
    "__system_unknown_caller__",
    {
      en: "Unknown caller",
      ja: "不明な発信者",
      zhHans: "未知来电",
      zhHant: "未知來電",
    },
  ],
  [
    "__system_group_call__",
    {
      en: "Group call",
      ja: "グループ通話",
      zhHans: "群组通话",
      zhHant: "群組通話",
    },
  ],
  [
    "__system_group__",
    { en: "Group", ja: "グループ", zhHans: "群组", zhHant: "群組" },
  ],
]);

function activeUiLanguage(locale?: string) {
  if (locale?.trim()) return locale.trim().toLowerCase();
  if (typeof document !== "undefined")
    return document.documentElement.lang.trim().toLowerCase();
  return "en";
}

function rawErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const data = "data" in error ? error.data : undefined;
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = data.message;
    if (typeof message === "string") return message.trim();
  }
  return error instanceof Error ? error.message.trim() : "";
}

function containsCjkText(value: string) {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);
}

export function uiErrorMessage(
  error: unknown,
  fallback: string,
  locale?: string,
) {
  const message = rawErrorMessage(error);
  if (!message) return fallback;
  const isEnglish = activeUiLanguage(locale).startsWith("en");
  if (isEnglish) return containsCjkText(message) ? fallback : message;
  return containsCjkText(message) ? message : fallback;
}

export function localizedUiData(value: string, locale?: string) {
  const language = activeUiLanguage(locale);
  const trimmed = value.trim();
  const systemCopy = SYSTEM_UI_DATA.get(trimmed);
  if (systemCopy) {
    if (language.startsWith("ja")) return systemCopy.ja;
    if (language.startsWith("zh-hant") || language.startsWith("zh-tw"))
      return systemCopy.zhHant;
    if (language.startsWith("zh")) return systemCopy.zhHans;
    return systemCopy.en;
  }
  if (!language.startsWith("en")) return value;
  return ENGLISH_UI_DATA.get(trimmed) ?? value;
}
