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
  if (!activeUiLanguage(locale).startsWith("en")) return value;
  return ENGLISH_UI_DATA.get(value.trim()) ?? value;
}
