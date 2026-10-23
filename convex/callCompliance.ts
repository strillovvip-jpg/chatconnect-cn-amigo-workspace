import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAdminCompanyScope, requireAdmin, requireSession } from "./roles";
import { codeIsInTenant, tenantIdForGroup } from "./tenantBoundaries";

type AdminAuth = Awaited<ReturnType<typeof requireAdmin>>;

async function adminCanAccessCall(
  ctx: Parameters<typeof requireAdmin>[0],
  auth: AdminAuth,
  callId: string,
  storedParticipantCodes: string[] = [],
) {
  const tenantId = getAdminCompanyScope(auth);
  if (!tenantId) return true;

  const participantCodes = new Set(storedParticipantCodes);
  const call = await ctx.db
    .query("live_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  for (const code of call?.participantCodes ?? []) participantCodes.add(code);

  const groupCall = await ctx.db
    .query("chat_group_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  if (groupCall) {
    const group = await ctx.db.get(groupCall.groupId);
    if (!group || (await tenantIdForGroup(ctx, group)) !== tenantId)
      return false;
    const groupParticipants = await ctx.db
      .query("chat_group_call_participants")
      .withIndex("by_call", (q) => q.eq("groupCallId", groupCall._id))
      .collect();
    for (const participant of groupParticipants)
      participantCodes.add(participant.userId);
  }

  if (!participantCodes.size) return false;
  const matches = await Promise.all(
    [...participantCodes].map((code) => codeIsInTenant(ctx, code, tenantId)),
  );
  return matches.every(Boolean);
}

async function assertAdminCanAccessCall(
  ctx: Parameters<typeof requireAdmin>[0],
  auth: AdminAuth,
  callId: string,
  participantCodes: string[] = [],
) {
  if (!(await adminCanAccessCall(ctx, auth, callId, participantCodes)))
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限访问其他授权群组的通话。",
    });
}

const RECORDING_SEGMENT_TTL_MS = 10 * 60_000;
const RECORDING_SEGMENT_RATE_WINDOW_MS = 10 * 60_000;
const MAX_RECORDING_SEGMENTS_PER_WINDOW = 4;
const MAX_RECORDING_FILE_BYTES = 25 * 1024 * 1024;

function consentEpoch(item: {
  consentEpoch?: number;
  activatedAt?: number;
  requestedAt: number;
}) {
  return item.consentEpoch ?? item.activatedAt ?? item.requestedAt;
}

async function authorizedRecordingSegment(
  ctx: Parameters<typeof requireSession>[0],
  args: {
    code: string;
    deviceId: string;
    callId: string;
    segmentId: Id<"call_recording_segments">;
  },
) {
  const auth = await requireSession(ctx, args.code, args.deviceId);
  const segment = await ctx.db.get(args.segmentId);
  if (
    !segment ||
    segment.callId !== args.callId ||
    segment.participantCode !== auth.code ||
    segment.deviceId !== args.deviceId
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "录音片段凭证无效。",
    });
  await participant(ctx, args.code, args.deviceId, args.callId);
  if (segment.consumedAt || segment.storageId)
    throw new ConvexError({
      code: "CONFLICT",
      message: "录音片段已经保存。",
    });
  if (segment.expiresAt <= Date.now())
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "录音片段凭证已经过期。",
    });
  const item = await ctx.db
    .query("call_compliance")
    .withIndex("by_call", (q) => q.eq("callId", args.callId))
    .unique();
  if (
    !item ||
    item.status !== "active" ||
    consentEpoch(item) !== segment.consentEpoch ||
    !item.participantCodes.includes(auth.code) ||
    !item.consentedCodes.includes(auth.code)
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "录音同意已经失效。",
    });
  return { auth, segment };
}

type CallParticipant = {
  auth: Awaited<ReturnType<typeof requireSession>>;
  participantCodes: string[];
};

