import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireSession } from "./roles";

export const heartbeat = mutation({
  args: { code: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const current = await ctx.db
      .query("user_presence")
      .withIndex("by_user", (q) => q.eq("userId", auth.code))
      .unique();
    const now = Date.now();
    if (current)
      await ctx.db.patch(current._id, {
        lastSeenAt: now,
        online: true,
        lastOnlineAt: current.online ? current.lastOnlineAt : now,
      });
    else
      await ctx.db.insert("user_presence", {
        userId: auth.code,
        lastSeenAt: now,
        online: true,
        lastOnlineAt: now,
      });
  },
});

export const markOffline = mutation({
  args: { code: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.code, args.deviceId);
    const current = await ctx.db
      .query("user_presence")
      .withIndex("by_user", (q) => q.eq("userId", auth.code))
      .unique();
    if (current)
      await ctx.db.patch(current._id, {
        online: false,
        lastOfflineAt: Date.now(),
        lastSeenAt: Date.now(),
      });
  },
});
