import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import {
  assertActiveAuthorizationTarget,
  requireSession,
  tenantIdForAllowed,
} from "./roles";
import { internal } from "./_generated/api";
import {
  allowedForCode,
  assertCodesCanCommunicate,
  requireGroupTenant,
} from "./tenantBoundaries";
import { constantTimeHashEqual } from "./claimCredentials";

const FILE_UPLOAD_TTL_MS = 10 * 60_000;
type FileUploadPurpose = "document" | "message" | "group_message";
type FileUploadBinding =
  | { purpose: "document" }
  | { purpose: "message"; targetCode: string }
  | { purpose: "group_message"; groupId: Id<"chat_groups"> };
const documentTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const messageMediaTypes = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
]);

export function validateFileUpload(
  purpose: FileUploadPurpose,
  mimeType: string,
  byteLength: number,
) {
  const type = mimeType.trim().toLowerCase().split(";", 1)[0];
  const maxBytes = (purpose === "document" ? 25 : 50) * 1024 * 1024;
  if (
    (!documentTypes.has(type) &&
      !(purpose !== "document" && messageMediaTypes.has(type))) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > maxBytes
  )
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid upload MIME type or file size.",
    });
  return type;
}

async function fileTokenHash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`file-upload:v1:${token}`),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createFileUploadAdmission(
  ctx: MutationCtx,
  auth: Awaited<ReturnType<typeof requireSession>>,
  deviceId: string,
  binding: FileUploadBinding,
) {
  const origin = process.env.CONVEX_SITE_URL;
  if (!origin || !/^https:\/\//.test(origin))
    throw new ConvexError({
      code: "PRECONDITION_FAILED",
      message: "Secure upload endpoint is not configured.",
    });
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  if (binding.purpose === "group_message")
    await requireActiveGroupUploadMember(ctx, auth, binding.groupId);
  const admissionId = await ctx.db.insert("file_upload_admissions", {
    ownerCode: auth.code,
    deviceId,
    sessionId: auth.session._id,
    tenantId: tenantIdForAllowed(auth.allowed),
    ...binding,
    tokenHash: await fileTokenHash(token),
    createdAt: Date.now(),
    expiresAt: Date.now() + FILE_UPLOAD_TTL_MS,
  });
  await ctx.scheduler.runAfter(
    FILE_UPLOAD_TTL_MS,
    internal.messages.expireFileUpload,
    { admissionId },
  );
  return `${origin.replace(/\/$/, "")}/api/files/upload?admissionId=${encodeURIComponent(admissionId)}&token=${token}`;
}

const admissionArgs = {
  admissionId: v.id("file_upload_admissions"),
  token: v.string(),
};

async function requireActiveGroupUploadMember(
  ctx: Parameters<typeof requireSession>[0],
  auth: Awaited<ReturnType<typeof requireSession>>,
  groupId: Id<"chat_groups">,
) {
  const { group } = await requireGroupTenant(ctx, groupId, auth.allowed);
  const member = await ctx.db
    .query("chat_group_members")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", auth.code),
    )
    .unique();
  if (group.status !== "active" || !member || member.status !== "active")
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Invalid group upload owner.",
    });
}

async function authorizeAdmission(
  ctx: Parameters<typeof requireSession>[0],
  args: { admissionId: Id<"file_upload_admissions">; token: string },
) {
  const admission = await ctx.db.get(args.admissionId);
  if (
    !admission ||
    admission.storageId ||
    admission.consumedAt ||
    admission.expiresAt <= Date.now() ||
    !constantTimeHashEqual(admission.tokenHash, await fileTokenHash(args.token))
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Invalid or expired upload admission.",
    });
  const auth = await requireSession(
    ctx,
    admission.ownerCode,
    admission.deviceId,
  );
  if (
    auth.session._id !== admission.sessionId ||
    tenantIdForAllowed(auth.allowed) !== admission.tenantId ||
    (admission.purpose === "document" &&
      !["admin", "super_admin"].includes(auth.role))
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Invalid upload owner.",
    });
  if (admission.purpose === "message")
    await requireContact(
      ctx,
      auth.code,
      auth.allowed,
      admission.targetCode ?? "",
    );
  if (admission.purpose === "group_message") {
    if (!admission.groupId)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Invalid group upload admission.",
      });
    await requireActiveGroupUploadMember(ctx, auth, admission.groupId);
  }
  return admission;
}

