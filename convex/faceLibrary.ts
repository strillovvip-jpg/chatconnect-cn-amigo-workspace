import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession } from "./roles";

const authArgs = { code: v.string(), deviceId: v.string() };

export const listMine = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const faces = await ctx.db
      .query("face_library")
      .withIndex("by_owner", (q) => q.eq("ownerCode", auth.code))
      .order("desc")
      .collect();
    return await Promise.all(
      faces.map(async (face) => ({
        ...face,
        imageUrl: await ctx.storage.getUrl(face.storageId),
      })),
    );
  },
});

export const generateUploadUrl = mutation({
  args: authArgs,
  handler: async (ctx, args) => {
    await requireSession(ctx, args.code, args.deviceId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const addFace = mutation({
  args: { ...authArgs, name: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "名称必须为 1 至 80 个字符。",
      });
    const imageUrl = await ctx.storage.getUrl(args.storageId);
    if (!imageUrl)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到已上传的图片。",
      });
    const faceId = `FACE-${crypto.randomUUID().toUpperCase()}`;
    await ctx.db.insert("face_library", {
      faceId,
      ownerCode: auth.code,
      name,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
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
