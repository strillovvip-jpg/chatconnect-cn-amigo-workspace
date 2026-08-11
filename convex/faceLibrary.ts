import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireFeature } from "./features";
import { requireSession } from "./roles";

const authArgs = { code: v.string(), deviceId: v.string() };
const CONSENT_VERSION = "2026-08-02";
const UPLOAD_REQUEST_TTL_MS = 15 * 60 * 1000;

async function presentFaces(
  ctx: Pick<QueryCtx, "db" | "storage">,
  ownerCode: string,
) {
  const faces = await ctx.db
    .query("face_library")
    .withIndex("by_owner", (q) => q.eq("ownerCode", ownerCode))
    .order("desc")
    .collect();
  return await Promise.all(
    faces.map(async (face) => ({
      ...face,
      imageUrl: await ctx.storage.getUrl(face.storageId),
      consentValid:
        face.consentVersion === CONSENT_VERSION &&
        face.subjectIsAdult === true &&
        typeof face.consentConfirmedAt === "number",
    })),
  );
}

export const listMine = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canAIFace",
    );
    return await presentFaces(ctx, auth.code);
  },
});

export const listMineForManagement = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    return await presentFaces(ctx, auth.code);
  },
});

export const generateUploadUrl = mutation({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canAIFace",
    );
    const now = Date.now();
    const requestId = await ctx.db.insert("face_upload_requests", {
      ownerCode: auth.code,
      createdAt: now,
      expiresAt: now + UPLOAD_REQUEST_TTL_MS,
    });
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      requestId,
    };
  },
});

export const addFace = mutation({
  args: {
    ...authArgs,
    name: v.string(),
    storageId: v.id("_storage"),
    uploadRequestId: v.id("face_upload_requests"),
    hasConsent: v.boolean(),
    subjectIsAdult: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canAIFace",
    );
    if (!args.hasConsent)
      throw new ConvexError({
        code: "CONSENT_REQUIRED",
        message: "必须确认已获得本人同意。",
      });
    if (!args.subjectIsAdult)
      throw new ConvexError({
        code: "ADULT_REQUIRED",
        message: "仅允许登记成年人的照片。",
      });
    const request = await ctx.db.get(args.uploadRequestId);
    if (
      !request ||
      request.ownerCode !== auth.code ||
      request.consumedAt ||
      request.expiresAt < Date.now()
    )
      throw new ConvexError({
        code: "UPLOAD_REQUEST_INVALID",
        message: "上传请求无效或已过期，请重新选择图片。",
      });
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "名称必须为 1 至 80 个字符。",
      });
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到已上传的图片。",
      });
    if (!metadata.contentType?.toLowerCase().startsWith("image/"))
      throw new ConvexError({
        code: "BAD_FILE_TYPE",
        message: "仅允许上传图片文件。",
      });
    const faceId = `FACE-${crypto.randomUUID().toUpperCase()}`;
    await ctx.db.insert("face_library", {
      faceId,
      ownerCode: auth.code,
      name,
      storageId: args.storageId,
      consentConfirmedAt: Date.now(),
      consentVersion: CONSENT_VERSION,
      subjectIsAdult: true,
      createdAt: Date.now(),
    });
    await ctx.db.patch(request._id, { consumedAt: Date.now() });
    return { faceId };
  },
});

export const renameFace = mutation({
  args: { ...authArgs, faceId: v.id("face_library"), name: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const face = await ctx.db.get(args.faceId);
    if (!face || face.ownerCode !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无权修改此人脸资料。",
      });
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "名称必须为 1 至 80 个字符。",
      });
    await ctx.db.patch(face._id, { name });
  },
});

export const authorizeForCall = mutation({
  args: { ...authArgs, faceId: v.id("face_library") },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.code,
      args.deviceId,
      "canAIFace",
    );
    const face = await ctx.db.get(args.faceId);
    if (!face || face.ownerCode !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无权将此人脸用于通话。",
      });
    const consentValid =
      face.consentVersion === CONSENT_VERSION &&
      face.subjectIsAdult === true &&
      typeof face.consentConfirmedAt === "number";
    if (!consentValid)
      throw new ConvexError({
        code: "CONSENT_REQUIRED",
        message: "此人脸资料需要重新确认同意后才能用于通话。",
      });
    const imageUrl = await ctx.storage.getUrl(face.storageId);
    if (!imageUrl)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到人脸图片。",
      });
    await ctx.db.insert("audit_logs", {
      actorCode: auth.code,
      action: "ai_face.authorize_call",
      targetType: "face_library",
      targetId: String(face._id),
      success: true,
      details: { consentVersion: face.consentVersion },
      createdAt: Date.now(),
    });
    return {
      faceId: String(face._id),
      name: face.name,
      imageUrl,
      consentVersion: face.consentVersion,
    };
  },
});

export const deleteFace = mutation({
  args: { ...authArgs, faceId: v.id("face_library") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const face = await ctx.db.get(args.faceId);
    if (!face || face.ownerCode !== auth.code)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "您无权删除此人脸资料。",
      });
    await ctx.storage.delete(face.storageId);
    await ctx.db.delete(face._id);
  },
});
