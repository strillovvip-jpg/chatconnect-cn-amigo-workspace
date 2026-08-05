import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAdmin, requireSession } from "./roles";

async function participant(
  ctx: Parameters<typeof requireSession>[0],
  code: string,
  deviceId: string,
  callId: string,
) {
  const auth = await requireSession(ctx, code, deviceId);
  const call = await ctx.db
    .query("live_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  if (call?.participantCodes.includes(auth.code))
    return { auth, participantCodes: call.participantCodes };
  const groupCall = await ctx.db
    .query("chat_group_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  if (groupCall) {
    const joined = (
      await ctx.db
        .query("chat_group_call_participants")
        .withIndex("by_call", (q) => q.eq("groupCallId", groupCall._id))
        .collect()
    )
      .filter((item) => item.status === "joined")
      .map((item) => item.userId);
    if (joined.includes(auth.code)) return { auth, participantCodes: joined };
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "您不是此通话的参与者。",
  });
}

export const request = mutation({
  args: { password: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const call = await ctx.db
      .query("live_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    const groupCall = await ctx.db
      .query("chat_group_calls")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
    let participantCodes =
      call && ["connected", "active"].includes(call.status)
        ? call.participantCodes
        : [];
    if (!participantCodes.length && groupCall?.status === "active")
      participantCodes = (
        await ctx.db
          .query("chat_group_call_participants")
          .withIndex("by_call", (q) => q.eq("groupCallId", groupCall._id))
          .collect()
      )
        .filter((item) => item.status === "joined")
        .map((item) => item.userId);
    if (!participantCodes.length)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到正在进行的通话。",
      });
    const existing = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    const data = {
      participantCodes,
      consentedCodes: [] as string[],
      declinedCodes: [] as string[],
      status: "requested" as const,
      requestedBy: auth.code,
      requestedAt: Date.now(),
      activatedAt: undefined,
      stoppedAt: undefined,
      translationEnabled: false,
    };
    if (existing) await ctx.db.patch(existing._id, data);
    else
      await ctx.db.insert("call_compliance", { callId: args.callId, ...data });
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "call.recording.request",
      targetType: "call",
      targetId: args.callId,
      success: true,
      createdAt: Date.now(),
    });
  },
});

export const status = query({
  args: { code: v.string(), deviceId: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    return item
      ? {
          ...item,
          myConsent: item.consentedCodes.includes(auth.code),
          myDecline: item.declinedCodes.includes(auth.code),
        }
      : null;
  },
});

export const respond = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || item.status !== "requested")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "录音同意请求已失效。",
      });
    const consentedCodes = item.consentedCodes.filter(
      (code) => code !== auth.code,
    );
    const declinedCodes = item.declinedCodes.filter(
      (code) => code !== auth.code,
    );
    if (args.consent) consentedCodes.push(auth.code);
    else declinedCodes.push(auth.code);
    const allConsented = item.participantCodes.every((code) =>
      consentedCodes.includes(code),
    );
    await ctx.db.patch(item._id, {
      consentedCodes,
      declinedCodes,
      status: declinedCodes.length
        ? "declined"
        : allConsented
          ? "active"
          : "requested",
      activatedAt: allConsented ? Date.now() : undefined,
    });
  },
});

export const addTranscript = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    const text = args.text.trim().slice(0, 500);
    if (
      !item ||
      item.status !== "active" ||
      !item.consentedCodes.includes(auth.code) ||
      !text
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "不允许生成文字记录。",
      });
    await ctx.db.insert("call_transcripts", {
      callId: args.callId,
      speakerCode: auth.code,
      speakerName: auth.session.name,
      text,
      createdAt: Date.now(),
    });
  },
});

export const authorizeTranslation = internalQuery({
  args: { code: v.string(), deviceId: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !item ||
      item.status !== "active" ||
      !item.translationEnabled ||
      !item.consentedCodes.includes(auth.code)
    )
      throw new ConvexError({ code: "FORBIDDEN", message: "翻译未开启。" });
    return { speakerCode: auth.code, speakerName: auth.session.name };
  },
});

export const storeTranslation = internalMutation({
  args: {
    callId: v.string(),
    speakerCode: v.string(),
    speakerName: v.string(),
    text: v.string(),
    originalText: v.string(),
    sourceLanguage: v.string(),
    translated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !item ||
      item.status !== "active" ||
      !item.translationEnabled ||
      !item.consentedCodes.includes(args.speakerCode)
    )
      throw new ConvexError({ code: "FORBIDDEN", message: "翻译未开启。" });
    await ctx.db.insert("call_transcripts", {
      ...args,
      text: args.text.slice(0, 1000),
      originalText: args.originalText.slice(0, 500),
      sourceLanguage: args.sourceLanguage.slice(0, 20),
      createdAt: Date.now(),
    });
  },
});

export const generateUploadUrl = mutation({
  args: { code: v.string(), deviceId: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (
      !item ||
      !["active", "stopped"].includes(item.status) ||
      !item.consentedCodes.includes(auth.code)
    )
      throw new ConvexError({ code: "FORBIDDEN", message: "不允许录音。" });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveRecording = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || !item.consentedCodes.includes(auth.code))
      throw new ConvexError({ code: "FORBIDDEN", message: "不允许保存录音。" });
    await ctx.db.insert("call_recordings", {
      callId: args.callId,
      participantCode: auth.code,
      participantName: auth.session.name,
      storageId: args.storageId,
      mimeType: args.mimeType.slice(0, 100),
      createdAt: Date.now(),
    });
  },
});

export const stop = mutation({
  args: { password: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (item)
      await ctx.db.patch(item._id, {
        status: "stopped",
        stoppedAt: Date.now(),
        translationEnabled: false,
      });
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "call.recording.stop",
      targetType: "call",
      targetId: args.callId,
      success: true,
      createdAt: Date.now(),
    });
  },
});

export const setTranslation = mutation({
  args: { password: v.string(), callId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || item.status !== "active")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "录音尚未获得同意或通话未进行中。",
      });
    await ctx.db.patch(item._id, { translationEnabled: args.enabled });
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: args.enabled ? "call.translation.start" : "call.translation.stop",
      targetType: "call",
      targetId: args.callId,
      success: true,
      createdAt: Date.now(),
    });
  },
});

export const adminDashboard = query({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.password);
    const sessions = await ctx.db
      .query("call_compliance")
      .order("desc")
      .take(30);
    return await Promise.all(
      sessions.map(async (session) => {
        const transcripts = await ctx.db
          .query("call_transcripts")
          .withIndex("by_call_time", (q) => q.eq("callId", session.callId))
          .collect();
        const recordings = await ctx.db
          .query("call_recordings")
          .withIndex("by_call", (q) => q.eq("callId", session.callId))
          .collect();
        return {
          ...session,
          transcripts,
          recordings: await Promise.all(
            recordings.map(async (recording) => ({
              ...recording,
              url: await ctx.storage.getUrl(recording.storageId),
            })),
          ),
        };
      }),
    );
  },
});
