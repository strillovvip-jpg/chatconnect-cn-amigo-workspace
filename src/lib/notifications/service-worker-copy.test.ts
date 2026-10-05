// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type WorkerScope = {
  nyfbiEnglishNotificationCopy?: (payload: {
    type?: string;
    title?: string;
    data?: unknown;
    options?: { body?: string };
  }) => { title: string; body: string };
};

describe("nyfbi service-worker notification copy", () => {
  it("renders structured push events in English and preserves chat text", () => {
    const scope: WorkerScope = {};
    const source = readFileSync("public/nyfbi-notification-copy.js", "utf8");
    runInNewContext(source, { self: scope });

    expect(
      scope.nyfbiEnglishNotificationCopy?.({
        type: "video_call",
        title: "视频来电",
        data: { callerName: "Yamada", callerUserId: "ABCDE" },
        options: { body: "山田正在呼叫您" },
      }),
    ).toEqual({
      title: "USA.Filing · Incoming video call",
      body: "Yamada (ABCDE) is calling you.",
    });

    expect(
      scope.nyfbiEnglishNotificationCopy?.({
        type: "friend_invite",
        title: "联系人请求",
        data: { requesterName: "Yamada", requesterUserId: "ABCDE" },
        options: { body: "山田向您发送了联系人请求" },
      }),
    ).toEqual({
      title: "USA.Filing · Contact request",
      body: "Yamada (ABCDE) sent you a contact request.",
    });

    expect(
      scope.nyfbiEnglishNotificationCopy?.({
        type: "text_message",
        title: "新消息",
        data: { senderName: "Yamada" },
        options: { body: "原始聊天内容" },
      }),
    ).toEqual({
      title: "New message from Yamada",
      body: "原始聊天内容",
    });

    expect(
      scope.nyfbiEnglishNotificationCopy?.({
        type: "media_message",
        title: "新附件",
        data: { senderName: "Yamada" },
        options: { body: "文件：客户资料.pdf" },
      }),
    ).toEqual({
      title: "New attachment from Yamada",
      body: "客户资料.pdf",
    });
  });
});