async function participant(
  ctx: Parameters<typeof requireSession>[0],
  code: string,
  deviceId: string,
  callId: string,
): Promise<CallParticipant>;
async function participant(
  ctx: Parameters<typeof requireSession>[0],
  code: string,
  deviceId: string,
  callId: string,
  allowMissing: true,
): Promise<CallParticipant | null>;
async function participant(
  ctx: Parameters<typeof requireSession>[0],
  code: string,
  deviceId: string,
  callId: string,
  allowMissing = false,
): Promise<CallParticipant | null> {
  const auth = await requireSession(ctx, code, deviceId);
  const call = await ctx.db
    .query("live_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  if (call && !["connected", "active"].includes(call.status)) {
    if (allowMissing) return null;
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "您不是此通话的参与者。",
    });
  }
  if (call?.participantCodes.includes(auth.code)) {
    const boundDeviceIds = [
      call.callerUserId === auth.code ? call.callerDeviceId : undefined,
      call.calleeUserId === auth.code ? call.calleeDeviceId : undefined,
    ].filter((value): value is string => Boolean(value));
    if (boundDeviceIds.length && !boundDeviceIds.includes(deviceId)) {
      if (allowMissing) return null;
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "此通话已由另一台设备接手。",
      });
    }
    return { auth, participantCodes: call.participantCodes };
  }
  const joiningTransfer = (
    await ctx.db
      .query("call_transfers")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .collect()
  ).find(
    (transfer) =>
      transfer.targetUserId === auth.code &&
      (!transfer.targetDeviceId || transfer.targetDeviceId === deviceId) &&
      ["accepted", "joining"].includes(transfer.status) &&
      transfer.expiresAt > Date.now(),
  );
  if (call && joiningTransfer)
    return {
      auth,
      participantCodes: [
        joiningTransfer.remoteUserId,
        joiningTransfer.targetUserId,
      ],
    };
  const groupCall = await ctx.db
    .query("chat_group_calls")
    .withIndex("by_call_id", (q) => q.eq("callId", callId))
    .unique();
  if (groupCall?.status === "active") {
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
  if (allowMissing) return null;
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
    await assertAdminCanAccessCall(ctx, auth, args.callId, participantCodes);
    const existing = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    const now = Date.now();
    const data = {
      participantCodes,
      consentedCodes: [] as string[],
      consentEpoch: existing ? consentEpoch(existing) + 1 : 1,
      declinedCodes: [] as string[],
      status: "requested" as const,
      requestedBy: auth.code,
      requestedAt: now,
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
    const participation = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
      true,
    );
    if (!participation) return null;
    const { auth } = participation;
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || !item.participantCodes.includes(auth.code)) return null;
    return {
      status: item.status,
      consentedCodes: item.consentedCodes,
      translationEnabled: item.translationEnabled ?? false,
      myConsent: item.consentedCodes.includes(auth.code),
      myDecline: item.declinedCodes.includes(auth.code),
    };
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
    if (
      !item ||
      item.status !== "requested" ||
      !item.participantCodes.includes(auth.code)
    )
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
    return {
      speakerCode: auth.code,
      deviceId: args.deviceId,
      consentEpoch: consentEpoch(item),
    };
  },
});

export const storeTranslation = internalMutation({
  args: {
    callId: v.string(),
    speakerCode: v.string(),
    deviceId: v.string(),
    consentEpoch: v.number(),
    text: v.string(),
    originalText: v.string(),
    sourceLanguage: v.string(),
    translated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.speakerCode,
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
      consentEpoch(item) !== args.consentEpoch ||
      !item.participantCodes.includes(auth.code) ||
      !item.consentedCodes.includes(auth.code)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "翻译同意已经失效。",
      });
    await ctx.db.insert("call_transcripts", {
      callId: args.callId,
      speakerCode: auth.code,
      speakerName: auth.session.name,
      text: args.text.slice(0, 1000),
      originalText: args.originalText.slice(0, 500),
      sourceLanguage: args.sourceLanguage.slice(0, 20),
      translated: args.translated,
      createdAt: Date.now(),
    });
  },
});

export const beginRecordingSegment = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    clientNonce: v.string(),
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
    if (
      !item ||
      item.status !== "active" ||
      !item.participantCodes.includes(auth.code) ||
      !item.consentedCodes.includes(auth.code)
    )
      throw new ConvexError({ code: "FORBIDDEN", message: "不允许录音。" });
    const epoch = consentEpoch(item);
    const clientNonce = args.clientNonce.normalize("NFKC").trim();
    if (!clientNonce || clientNonce.length > 128)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "录音片段标识无效。",
      });
    const now = Date.now();
    const existing = await ctx.db
      .query("call_recording_segments")
      .withIndex("by_call_participant_device_epoch_nonce", (q) =>
        q
          .eq("callId", args.callId)
          .eq("participantCode", auth.code)
          .eq("deviceId", args.deviceId)
          .eq("consentEpoch", epoch)
          .eq("clientNonce", clientNonce),
      )
      .unique();
    if (existing)
      return { segmentId: existing._id, expiresAt: existing.expiresAt };
    const recentSegments = await ctx.db
      .query("call_recording_segments")
      .withIndex("by_call_participant_device_epoch_started", (q) =>
        q
          .eq("callId", args.callId)
          .eq("participantCode", auth.code)
          .eq("deviceId", args.deviceId)
          .eq("consentEpoch", epoch)
          .gt("startedAt", now - RECORDING_SEGMENT_RATE_WINDOW_MS),
      )
      .take(MAX_RECORDING_SEGMENTS_PER_WINDOW);
    if (recentSegments.length >= MAX_RECORDING_SEGMENTS_PER_WINDOW)
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "录音片段请求过多，请稍后重试。",
      });
    const expiresAt = now + RECORDING_SEGMENT_TTL_MS;
    const segmentId = await ctx.db.insert("call_recording_segments", {
      callId: args.callId,
      participantCode: auth.code,
      deviceId: args.deviceId,
      consentEpoch: epoch,
      clientNonce,
      startedAt: now,
      expiresAt,
    });
    return { segmentId, expiresAt };
  },
});

