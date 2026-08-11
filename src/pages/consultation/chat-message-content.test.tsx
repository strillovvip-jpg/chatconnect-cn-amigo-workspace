import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  ChatMessageContent,
  isAuthorizationCodeLikeText,
} from "./chat-message-content";

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("isAuthorizationCodeLikeText", () => {
  it("detects raw code text", () => {
    expect(isAuthorizationCodeLikeText("QQAUF")).toBe(true);
  });

  it("detects authorization code labels", () => {
    expect(isAuthorizationCodeLikeText("Authorization code")).toBe(true);
    expect(isAuthorizationCodeLikeText("認証コード")).toBe(true);
  });

  it("ignores normal chat text", () => {
    expect(isAuthorizationCodeLikeText("hello there")).toBe(false);
  });
});

describe("ChatMessageContent", () => {
  it("renders auth-like text as a button", () => {
    const onCopyCode = vi.fn();
    renderWithI18n(
      <ChatMessageContent
        message={{ type: "text", text: "QQAUF" }}
        isMe={true}
        onCopyCode={onCopyCode}
      />,
    );
    screen.getByRole("button", { name: /QQAUF/i }).click();
    expect(onCopyCode).toHaveBeenCalledWith("QQAUF");
  });

  it("renders file messages as a link", () => {
    renderWithI18n(
      <ChatMessageContent
        message={{
          type: "file",
          mediaUrl: "https://example.com/file.pdf",
          fileName: "file.pdf",
        }}
        isMe={false}
      />,
    );
    expect(screen.getByRole("link", { name: /file.pdf/i })).toHaveAttribute(
      "href",
      "https://example.com/file.pdf",
    );
  });
});
