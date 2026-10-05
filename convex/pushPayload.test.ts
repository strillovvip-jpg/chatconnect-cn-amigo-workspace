import { describe, expect, it } from "vitest";
import { createWebPushPayload } from "./pushPayload";

describe("createWebPushPayload", () => {
  it("includes notification type and structured data for nyfbi English rendering", () => {
    const payload = createWebPushPayload({
      userId: "ABCDE",
      title: "视频来电",
      message: "山田正在呼叫您",
      url: "/consultation",
      type: "video_call",
      data: { callerName: "Yamada", callerUserId: "FGHIJ" },
    });

    expect(payload).toMatchObject({
      type: "video_call",
      data: { callerName: "Yamada", callerUserId: "FGHIJ" },
      options: {
        body: "山田正在呼叫您",
        icon: "/icon/shojin-192.png?v=2",
        badge: "/icon/shojin-192.png?v=2",
        data: { url: "/consultation" },
      },
    });
  });
});
