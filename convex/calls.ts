"use node";
import { AccessToken } from "livekit-server-sdk";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api } from "./_generated/api";

function roomName(a: string, b: string): string {
  return [a, b].sort().join("-").toLowerCase();
}

function liveKitConfig() {
  const configuredUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!configuredUrl || !apiKey || !apiSecret) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "请配置 LIVEKIT_URL、LIVEKIT_API_KEY 和 LIVEKIT_API_SECRET。",
    });
  }
  const serverUrl = configuredUrl
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
  if (!/^wss?:\/\//.test(serverUrl)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "LIVEKIT_URL 必须使用 ws:// 或 wss://。",
    });
  }
  return { serverUrl, apiKey, apiSecret };
}

export const getOrCreateRoom = action({
  args: {
    myCode: v.string(),
    theirCode: v.string(),
    myName: v.string(),
    deviceId: v.string(),
    callType: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serverUrl: string;
    token: string;
    roomName: string;
    callId: string;
    myCode: string;
    remoteCode: string;
    callType: "audio" | "video";
  }> => {
    const prepared = await ctx.runMutation(api.callState.prepareP2P, {
      code: args.myCode,
      deviceId: args.deviceId,
      theirCode: args.theirCode,
      callType: args.callType,
    });
    return {
      serverUrl: "",
      token: "",
      roomName: prepared.roomName,
      callId: prepared.callId,
      myCode: args.myCode.trim().toUpperCase(),
      remoteCode: prepared.peerCode,
      callType: args.callType,
    };
  },
});

export const joinAcceptedOutgoingCall = action({
  args: { code: v.string(), deviceId: v.string(), callId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serverUrl: string;
    token: string;
    roomName: string;
    callId: string;
    myCode: string;
    remoteCode: string;
    callType: "audio" | "video";
    chatName: string;
  }> => {
    const { serverUrl, apiKey, apiSecret } = liveKitConfig();
    const prepared = await ctx.runMutation(
      api.callState.authorizeOutgoingJoin,
      args,
    );
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: `${args.code.trim().toUpperCase()}-${crypto.randomUUID()}`,
      name: prepared.name,
      ttl: "15m",
    });
    accessToken.addGrant({
      roomJoin: true,
      room: prepared.roomName,
      canPublish: true,
      canSubscribe: true,
    });
    return {
      serverUrl,
      token: await accessToken.toJwt(),
      roomName: prepared.roomName,
      callId: prepared.callId,
      myCode: args.code.trim().toUpperCase(),
      remoteCode: prepared.calleeCode,
      callType: prepared.callType,
      chatName: prepared.calleeName,
    };
  },
});

export const joinTransferredRoom = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    transferId: v.id("call_transfers"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serverUrl: string;
    token: string;
    roomName: string;
    callId: string;
    myCode: string;
    remoteCode: string;
    callType: "audio" | "video";
  }> => {
    const { serverUrl, apiKey, apiSecret } = liveKitConfig();
    const prepared = await ctx.runMutation(
      api.callState.authorizeTransferJoin,
      args,
    );
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: `${args.code.trim().toUpperCase()}-${crypto.randomUUID()}`,
      name: prepared.name,
      ttl: "5m",
    });
    accessToken.addGrant({
      roomJoin: true,
      room: prepared.roomName,
      canPublish: true,
      canSubscribe: true,
    });
    return {
      serverUrl,
      token: await accessToken.toJwt(),
      roomName: prepared.roomName,
      callId: prepared.callId,
      myCode: args.code.trim().toUpperCase(),
      remoteCode: "",
      callType: prepared.callType,
    };
  },
});

export const acceptIncomingCall = action({
  args: { code: v.string(), deviceId: v.string(), callId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serverUrl: string;
    token: string;
    roomName: string;
    callId: string;
    myCode: string;
    remoteCode: string;
    callType: "audio" | "video";
    chatName: string;
  }> => {
    const { serverUrl, apiKey, apiSecret } = liveKitConfig();
    const prepared = await ctx.runMutation(
      api.callState.acceptAndAuthorizeIncomingJoin,
      args,
    );
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: `${args.code.trim().toUpperCase()}-${crypto.randomUUID()}`,
      name: prepared.name,
      ttl: "15m",
    });
    accessToken.addGrant({
      roomJoin: true,
      room: prepared.roomName,
      canPublish: true,
      canSubscribe: true,
    });
    return {
      serverUrl,
      token: await accessToken.toJwt(),
      roomName: prepared.roomName,
      callId: prepared.callId,
      myCode: args.code.trim().toUpperCase(),
      remoteCode: prepared.callerCode,
      callType: prepared.callType,
      chatName: prepared.callerName,
    };
  },
});
