import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { TRANSFER_CLEANUP_RETRY_OFFSETS_MS } from "./transferCleanupPolicy";

type RevocationCtx = Pick<MutationCtx, "db" | "scheduler">;

const expireAuthorizationCodeReference = makeFunctionReference<
  "mutation",
  {
    authorizationCodeId: Id<"allowed_codes">;
    expectedExpiresAt: number;
  },
  { revoked: boolean }
>("authorizationCodeLifecycle:expireAuthorizationCode");

const activeDirectCallStatusValues = [
  "ringing",
  "accepted",
  "connecting",
  "connected",
  "active",
] as const;
const activeDirectCallStatuses = new Set<string>(activeDirectCallStatusValues);
const activeGroupParticipantStatuses = [
  "invited",
  "ringing",
  "joined",
] as const;
const activeTransferStatuses = new Set(["pending", "accepted", "joining"]);

function normalizeCode(code: string) {
  return code.normalize("NFKC").trim().toUpperCase();
}

export async function assertAuthorizationCodeNotRetired(
  ctx: Pick<MutationCtx, "db">,
  code: string,
) {
  const normalized = normalizeCode(code);
  const retired = await ctx.db
    .query("authorization_code_tombstones")
    .withIndex("by_code", (query) => query.eq("code", normalized))
    .first();
  if (retired)
    throw new ConvexError({
      code: "CONFLICT",
      message: "此授权码已永久停用，不能重新使用。",
    });
}

function addCleanupIdentities(
  cleanupByRoom: Map<string, Set<string>>,
  roomName: string,
  identities: Array<string | undefined>,
) {
  const exactIdentities = identities.filter((identity): identity is string =>
    Boolean(identity?.trim()),
  );
  if (!exactIdentities.length) return;
  const roomIdentities = cleanupByRoom.get(roomName) ?? new Set<string>();
  for (const identity of exactIdentities) roomIdentities.add(identity);
  cleanupByRoom.set(roomName, roomIdentities);
}

async function expireNotification(ctx: RevocationCtx, notificationId?: string) {
  if (!notificationId) return;
  const notification = await ctx.db
    .query("notifications")
    .withIndex("by_notification_id", (query) =>
      query.eq("notificationId", notificationId),
    )
    .unique();
  if (notification?.status === "unread")
    await ctx.db.patch(notification._id, { status: "expired" });
}

async function queueLiveKitIdentityRevocations(
  ctx: RevocationCtx,
  authorizationCode: string,
  cleanupByRoom: Map<string, Set<string>>,
) {
  const now = Date.now();
  for (const [roomName, identities] of cleanupByRoom) {
    const participantIdentities = [...identities];
    if (!participantIdentities.length) continue;
    const auditLogId = await ctx.db.insert("audit_logs", {
      actorCode: authorizationCode,
      action: "authorization.livekit_revoke",
      targetType: "livekit_room",
      targetId: roomName,
      success: false,
      details: {
        authorizationCode,
        roomName,
        participantIdentities,
        cleanupStatus: "pending",
        cleanupAttempts: 0,
        requestedAt: now,
        updatedAt: now,
      },
      createdAt: now,
    });
    for (const [
      attempt,
      offsetMs,
    ] of TRANSFER_CLEANUP_RETRY_OFFSETS_MS.entries())
      await ctx.scheduler.runAt(
        now + offsetMs,
        internal.calls.retryAuthorizationRevocation,
        { auditLogId, attempt },
      );
  }
}

