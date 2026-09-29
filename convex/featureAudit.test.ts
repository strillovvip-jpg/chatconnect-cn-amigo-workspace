import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("auth_codes", {
      code: "USERA",
      deviceId: "device-a",
      name: "User A",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "USERB",
      deviceId: "device-b",
      name: "User B",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("contacts", {
      ownerCode: "USERA",
      targetCode: "USERB",
      targetName: "User B",
      addedAt: new Date().toISOString(),
    });
  });
  return t;
}

describe("presence and browser notification subscriptions", () => {
  test("license profile is loaded and enforced by call APIs", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const features = {
        canVideoCall: false,
        canVoiceCall: true,
        canAIFace: false,
        canVideoSource: false,
        canPlayVideo: false,
        canScreenShare: false,
        canTransferCall: false,
        canGroupCall: false,
        canPictureInPicture: false,
        canFloatingWindow: false,
        canFileSearch: false,
        canRecord: false,
      };
      const profileId = await ctx.db.insert("license_profiles", {
        name: "仅语音",
        features,
        createdBy: "ADMIN",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("allowed_codes", {
        code: "USERA",
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
      });
      await ctx.db.insert("allowed_codes", {
        code: "USERB",
        role: "user",
        enabled: true,
        licenseProfileId: profileId,
      });
      await ctx.db.insert("auth_codes", {
        code: "USERA",
        deviceId: "device-a",
        name: "User A",
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("auth_codes", {
        code: "USERB",
        deviceId: "device-b",
        name: "User B",
        usedAt: new Date().toISOString(),
      });
    });
    expect(
      (
        await t.query(api.features.current, {
          code: "USERA",
          deviceId: "device-a",
        })
      ).features.canVoiceCall,
    ).toBe(true);
    expect(
      (
        await t.query(api.features.current, {
          code: "USERA",
          deviceId: "device-a",
        })
      ).features.canFileSearch,
    ).toBe(true);
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "USERA",
        deviceId: "device-a",
        theirCode: "USERB",
        callType: "video",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.callState.prepareP2P, {
        code: "USERA",
        deviceId: "device-a",
        theirCode: "USERB",
        callType: "audio",
      }),
    ).resolves.toMatchObject({ peerCode: "USERB" });
  });

  test("expired authorization codes cannot restore a session", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "EXPIRED",
        role: "user",
        enabled: true,
        expiresAt: Date.now() - 1,
      });
      await ctx.db.insert("auth_codes", {
        code: "EXPIRED",
        deviceId: "device-x",
        name: "Expired",
        usedAt: new Date().toISOString(),
      });
    });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "EXPIRED",
        deviceId: "device-x",
      }),
    ).toBeNull();
  });

  test("one authorization code allows a phone browser, its installed app, and one desktop", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "LIMIT1",
        role: "user",
        enabled: true,
      });
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "LIMIT1",
      deviceId: "phone-1",
      deviceType: "mobile",
      deviceContext: "browser",
      name: "Device Test",
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "LIMIT1",
      deviceId: "phone-app-1",
      deviceType: "mobile",
      deviceContext: "standalone",
      name: "Device Test",
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "LIMIT1",
      deviceId: "desktop-1",
      deviceType: "desktop",
      name: "Device Test",
    });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "LIMIT1",
        deviceId: "phone-1",
      }),
    ).toMatchObject({ role: "user" });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "LIMIT1",
        deviceId: "phone-app-1",
      }),
    ).toMatchObject({ role: "user" });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "LIMIT1",
        deviceId: "desktop-1",
      }),
    ).toMatchObject({ role: "user" });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "LIMIT1",
        deviceId: "phone-2",
        deviceType: "mobile",
        name: "Device Test",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "LIMIT1",
        deviceId: "phone-app-2",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Device Test",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "LIMIT1",
        deviceId: "desktop-2",
        deviceType: "desktop",
        name: "Device Test",
      }),
    ).rejects.toThrow();
  });

  test("a two-device authorization accepts any two devices and rejects a third", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "TWO01",
        role: "user",
        enabled: true,
        maxDevices: 2,
      });
    });

    for (const deviceId of ["phone-browser-1", "phone-browser-2"])
      await expect(
        t.mutation(api.authCodes.claimCode, {
          code: "TWO01",
          deviceId,
          deviceType: "mobile",
          deviceContext: "browser",
          name: "Two Device User",
        }),
      ).resolves.toMatchObject({ success: true });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "TWO01",
        deviceId: "phone-browser-1",
        deviceType: "mobile",
        deviceContext: "browser",
        name: "Two Device User",
      }),
    ).resolves.toMatchObject({ success: true });

    for (const deviceId of ["phone-browser-1", "phone-browser-2"])
      await expect(
        t.query(api.authCodes.getSessionRole, {
          code: "TWO01",
          deviceId,
        }),
      ).resolves.toMatchObject({ role: "user" });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "TWO01",
        deviceId: "desktop-3",
        deviceType: "desktop",
        name: "Two Device User",
      }),
    ).rejects.toThrow("设备数量上限");
    await expect(
      t.query(api.authCodes.getSessionRole, {
        code: "TWO01",
        deviceId: "desktop-3",
      }),
    ).resolves.toBeNull();
  });

  test("a one-device authorization rejects a second device", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "ONE01",
        role: "user",
        enabled: true,
        maxDevices: 1,
      });
    });

    await t.mutation(api.authCodes.claimCode, {
      code: "ONE01",
      deviceId: "phone-1",
      deviceType: "mobile",
      deviceContext: "standalone",
      name: "One Device User",
    });
    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "ONE01",
        deviceId: "desktop-2",
        deviceType: "desktop",
        name: "One Device User",
      }),
    ).rejects.toThrow("设备数量上限");
  });

  test("a legacy one-device session can add one arbitrary second device", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "OLD02",
        role: "user",
        enabled: true,
        maxDevices: 2,
      });
      await ctx.db.insert("auth_codes", {
        code: "OLD02",
        deviceId: "legacy-phone",
        name: "Legacy User",
        usedAt: new Date().toISOString(),
      });
    });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "OLD02",
        deviceId: "second-phone",
        deviceType: "mobile",
        deviceContext: "standalone",
        name: "Legacy User",
      }),
    ).resolves.toMatchObject({ success: true });

    for (const deviceId of ["legacy-phone", "second-phone"])
      await expect(
        t.query(api.authCodes.getSessionRole, {
          code: "OLD02",
          deviceId,
        }),
      ).resolves.toMatchObject({ role: "user" });

    await expect(
      t.mutation(api.authCodes.claimCode, {
        code: "OLD02",
        deviceId: "third-phone",
        deviceType: "mobile",
        deviceContext: "browser",
        name: "Legacy User",
      }),
    ).rejects.toThrow("设备数量上限");
  });

  test("an unlimited authorization code accepts additional devices", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("allowed_codes", {
        code: "MULTI1",
        role: "user",
        enabled: true,
        unlimitedDevices: true,
      });
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "MULTI1",
      deviceId: "phone-1",
      deviceType: "mobile",
      name: "Multi Device",
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "MULTI1",
      deviceId: "phone-2",
      deviceType: "mobile",
      name: "Multi Device",
    });
    await t.mutation(api.authCodes.claimCode, {
      code: "MULTI1",
      deviceId: "desktop-2",
      deviceType: "desktop",
      name: "Multi Device",
    });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "MULTI1",
        deviceId: "phone-2",
      }),
    ).toMatchObject({ role: "user" });
    expect(
      await t.query(api.authCodes.getSessionRole, {
        code: "MULTI1",
        deviceId: "desktop-2",
      }),
    ).toMatchObject({ role: "user" });
  });

  test("online status is derived from an authenticated heartbeat", async () => {
    const t = await setup();
    expect(
      (
        await t.query(api.contacts.getContacts, {
          ownerCode: "USERA",
          deviceId: "device-a",
        })
      )[0].online,
    ).toBe(false);
    await t.mutation(api.presence.heartbeat, {
      code: "USERB",
      deviceId: "device-b",
    });
    expect(
      (
        await t.query(api.contacts.getContacts, {
          ownerCode: "USERA",
          deviceId: "device-a",
        })
      )[0].online,
    ).toBe(true);
  });

  test("push subscriptions are private and device-bound", async () => {
    const t = await setup();
    await t.mutation(api.pushSubscriptions.save, {
      code: "USERA",
      deviceId: "device-a",
      endpoint: "https://push.example/subscription-a",
      p256dh: "key",
      auth: "secret",
    });
    expect(
      await t.query(api.pushSubscriptions.status, {
        code: "USERA",
        deviceId: "device-a",
      }),
    ).toBe(true);
    expect(
      await t.query(api.pushSubscriptions.status, {
        code: "USERB",
        deviceId: "device-b",
      }),
    ).toBe(false);
    await expect(
      t.mutation(api.pushSubscriptions.save, {
        code: "USERA",
        deviceId: "device-b",
        endpoint: "https://push.example/forged",
        p256dh: "key",
        auth: "secret",
      }),
    ).rejects.toThrow();
  });
});
