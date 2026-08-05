"use node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";

type GroupDetails = {
  serverUrl: string;
  token: string;
  roomName: string;
  callId: string;
  groupCallId: Id<"chat_group_calls">;
  chatName: string;
  callType: "video" | "audio";
};

function config() {
  const url = process.env.LIVEKIT_URL,
    key = process.env.LIVEKIT_API_KEY,
    secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret)
    throw new ConvexError({ code: "CONFIG", message: "尚未配置 LiveKit。" });
  return {
    serverUrl: url.replace(/^http:/, "ws:").replace(/^https:/, "wss:"),
    key,
    secret,
  };
}
async function token(roomName: string, identity: string, name: string) {
  const { serverUrl, key, secret } = config();
  const access = new AccessToken(key, secret, { identity, name, ttl: "10m" });
  access.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return { serverUrl, token: await access.toJwt(), roomName };
}
export const create = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    groupId: v.id("chat_groups"),
    type: v.union(v.literal("video"), v.literal("audio")),
  },
  handler: async (ctx, args): Promise<GroupDetails> => {
    const prepared: {
      roomName: string;
      callId: string;
      groupCallId: Id<"chat_group_calls">;
      identity: string;
      name: string;
      groupName: string;
      type: "video" | "audio";
    } = await ctx.runMutation(api.groupCallState.createCall, args);
    return {
      ...(await token(prepared.roomName, prepared.identity, prepared.name)),
      callId: prepared.callId,
      groupCallId: prepared.groupCallId,
      chatName: prepared.groupName,
      callType: prepared.type,
    };
  },
});
export const join = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    groupCallId: v.id("chat_group_calls"),
  },
  handler: async (ctx, args): Promise<GroupDetails> => {
    const prepared: {
      roomName: string;
      callId: string;
      identity: string;
      name: string;
      groupName: string;
      type: "video" | "audio";
    } = await ctx.runMutation(api.groupCallState.authorizeJoin, args);
    return {
      ...(await token(prepared.roomName, prepared.identity, prepared.name)),
      callId: prepared.callId,
      groupCallId: args.groupCallId,
      chatName: prepared.groupName,
      callType: prepared.type,
    };
  },
});

export const hostAction = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    groupCallId: v.id("chat_group_calls"),
    targetCode: v.optional(v.string()),
    action: v.union(
      v.literal("remove"),
      v.literal("block"),
      v.literal("cohost"),
      v.literal("end"),
    ),
  },
  handler: async (ctx, args) => {
    const prepared: {
      roomName: string;
      action: "remove" | "block" | "cohost" | "end";
      identity?: string;
    } = await ctx.runMutation(api.groupCallState.authorizeHostAction, args);
    if (prepared.action !== "cohost") {
      const { key, secret } = config();
      const httpUrl = (process.env.LIVEKIT_URL ?? "")
        .replace(/^ws:/, "http:")
        .replace(/^wss:/, "https:");
      const service = new RoomServiceClient(httpUrl, key, secret);
      try {
        if (prepared.action === "end")
          await service.deleteRoom(prepared.roomName);
        else if (prepared.identity)
          await service.removeParticipant(prepared.roomName, prepared.identity);
      } catch (error) {
        throw new ConvexError({
          code: "LIVEKIT",
          message:
            error instanceof Error
              ? `LiveKit 管理操作失败：${error.message}`
              : "LiveKit 管理操作失败。",
        });
      }
    }
    await ctx.runMutation(api.groupCallState.finalizeHostAction, args);
  },
});
