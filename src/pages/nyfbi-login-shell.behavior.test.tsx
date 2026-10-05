// @vitest-environment-options { "url": "https://nyfbi.org/" }

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChinesePortal from "./ChinesePortal";

const mocks = vi.hoisted(() => ({
  claimCode: vi.fn(),
  navigate: vi.fn(),
  native: false,
  nyfbi: true,
  portalTitle: "Private Communications Access Portal",
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
  Capacitor: { isNativePlatform: () => mocks.native },
}));

vi.mock("@/lib/runtime-surface.ts", () => ({
  isNyfbiWebRuntime: () => mocks.nyfbi,
  isAichijpWebRuntime: () => false,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    preference: "system",
    setPreference: vi.fn(),
    messages: {
      app: {
        languageLabel: "Language",
        languageSystem: "Follow system",
        languageJa: "Japanese",
        languageZhHans: "Simplified Chinese",
        languageZhHant: "Traditional Chinese",
        languageEn: "English",
      },
      portal: {
        title: mocks.portalTitle,
        description: "Private service",
        restore: "Restoring secure session...",
        cardTitle: "Authorized users only",
        cardSubtitle: "Secure access • Confidential communication",
        codePlaceholder: "Authorization code",
        namePlaceholder: "Name (optional)",
        submitIdle: "Sign in",
        submitBusy: "Signing in...",
        divider: "or",
        qrButton: "Sign in with QR code",
        supportCta: "No authorization code? Tap here",
        supportTitle: "How to get an authorization code",
        supportBody: "Use a shared authorization code.",
        supportBodySecondary: "QR sign-in fills the authorization code.",
        securityLine: "Secure access • Confidential communication",
        privateServiceNotice:
          "Private service — Not affiliated with any government agency.",
        loginError: "Unable to sign in.",
        loginTimeout: "Connection timed out.",
        qrUnsupported: "QR unsupported.",
        qrNotFound: "QR not found.",
        qrReady: "Authorization code loaded.",
        qrFailed: "QR failed.",
        defaultName: "User",
      },
    },
  }),
}));

describe("nyfbi private login shell", () => {
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
    mocks.native = false;
    mocks.nyfbi = true;
    mocks.portalTitle = "Private Communications Access Portal";
    vi.clearAllMocks();
  });

  it("presents the premium USA.Filing portal while keeping authorization-code, name, and QR login available", () => {
    render(<ChinesePortal />);

    expect(
      screen.getByRole("heading", {
        name: "USA.Filing Secure Communications",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Authorized Access Portal" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Private service — Not affiliated with any government agency.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("private-service-shield")).toHaveAttribute(
      "src",
      "/icon/usa-192.png?v=3",
    );
    expect(screen.queryByText("SC")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter authorization code")).toBeVisible();
    expect(screen.getByPlaceholderText("Enter your full name")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sign in with QR code" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("combobox", { name: "language" }),
    ).not.toBeInTheDocument();
    expect(document.title).toBe("USA.Filing Secure Communications");
  });

  it("uses the same English USA.Filing shell for a native app", () => {
    mocks.nyfbi = false;
    mocks.native = true;
    mocks.portalTitle = "プライベート通信アクセス";

    render(<ChinesePortal />);

    expect(
      screen.getByRole("heading", { name: "USA.Filing Secure Communications" }),
    ).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("private-service-shield")).toHaveAttribute(
      "src",
      "/icon/usa-192.png?v=3",
    );
  });

  it("claims a native mobile app session in the standalone device slot", async () => {
    mocks.nyfbi = false;
    mocks.native = true;
    mocks.claimCode.mockResolvedValue({ name: "IGIDM user", role: "user" });

    render(<ChinesePortal />);
    fireEvent.change(screen.getByPlaceholderText("Enter authorization code"), {
      target: { value: "IGIDM" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter your full name"), {
      target: { value: "IGIDM user" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    await waitFor(() => expect(mocks.claimCode).toHaveBeenCalledTimes(1));
    expect(mocks.claimCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "IGIDM",
        deviceType: "mobile",
        deviceContext: "standalone",
        surface: "app",
      }),
    );
  });

  it("leaves non-nyfbi browser login on its existing shell", () => {
    mocks.nyfbi = false;

    const { container } = render(<ChinesePortal />);

    expect(container.querySelector(".japan-portal")).toBeTruthy();
    expect(container.querySelector(".nyfbi-login")).toBeNull();
  });
});
