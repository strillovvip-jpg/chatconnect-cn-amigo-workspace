import { Copy, FileText, ImageIcon, Video } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type ChatMessage = {
  type: "text" | "image" | "video" | "file";
  text?: string;
  mediaUrl?: string;
  fileName?: string;
};

export function isAuthorizationCodeLikeText(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/^[A-Z0-9]{4,20}$/.test(value)) return true;
  return /authorization code|auth code|認証コード|授权码/i.test(value);
}

export function ChatMessageContent({
  message,
  isMe,
  onCopyCode,
}: {
  message: ChatMessage;
  isMe: boolean;
  onCopyCode?: (text: string) => void;
}) {
  const { messages } = useI18n();
  const copy = messages.chatMessage;
  if (message.type === "text") {
    if (message.text && isAuthorizationCodeLikeText(message.text)) {
      return (
        <button
          type="button"
          onClick={() => onCopyCode?.(message.text ?? "")}
          className="group flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left text-sm transition hover:brightness-110"
          style={{
            background: isMe ? "oklch(0.5 0.07 220)" : "oklch(0.22 0.03 240)",
            borderColor: "oklch(1 0 0 / 12%)",
          }}
        >
          <div className="min-w-0">
            <div className="truncate font-medium">{message.text}</div>
            <div className="mt-1 text-[11px] opacity-60">{copy.tapToCopy}</div>
          </div>
          <span className="shrink-0 rounded-full bg-black/20 p-2">
            <Copy size={14} />
          </span>
        </button>
      );
    }
    return (
      <div
        className="px-3 py-2 rounded-2xl text-sm leading-relaxed"
        style={{
          background: isMe ? "oklch(0.5 0.07 220)" : "oklch(0.22 0.03 240)",
          borderBottomRightRadius: isMe ? 4 : undefined,
          borderBottomLeftRadius: !isMe ? 4 : undefined,
        }}
      >
        {message.text}
      </div>
    );
  }

  if (message.type === "image" && message.mediaUrl) {
    return (
      <a
        href={message.mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10"
      >
        <img
          src={message.mediaUrl}
          alt={message.fileName || copy.imageAlt}
          className="max-w-full object-cover"
          style={{ maxHeight: 280 }}
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <ImageIcon size={14} className="shrink-0" />
            <span className="truncate">{message.fileName || copy.imageOpen}</span>
          </span>
          <span className="rounded-full bg-white/10 px-2 py-1">{copy.open}</span>
        </div>
      </a>
    );
  }

  if (message.type === "video" && message.mediaUrl) {
    return (
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <video
          src={message.mediaUrl}
          controls
          className="max-w-full"
          style={{ maxHeight: 280 }}
        />
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 px-3 py-2 text-xs transition hover:bg-white/10"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Video size={14} className="shrink-0" />
            <span className="truncate">{message.fileName || copy.videoOpen}</span>
          </span>
          <span className="rounded-full bg-white/10 px-2 py-1">{copy.open}</span>
        </a>
      </div>
    );
  }

  if (message.type === "file" && message.mediaUrl) {
    return (
      <a
        href={message.mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={message.fileName}
        className="flex max-w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm transition hover:bg-white/10"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileText size={18} className="shrink-0" />
          <span className="truncate">{message.fileName || copy.attachment}</span>
        </span>
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-xs">
          {copy.open}
        </span>
      </a>
    );
  }

  return null;
}