export const authorizeFileUpload = internalQuery({
  args: admissionArgs,
  handler: async (ctx, args) => ({
    purpose: (await authorizeAdmission(ctx, args)).purpose,
  }),
});

export const recordFileUpload = internalMutation({
  args: {
    ...admissionArgs,
    storageId: v.id("_storage"),
    mimeType: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args) => {
    const admission = await authorizeAdmission(ctx, args);
    const mimeType = validateFileUpload(
      admission.purpose,
      args.mimeType,
      args.byteLength,
    );
    const stored = await ctx.db.system.get("_storage", args.storageId);
    if (!stored || stored.size !== args.byteLength)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Invalid uploaded file.",
      });
    await ctx.db.patch(admission._id, {
      storageId: args.storageId,
      mimeType,
      byteLength: args.byteLength,
    });
  },
});

export const expireFileUpload = internalMutation({
  args: { admissionId: v.id("file_upload_admissions") },
  handler: async (ctx, args) => {
    const admission = await ctx.db.get(args.admissionId);
    if (!admission || admission.consumedAt || admission.expiresAt > Date.now())
      return;
    if (admission.storageId) await ctx.storage.delete(admission.storageId);
    await ctx.db.delete(admission._id);
  },
});

export async function consumeFileUpload(
  ctx: MutationCtx,
  auth: Awaited<ReturnType<typeof requireSession>>,
  deviceId: string,
  storageId: Id<"_storage">,
  binding: FileUploadBinding,
) {
  const admission = await ctx.db
    .query("file_upload_admissions")
    .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
    .unique();
  if (
    !admission ||
    admission.consumedAt ||
    admission.expiresAt <= Date.now() ||
    admission.ownerCode !== auth.code ||
    admission.deviceId !== deviceId ||
    admission.sessionId !== auth.session._id ||
    admission.tenantId !== tenantIdForAllowed(auth.allowed) ||
    admission.purpose !== binding.purpose ||
    admission.targetCode !==
      (binding.purpose === "message" ? binding.targetCode : undefined) ||
    admission.groupId !==
      (binding.purpose === "group_message" ? binding.groupId : undefined)
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Invalid or consumed upload admission.",
    });
  const stored = await ctx.db.system.get("_storage", storageId);
  if (!stored || stored.size !== admission.byteLength)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid uploaded file.",
    });
  if (binding.purpose === "group_message")
    await requireActiveGroupUploadMember(ctx, auth, binding.groupId);
  const mimeType = validateFileUpload(
    binding.purpose,
    admission.mimeType ?? "",
    stored.size,
  );
  await ctx.db.patch(admission._id, { consumedAt: Date.now() });
  return mimeType;
}

async function notifyMessage(
  ctx: MutationCtx,
  targetCode: string,
  senderCode: string,
  senderName: string,
  preview: string,
  media: boolean,
) {
  const notificationId = crypto.randomUUID();
  const title = media
    ? `${senderName} 发来了新附件`
    : `${senderName} 发来了新消息`;
  await ctx.db.insert("notifications", {
    notificationId,
    userId: targetCode,
    type: media ? "media_message" : "text_message",
    title,
    message: preview.slice(0, 180),
    data: { source: "message", senderCode, senderName },
    status: "unread",
    priority: "normal",
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.push.send, {
    userId: targetCode,
    title,
    message: preview.slice(0, 180),
    url: `/consultation/chat/${encodeURIComponent(senderCode)}`,
    type: media ? "media_message" : "text_message",
    data: { source: "message", senderCode, senderName },
  });
}

// Build deterministic room ID from two codes
function roomId(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export const generateUploadUrl = mutation({
  args: { myCode: v.string(), deviceId: v.string(), theirCode: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.myCode, args.deviceId);
    const targetCode = await requireContact(
      ctx,
      auth.code,
      auth.allowed,
      args.theirCode,
    );
    return await createFileUploadAdmission(ctx, auth, args.deviceId, {
      purpose: "message",
      targetCode,
    });
  },
});

async function requireContact(
  ctx: Parameters<typeof requireSession>[0],
  ownerCode: string,
  _ownerAllowed: { companyId?: string } | null | undefined,
  targetCode: string,
) {
  const normalizedTarget = targetCode.trim().toUpperCase();
  const contact = await ctx.db
    .query("contacts")
    .withIndex("by_owner_target", (q) =>
      q.eq("ownerCode", ownerCode).eq("targetCode", normalizedTarget),
    )
    .unique();
  if (!contact)
    throw new ConvexError({ code: "FORBIDDEN", message: "只能与联系人聊天。" });
  const targetAllowed = await allowedForCode(ctx, normalizedTarget);
  assertActiveAuthorizationTarget(targetAllowed);
  await assertCodesCanCommunicate(ctx, ownerCode, normalizedTarget);
  return normalizedTarget;
}

export const sendText = mutation({
  args: {
    myCode: v.string(),
    myName: v.string(),
    theirCode: v.string(),
    deviceId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.myCode, args.deviceId);
    const targetCode = await requireContact(
      ctx,
      auth.code,
      auth.allowed,
      args.theirCode,
    );
    const text = args.text.trim();
    if (!text || text.length > 5000)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "消息无效或过长。",
      });
    await ctx.db.insert("messages", {
      roomId: roomId(auth.code, targetCode),
      senderCode: auth.code,
      senderName: auth.session.name,
      type: "text",
      text,
      sentAt: new Date().toISOString(),
    });
    await notifyMessage(
      ctx,
      targetCode,
      auth.code,
      auth.session.name,
      text,
      false,
    );
  },
});

