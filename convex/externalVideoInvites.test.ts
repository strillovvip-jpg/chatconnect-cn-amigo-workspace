import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

const fullFeatures = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: true,
};

const limitedFeatures = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: false,
  canVideoSource: false,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: false,
};

async function setup() {
  const t = convexTest({ schema, modules });
  const [fullProfileId, limitedProfileId] = await Promise.all([
    t.run(async (ctx) =>
      ctx.db.insert("license_profiles", {
        name: "全功能",
        features: fullFeatures,
        createdBy: "RAVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ),
    t.run(async (ctx) =>
      ctx.db.insert("license_profiles", {
        name: "受限",
        features: limitedFeatures,
        createdBy: "RAVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ),
  ]);

  await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code: "FULL1",
      deviceId: "device-full",
      name: "Full User",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "LIMIT1",
      deviceId: "device-limit",
      name: "Limited User",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "FULL1",
      role: "user",
      enabled: true,
      licenseProfileId: fullProfileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "LIMIT1",
      role: "user",
      enabled: true,
      licenseProfileId: limitedProfileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return t;
}

describe("external video invites", () => {
  test("full-feature authorization codes can create an external invite record", async () => {
    const t = await setup();
    const invite = await t.mutation(
      api.externalVideoInvites.prepareInviteSession,
      {
        code: "FULL1",
        deviceId: "device-full",
        inviteId: "invite-1",
        roomName: "guest-room-1",
        operatorIdentity: "FULL1-host-1",
        passwordHash: "hash-1",
        passwordSalt: "salt-1",
        expiresAt: Date.now() + 60_000,
      },
    );
    expect(invite).toMatchObject({
      inviteId: "invite-1",
      roomName: "guest-room-1",
      operatorCode: "FULL1",
      operatorName: "Full User",
    });
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: "invite-1",
      }),
    ).toMatchObject({
      inviteId: "invite-1",
      status: "pending",
      requiresPassword: true,
      available: true,
    });
  });

  test("limited authorization codes are rejected by the backend", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.externalVideoInvites.prepareInviteSession, {
        code: "LIMIT1",
        deviceId: "device-limit",
        inviteId: "invite-2",
        roomName: "guest-room-2",
        operatorIdentity: "LIMIT1-host-1",
        passwordHash: "hash-2",
        passwordSalt: "salt-2",
        expiresAt: Date.now() + 60_000,
      }),
    ).rejects.toThrow();
  });

  test("guest admission is single-use and ended invites become unavailable", async () => {
    const t = await setup();
    await t.mutation(api.externalVideoInvites.prepareInviteSession, {
      code: "FULL1",
      deviceId: "device-full",
      inviteId: "invite-3",
      roomName: "guest-room-3",
      operatorIdentity: "FULL1-host-3",
      passwordHash: "hash-3",
      passwordSalt: "salt-3",
      expiresAt: Date.now() + 60_000,
    });
    await t.mutation(api.externalVideoInvites.markGuestJoined, {
      inviteId: "invite-3",
      guestIdentity: "guest-invite-3",
    });
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: "invite-3",
      }),
    ).toMatchObject({
      inviteId: "invite-3",
      status: "active",
      available: false,
      guestJoined: true,
    });
    await expect(
      t.mutation(api.externalVideoInvites.markGuestJoined, {
        inviteId: "invite-3",
        guestIdentity: "guest-invite-3b",
      }),
    ).rejects.toThrow();
    await t.mutation(api.externalVideoInvites.endInviteSession, {
      code: "FULL1",
      deviceId: "device-full",
      inviteId: "invite-3",
    });
    expect(
      await t.query(api.externalVideoInvites.getPublicInviteSession, {
        inviteId: "invite-3",
      }),
    ).toMatchObject({
      inviteId: "invite-3",
      status: "ended",
      available: false,
    });
  });
});