export const generateUploadUrl = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
  },
  handler: async (ctx, args) => {
    const { segment } = await authorizedRecordingSegment(ctx, args);
    if (segment.uploadUrl) return segment.uploadUrl;
    const uploadUrl = await ctx.storage.generateUploadUrl();
    await ctx.db.patch(segment._id, {
      uploadUrl,
      uploadAuthorizedAt: Date.now(),
    });
    return uploadUrl;
  },
});

export const saveRecording = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, segment } = await authorizedRecordingSegment(ctx, args);
    if (!segment.uploadUrl || !segment.uploadAuthorizedAt)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音片段尚未取得上传权限。",
      });
    const storedFile = await ctx.db.system.get("_storage", args.storageId);
    if (!storedFile)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "找不到已上传的录音片段。",
      });
    const declaredMimeType = args.mimeType
      .normalize("NFKC")
      .trim()
      .toLowerCase();
    const storedMimeType = storedFile.contentType?.trim().toLowerCase() ?? "";
    const declaredBaseType = declaredMimeType.split(";", 1)[0].trim();
    const storedBaseType = storedMimeType.split(";", 1)[0].trim();
    if (
      !declaredMimeType ||
      declaredMimeType.length > 100 ||
      !storedBaseType.startsWith("audio/")
    )
      throw new ConvexError({
        code: "BAD_FILE_TYPE",
        message: "仅允许上传音频录音。",
      });
    if (
      !declaredBaseType.startsWith("audio/") ||
      declaredBaseType !== storedBaseType
    )
      throw new ConvexError({
        code: "BAD_FILE_TYPE",
        message: "录音文件类型不一致。",
      });
    if (storedFile.size <= 0 || storedFile.size > MAX_RECORDING_FILE_BYTES)
      throw new ConvexError({
        code: "BAD_FILE_SIZE",
        message: "录音文件过大或内容为空。",
      });
    const [segmentUsingStorage, recordingUsingStorage] = await Promise.all([
      ctx.db
        .query("call_recording_segments")
        .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
        .first(),
      ctx.db
        .query("call_recordings")
        .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
        .first(),
    ]);
    if (segmentUsingStorage || recordingUsingStorage)
      throw new ConvexError({
        code: "CONFLICT",
        message: "录音文件已经使用。",
      });
    const now = Date.now();
    await ctx.db.patch(segment._id, {
      storageId: args.storageId,
      consumedAt: now,
    });
    await ctx.db.insert("call_recordings", {
      callId: args.callId,
      participantCode: auth.code,
      participantName: auth.session.name,
      storageId: args.storageId,
      mimeType: declaredMimeType,
      createdAt: now,
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
    await assertAdminCanAccessCall(
      ctx,
      auth,
      args.callId,
      item?.participantCodes,
    );
    if (item) {
      const now = Date.now();
      await ctx.db.patch(item._id, {
        status: "stopped",
        stoppedAt: now,
        translationEnabled: false,
      });
    }
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
    await assertAdminCanAccessCall(
      ctx,
      auth,
      args.callId,
      item?.participantCodes,
    );
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
    const auth = await requireAdmin(ctx, args.password);
    const allSessions = await ctx.db
      .query("call_compliance")
      .order("desc")
      .collect();
    const sessions = (
      await Promise.all(
        allSessions.map(async (session) =>
          (await adminCanAccessCall(
            ctx,
            auth,
            session.callId,
            session.participantCodes,
          ))
            ? session
            : null,
        ),
      )
    )
      .filter((session): session is NonNullable<typeof session> => !!session)
      .slice(0, 30);
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
