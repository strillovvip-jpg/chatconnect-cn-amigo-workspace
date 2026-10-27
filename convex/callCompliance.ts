import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getAdminCompanyScope,
  requireAdmin,
  requireSession,
  tenantIdForAllowed,
} from "./roles";
import { allowedForCode } from "./tenantBoundaries";
import { constantTimeHashEqual } from "./claimCredentials";
import { internal } from "./_generated/api";

type AdminAuth = Awaited<ReturnType<typeof requireAdmin>>;

function adminCanAccessTenant(auth: AdminAuth, tenantId: string | undefined) {
  const scope = getAdminCompanyScope(auth);
  return !scope || (!!tenantId && tenantId === scope);
}

function assertAdminCanAccessTenant(
  auth: AdminAuth,
  tenantId: string | undefined,
) {
  if (!adminCanAccessTenant(auth, tenantId))
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "没有权限访问其他授权群组的通话。",
    });
}

async function assertNoActiveCrossTenantTransfer(
  ctx: Parameters<typeof requireAdmin>[0],
  callId: string,
) {
  const transfers = await ctx.db
    .query("call_transfers")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  for (const transfer of transfers) {
    const active = ["pending", "accepted", "joining"].includes(transfer.status);
    const abandonedReceiver =
      ["cancelled", "failed", "expired"].includes(transfer.status) &&
      Boolean(transfer.targetIdentity) &&
      (transfer.cleanupStatus !== "completed" ||
        (transfer.targetTokenExpiresAt !== undefined &&
          (transfer.cleanupLastSucceededAt ?? 0) <
            transfer.targetTokenExpiresAt));
    if (!active && !abandonedReceiver) continue;
    const tenants = new Set<string>();
    for (const code of [transfer.remoteUserId, transfer.targetUserId]) {
      const allowed = await allowedForCode(ctx, code);
      if (!allowed || allowed.enabled === false)
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "通话参与者的授权已经失效。",
        });
      tenants.add(tenantIdForAllowed(allowed));
    }
    if (tenants.size > 1)
      throw new ConvexError({
        code: "CONFLICT",
        message: active
          ? "跨授权群组转接进行中，不能开启通话录音。"
          : "必须等待跨授权群组转接接收端清理完成，才能开启通话录音。",
      });
  }
}

async function resolveParticipantTenant(
  ctx: Parameters<typeof requireAdmin>[0],
  participantCodes: string[],
) {
  if (!participantCodes.length)
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "找不到正在进行的通话。",
    });
  const tenants = new Set<string>();
  for (const code of participantCodes) {
    const allowed = await allowedForCode(ctx, code);
    if (!allowed || allowed.enabled === false)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "通话参与者的授权已经失效。",
      });
    tenants.add(tenantIdForAllowed(allowed));
  }
  if (tenants.size !== 1)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "不能跨授权群组建立合规记录。",
    });
  return [...tenants][0];
}

function requireStoredTenant(item: { tenantId?: string }) {
  if (!item.tenantId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "旧版合规记录缺少授权群组，必须重新请求同意。",
    });
  return item.tenantId;
}

function assertParticipantTenant(
  auth: Awaited<ReturnType<typeof requireSession>>,
  item: { tenantId?: string },
) {
  const tenantId = requireStoredTenant(item);
  if (tenantIdForAllowed(auth.allowed) !== tenantId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "不能访问其他授权群组的合规记录。",
    });
  return tenantId;
}

const RECORDING_SEGMENT_TTL_MS = 10 * 60_000;
const RECORDING_SEGMENT_RATE_WINDOW_MS = 10 * 60_000;
const MAX_RECORDING_SEGMENTS_PER_WINDOW = 4;
const MAX_RECORDING_FILE_BYTES = 25 * 1024 * 1024;
const TRANSFER_RECORDING_DRAIN_GRACE_MS = 15_000;

function recordingMimeType(value: string | undefined) {
  const mimeType = value?.normalize("NFKC").trim().toLowerCase() ?? "";
  const baseType = mimeType.split(";", 1)[0].trim();
  if (!baseType.startsWith("audio/"))
    throw new ConvexError({
      code: "BAD_FILE_TYPE",
      message: "录音文件类型无效。",
    });
  return baseType;
}

