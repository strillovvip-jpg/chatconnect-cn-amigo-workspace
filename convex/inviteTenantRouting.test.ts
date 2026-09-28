import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { RoomServiceClient } from "livekit-server-sdk";
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

const joinTenantInvite = makeFunctionReference<
  "action",
  {
    inviteId: string;
    password: string;
    code: string;
    deviceId: string;
  },
  {
    serverUrl: string;
    token: string;
    roomName: string;
    inviteId: string;
    guestIdentity: string;
  }
>("calls:joinFaceSwapInvite");

type Tenant = "aichijp" | "default";

async function seedInviteUsers(options: {
  operatorTenant: Tenant;
  guestTenant?: Tenant;
}) {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("license_profiles", {
      name: "Fixture full access",
      ...(options.operatorTenant === "aichijp" ? { companyId: "aichijp" } : {}),
      features: fullFeatures,
      createdBy: "TESTADMIN",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auth_codes", {
      code: "PORTALHOST",
      deviceId: "fixture-host-device",
      name: "Fixture Host",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "PORTALHOST",
      role: "user",
      enabled: true,
      licenseProfileId: profileId,
      ...(options.operatorTenant === "aichijp" ? { companyId: "aichijp" } : {}),
    });

    if (options.guestTenant) {
      await ctx.db.insert("auth_codes", {
        code: "PORTALGUEST",
        deviceId: "fixture-guest-device",
        name: "Fixture Guest",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "PORTALGUEST",
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
        ...(options.guestTenant === "aichijp" ? { companyId: "aichijp" } : {}),
      });
    }
  });
  return t;
}

async function createInvite(
  t: Awaited<ReturnType<typeof seedInviteUsers>>,
  origin: string,
) {
  return await t.action(api.calls.createFaceSwapInvite, {
    code: "PORTALHOST",
    deviceId: "fixture-host-device",
    origin,
  });
}

describe("tenant-bound external video invitations", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "https://livekit.example.test";
    process.env.LIVEKIT_API_KEY = "fixture-livekit-key";
    process.env.LIVEKIT_API_SECRET = "fixture-livekit-secret-with-entropy";
    vi.spyOn(RoomServiceClient.prototype, "createRoom").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(RoomServiceClient.prototype, "deleteRoom").mockResolvedValue(
      undefined as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  test("an authenticated aichijp tenant receives an aichijp invitation URL", async () => {
    const t = await seedInviteUsers({ operatorTenant: "aichijp" });

    const invite = await createInvite(t, "https://attacker.example");

    expect(invite.inviteUrl).toBe(
      `https://aichijp.com/video_call/${invite.inviteId}`,
    );
  });

  test("the default tenant stays on nyfbi and cannot override routing with client origin", async () => {
    const t = await seedInviteUsers({ operatorTenant: "default" });

    const invite = await createInvite(t, "https://aichijp.com");

    expect(invite.inviteUrl).toBe(
      `https://nyfbi.org/video_call/${invite.inviteId}`,
    );
  });

  test("an aichijp invitation rejects anonymous password-only admission", async () => {
    const t = await seedInviteUsers({ operatorTenant: "aichijp" });
    const invite = await createInvite(t, "capacitor://localhost");

    await expect(
      t.action(api.calls.joinFaceSwapInvite, {
        inviteId: invite.inviteId,
        password: invite.password,
      }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  test("an authenticated aichijp guest can join an aichijp invitation", async () => {
    const t = await seedInviteUsers({
      operatorTenant: "aichijp",
      guestTenant: "aichijp",
    });
    const invite = await createInvite(t, "https://attacker.example");

    await expect(
      t.action(joinTenantInvite, {
        inviteId: invite.inviteId,
        password: invite.password,
        code: "PORTALGUEST",
        deviceId: "fixture-guest-device",
      }),
    ).resolves.toMatchObject({
      inviteId: invite.inviteId,
      roomName: invite.roomName,
      guestIdentity: expect.any(String),
    });
  });

  test("an authenticated default-tenant guest cannot join an aichijp invitation", async () => {
    const t = await seedInviteUsers({
      operatorTenant: "aichijp",
      guestTenant: "default",
    });
    const invite = await createInvite(t, "https://attacker.example");

    await expect(
      t.action(joinTenantInvite, {
        inviteId: invite.inviteId,
        password: invite.password,
        code: "PORTALGUEST",
        deviceId: "fixture-guest-device",
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("a default-tenant invitation remains available to a password-only guest", async () => {
    const t = await seedInviteUsers({ operatorTenant: "default" });
    const invite = await createInvite(t, "https://aichijp.com");

    await expect(
      t.action(api.calls.joinFaceSwapInvite, {
        inviteId: invite.inviteId,
        password: invite.password,
      }),
    ).resolves.toMatchObject({
      inviteId: invite.inviteId,
      roomName: invite.roomName,
      guestIdentity: expect.any(String),
    });
  });
});
