import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { effectiveFeatures } from "./features";
import { requireSession } from "./roles";

export function canCreateExternalInvite(features: Awaited<
  ReturnType<typeof effectiveFeatures>
>["features"]) {
  return (
    features.canVideoCall &&
    features.canVoiceCall &&
    features.canAIFace &&
    features.canVideoSource &&
    features.canPlayVideo &&
    features.canScreenShare &&
    features.canTransferCall &&
    features.canGroupCall &&
    features.canPictureInPicture &&
    features.canFloatingWindow &&
    features.canFileSearch &&
    features.canRecord
  );
}

function resolveStatus(record: {
  status: "pending" | "active" | "ended" | "expired";
  expiresAt: number;
  endedAt?: number;
}) {
  if (record.status === "ended") return "ended" as const;
  if (record.endedAt) return "ended" as const;
  if (record.expiresAt <= Date.now()) return "expired" as const;
  return record.status;
}

function publicInviteState(
  record:
    | {
        inviteId: string;
        status: "pending" | "active" | "ended" | "expired";
        expiresAt: number;
        guestJoinedAt?: number;
        endedAt?: number;
      }
    | null,
) {
  if (!record) return null;
  const status = resolveStatus(record);
  return {
    inviteId: record.inviteId,
    status,
    requiresPassword: true,
    available: status === "pending" && !record.guestJoinedAt,
    guestJoined: Boolean(record.guestJoinedAt),
  };
}

export const prepareInviteSession = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    inviteId: v.string(),
    roomName: v.string(),
    operatorIdentity: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const license = await effectiveFeatures(ctx, auth.allowed);
    if (!canCreateExternalInvite(license.features))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "只有全功能授权码可以建立换脸视讯邀请。",
      });
    const inviteId = args.inviteId.trim();
    const roomName = args.roomName.trim();
    if (!inviteId || !roomName)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "缺少邀请编号或房间编号。",
      });
    const existing = await ctx.db
      .query("external_video_invites")
      .withIndex("by_invite_id", (q) => q.eq("inviteId", inviteId))
      .unique();
    if (existing)
      throw new ConvexError({
        code: "CONFLICT",
        message: "邀请已存在，请重新建立。",
      });
    await ctx.db.insert("external_video_invites", {
      inviteId,
      roomName,
      operatorCode: auth.code,
      operatorName: auth.session.name,
      operatorIdentity: args.operatorIdentity.trim(),
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    return {
      inviteId,
      roomName,
      operatorCode: auth.code,
      operatorName: auth.session.name,
    };
  },
});

export const getPublicInviteSession = query({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("external_video_invites")
      .withIndex("by_invite_id", (q) => q.eq("inviteId", args.inviteId.trim()))
      .unique();
    return publicInviteState(record);
  },
});

export const getInviteSessionForJoin = internalQuery({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("external_video_invites")
      .withIndex("by_invite_id", (q) => q.eq("inviteId", args.inviteId.trim()))
      .unique();
    if (!record) return null;
    return {
      _id: record._id,
      inviteId: record.inviteId,
      roomName: record.roomName,
      operatorCode: record.operatorCode,
      operatorName: record.operatorName,
      operatorIdentity: record.operatorIdentity,
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      status: resolveStatus(record),
      expiresAt: record.expiresAt,
      endedAt: record.endedAt,
      guestJoinedAt: record.guestJoinedAt,
      guestIdentity: record.guestIdentity,
    };
  },
});

export const markGuestJoined = mutation({
  args: {
    inviteId: v.string(),
    guestIdentity: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("external_video_invites")
      .withIndex("by_invite_id", (q) => q.eq("inviteId", args.inviteId.trim()))
      .unique();
    if (!record)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到该视讯邀请。",
      });
    const status = resolveStatus(record);
    if (status === "ended" || status === "expired")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "该视讯邀请已失效。",
      });
    if (record.guestJoinedAt)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "该视讯邀请已被使用。",
      });
    await ctx.db.patch(record._id, {
      status: "active",
      guestJoinedAt: Date.now(),
      guestIdentity: args.guestIdentity.trim(),
    });
    return true;
  },
});

export const endInviteSession = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    inviteId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const record = await ctx.db
      .query("external_video_invites")
      .withIndex("by_invite_id", (q) => q.eq("inviteId", args.inviteId.trim()))
      .unique();
    if (!record)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "找不到该视讯邀请。",
      });
    if (record.operatorCode !== auth.code && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限结束该视讯邀请。",
      });
    await ctx.db.patch(record._id, {
      status: "ended",
      endedAt: Date.now(),
    });
    return true;
  },
});
