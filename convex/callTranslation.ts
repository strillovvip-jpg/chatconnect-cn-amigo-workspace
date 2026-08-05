"use node";

import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";

const authorizeTranslation = makeFunctionReference<
  "query",
  { code: string; deviceId: string; callId: string },
  { speakerCode: string; speakerName: string }
>("callCompliance:authorizeTranslation");
const storeTranslation = makeFunctionReference<
  "mutation",
  {
    callId: string;
    speakerCode: string;
    speakerName: string;
    text: string;
    originalText: string;
    sourceLanguage: string;
    translated: boolean;
  },
  null
>("callCompliance:storeTranslation");

function translatedText(payload: unknown): string | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const result = payload[0]
    .map((part) =>
      Array.isArray(part) && typeof part[0] === "string" ? part[0] : "",
    )
    .join("")
    .trim();
  return result || null;
}

export const translateToChinese = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    text: v.string(),
    sourceLanguage: v.string(),
  },
  handler: async (ctx, args) => {
    const originalText = args.text.trim().slice(0, 500);
    if (!originalText)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "没有可翻译的文字。",
      });
    const speaker = await ctx.runQuery(authorizeTranslation, {
      code: args.code,
      deviceId: args.deviceId,
      callId: args.callId,
    });
    let text = originalText;
    let translated = false;
    try {
      const source = /^[a-z]{2}(-[A-Z]{2})?$/.test(args.sourceLanguage)
        ? args.sourceLanguage.split("-")[0]
        : "auto";
      const url = new URL(
        "https://translate.googleapis.com/translate_a/single",
      );
      url.searchParams.set("client", "gtx");
      url.searchParams.set("sl", source);
      url.searchParams.set("tl", "zh-CN");
      url.searchParams.set("dt", "t");
      url.searchParams.set("q", originalText);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`translation ${response.status}`);
      const result = translatedText(await response.json());
      if (result) {
        text = result;
        translated = true;
      }
    } catch {
      /* retain the original segment so no conversation content is lost */
    }
    await ctx.runMutation(storeTranslation, {
      callId: args.callId,
      speakerCode: speaker.speakerCode,
      speakerName: speaker.speakerName,
      text,
      originalText,
      sourceLanguage: args.sourceLanguage,
      translated,
    });
    return { text, translated };
  },
});
