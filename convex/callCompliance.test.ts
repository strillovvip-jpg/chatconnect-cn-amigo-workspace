import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    for (const [code, deviceId, name, role] of [
      ["ROOT1", "root-device", "总管理员", "super_admin"],
      ["ADMIN", "admin-device", "管理员", "admin"],
      ["ALICE", "alice-device", "Alice", "user"],
      ["BOBXX", "bob-device", "Bob", "user"],
    ] as const) {
      await ctx.db.insert("auth_codes", {
        code,
        deviceId,
        name,
        usedAt: new Date().toISOString(),
      });
      await ctx.db.insert("allowed_codes", { code, role, enabled: true });
    }
    await ctx.db.insert("live_calls", {
      callId: "call-1",
      roomName: "room-1",
      type: "audio",
      status: "connected",
      participantCodes: ["ALICE", "BOBXX"],
      createdByCode: "ALICE",
      createdAt: Date.now(),
    });
  });
  return t;
}

describe("consent-gated call recording", () => {
  test("an administrator can request and every participant must consent", async () => {
    const t = await setup();
    await t.mutation(api.callCompliance.request, {
      password: "ADMIN:admin-device",
      callId: "call-1",
    });
    await t.mutation(api.callCompliance.respond, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      consent: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("requested");
    await t.mutation(api.callCompliance.respond, {
      code: "BOBXX",
      deviceId: "bob-device",
      callId: "call-1",
      consent: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("active");
    await t.mutation(api.callCompliance.setTranslation, {
      password: "ADMIN:admin-device",
      callId: "call-1",
      enabled: true,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.translationEnabled,
    ).toBe(true);
  });

  test("a participant can decline", async () => {
    const t = await setup();
    await t.mutation(api.callCompliance.request, {
      password: "ROOT1:root-device",
      callId: "call-1",
    });
    await t.mutation(api.callCompliance.respond, {
      code: "ALICE",
      deviceId: "alice-device",
      callId: "call-1",
      consent: false,
    });
    expect(
      (
        await t.query(api.callCompliance.status, {
          code: "ALICE",
          deviceId: "alice-device",
          callId: "call-1",
        })
      )?.status,
    ).toBe("declined");
  });
});
