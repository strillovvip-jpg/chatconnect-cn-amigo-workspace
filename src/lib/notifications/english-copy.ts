export type NotificationCopyInput = {
  type: string;
  title: string;
  message: string;
  data?: unknown;
};

export type NotificationDisplayCopy = {
  title: string;
  message: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mediaMessageBody(message: string): string {
  return message.replace(/^(?:图片|视频|文件)：\s*/u, "");
}

function namedParty(
  data: Record<string, unknown>,
  nameKey: string,
  idKey: string,
  fallback: string,
): string {
  const name = text(data[nameKey]);
  const id = text(data[idKey]);
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id || fallback;
}

/**
 * Produces the English-only system copy used on nyfbi.org.
 *
 * The backend stores legacy localized titles/messages for compatibility with
 * existing native clients.  The web surface therefore derives system copy
 * from notification type and structured data instead of echoing those fields.
 * User-authored message and announcement bodies are deliberately preserved.
 */
export function englishNotificationCopy(
  item: NotificationCopyInput,
): NotificationDisplayCopy {
  const data = record(item.data);

  if (
    item.type === "admin_announcement" ||
    item.type === "system_announcement"
  ) {
    return { title: item.title, message: item.message };
  }

  if (item.type === "text_message" || item.type === "media_message") {
    const sender = text(data.senderName) || text(data.senderCode);
    return {
      title:
        item.type === "media_message"
          ? sender
            ? `New attachment from ${sender}`
            : "New attachment"
          : sender
            ? `New message from ${sender}`
            : "New message",
      message:
        item.type === "media_message"
          ? mediaMessageBody(item.message)
          : item.message,
    };
  }

  switch (item.type) {
    case "friend_invite": {
      const requester = namedParty(
        data,
        "requesterName",
        "requesterUserId",
        "A user",
      );
      return {
        title: "U.S.A · Contact request",
        message: `${requester} sent you a contact request.`,
      };
    }
    case "friend_accepted":
      return {
        title: "U.S.A · Contact request accepted",
        message: "Your contact request was accepted.",
      };
    case "friend_rejected":
      return {
        title: "U.S.A · Contact request declined",
        message: "Your contact request was declined.",
      };
    case "friend_cancelled":
      return {
        title: "U.S.A · Contact request cancelled",
        message: "The contact request was cancelled.",
      };
    case "video_call":
    case "audio_call": {
      const caller = namedParty(
        data,
        "callerName",
        "callerUserId",
        "A contact",
      );
      const video = item.type === "video_call";
      return {
        title: video
          ? "U.S.A · Incoming video call"
          : "U.S.A · Incoming audio call",
        message: `${caller} is calling you.`,
      };
    }
    case "missed_call": {
      const caller = namedParty(
        data,
        "callerName",
        "callerUserId",
        "a contact",
      );
      return { title: "Missed call", message: `Missed call from ${caller}.` };
    }
    case "call_transfer":
      return {
        title: "Call transfer request",
        message: "You received a call transfer request.",
      };
    case "group_invite":
      return {
        title: "Group invitation",
        message: "You were invited to join a group.",
      };
    case "group_video_invite": {
      const audio = text(data.callType) === "audio";
      return {
        title: audio ? "Incoming group audio call" : "Incoming group video call",
        message: "A group call has started.",
      };
    }
    case "case_shared":
      return {
        title: "Case shared",
        message: "A case was shared with you.",
      };
    case "document_shared":
      return {
        title: "Document shared",
        message: "A document was shared with you.",
      };
    case "auth_code_expiring":
      return {
        title: "Authorization code expiring",
        message: "Your authorization code will expire soon.",
      };
    case "account_disabled":
      return {
        title: "Account disabled",
        message: "This account has been disabled. Contact an administrator.",
      };
    default:
      return {
        title: "Notification",
        message: "Open the app for details.",
      };
  }
}

export function notificationDisplayCopy(
  item: NotificationCopyInput,
  forceEnglish: boolean,
): NotificationDisplayCopy {
  return forceEnglish
    ? englishNotificationCopy(item)
    : { title: item.title, message: item.message };
}
