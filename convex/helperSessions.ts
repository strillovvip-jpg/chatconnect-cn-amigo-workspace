import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { effectiveFeatures } from "./features";
import { requireSession, tenantIdForAllowed } from "./roles";

const SESSION_LIFETIME_MS = 5 * 60 * 1000;
const USA_FILING_PRODUCTION_ORIGIN = "https://nyfbi.org";

function productionOriginForTenant(tenantId: string) {
  // Custom companies are isolated data tenants inside the USA.Filing portal.
  // The separate aichijp portal must never authorize its local helper against
  // the USA.Filing browser origin.
  return tenantId === "aichijp" ? undefined : USA_FILING_PRODUCTION_ORIGIN;
}

function encodeBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function invalidAssertion() {
  return new ConvexError({
    code: "UNAUTHENTICATED",
    message: "The local helper assertion is invalid or expired.",
  });
}

export const create = mutation({
  args: {
    code: v.string(),
    deviceId: v.string(),
    helperNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const license = await effectiveFeatures(ctx, auth.allowed);
    const { canAIFace, canVideoCall, canVideoSource } = license.features;
    if (!canAIFace || !canVideoCall || !canVideoSource)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "A full-feature authorization code is required.",
      });

    const nonce = args.helperNonce.trim();
    if (!nonce)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "A helper nonce is required.",
      });

    const origin = productionOriginForTenant(
      tenantIdForAllowed(auth.allowed),
    );
    if (!origin)
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "The Windows helper is not enabled for this portal.",
      });

    const assertionBytes = new Uint8Array(32);
    crypto.getRandomValues(assertionBytes);
    const assertion = encodeBase64Url(assertionBytes);
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_LIFETIME_MS;

    await ctx.db.insert("helper_sessions", {
      assertionHash: await sha256(assertion),
      authorizationCode: auth.code,
      deviceId: args.deviceId,
      nonceHash: await sha256(nonce),
      allowedOrigin: origin,
      createdAt,
      expiresAt,
    });

    return { assertion, expiresAt, origin };
  },
});

export const consume = mutation({
  args: {
    assertionId: v.string(),
    helperNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const assertionHash = await sha256(args.assertionId);
    const record = await ctx.db
      .query("helper_sessions")
      .withIndex("by_assertion_hash", (query) =>
        query.eq("assertionHash", assertionHash),
      )
      .unique();
    const nonceHash = await sha256(args.helperNonce.trim());
    if (
      !record ||
      record.nonceHash !== nonceHash ||
      record.consumedAt !== undefined ||
      record.expiresAt <= Date.now()
    )
      throw invalidAssertion();

    const consumedAt = Date.now();
    await ctx.db.patch(record._id, { consumedAt });
    return {
      authorizationCode: record.authorizationCode,
      deviceId: record.deviceId,
      origin: record.allowedOrigin,
      expiresAt: record.expiresAt,
      consumedAt,
    };
  },
});
