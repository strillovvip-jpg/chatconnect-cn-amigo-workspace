// @vitest-environment-options { "url": "https://aichijp.com/" }

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChinesePortal from "./ChinesePortal";

const mocks = vi.hoisted(() => ({
  claimCode: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.claimCode,
  useQuery: () => undefined,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    authCodes: { claimCode: "claimCode", getSessionRole: "getSessionRole" },
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock("@/lib/runtime-surface.ts", () => ({
  isNyfbiWebRuntime: () => false,
  isAichijpWebRuntime: () => true,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "ja",
    preference: "system",
    setPreference: vi.fn(),
    messages: {
      app: {
        languageLabel: "言語",
        languageSystem: "システム設定に従う",
        languageJa: "日本語",
        languageZhHans: "简体中文",
        languageZhHant: "繁體中文",
        languageEn: "English",
      },
      portal: {
        title: "頌進 | セキュア通信ポータル",
        description: "民間サービス",
        restore: "セッションを復元しています…",
        cardTitle: "ご利用を開始する",
        cardSubtitle: "認証コードを入力してください",
        codePlaceholder: "認証コード",
        namePlaceholder: "お名前（任意）",
        submitIdle: "ログイン",
        submitBusy: "ログイン中…",
        divider: "または",
        qrButton: "QRコードでログイン",
        supportCta: "認証コードをお持ちでない方",
        supportTitle: "認証コードについて",
        supportBody: "発行済みの認証コードをご利用ください。",
        supportBodySecondary: "QRコードからも読み取れます。",
        securityLine: "安全なアクセス",
        privateServiceNotice: "民間サービス — 政府機関とは関係ありません。",
        loginError: "ログインできませんでした。",
        loginTimeout: "接続がタイムアウトしました。",
        qrUnsupported: "QRコードを利用できません。",
        qrNotFound: "QRコードが見つかりません。",
        qrReady: "認証コードを読み取りました。",
        qrFailed: "QRコードを読み取れませんでした。",
        defaultName: "利用者",
      },
    },
  }),
}));

describe("aichijp dedicated login shell", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    mocks.claimCode.mockResolvedValue({ name: "山田 太郎", role: "user" });
    vi.clearAllMocks();
  });

  it("matches the approved Japanese red-and-white entrance and preserves real code login", async () => {
    const { container } = render(<ChinesePortal />);

    expect(container.querySelector(".aichijp-login")).toBeTruthy();
    expect(screen.getByText("愛知県向け届出・申請サポート")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "届出・申請を、より分かりやすく。" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "ご利用者ログイン" }),
    ).toBeVisible();

    const codeInput = screen.getByPlaceholderText("英字5文字");
    const nameInput = screen.getByPlaceholderText("お名前を入力");
    const submit = screen.getByRole("button", { name: "認証して進む" });

    expect(codeInput).toHaveAttribute("placeholder", "英字5文字");
    expect(nameInput).toHaveAttribute("placeholder", "お名前を入力");
    expect(submit).toBeDisabled();

    fireEvent.change(codeInput, { target: { value: "IGIDM" } });
    expect(submit).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "山田 太郎" } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(() => expect(mocks.claimCode).toHaveBeenCalledTimes(1));
    expect(mocks.claimCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "IGIDM",
        name: "山田 太郎",
        deviceType: "desktop",
        deviceContext: "browser",
      }),
    );
  });
});
