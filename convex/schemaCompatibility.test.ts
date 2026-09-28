import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("US production data compatibility", () => {
  test("accepts legacy auth-code rows that contain a role", async () => {
    const t = convexTest({ schema, modules });

    const id = await t.run(async (ctx) =>
      ctx.db.insert(
        "auth_codes",
        {
          code: "LEGACY",
          deviceId: "legacy-device",
          name: "Legacy user",
          role: "user",
          usedAt: new Date().toISOString(),
        } as never,
      ),
    );

    const record = await t.run(async (ctx) => ctx.db.get(id));
    expect(record).toMatchObject({ code: "LEGACY", role: "user" });
  });
});
