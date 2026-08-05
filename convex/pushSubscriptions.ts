import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSession } from "./roles";

const authArgs = { code: v.string(), deviceId: v.string() };

export const status = query({
  args: authArgs,
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    return Boolean(
      await ctx.db
        .query("push_subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", auth.code))
        .first(),
    );
  },
});

export const save = mutation({
  args: {
    ...authArgs,
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.code, args.deviceId);
    if (!args.endpoint.startsWith("https://") || args.endpoint.length > 2000)
      throw new Error("推送通知注册信息无效。");
    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    const record = {
      userId: session.code,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, record);
    else
      await ctx.db.insert("push_subscriptions", {
        ...record,
        createdAt: Date.now(),
      });
  },
});

export const remove = mutation({
  args: { ...authArgs, endpoint: v.string() },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.code, args.deviceId);
    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing?.userId === session.code) await ctx.db.delete(existing._id);
  },
});

export const forUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect(),
});
