import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { requireSession } from "./roles";
import { internal } from "./_generated/api";

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
    await requireContact(ctx, auth.code, args.theirCode);
    return await ctx.storage.generateUploadUrl();
  },
});

async function requireContact(
  ctx: Parameters<typeof requireSession>[0],
  ownerCode: string,
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
    const targetCode = await requireContact(ctx, auth.code, args.theirCode);
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
    const targetCode = await requireContact(ctx, auth.code, args.theirCode);
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
      mimeType: args.mimeType?.trim().slice(0, 200),
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
    const targetCode = await requireContact(ctx, auth.code, args.theirCode);
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
