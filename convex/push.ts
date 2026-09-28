"use node";
import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createWebPushPayload } from "./pushPayload";

export const send = internalAction({
  args: {
    userId: v.string(),
    title: v.string(),
    message: v.string(),
    url: v.optional(v.string()),
    type: v.optional(v.string()),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!subject || !publicKey || !privateKey) return;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const subscriptions = await ctx.runQuery(
      internal.pushSubscriptions.forUser,
      { userId: args.userId },
    );
    await Promise.allSettled(
      subscriptions.map((subscription) =>
        webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(createWebPushPayload(args)),
        ),
      ),
    );
  },
});
