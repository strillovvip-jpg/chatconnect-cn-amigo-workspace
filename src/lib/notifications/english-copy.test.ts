import { describe, expect, it } from "vitest";
import {
  englishNotificationCopy,
  notificationDisplayCopy,
} from "./english-copy";

describe("englishNotificationCopy", () => {
  it("replaces backend-localized contact notifications with English copy", () => {
    expect(
      englishNotificationCopy({
        type: "friend_invite",
        title: "联系人请求",
        message: "山田（ABCDE）向您发送了联系人请求",
        data: { requesterName: "Yamada", requesterUserId: "ABCDE" },
      }),
    ).toEqual({
      title: "U.S.A · Contact request",
      message: "Yamada (ABCDE) sent you a contact request.",
    });
  });

  it("uses English system copy without echoing untranslated backend text", () => {
    const systemTypes = [
      "video_call",
      "audio_call",
      "missed_call",
      "call_transfer",
      "group_invite",
      "group_video_invite",
      "case_shared",
      "document_shared",
      "auth_code_expiring",
      "account_disabled",
    ];

    for (const type of systemTypes) {
      const copy = englishNotificationCopy({
        type,
        title: "中文标题",
        message: "日本語の本文",
        data: {},
      });
      expect(`${copy.title} ${copy.message}`).not.toMatch(
        /[\u3040-\u30ff\u3400-\u9fff]/u,
      );
    }
  });

  it("brands incoming-call notifications with U.S.A", () => {
    expect(
      englishNotificationCopy({
        type: "video_call",
        title: "视频来电",
        message: "山田正在呼叫您",
        data: { callerName: "Yamada", callerUserId: "ABCDE" },
      }),
    ).toEqual({
      title: "U.S.A · Incoming video call",
      message: "Yamada (ABCDE) is calling you.",
    });
  });

  it("keeps user-authored chat content while localizing its title", () => {
    expect(
      englishNotificationCopy({
        type: "text_message",
        title: "小林 发来了新消息",
        message: "明天早上见",
        data: { senderName: "Kobayashi" },
      }),
    ).toEqual({
      title: "New message from Kobayashi",
      message: "明天早上见",
    });
  });

  it.each([
    ["图片：portrait.jpg", "portrait.jpg"],
    ["视频：clip.mp4", "clip.mp4"],
    ["文件：客户资料.pdf", "客户资料.pdf"],
  ])(
    "removes the backend media prefix from %s while preserving the file name",
    (message, expected) => {
      expect(
        englishNotificationCopy({
          type: "media_message",
          title: "小林 发来了新附件",
          message,
          data: { senderName: "Kobayashi" },
        }),
      ).toEqual({
        title: "New attachment from Kobayashi",
        message: expected,
      });
    },
  );

  it("preserves administrator-authored announcement copy", () => {
    const announcement = {
      type: "admin_announcement",
      title: "維護通知",
      message: "今晚十點維護",
      data: { sourceUserId: "RAVE" },
    };
    expect(englishNotificationCopy(announcement)).toEqual({
      title: announcement.title,
      message: announcement.message,
    });
  });

  it("provides safe English fallback copy for unknown system types", () => {
    expect(
      englishNotificationCopy({
        type: "future_system_event",
        title: "未知事件",
        message: "未知訊息",
        data: {},
      }),
    ).toEqual({
      title: "Notification",
      message: "Open the app for details.",
    });
  });

  it("leaves native and non-nyfbi notification copy unchanged", () => {
    expect(
      notificationDisplayCopy(
        {
          type: "video_call",
          title: "视频来电",
          message: "山田正在呼叫您",
          data: { callerName: "Yamada" },
        },
        false,
      ),
    ).toEqual({ title: "视频来电", message: "山田正在呼叫您" });

    expect(
      notificationDisplayCopy(
        {
          type: "media_message",
          title: "小林 发来了新附件",
          message: "图片：客户资料.jpg",
          data: { senderName: "Kobayashi" },
        },
        false,
      ),
    ).toEqual({
      title: "小林 发来了新附件",
      message: "图片：客户资料.jpg",
    });
  });
});
