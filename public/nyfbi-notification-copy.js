(function registerNyfbiEnglishNotificationCopy(scope) {
  function object(value) {
    return value && typeof value === "object" ? value : {};
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function mediaMessageBody(body) {
    return body.replace(/^(?:图片|视频|文件)：\s*/u, "");
  }

  function party(data, nameKey, idKey, fallback) {
    const name = text(data[nameKey]);
    const id = text(data[idKey]);
    if (name && id && name !== id) return `${name} (${id})`;
    return name || id || fallback;
  }

  scope.nyfbiEnglishNotificationCopy = function englishCopy(payload) {
    const data = object(payload && payload.data);
    const options = object(payload && payload.options);
    const type = text(payload && payload.type);
    const originalTitle = text(payload && payload.title);
    const originalBody = text(options.body);

    if (type === "admin_announcement" || type === "system_announcement") {
      return { title: originalTitle, body: originalBody };
    }

    if (type === "text_message" || type === "media_message") {
      const sender = text(data.senderName) || text(data.senderCode);
      const title =
        type === "media_message"
          ? sender
            ? `New attachment from ${sender}`
            : "New attachment"
          : sender
            ? `New message from ${sender}`
            : "New message";
      return {
        title,
        body:
          type === "media_message"
            ? mediaMessageBody(originalBody)
            : originalBody,
      };
    }

    switch (type) {
      case "friend_invite": {
        const requester = party(
          data,
          "requesterName",
          "requesterUserId",
          "A user",
        );
        return {
          title: "U.S.A · Contact request",
          body: `${requester} sent you a contact request.`,
        };
      }
      case "friend_accepted":
        return {
          title: "U.S.A · Contact request accepted",
          body: "Your contact request was accepted.",
        };
      case "friend_rejected":
        return {
          title: "U.S.A · Contact request declined",
          body: "Your contact request was declined.",
        };
      case "friend_cancelled":
        return {
          title: "U.S.A · Contact request cancelled",
          body: "The contact request was cancelled.",
        };
      case "video_call":
      case "audio_call": {
        const caller = party(
          data,
          "callerName",
          "callerUserId",
          "A contact",
        );
        return {
          title:
            type === "video_call"
              ? "U.S.A · Incoming video call"
              : "U.S.A · Incoming audio call",
          body: `${caller} is calling you.`,
        };
      }
      case "missed_call": {
        const caller = party(
          data,
          "callerName",
          "callerUserId",
          "a contact",
        );
        return { title: "Missed call", body: `Missed call from ${caller}.` };
      }
      case "call_transfer":
        return {
          title: "Call transfer request",
          body: "You received a call transfer request.",
        };
      case "group_invite":
        return {
          title: "Group invitation",
          body: "You were invited to join a group.",
        };
      case "group_video_invite":
        return {
          title:
            text(data.callType) === "audio"
              ? "Incoming group audio call"
              : "Incoming group video call",
          body: "A group call has started.",
        };
      case "case_shared":
        return { title: "Case shared", body: "A case was shared with you." };
      case "document_shared":
        return {
          title: "Document shared",
          body: "A document was shared with you.",
        };
      case "auth_code_expiring":
        return {
          title: "Authorization code expiring",
          body: "Your authorization code will expire soon.",
        };
      case "account_disabled":
        return {
          title: "Account disabled",
          body: "This account has been disabled. Contact an administrator.",
        };
      default:
        return { title: "Notification", body: "Open the app for details." };
    }
  };
})(self);
