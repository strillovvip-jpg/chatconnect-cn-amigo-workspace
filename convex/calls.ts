"use node";
import { createHash, randomInt } from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { makeFunctionReference } from "convex/server";
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
  const apiUrl = configuredUrl
    .replace(/^ws:/, "http:")
    .replace(/^wss:/, "https:");
  return { serverUrl, apiUrl, apiKey, apiSecret };
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createInvitePassword() {
  return String(randomInt(100000, 1000000));
}

function buildInviteUrl(origin: string, inviteId: string) {
  const base = origin.replace(/\/+$/, "");
  return `${base}/video_call/${inviteId}`;
}

const prepareInviteSession = makeFunctionReference<
  "mutation",
  {
    code: string;
    deviceId: string;
    inviteId: string;
    roomName: string;
    operatorIdentity: string;
    passwordHash: string;
    passwordSalt: string;
    expiresAt: number;
  },
  {
    inviteId: string;
    roomName: string;
    operatorCode: string;
    operatorName: string;
  }
>("externalVideoInvites:prepareInviteSession");

const getInviteSessionForJoin = makeFunctionReference<
  "query",
  { inviteId: string },
  | {
      _id: string;
      inviteId: string;
      roomName: string;
      operatorCode: string;
      operatorName: string;
      operatorIdentity: string;
      passwordHash: string;
      passwordSalt: string;
      status: "pending" | "active" | "ended" | "expired";
      expiresAt: number;
      endedAt?: number;
      guestJoinedAt?: number;
      guestIdentity?: string;
    }
  | null
>("externalVideoInvites:getInviteSessionForJoin");

const markGuestJoined = makeFunctionReference<
  "mutation",
  { inviteId: string; guestIdentity: string },
  boolean
>("externalVideoInvites:markGuestJoined");

const endInviteSession = makeFunctionReference<
  "mutation",
  { code: string; deviceId: string; inviteId: string },
  boolean
>("externalVideoInvites:endInviteSession");

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

export const createFaceSwapInvite = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    origin: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    inviteId: string;
    inviteUrl: string;
    password: string;
    roomName: string;
    serverUrl: string;
    operatorToken: string;
    operatorIdentity: string;
  }> => {
    const { serverUrl, apiUrl, apiKey, apiSecret } = liveKitConfig();
    const inviteId = crypto.randomUUID();
    const roomName = `guest-${inviteId}`;
    const operatorIdentity = `${args.code.trim().toUpperCase()}-host-${crypto.randomUUID()}`;
    const password = createInvitePassword();
    const passwordSalt = crypto.randomUUID();
    const passwordHash = sha256Hex(`${passwordSalt}:${password}`);
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret);

    await roomService.createRoom({
      name: roomName,
      maxParticipants: 2,
      emptyTimeout: 300,
      departureTimeout: 0,
    });

    try {
      await ctx.runMutation(prepareInviteSession, {
        code: args.code,
        deviceId: args.deviceId,
        inviteId,
        roomName,
        operatorIdentity,
        passwordHash,
        passwordSalt,
        expiresAt,
      });
    } catch (error) {
      await roomService.deleteRoom(roomName).catch(() => undefined);
      throw error;
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: operatorIdentity,
      name: args.code.trim().toUpperCase(),
      ttl: "30m",
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    return {
      inviteId,
      inviteUrl: buildInviteUrl(args.origin, inviteId),
      password,
      roomName,
      serverUrl,
      operatorToken: await token.toJwt(),
      operatorIdentity,
    };
  },
});

export const joinFaceSwapInvite = action({
  args: {
    inviteId: v.string(),
    password: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serverUrl: string;
    token: string;
    roomName: string;
    inviteId: string;
    guestIdentity: string;
  }> => {
    const { serverUrl, apiKey, apiSecret } = liveKitConfig();
    const invite = await ctx.runQuery(getInviteSessionForJoin, {
      inviteId: args.inviteId,
    });
    if (!invite)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到该视讯邀请。",
      });
    if (invite.status === "ended" || invite.status === "expired")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "该视讯邀请已失效。",
      });
    if (invite.guestJoinedAt)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "该视讯邀请已被使用。",
      });
    const suppliedHash = sha256Hex(`${invite.passwordSalt}:${args.password.trim()}`);
    if (suppliedHash !== invite.passwordHash)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "视讯密码错误。",
      });

    const guestIdentity = `guest-${args.inviteId.trim()}`;
    await ctx.runMutation(markGuestJoined, {
      inviteId: args.inviteId,
      guestIdentity,
    });

    const token = new AccessToken(apiKey, apiSecret, {
      identity: guestIdentity,
      name: "Guest",
      ttl: "20m",
    });
    token.addGrant({
      roomJoin: true,
      room: invite.roomName,
      canPublish: true,
      canSubscribe: true,
    });

    return {
      serverUrl,
      token: await token.toJwt(),
      roomName: invite.roomName,
      inviteId: invite.inviteId,
      guestIdentity,
    };
  },
});

export const endFaceSwapInvite = action({
  args: {
    code: v.string(),
    deviceId: v.string(),
    inviteId: v.string(),
  },
  handler: async (ctx, args): Promise<{ ended: true }> => {
    const { apiUrl, apiKey, apiSecret } = liveKitConfig();
    const invite = await ctx.runQuery(getInviteSessionForJoin, {
      inviteId: args.inviteId,
    });
    await ctx.runMutation(endInviteSession, args);
    if (invite?.roomName) {
      const roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret);
      await roomService.deleteRoom(invite.roomName).catch(() => undefined);
    }
    return { ended: true };
  },
});