function recordingExtension(mimeType: string) {
  return (
    (
      {
        "audio/aac": "aac",
        "audio/flac": "flac",
        "audio/m4a": "m4a",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/webm": "webm",
        "audio/x-m4a": "m4a",
        "audio/x-wav": "wav",
      } as Record<string, string>
    )[mimeType] ?? "audio"
  );
}

function safeRecordingFilenamePart(value: string, fallback: string) {
  const safe = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safe || fallback;
}

function recordingDownloadFilename(recording: Doc<"call_recordings">) {
  const timestamp = new Date(recording.createdAt)
    .toISOString()
    .replace(/[:.]/g, "-");
  return [
    "USA-Filing-recording",
    safeRecordingFilenamePart(recording.callId, "call"),
    safeRecordingFilenamePart(recording.participantCode, "participant"),
    timestamp,
  ].join("-");
}

async function hashRecordingUploadToken(
  segmentId: Id<"call_recording_segments">,
  token: string,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`call-recording-upload:v1:${segmentId}:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function newRecordingUploadToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function consentEpoch(item: {
  consentEpoch?: number;
  activatedAt?: number;
  requestedAt: number;
}) {
  return item.consentEpoch ?? item.activatedAt ?? item.requestedAt;
}

async function hasTransferRecordingDrainGrace(
  ctx: Parameters<typeof requireSession>[0],
  item: Doc<"call_compliance">,
  segment: Doc<"call_recording_segments">,
  participantCode: string,
  now: number,
) {
  if (
    !segment.transferDrainTransferId ||
    !segment.transferDrainDeadline ||
    segment.transferDrainDeadline <= now ||
    item.status === "stopping" ||
    item.status === "stopped" ||
    consentEpoch(item) !== segment.consentEpoch + 1 ||
    !item.participantCodes.includes(participantCode)
  )
    return false;
  const transfer = await ctx.db.get(segment.transferDrainTransferId);
  return Boolean(
    transfer &&
    transfer.status === "completed" &&
    transfer.targetUserId !== transfer.fromUserId &&
    transfer.callId === segment.callId &&
    transfer.remoteUserId === participantCode &&
    transfer.sourceRecordingDrainEpoch === segment.consentEpoch &&
    transfer.completedAt !== undefined &&
    now <= transfer.completedAt + TRANSFER_RECORDING_DRAIN_GRACE_MS &&
    segment.startedAt <= transfer.completedAt &&
    segment.transferDrainDeadline <=
      transfer.completedAt + TRANSFER_RECORDING_DRAIN_GRACE_MS,
  );
}

async function hasRecordingSegmentUploadAuthorization(
  ctx: Parameters<typeof requireSession>[0],
  item: Doc<"call_compliance">,
  segment: Doc<"call_recording_segments">,
  participantCode: string,
  now: number,
) {
  const hasCurrentConsent =
    (item.status === "active" ||
      (item.status === "stopping" && (item.stopDeadline ?? 0) > now)) &&
    consentEpoch(item) === segment.consentEpoch &&
    item.participantCodes.includes(participantCode) &&
    item.consentedCodes.includes(participantCode);
  return (
    hasCurrentConsent ||
    (await hasTransferRecordingDrainGrace(
      ctx,
      item,
      segment,
      participantCode,
      now,
    ))
  );
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
  const now = Date.now();
  if (
    !item ||
    !(await hasRecordingSegmentUploadAuthorization(
      ctx,
      item,
      segment,
      auth.code,
      now,
    ))
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "录音同意已经失效。",
    });
  const tenantId = assertParticipantTenant(auth, item);
  if (segment.tenantId !== tenantId)
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "录音片段的授权群组不匹配。",
    });
  return { auth, segment, tenantId };
}

export const recordingSegmentUploadStatus = query({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
  },
  handler: async (ctx, args) => {
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
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || segment.tenantId !== assertParticipantTenant(auth, item))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音片段的授权群组不匹配。",
      });
    const consumed = Boolean(segment.consumedAt && segment.storageId);
    const now = Date.now();
    return {
      consumed,
      uploadable:
        !consumed &&
        segment.expiresAt > now &&
        (await hasRecordingSegmentUploadAuthorization(
          ctx,
          item,
          segment,
          auth.code,
          now,
        )),
    };
  },
});

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
    const joinedParticipants = (
      await ctx.db
        .query("chat_group_call_participants")
        .withIndex("by_call", (q) => q.eq("groupCallId", groupCall._id))
        .collect()
    ).filter((item) => item.status === "joined");
    const currentParticipant = joinedParticipants.find(
      (item) => item.userId === auth.code,
    );
    if (currentParticipant && currentParticipant.deviceId === deviceId)
      return {
        auth,
        participantCodes: joinedParticipants.map((item) => item.userId),
      };
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
    await assertNoActiveCrossTenantTransfer(ctx, args.callId);
    const tenantId = await resolveParticipantTenant(ctx, participantCodes);
    assertAdminCanAccessTenant(auth, tenantId);
    const existing = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    const now = Date.now();
    const data = {
      tenantId,
      participantCodes,
      consentedCodes: [] as string[],
      consentEpoch: existing ? consentEpoch(existing) + 1 : 1,
      declinedCodes: [] as string[],
      status: "requested" as const,
      requestedBy: auth.code,
      requestedAt: now,
      activatedAt: undefined,
      stoppedAt: undefined,
      stopDeadline: undefined,
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
    if (!item.tenantId || tenantIdForAllowed(auth.allowed) !== item.tenantId)
      return null;
    return {
      status: item.status,
      consentedCodes: item.consentedCodes,
      translationEnabled: item.translationEnabled ?? false,
      myConsent: item.consentedCodes.includes(auth.code),
      myDecline: item.declinedCodes.includes(auth.code),
      ...(item.status === "stopping" && item.stopDeadline !== undefined
        ? { stopDeadline: item.stopDeadline }
        : {}),
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
    assertParticipantTenant(auth, item);
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
    assertParticipantTenant(auth, item);
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
    const tenantId = assertParticipantTenant(auth, item);
    await ctx.db.insert("call_transcripts", {
      callId: args.callId,
      tenantId,
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
    const tenantId = assertParticipantTenant(auth, item);
    const epoch = consentEpoch(item);
    const activeTransfer = (
      await ctx.db
        .query("call_transfers")
        .withIndex("by_call", (q) => q.eq("callId", args.callId))
        .collect()
    ).find(
      (transfer) =>
        transfer.status === "joining" &&
        transfer.fromUserId === auth.code &&
        transfer.fromDeviceId === args.deviceId &&
        transfer.sourceRecordingDrainedAt !== undefined &&
        transfer.sourceRecordingDrainEpoch === epoch,
    );
    if (activeTransfer)
      throw new ConvexError({
        code: "CONFLICT",
        message: "转接录音已经完成交接，来源装置不能再开始新片段。",
      });
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
      tenantId,
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
    // Never expose a raw Convex storage URL. Such a URL remains usable after a
    // call handoff or consent revocation and can create untracked orphan data.
    // The HTTP upload endpoint rechecks this one-time token immediately before
    // and after storing the audio.
    const uploadToken = newRecordingUploadToken();
    await ctx.db.patch(segment._id, {
      uploadUrl: undefined,
      uploadTokenHash: await hashRecordingUploadToken(segment._id, uploadToken),
      uploadAuthorizedAt: Date.now(),
    });
    return { uploadToken };
  },
});

export const authorizeRecordingHttpUpload = internalQuery({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { segment } = await authorizedRecordingSegment(ctx, args);
    const expectedHash = segment.uploadTokenHash ?? "";
    const candidateHash = await hashRecordingUploadToken(
      segment._id,
      args.uploadToken,
    );
    if (
      !segment.uploadAuthorizedAt ||
      !expectedHash ||
      !constantTimeHashEqual(candidateHash, expectedHash)
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音上传凭证无效。",
      });
    return { authorized: true as const };
  },
});

export const saveRecordingHttpUpload = internalMutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
    uploadToken: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args) => {
    const { auth, segment, tenantId } = await authorizedRecordingSegment(
      ctx,
      args,
    );
    const expectedHash = segment.uploadTokenHash ?? "";
    const candidateHash = await hashRecordingUploadToken(
      segment._id,
      args.uploadToken,
    );
    const mimeType = args.mimeType.normalize("NFKC").trim().toLowerCase();
    const storedFile = await ctx.db.system.get("_storage", args.storageId);
    if (
      !segment.uploadAuthorizedAt ||
      !expectedHash ||
      !constantTimeHashEqual(candidateHash, expectedHash) ||
      !mimeType.split(";", 1)[0].startsWith("audio/") ||
      !storedFile ||
      args.byteLength <= 0 ||
      args.byteLength > MAX_RECORDING_FILE_BYTES ||
      storedFile.size !== args.byteLength
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音上传凭证或文件无效。",
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
      uploadTokenHash: undefined,
      transferDrainTransferId: undefined,
      transferDrainDeadline: undefined,
    });
    await ctx.db.insert("call_recordings", {
      callId: args.callId,
      tenantId,
      participantCode: auth.code,
      participantName: auth.session.name,
      storageId: args.storageId,
      mimeType,
      createdAt: now,
    });
    await finishRecordingStopIfFlushed(ctx, args.callId);
  },
});

// Migration-only finalization: clients must use the guarded HTTP upload.
export const saveRecording = internalMutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    segmentId: v.id("call_recording_segments"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, segment, tenantId } = await authorizedRecordingSegment(
      ctx,
      args,
    );
    if (
      (!segment.uploadTokenHash && !segment.uploadUrl) ||
      !segment.uploadAuthorizedAt
    )
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
      uploadTokenHash: undefined,
      transferDrainTransferId: undefined,
      transferDrainDeadline: undefined,
    });
    await ctx.db.insert("call_recordings", {
      callId: args.callId,
      tenantId,
      participantCode: auth.code,
      participantName: auth.session.name,
      storageId: args.storageId,
      mimeType: declaredMimeType,
      createdAt: now,
    });
  },
});

async function finishRecordingStopIfFlushed(ctx: MutationCtx, callId: string) {
  const item = await ctx.db
    .query("call_compliance")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .unique();
  if (!item || item.status !== "stopping") return;
  const segments = await ctx.db
    .query("call_recording_segments")
    .withIndex("by_call", (q) => q.eq("callId", callId))
    .collect();
  const outstanding = segments.some(
    (segment) =>
      segment.consentEpoch === consentEpoch(item) &&
      !segment.consumedAt &&
      segment.expiresAt > Date.now(),
  );
  if (!outstanding || (item.stopDeadline ?? 0) <= Date.now())
    await ctx.db.patch(item._id, {
      status: "stopped",
      stoppedAt: Date.now(),
      stopDeadline: undefined,
      translationEnabled: false,
    });
}

export const finalizeRecordingStop = internalMutation({
  args: { callId: v.string(), consentEpoch: v.number() },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!item || consentEpoch(item) !== args.consentEpoch) return;
    await finishRecordingStopIfFlushed(ctx, args.callId);
  },
});

async function beginRecordingStop(
  ctx: MutationCtx,
  item: Doc<"call_compliance">,
) {
  if (item.status === "stopping") return item.stopDeadline ?? Date.now();
  if (item.status === "stopped") return item.stoppedAt ?? Date.now();
  const stopDeadline = Date.now() + 15_000;
  await ctx.db.patch(item._id, {
    status: "stopping",
    stopDeadline,
    translationEnabled: false,
  });
  await finishRecordingStopIfFlushed(ctx, item.callId);
  await ctx.scheduler.runAfter(
    15_000,
    internal.callCompliance.finalizeRecordingStop,
    { callId: item.callId, consentEpoch: consentEpoch(item) },
  );
  return stopDeadline;
}

export const prepareRecordingHangup = mutation({
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
    if (!item || !item.participantCodes.includes(auth.code))
      return { stopDeadline: Date.now() };
    assertParticipantTenant(auth, item);
    return { stopDeadline: await beginRecordingStop(ctx, item) };
  },
});

export const acknowledgeTransferRecordingDrain = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    callId: v.string(),
    transferId: v.id("call_transfers"),
  },
  handler: async (ctx, args) => {
    const { auth } = await participant(
      ctx,
      args.code,
      args.deviceId,
      args.callId,
    );
    const transfer = await ctx.db.get(args.transferId);
    if (
      !transfer ||
      transfer.callId !== args.callId ||
      transfer.fromUserId !== auth.code ||
      transfer.fromDeviceId !== args.deviceId
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音交接凭证与来源装置不匹配。",
      });
    if (transfer.status !== "joining" || transfer.expiresAt <= Date.now())
      throw new ConvexError({
        code: "CONFLICT",
        message: "当前转接状态不允许确认录音交接。",
      });
    const item = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (item) assertParticipantTenant(auth, item);
    if (item?.status === "stopping")
      throw new ConvexError({
        code: "CONFLICT",
        message: "录音仍在结束处理中，请等待最后片段保存。",
      });
    const epoch =
      item?.status === "active" && item.consentedCodes.includes(auth.code)
        ? consentEpoch(item)
        : undefined;
    if (epoch !== undefined) {
      const segments = await ctx.db
        .query("call_recording_segments")
        .withIndex("by_call", (q) => q.eq("callId", args.callId))
        .collect();
      const outstanding = segments.some(
        (segment) =>
          segment.participantCode === auth.code &&
          segment.deviceId === args.deviceId &&
          segment.consentEpoch === epoch &&
          !segment.consumedAt,
      );
      if (outstanding)
        throw new ConvexError({
          code: "CONFLICT",
          message: "录音最后片段尚未保存，无法完成转接。",
        });
    }
    await ctx.db.patch(transfer._id, {
      sourceRecordingDrainedAt: Date.now(),
      sourceRecordingDrainEpoch: epoch,
    });
    return { acknowledged: true as const, consentEpoch: epoch ?? null };
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
    if (!item)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到合规记录。",
      });
    assertAdminCanAccessTenant(auth, item.tenantId);
    const now = Date.now();
    await beginRecordingStop(ctx, item);
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
    assertAdminCanAccessTenant(auth, item.tenantId);
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

export const authorizeRecordingDownload = internalQuery({
  args: {
    password: v.string(),
    recordingId: v.id("call_recordings"),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const recording = await ctx.db.get(args.recordingId);
    if (!recording)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到录音。",
      });
    assertAdminCanAccessTenant(auth, recording.tenantId);
    const storedFile = await ctx.db.system.get("_storage", recording.storageId);
    if (!storedFile)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到录音文件。",
      });
    const declaredType = recordingMimeType(recording.mimeType);
    const storedType = recordingMimeType(
      storedFile.contentType ?? declaredType,
    );
    if (declaredType !== storedType)
      throw new ConvexError({
        code: "BAD_FILE_TYPE",
        message: "录音文件类型不一致。",
      });
    return {
      storageId: recording.storageId,
      mimeType: storedType,
      filename: `${recordingDownloadFilename(recording)}.${recordingExtension(storedType)}`,
    };
  },
});

export const deleteRecording = mutation({
  args: {
    password: v.string(),
    recordingId: v.id("call_recordings"),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const recording = await ctx.db.get(args.recordingId);
    if (!recording)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到录音。",
      });
    assertAdminCanAccessTenant(auth, recording.tenantId);

    const compliance = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", recording.callId))
      .unique();
    if (!compliance)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到录音所属的合规记录。",
      });
    assertAdminCanAccessTenant(auth, compliance.tenantId);
    if (compliance.status === "active" || compliance.status === "stopping")
      throw new ConvexError({
        code: "CONFLICT",
        message: "不能删除进行中的录音，请先停止录音。",
      });

    const [recordingReferences, segmentReferences, storedFile] =
      await Promise.all([
        ctx.db
          .query("call_recordings")
          .withIndex("by_storage_id", (q) =>
            q.eq("storageId", recording.storageId),
          )
          .collect(),
        ctx.db
          .query("call_recording_segments")
          .withIndex("by_storage_id", (q) =>
            q.eq("storageId", recording.storageId),
          )
          .collect(),
        ctx.db.system.get("_storage", recording.storageId),
      ]);
    const hasSharedRecording =
      recordingReferences.length !== 1 ||
      String(recordingReferences[0]?._id) !== String(recording._id);
    const segment = segmentReferences[0];
    const tenantMismatch =
      !recording.tenantId ||
      compliance.tenantId !== recording.tenantId ||
      (segment !== undefined && segment.tenantId !== recording.tenantId);
    const hasSharedSegment =
      segmentReferences.length > 1 ||
      (segment !== undefined &&
        (segment.callId !== recording.callId ||
          segment.participantCode !== recording.participantCode));
    if (tenantMismatch)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "录音文件的授权群组不匹配，无法删除。",
      });
    if (hasSharedRecording || hasSharedSegment)
      throw new ConvexError({
        code: "CONFLICT",
        message: "录音文件仍被其他记录使用，无法删除。",
      });
    if (!storedFile)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到录音文件。",
      });

    await ctx.storage.delete(recording.storageId);
    if (segment) {
      await ctx.db.patch(segment._id, { storageId: undefined });
    }
    await ctx.db.delete(recording._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "call.recording.delete",
      targetType: "call_recording",
      targetId: String(recording._id),
      success: true,
      details: JSON.stringify({
        callId: recording.callId,
        participantCode: recording.participantCode,
        createdAt: recording.createdAt,
      }),
      createdAt: Date.now(),
    });
    return { deleted: true as const };
  },
});

export const deleteCallRecordings = mutation({
  args: { password: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const compliance = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!compliance)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到通话录音。" });
    assertAdminCanAccessTenant(auth, compliance.tenantId);
    if (compliance.status === "active" || compliance.status === "stopping")
      throw new ConvexError({
        code: "CONFLICT",
        message: "不能删除进行中的录音，请先停止录音。",
      });
    const recordings = await ctx.db
      .query("call_recordings")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    if (!recordings.length)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到通话录音。" });
    for (const recording of recordings)
      assertAdminCanAccessTenant(auth, recording.tenantId);

    const storageIds = new Set(
      recordings.map((recording) => recording.storageId),
    );
    for (const storageId of storageIds) {
      const [recordingReferences, segmentReferences, storedFile] =
        await Promise.all([
          ctx.db
            .query("call_recordings")
            .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
            .collect(),
          ctx.db
            .query("call_recording_segments")
            .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
            .collect(),
          ctx.db.system.get("_storage", storageId),
        ]);
      if (
        recordingReferences.some(
          (recording) =>
            recording.callId !== args.callId ||
            recording.tenantId !== compliance.tenantId,
        ) ||
        segmentReferences.some(
          (segment) =>
            segment.callId !== args.callId ||
            segment.tenantId !== compliance.tenantId,
        )
      )
        throw new ConvexError({
          code: "CONFLICT",
          message: "录音文件仍被其他记录使用，无法删除。",
        });
      if (storedFile) await ctx.storage.delete(storageId);
      for (const segment of segmentReferences)
        await ctx.db.patch(segment._id, { storageId: undefined });
    }
    for (const recording of recordings) await ctx.db.delete(recording._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "call.recording.delete_all",
      targetType: "call_recording",
      targetId: args.callId,
      success: true,
      details: JSON.stringify({
        callId: args.callId,
        recordingCount: recordings.length,
      }),
      createdAt: Date.now(),
    });
    return { deleted: recordings.length };
  },
});

export const deleteCallTranscripts = mutation({
  args: { password: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const compliance = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!compliance)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到通话记录。" });
    assertAdminCanAccessTenant(auth, compliance.tenantId);
    if (compliance.status === "active" || compliance.status === "stopping")
      throw new ConvexError({
        code: "CONFLICT",
        message: "不能删除进行中的文字翻译，请先结束通话。",
      });
    const transcripts = await ctx.db
      .query("call_transcripts")
      .withIndex("by_call_time", (q) => q.eq("callId", args.callId))
      .collect();
    const scoped = transcripts.filter(
      (line) => line.tenantId === compliance.tenantId,
    );
    if (!scoped.length)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到文字翻译。" });
    for (const line of scoped) await ctx.db.delete(line._id);
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "call.transcript.delete_all",
      targetType: "call_transcript",
      targetId: args.callId,
      success: true,
      details: JSON.stringify({
        callId: args.callId,
        transcriptCount: scoped.length,
      }),
      createdAt: Date.now(),
    });
    return { deleted: scoped.length };
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
    const sessions = allSessions
      .map((session) =>
        adminCanAccessTenant(auth, session.tenantId) ? session : null,
      )
      .filter((session): session is NonNullable<typeof session> => !!session)
      .slice(0, 30);
    const scope = getAdminCompanyScope(auth);
    return await Promise.all(
      sessions.map(async (session) => {
        const transcripts = (
          await ctx.db
            .query("call_transcripts")
            .withIndex("by_call_time", (q) => q.eq("callId", session.callId))
            .collect()
        ).filter(
          (transcript) =>
            !scope ||
            (!!transcript.tenantId && transcript.tenantId === session.tenantId),
        );
        const recordings = (
          await ctx.db
            .query("call_recordings")
            .withIndex("by_call", (q) => q.eq("callId", session.callId))
            .collect()
        ).filter(
          (recording) =>
            !scope ||
            (!!recording.tenantId && recording.tenantId === session.tenantId),
        );
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
