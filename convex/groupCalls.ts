import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

// ─── Public queries ──────────────────────────────────────────────────────────

export const listActive = query({
  args: {},
  handler: async (_ctx: QueryCtx) => {
    throw new ConvexError({
      code: "GONE",
      message: "旧版公开群组通话已停用，请使用安全群组通话。",
    });
  },
});

// ─── Internal mutations (called from actions) ────────────────────────────────

export const createGroupCallRecord = mutation({
  args: {
    roomName: v.string(),
    serverUrl: v.string(),
    title: v.string(),
    createdByCode: v.string(),
    createdByName: v.string(),
    callType: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (ctx: MutationCtx, args) => {
    void ctx;
    void args;
    throw new ConvexError({
      code: "GONE",
      message: "旧版公开群组通话已停用。",
    });
  },
});

export const endGroupCallRecord = mutation({
  args: { roomName: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    void ctx;
    void args;
    throw new ConvexError({
      code: "GONE",
      message: "旧版公开群组通话已停用。",
    });
  },
});
