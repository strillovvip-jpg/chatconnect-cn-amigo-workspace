"use node";
import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";

function retired(): never {
  throw new ConvexError({
    code: "GONE",
    message: "旧版公开群组通话已停用，请使用安全群组通话。",
  });
}

export const createGroupRoom = action({
  args: {
    title: v.string(),
    createdByCode: v.string(),
    createdByName: v.string(),
    callType: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (): Promise<never> => retired(),
});

export const joinGroupRoom = action({
  args: { roomName: v.string(), userCode: v.string(), userName: v.string() },
  handler: async (): Promise<never> => retired(),
});

export const endGroupRoom = action({
  args: { roomName: v.string() },
  handler: async (): Promise<never> => retired(),
});