export const sendMedia = mutation({
  args: {
    myCode: v.string(),
    myName: v.string(),
    theirCode: v.string(),
    storageId: v.id("_storage"),
    mediaType: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("file"),
    ),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.myCode, args.deviceId);
    const targetCode = await requireContact(
      ctx,
      auth.code,
      auth.allowed,
      args.theirCode,
    );
    const mimeType = await consumeFileUpload(
      ctx,
      auth,
      args.deviceId,
      args.storageId,
      { purpose: "message", targetCode },
    );
    if (
      (args.mediaType === "image" && !mimeType.startsWith("image/")) ||
      (args.mediaType === "video" && !mimeType.startsWith("video/")) ||
      (args.mimeType &&
        args.mimeType.split(";", 1)[0].trim().toLowerCase() !== mimeType)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Upload MIME type does not match the attachment.",
      });
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到已上传的文件。",
      });
    await ctx.db.insert("messages", {
      roomId: roomId(auth.code, targetCode),
      senderCode: auth.code,
      senderName: auth.session.name,
      type: args.mediaType,
      storageId: args.storageId,
      mediaUrl: url ?? undefined,
      fileName: args.fileName?.trim().slice(0, 255),
      mimeType,
      sentAt: new Date().toISOString(),
    });
    const kind =
      args.mediaType === "image"
        ? "图片"
        : args.mediaType === "video"
          ? "视频"
          : "文件";
    await notifyMessage(
      ctx,
      targetCode,
      auth.code,
      auth.session.name,
      `${kind}：${args.fileName?.trim() || "附件"}`,
      true,
    );
  },
});

export const listMessages = query({
  args: {
    myCode: v.string(),
    theirCode: v.string(),
    paginationOpts: paginationOptsValidator,
    deviceId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: Array<{
      _id: Id<"messages">;
      roomId: string;
      senderCode: string;
      senderName: string;
      type: "text" | "image" | "video" | "file";
      text?: string;
      mediaUrl?: string;
      fileName?: string;
      mimeType?: string;
      sentAt: string;
    }>;
    isDone: boolean;
    continueCursor: string;
  }> => {
    const auth = await requireSession(ctx, args.myCode, args.deviceId);
    const targetCode = await requireContact(
      ctx,
      auth.code,
      auth.allowed,
      args.theirCode,
    );
    const rid = roomId(auth.code, targetCode);
    const result = await ctx.db
      .query("messages")
      .withIndex("by_room", (q) => q.eq("roomId", rid))
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((m) => ({
        _id: m._id,
        roomId: m.roomId,
        senderCode: m.senderCode,
        senderName: m.senderName,
        type: m.type,
        text: m.text,
        mediaUrl: m.mediaUrl,
        fileName: m.fileName,
        mimeType: m.mimeType,
        sentAt: m.sentAt,
      })),
    };
  },
});
