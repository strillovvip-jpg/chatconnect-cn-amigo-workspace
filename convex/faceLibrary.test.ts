import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");
type AuthArgs = { code: string; deviceId: string };
const addFace = makeFunctionReference<
  "mutation",
  AuthArgs & {
    name: string;
    storageId: Id<"_storage">;
    uploadRequestId: Id<"face_upload_requests">;
    hasConsent: boolean;
    subjectIsAdult: boolean;
  },
  { faceId: string }
>("faceLibrary:addFace");

const featureFlags = (canAIFace: boolean) => ({
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: false,
});

async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    const fullProfileId = await ctx.db.insert("license_profiles", {
      name: "高级授权码-全部功能",
      features: featureFlags(true),
      createdBy: "RAVE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const limitedProfileId = await ctx.db.insert("license_profiles", {
      name: "AI disabled",
      features: featureFlags(false),
      createdBy: "RAVE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("allowed_codes", {
      code: "FULLA",
      role: "user",
      enabled: true,
      licenseProfileId: fullProfileId,
    });
    await ctx.db.insert("allowed_codes", {
      code: "LIMIT",
      role: "user",
      enabled: true,
      licenseProfileId: limitedProfileId,
    });
    await ctx.db.insert("allowed_codes", {
      code: "RAVE",
      role: "super_admin",
      enabled: true,
    });
    await ctx.db.insert("auth_codes", {
      code: "FULLA",
      deviceId: "device-full",
      name: "Full User",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "LIMIT",
      deviceId: "device-limit",
      name: "Limited User",
      usedAt: new Date().toISOString(),
    });
    await ctx.db.insert("auth_codes", {
      code: "RAVE",
      deviceId: "device-admin",
      name: "RAVE",
      usedAt: new Date().toISOString(),
    });
  });
  return t;
}

async function storeFile(
  t: Awaited<ReturnType<typeof setup>>,
  contents: BlobPart,
  contentType: string,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([contents], { type: contentType }),
    );
    const testDb = ctx.db as unknown as {
      patch: (
        id: Id<"_storage">,
        value: { contentType: string; size?: number },
      ) => Promise<void>;
    };
    await testDb.patch(storageId, {
      contentType,
      size: typeof contents === "string" ? contents.length : undefined,
    });
    return storageId;
  });
}

describe("face library production compatibility", () => {
  test("full-feature codes and super admins can access the library, limited codes cannot", async () => {
    const t = await setup();
    await expect(
      t.query(api.faceLibrary.listMine, {
        code: "FULLA",
        deviceId: "device-full",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.faceLibrary.listMine, {
        code: "RAVE",
        deviceId: "device-admin",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.faceLibrary.listMine, {
        code: "LIMIT",
        deviceId: "device-limit",
      }),
    ).rejects.toThrow();
  });

  test("generateUploadUrl returns both uploadUrl and requestId", async () => {
    const t = await setup();
    const result = (await t.mutation(api.faceLibrary.generateUploadUrl, {
      code: "FULLA",
      deviceId: "device-full",
    })) as unknown as {
      uploadUrl?: string;
      requestId?: Id<"face_upload_requests">;
    };
    expect(result.uploadUrl).toEqual(expect.any(String));
    expect(result.requestId).toEqual(expect.any(String));
  });

  test("addFace requires consent metadata and stores auditable consent fields", async () => {
    const t = await setup();
    const storageId = await storeFile(t, "image", "image/jpeg");
    const request = (await t.mutation(api.faceLibrary.generateUploadUrl, {
      code: "FULLA",
      deviceId: "device-full",
    })) as unknown as { requestId: Id<"face_upload_requests"> };

    await expect(
      t.mutation(addFace, {
        code: "FULLA",
        deviceId: "device-full",
        name: "Consent missing",
        storageId,
        uploadRequestId: request.requestId,
        hasConsent: false,
        subjectIsAdult: true,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(addFace, {
        code: "FULLA",
        deviceId: "device-full",
        name: "Authorized adult",
        storageId,
        uploadRequestId: request.requestId,
        hasConsent: true,
        subjectIsAdult: true,
      }),
    ).resolves.toMatchObject({ faceId: expect.stringMatching(/^FACE-/) });

    const faces = (await t.query(api.faceLibrary.listMine, {
      code: "FULLA",
      deviceId: "device-full",
    })) as Array<{
      name: string;
      consentVersion?: string;
      subjectIsAdult?: boolean;
      consentConfirmedAt?: number;
      consentValid?: boolean;
    }>;
    expect(faces[0]).toMatchObject({
      name: "Authorized adult",
      consentVersion: "2026-08-02",
      subjectIsAdult: true,
      consentValid: true,
    });
    expect(faces[0].consentConfirmedAt).toEqual(expect.any(Number));
  });
});
