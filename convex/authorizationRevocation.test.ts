import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { RoomServiceClient } from "livekit-server-sdk";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { TRANSFER_CLEANUP_RETRY_OFFSETS_MS } from "./transferCleanupPolicy";

const modules = import.meta.glob("./**/*.*s");

async function setupActiveAuthorization() {
  const t = convexTest({ schema, modules });
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("allowed_codes", {
      code: "ADMIN",
      role: "admin",
      companyId: "nyfbi",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "ADMIN",
      deviceId: "admin-device",
      name: "Admin",
      usedAt: new Date(now).toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "ROOT1",
      role: "super_admin",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "ROOT1",
      deviceId: "root-device",
      name: "Root",
      usedAt: new Date(now).toISOString(),
    });
    for (const [code, deviceId] of [
      ["LIMIT", "target-device"],
      ["PEERX", "peer-device"],
    ] as const) {
      await ctx.db.insert("allowed_codes", {
        code,
        role: "user",
        companyId: "nyfbi",
        enabled: true,
      });
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        name: code,
        usedAt: new Date(now).toISOString(),
      });
    }
    await ctx.db.insert("push_subscriptions", {
      userId: "LIMIT",
      endpoint: "https://push.example/revoked",
      p256dh: "revoked-key",
      auth: "revoked-auth",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("user_presence", {
      userId: "LIMIT",
      lastSeenAt: now,
      online: true,
    });
    await ctx.db.insert("helper_sessions", {
      assertionHash: "revoked-helper-assertion",
      authorizationCode: "LIMIT",
      deviceId: "target-device",
      nonceHash: "revoked-helper-nonce",
      allowedOrigin: "https://nyfbi.org",
      createdAt: now,
      expiresAt: now + 60_000,
    });

    const notificationId = "revoked-direct-notification";
    await ctx.db.insert("notifications", {
      notificationId,
      userId: "LIMIT",
      type: "video_call",
      title: "Incoming call",
      message: "Incoming call",
      data: {},
      status: "unread",
      priority: "urgent",
      createdAt: now,
    });
    const directCallId = "revoked-direct-call";
    await ctx.db.insert("live_calls", {
      callId: directCallId,
      roomName: "revoked-direct-room",
      type: "video",
      status: "connected",
      participantCodes: ["LIMIT", "PEERX"],
      createdByCode: "LIMIT",
      callerUserId: "LIMIT",
      calleeUserId: "PEERX",
      callerIdentity: "LIMIT-browser-primary",
      callerPublisherIdentities: [
        "LIMIT-browser-primary",
        "LIMIT-face-swap-native",
      ],
      calleeIdentity: "PEERX-browser-primary",
      calleePublisherIdentities: ["PEERX-browser-primary"],
      notificationId,
      createdAt: now,
      connectedAt: now,
      lastActivityAt: now,
    });
    await ctx.db.insert("call_compliance", {
      callId: directCallId,
      tenantId: "nyfbi",
      participantCodes: ["LIMIT", "PEERX"],
      consentedCodes: ["LIMIT", "PEERX"],
      declinedCodes: [],
      status: "active",
      requestedBy: "ADMIN",
      requestedAt: now,
      activatedAt: now,
      translationEnabled: true,
    });

    const groupId = await ctx.db.insert("chat_groups", {
      name: "Revocation group",
      ownerUserId: "PEERX",
      tenantId: "nyfbi",
      maxMembers: 5,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const groupCallId = await ctx.db.insert("chat_group_calls", {
      groupId,
      callId: "revoked-group-call",
      roomName: "revoked-group-room",
      type: "video",
      status: "active",
      createdBy: "PEERX",
      startedAt: now,
      lastActivityAt: now,
      maxParticipants: 5,
    });
    const groupParticipantId = await ctx.db.insert(
      "chat_group_call_participants",
      {
        groupCallId,
        userId: "LIMIT",
        deviceId: "target-device",
        status: "joined",
        joinedAt: now,
        livekitIdentity: "LIMIT-group-browser",
        isHost: false,
      },
    );
    return { directCallId, groupParticipantId };
  });
  return { t, ...fixture };
}

describe("authorization identity revocation", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  test("disabling a code clears identity state, terminates participation, and queues exact LiveKit identity revocation", async () => {
    const { t, directCallId, groupParticipantId } =
      await setupActiveAuthorization();

    await t.mutation(api.roleManagement.setEnabled, {
      password: "ADMIN:admin-device",
      targetCode: "LIMIT",
      enabled: false,
    });

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("auth_codes")
          .withIndex("by_code", (q) => q.eq("code", "LIMIT"))
          .first(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("push_subscriptions")
          .withIndex("by_user", (q) => q.eq("userId", "LIMIT"))
          .first(),
      ).toBeNull();

      const directCall = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", directCallId))
        .unique();
      expect(directCall).toMatchObject({
        status: "ended",
        failureReason: "authorization_revoked",
      });
      expect(await ctx.db.get(groupParticipantId)).toMatchObject({
        status: "removed",
      });
      const compliance = await ctx.db
        .query("call_compliance")
        .withIndex("by_call", (q) => q.eq("callId", directCallId))
        .unique();
      expect(compliance).toMatchObject({
        status: "stopped",
        translationEnabled: false,
      });

      const cleanupAudits = (await ctx.db.query("audit_logs").collect())
        .filter((record) => record.action === "authorization.livekit_revoke")
        .sort((left, right) =>
          String(left.targetId).localeCompare(String(right.targetId)),
        );
      expect(cleanupAudits).toHaveLength(2);
      expect(
        cleanupAudits.map((record) => ({
          roomName: record.targetId,
          status: record.details?.cleanupStatus,
          identities: [...record.details.participantIdentities].sort(),
        })),
      ).toEqual([
        {
          roomName: "revoked-direct-room",
          status: "pending",
          identities: ["LIMIT-browser-primary", "LIMIT-face-swap-native"],
        },
        {
          roomName: "revoked-group-room",
          status: "pending",
          identities: ["LIMIT-group-browser"],
        },
      ]);

      const jobs = (
        await ctx.db.system.query("_scheduled_functions").collect()
      ).filter(
        (job) =>
          job.name === "calls:retryAuthorizationRevocation" &&
          job.state.kind === "pending",
      );
      expect(jobs).toHaveLength(2 * TRANSFER_CLEANUP_RETRY_OFFSETS_MS.length);
    });
  });

  test("revocation ends pending and active external invites and queues every exact invite identity", async () => {
    const { t } = await setupActiveAuthorization();
    const inviteIds = await t.run(async (ctx) => {
      const now = Date.now();
      const pending = await ctx.db.insert("external_video_invites", {
        inviteId: "revoked-pending-invite",
        roomName: "revoked-pending-invite-room",
        operatorCode: "LIMIT",
        operatorName: "Limit",
        operatorIdentity: "pending-host-publisher",
        operatorViewerIdentity: "pending-host-viewer",
        tenantId: "nyfbi",
        passwordHash: "pending-hash",
        passwordSalt: "pending-salt",
        status: "pending",
        createdAt: now,
        expiresAt: now + 60_000,
        guestIdentity: "pending-guest",
      });
      const active = await ctx.db.insert("external_video_invites", {
        inviteId: "revoked-active-invite",
        roomName: "revoked-active-invite-room",
        operatorCode: "LIMIT",
        operatorName: "Limit",
        operatorIdentity: "active-host-publisher",
        operatorViewerIdentity: "active-host-viewer",
        tenantId: "nyfbi",
        passwordHash: "active-hash",
        passwordSalt: "active-salt",
        status: "active",
        createdAt: now,
        expiresAt: now + 60_000,
        guestJoinedAt: now,
        guestIdentity: "active-guest",
      });
      await ctx.db.insert("external_video_invites", {
        inviteId: "already-ended-invite",
        roomName: "already-ended-invite-room",
        operatorCode: "LIMIT",
        operatorName: "Limit",
        operatorIdentity: "ended-host-publisher",
        operatorViewerIdentity: "ended-host-viewer",
        tenantId: "nyfbi",
        passwordHash: "ended-hash",
        passwordSalt: "ended-salt",
        status: "ended",
        createdAt: now,
        expiresAt: now + 60_000,
        endedAt: now,
        guestIdentity: "ended-guest",
      });
      return { pending, active };
    });

    await t.mutation(api.roleManagement.setEnabled, {
      password: "ADMIN:admin-device",
      targetCode: "LIMIT",
      enabled: false,
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(inviteIds.pending)).toMatchObject({
        status: "ended",
        endedAt: expect.any(Number),
      });
      expect(await ctx.db.get(inviteIds.active)).toMatchObject({
        status: "ended",
        endedAt: expect.any(Number),
      });
      const inviteAudits = (await ctx.db.query("audit_logs").collect())
        .filter(
          (record) =>
            record.action === "authorization.livekit_revoke" &&
            String(record.targetId).startsWith("revoked-") &&
            String(record.targetId).endsWith("-invite-room"),
        )
        .sort((left, right) =>
          String(left.targetId).localeCompare(String(right.targetId)),
        );
      expect(
        inviteAudits.map((record) => ({
          roomName: record.targetId,
          identities: [...record.details.participantIdentities].sort(),
        })),
      ).toEqual([
        {
          roomName: "revoked-active-invite-room",
          identities: [
            "active-guest",
            "active-host-publisher",
            "active-host-viewer",
          ],
        },
        {
          roomName: "revoked-pending-invite-room",
          identities: [
            "pending-guest",
            "pending-host-publisher",
            "pending-host-viewer",
          ],
        },
      ]);
      expect(
        (await ctx.db.query("audit_logs").collect()).some(
          (record) => record.targetId === "already-ended-invite-room",
        ),
      ).toBe(false);
    });
  });

  test.each([
    "reset",
    "rotate",
    "delete",
    "configure-disable",
    "configure-expired",
  ] as const)(
    "%s uses the same active-call and LiveKit identity revocation path",
    async (operation) => {
      const { t, directCallId, groupParticipantId } =
        await setupActiveAuthorization();
      if (operation === "reset")
        await t.mutation(api.admin.resetCode, {
          password: "ADMIN:admin-device",
          code: "LIMIT",
          claimSecretHash: "a".repeat(64),
        });
      else if (operation === "rotate")
        await t.mutation(api.roleManagement.rotateClaimSecret, {
          password: "ADMIN:admin-device",
          targetCode: "LIMIT",
          claimSecretHash: "b".repeat(64),
        });
      else if (operation === "delete")
        await t.mutation(api.roleManagement.deleteCode, {
          password: "ADMIN:admin-device",
          targetCode: "LIMIT",
        });
      else
        await t.mutation(api.features.configureCode, {
          password: "ROOT1:root-device",
          targetCode: "LIMIT",
          enabled: operation !== "configure-disable",
          expiresAt:
            operation === "configure-expired" ? Date.now() - 1 : undefined,
        });

      await t.run(async (ctx) => {
        const call = await ctx.db
          .query("live_calls")
          .withIndex("by_call_id", (q) => q.eq("callId", directCallId))
          .unique();
        expect(call).toMatchObject({
          status: "ended",
          failureReason: "authorization_revoked",
        });
        expect(await ctx.db.get(groupParticipantId)).toMatchObject({
          status: "removed",
        });
        expect(
          (await ctx.db.query("audit_logs").collect()).filter(
            (record) =>
              record.action === "authorization.livekit_revoke" &&
              record.actorCode === "LIMIT",
          ),
        ).toHaveLength(2);
      });
    },
  );

  test("cleanup retries revoke only the recorded exact identities and preserve an auditable failure state", async () => {
    const { t } = await setupActiveAuthorization();
    await t.mutation(api.roleManagement.setEnabled, {
      password: "ADMIN:admin-device",
      targetCode: "LIMIT",
      enabled: false,
    });
    const auditLogId = await t.run(async (ctx) => {
      const record = (await ctx.db.query("audit_logs").collect()).find(
        (candidate) =>
          candidate.action === "authorization.livekit_revoke" &&
          candidate.targetId === "revoked-direct-room",
      );
      if (!record) throw new Error("Missing direct cleanup audit");
      return record._id;
    });

    vi.spyOn(RoomServiceClient.prototype, "listParticipants").mockResolvedValue(
      [] as never,
    );
    const removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, "removeParticipant")
      .mockRejectedValueOnce(new Error("temporary LiveKit failure"))
      .mockResolvedValue(undefined as never);

    await t.action(internal.calls.retryAuthorizationRevocation, {
      auditLogId,
      attempt: 0,
    });
    await expect(
      t.run(async (ctx) => ctx.db.get(auditLogId)),
    ).resolves.toMatchObject({
      success: false,
      details: {
        cleanupStatus: "failed",
        cleanupAttempts: 1,
        cleanupError: "Failed to evict 1 publisher(s)",
      },
    });

    removeParticipant.mockClear();
    await t.action(internal.calls.retryAuthorizationRevocation, {
      auditLogId,
      attempt: 1,
    });
    expect(removeParticipant.mock.calls).toEqual([
      [
        "revoked-direct-room",
        "LIMIT-browser-primary",
        { revokeTokenTs: expect.any(BigInt) },
      ],
      [
        "revoked-direct-room",
        "LIMIT-face-swap-native",
        { revokeTokenTs: expect.any(BigInt) },
      ],
    ]);
    await expect(
      t.run(async (ctx) => ctx.db.get(auditLogId)),
    ).resolves.toMatchObject({
      success: true,
      details: {
        cleanupStatus: "completed",
        cleanupAttempts: 2,
      },
    });
  });

  test("a joining transfer target is revoked even before it replaces a direct-call participant", async () => {
    const { t } = await setupActiveAuthorization();
    const transferId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("live_calls", {
        callId: "transfer-target-call",
        roomName: "transfer-target-room",
        type: "video",
        status: "connected",
        participantCodes: ["PEERX", "ADMIN"],
        createdByCode: "PEERX",
        callerUserId: "PEERX",
        calleeUserId: "ADMIN",
        connectedAt: now,
        lastActivityAt: now,
        createdAt: now,
      });
      const notificationId = "joining-target-notification";
      await ctx.db.insert("notifications", {
        notificationId,
        userId: "LIMIT",
        type: "call_transfer",
        title: "Transfer",
        message: "Transfer",
        data: {},
        status: "unread",
        priority: "high",
        createdAt: now,
      });
      return await ctx.db.insert("call_transfers", {
        callId: "transfer-target-call",
        roomName: "transfer-target-room",
        fromUserId: "PEERX",
        remoteUserId: "ADMIN",
        targetUserId: "LIMIT",
        targetDeviceId: "target-device",
        targetIdentity: "LIMIT-transfer-receiver",
        status: "joining",
        createdAt: now,
        expiresAt: now + 60_000,
        notificationId,
      });
    });

    await t.mutation(api.roleManagement.setEnabled, {
      password: "ADMIN:admin-device",
      targetCode: "LIMIT",
      enabled: false,
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(transferId)).toMatchObject({
        status: "failed",
        failureReason: "authorization_revoked",
      });
      const originalCall = await ctx.db
        .query("live_calls")
        .withIndex("by_call_id", (q) => q.eq("callId", "transfer-target-call"))
        .unique();
      expect(originalCall?.status).toBe("connected");
      const audit = (await ctx.db.query("audit_logs").collect()).find(
        (record) =>
          record.action === "authorization.livekit_revoke" &&
          record.targetId === "transfer-target-room",
      );
      expect(audit?.details).toMatchObject({
        cleanupStatus: "pending",
        participantIdentities: ["LIMIT-transfer-receiver"],
      });
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_notification_id", (q) =>
          q.eq("notificationId", "joining-target-notification"),
        )
        .unique();
      expect(notification?.status).toBe("expired");
    });
  });
});