async function terminateAuthorizationCallState(
  ctx: RevocationCtx,
  authorizationCode: string,
  revokedDeviceIds?: ReadonlySet<string>,
) {
  const now = Date.now();
  const cleanupByRoom = new Map<string, Set<string>>();
  const deviceIsRevoked = (deviceId?: string) =>
    revokedDeviceIds === undefined ||
    Boolean(deviceId && revokedDeviceIds.has(deviceId));
  const callerCalls = (
    await Promise.all(
      activeDirectCallStatusValues.map((status) =>
        ctx.db
          .query("live_calls")
          .withIndex("by_caller_status", (query) =>
            query.eq("callerUserId", authorizationCode).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  const calleeCalls = (
    await Promise.all(
      activeDirectCallStatusValues.map((status) =>
        ctx.db
          .query("live_calls")
          .withIndex("by_callee_status", (query) =>
            query.eq("calleeUserId", authorizationCode).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  const directCalls = new Map(
    [...callerCalls, ...calleeCalls]
      .filter(
        (call) =>
          activeDirectCallStatuses.has(call.status) &&
          deviceIsRevoked(
            call.callerUserId === authorizationCode
              ? call.callerDeviceId
              : call.calleeDeviceId,
          ),
      )
      .map((call) => [call._id, call]),
  );

  for (const call of directCalls.values()) {
    const identities =
      call.callerUserId === authorizationCode
        ? [...(call.callerPublisherIdentities ?? []), call.callerIdentity]
        : [...(call.calleePublisherIdentities ?? []), call.calleeIdentity];
    addCleanupIdentities(cleanupByRoom, call.roomName, identities);
    await ctx.db.patch(call._id, {
      status: "ended",
      endedAt: now,
      endedBy: authorizationCode,
      failureReason: "authorization_revoked",
      lastActivityAt: now,
    });
    await expireNotification(ctx, call.notificationId);

    const compliance = await ctx.db
      .query("call_compliance")
      .withIndex("by_call", (query) => query.eq("callId", call.callId))
      .unique();
    if (compliance && compliance.status !== "stopped")
      await ctx.db.patch(compliance._id, {
        status: "stopped",
        stoppedAt: now,
        translationEnabled: false,
      });

    const transfers = await ctx.db
      .query("call_transfers")
      .withIndex("by_call", (query) => query.eq("callId", call.callId))
      .collect();
    for (const transfer of transfers) {
      if (transfer.targetUserId === authorizationCode)
        addCleanupIdentities(cleanupByRoom, transfer.roomName, [
          transfer.targetIdentity,
        ]);
      if (transfer.fromUserId === authorizationCode)
        addCleanupIdentities(
          cleanupByRoom,
          transfer.roomName,
          transfer.sourceIdentities ?? [],
        );
      if (!activeTransferStatuses.has(transfer.status)) continue;
      await ctx.db.patch(transfer._id, {
        status: "failed",
        completedAt: now,
        failureReason: "authorization_revoked",
      });
      await expireNotification(ctx, transfer.notificationId);
    }
  }

  // A receiver can already have a LiveKit identity while a transfer is in the
  // joining phase, before it replaces either participant in live_calls. Query
  // transfer state independently so revoking that receiver cannot leave its
  // short-lived room token usable until expiry.
  const targetedTransfers = (
    await Promise.all(
      ["pending", "accepted", "joining"].map((status) =>
        ctx.db
          .query("call_transfers")
          .withIndex("by_target_status", (query) =>
            query
              .eq("targetUserId", authorizationCode)
              .eq("status", status as "pending" | "accepted" | "joining"),
          )
          .collect(),
      ),
    )
  ).flat();
  for (const transfer of targetedTransfers) {
    if (!deviceIsRevoked(transfer.targetDeviceId)) continue;
    addCleanupIdentities(cleanupByRoom, transfer.roomName, [
      transfer.targetIdentity,
    ]);
    await ctx.db.patch(transfer._id, {
      status: "failed",
      completedAt: now,
      failureReason: "authorization_revoked",
    });
    await expireNotification(ctx, transfer.notificationId);
  }

  const outgoingTransfers = await ctx.db
    .query("call_transfers")
    .withIndex("by_from", (query) => query.eq("fromUserId", authorizationCode))
    .collect();
  for (const transfer of outgoingTransfers) {
    if (
      !activeTransferStatuses.has(transfer.status) ||
      !deviceIsRevoked(transfer.fromDeviceId)
    )
      continue;
    addCleanupIdentities(
      cleanupByRoom,
      transfer.roomName,
      transfer.sourceIdentities ?? [],
    );
    await ctx.db.patch(transfer._id, {
      status: "failed",
      completedAt: now,
      failureReason: "authorization_revoked",
    });
    await expireNotification(ctx, transfer.notificationId);
  }

  const groupParticipants = (
    await Promise.all(
      activeGroupParticipantStatuses.map((status) =>
        ctx.db
          .query("chat_group_call_participants")
          .withIndex("by_user_status", (query) =>
            query.eq("userId", authorizationCode).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  for (const participant of groupParticipants) {
    if (!deviceIsRevoked(participant.deviceId)) continue;
    const groupCall = await ctx.db.get(participant.groupCallId);
    if (groupCall && groupCall.status !== "ended")
      addCleanupIdentities(cleanupByRoom, groupCall.roomName, [
        participant.livekitIdentity,
      ]);
    await ctx.db.patch(participant._id, {
      status: "removed",
      leftAt: now,
    });
    await expireNotification(ctx, participant.notificationId);
  }

  // External invite identities are code-scoped rather than device-scoped, so
  // only a full authorization revocation can safely terminate them.
  if (revokedDeviceIds === undefined) {
    const externalInvites = await ctx.db
      .query("external_video_invites")
      .withIndex("by_operator_code", (query) =>
        query.eq("operatorCode", authorizationCode),
      )
      .collect();
    for (const invite of externalInvites) {
      if (invite.status !== "pending" && invite.status !== "active") continue;
      addCleanupIdentities(cleanupByRoom, invite.roomName, [
        invite.operatorIdentity,
        invite.operatorViewerIdentity,
        invite.guestIdentity,
      ]);
      await ctx.db.patch(invite._id, {
        status: "ended",
        endedAt: now,
      });
    }
  }

  await queueLiveKitIdentityRevocations(ctx, authorizationCode, cleanupByRoom);
}

function boundDeviceIds(session: Doc<"auth_codes">) {
  return Array.from(
    new Set(
      [
        ...(session.deviceIds ?? []),
        session.deviceId,
        session.mobileDeviceId,
        session.mobileAppDeviceId,
        session.desktopDeviceId,
      ].filter(
        (deviceId): deviceId is string =>
          typeof deviceId === "string" && deviceId.length > 0,
      ),
    ),
  );
}

function deviceIdsByRecency(session: Doc<"auth_codes">) {
  const explicit = [...(session.deviceIds ?? [])].reverse();
  const legacyOnly = boundDeviceIds(session)
    .filter((deviceId) => !explicit.includes(deviceId))
    .sort();
  return [...explicit, ...legacyOnly];
}

/**
 * Reconciles legacy multi-device session state after a tier decrease. Device
 * arrays are kept oldest-to-newest, so a successful login can move its exact
 * binding to the end before a later downgrade deterministically retains it.
 */
export async function enforceAuthorizationCodeDeviceLimit(
  ctx: RevocationCtx,
  code: string,
  maxDevices: number,
  preferredDeviceId?: string,
) {
  const normalized = normalizeCode(code);
  const limit = Math.max(1, Math.floor(maxDevices));
  const sessions = await ctx.db
    .query("auth_codes")
    .withIndex("by_code", (query) => query.eq("code", normalized))
    .collect();
  const newestSessions = [...sessions].sort(
    (left, right) =>
      (right.lastLoginAt ?? right.firstLoginAt ?? right._creationTime) -
        (left.lastLoginAt ?? left.firstLoginAt ?? left._creationTime) ||
      String(right._id).localeCompare(String(left._id)),
  );
  const allBindings = new Set(sessions.flatMap(boundDeviceIds));
  const byRecency: string[] = [];
  const addBinding = (deviceId: string | undefined) => {
    if (deviceId && allBindings.has(deviceId) && !byRecency.includes(deviceId))
      byRecency.push(deviceId);
  };
  addBinding(preferredDeviceId);
  for (const session of newestSessions)
    for (const deviceId of deviceIdsByRecency(session)) addBinding(deviceId);

  const retainedDeviceIds = byRecency.slice(0, limit);
  const removedDeviceIds = byRecency.slice(limit);
  if (removedDeviceIds.length > 0) {
    const removed = new Set(removedDeviceIds);
    await terminateAuthorizationCallState(ctx, normalized, removed);
    const [subscriptions, presence, helperSessions, accessGrants] =
      await Promise.all([
        ctx.db
          .query("push_subscriptions")
          .withIndex("by_user", (query) => query.eq("userId", normalized))
          .collect(),
        ctx.db
          .query("user_presence")
          .withIndex("by_user", (query) => query.eq("userId", normalized))
          .collect(),
        ctx.db
          .query("helper_sessions")
          .withIndex("by_authorization_code", (query) =>
            query.eq("authorizationCode", normalized),
          )
          .collect(),
        ctx.db.query("case_access_grants").collect(),
      ]);
    for (const record of [...subscriptions, ...presence])
      await ctx.db.delete(record._id);
    for (const record of helperSessions)
      if (removed.has(record.deviceId)) await ctx.db.delete(record._id);
    for (const record of accessGrants)
      if (record.userCode === normalized && removed.has(record.deviceId))
        await ctx.db.delete(record._id);
  }

  const assigned = new Set<string>();
  for (const session of newestSessions) {
    const sessionBindings = new Set(boundDeviceIds(session));
    const remaining = retainedDeviceIds.filter(
      (deviceId) => sessionBindings.has(deviceId) && !assigned.has(deviceId),
    );
    if (remaining.length === 0) {
      await ctx.db.delete(session._id);
      continue;
    }
    for (const deviceId of remaining) assigned.add(deviceId);
    const mostRecent = remaining[0];
    await ctx.db.patch(session._id, {
      deviceId: mostRecent,
      deviceIds: [...remaining].reverse(),
      mobileDeviceId: remaining.includes(session.mobileDeviceId ?? "")
        ? session.mobileDeviceId
        : undefined,
      mobileAppDeviceId: remaining.includes(session.mobileAppDeviceId ?? "")
        ? session.mobileAppDeviceId
        : undefined,
      desktopDeviceId: remaining.includes(session.desktopDeviceId ?? "")
        ? session.desktopDeviceId
        : undefined,
    });
  }

  return { retainedDeviceIds, removedDeviceIds };
}

export async function assertAuthorizationCodesNotRetired(
  ctx: Pick<MutationCtx, "db">,
  codes: string[],
) {
  for (const code of new Set(codes.map(normalizeCode)))
    await assertAuthorizationCodeNotRetired(ctx, code);
}

export async function revokeAuthorizationCodeIdentityState(
  ctx: RevocationCtx,
  code: string,
) {
  const normalized = normalizeCode(code);
  await terminateAuthorizationCallState(ctx, normalized);
  const [sessions, subscriptions, presence, helperSessions, uploadRequests] =
    await Promise.all([
      ctx.db
        .query("auth_codes")
        .withIndex("by_code", (query) => query.eq("code", normalized))
        .collect(),
      ctx.db
        .query("push_subscriptions")
        .withIndex("by_user", (query) => query.eq("userId", normalized))
        .collect(),
      ctx.db
        .query("user_presence")
        .withIndex("by_user", (query) => query.eq("userId", normalized))
        .collect(),
      ctx.db
        .query("helper_sessions")
        .withIndex("by_authorization_code", (query) =>
          query.eq("authorizationCode", normalized),
        )
        .collect(),
      ctx.db
        .query("face_upload_requests")
        .withIndex("by_owner_created", (query) =>
          query.eq("ownerCode", normalized),
        )
        .collect(),
    ]);
  for (const record of [
    ...sessions,
    ...subscriptions,
    ...presence,
    ...helperSessions,
    ...uploadRequests,
  ])
    await ctx.db.delete(record._id);
}

export async function retireAuthorizationCode(
  ctx: RevocationCtx,
  code: string,
  metadata: {
    retiredBy: string;
    companyId?: string;
    reason: "deleted" | "bulk_replace" | "bulk_import";
  },
) {
  const normalized = normalizeCode(code);
  const existing = await ctx.db
    .query("authorization_code_tombstones")
    .withIndex("by_code", (query) => query.eq("code", normalized))
    .first();
  if (!existing)
    await ctx.db.insert("authorization_code_tombstones", {
      code: normalized,
      companyId: metadata.companyId?.trim().toLowerCase() || undefined,
      reason: metadata.reason,
      retiredBy: metadata.retiredBy,
      retiredAt: Date.now(),
    });
  await revokeAuthorizationCodeIdentityState(ctx, normalized);
}

export async function scheduleAuthorizationCodeExpiry(
  ctx: Pick<MutationCtx, "scheduler">,
  authorizationCodeId: Id<"allowed_codes">,
  expiresAt?: number,
) {
  if (expiresAt === undefined || expiresAt <= Date.now()) return false;
  await ctx.scheduler.runAt(expiresAt, expireAuthorizationCodeReference, {
    authorizationCodeId,
    expectedExpiresAt: expiresAt,
  });
  return true;
}

export const expireAuthorizationCode = internalMutation({
  args: {
    authorizationCodeId: v.id("allowed_codes"),
    expectedExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.authorizationCodeId);
    if (
      !record ||
      record.expiresAt !== args.expectedExpiresAt ||
      record.expiresAt > Date.now() ||
      record.expiryRevocationVersion === args.expectedExpiresAt
    )
      return { revoked: false };

    await revokeAuthorizationCodeIdentityState(ctx, record.code);
    await ctx.db.patch(record._id, {
      expiryRevocationVersion: args.expectedExpiresAt,
      updatedAt: Date.now(),
    });
    return { revoked: true };
  },
});

export const authorizationRevocationCleanupDetails = internalQuery({
  args: { auditLogId: v.id("audit_logs") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditLogId);
    if (!audit || audit.action !== "authorization.livekit_revoke") return null;
    const details = audit.details as
      | {
          roomName?: unknown;
          participantIdentities?: unknown;
          cleanupStatus?: unknown;
          cleanupAttempts?: unknown;
        }
      | undefined;
    if (details?.cleanupStatus === "completed") return null;
    if (
      typeof details?.roomName !== "string" ||
      !Array.isArray(details.participantIdentities) ||
      !details.participantIdentities.every(
        (identity): identity is string => typeof identity === "string",
      )
    )
      return null;
    return {
      roomName: details.roomName,
      participantIdentities: details.participantIdentities,
      cleanupAttempts:
        typeof details.cleanupAttempts === "number"
          ? details.cleanupAttempts
          : 0,
    };
  },
});

export const recordAuthorizationRevocationCleanup = internalMutation({
  args: {
    auditLogId: v.id("audit_logs"),
    attempt: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditLogId);
    if (!audit || audit.action !== "authorization.livekit_revoke") return;
    const details = (audit.details ?? {}) as Record<string, unknown>;
    if (details.cleanupStatus === "completed") return;
    await ctx.db.patch(audit._id, {
      success: args.success,
      details: {
        ...details,
        cleanupStatus: args.success ? "completed" : "failed",
        cleanupAttempts: Math.max(
          typeof details.cleanupAttempts === "number"
            ? details.cleanupAttempts
            : 0,
          args.attempt + 1,
        ),
        cleanupError: args.success ? undefined : args.error,
        updatedAt: Date.now(),
      },
    });
  },
});
