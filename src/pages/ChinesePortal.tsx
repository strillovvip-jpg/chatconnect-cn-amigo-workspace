import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import {
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { resolveAutoLoginSession } from "./portal-auto-login";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";
import { uiErrorMessage } from "@/lib/utils.ts";
import {
  isAichijpWebRuntime,
  isNyfbiWebRuntime,
} from "@/lib/runtime-surface.ts";

const forcedDeviceId = import.meta.env.VITE_FORCE_DEVICE_ID?.trim() || "";
const forcedDeviceContext = import.meta.env.VITE_FORCE_DEVICE_CONTEXT?.trim();
const autoLoginCode =
  import.meta.env.VITE_TEST_LOGIN_CODE?.trim().toUpperCase() || "";
const autoLoginName = import.meta.env.VITE_TEST_LOGIN_NAME?.trim() || "RAVE";

function persistentDeviceId() {
  const key = "ksc_device_id";
  if (forcedDeviceId) {
    localStorage.setItem(key, forcedDeviceId);
    return forcedDeviceId;
  }
  let id = localStorage.getItem(key);
  if (!id) {
    if (typeof crypto?.randomUUID === "function") id = crypto.randomUUID();
    else if (typeof crypto?.getRandomValues === "function") {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } else {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    localStorage.setItem(key, id);
  }
  return id;
}

function deviceType(): "mobile" | "desktop" {
  if (Capacitor.isNativePlatform()) return "mobile";
  const mobile = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
  const iPad =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return mobile || iPad ? "mobile" : "desktop";
}

function deviceContext(): "browser" | "standalone" {
  if (Capacitor.isNativePlatform()) return "standalone";
  if (
    forcedDeviceContext === "browser" ||
    forcedDeviceContext === "standalone"
  ) {
    return forcedDeviceContext;
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standalone ? "standalone" : "browser";
}

function extractCodeFromQr(rawValue: string) {
  const trimmed = rawValue.trim();
  try {
    const url = new URL(trimmed);
    const code =
      url.searchParams.get("code") ??
      url.pathname.split("/").filter(Boolean).at(-1) ??
      trimmed;
    return code.trim();
  } catch {
    return trimmed;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("LOGIN_TIMEOUT"));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function safePostLoginPath() {
  const candidate = new URLSearchParams(window.location.search).get("next");
  return candidate && /^\/video_call\/[A-Za-z0-9-]+$/.test(candidate)
    ? candidate
    : null;
}

type QRCodeResult = { rawValue?: string };

type BarcodeDetectorInstance = {
  detect(source: ImageBitmap): Promise<QRCodeResult[]>;
};

type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorInstance;

export default function ChinesePortal() {
  const { messages } = useI18n();
  const copy = messages.portal;
  const useAichijpLoginShell =
    isAichijpWebRuntime() && !Capacitor.isNativePlatform();
  const usePrivateLoginShell =
    isNyfbiWebRuntime() || Capacitor.isNativePlatform();
  const authSurface = Capacitor.isNativePlatform()
    ? ("app" as const)
    : useAichijpLoginShell
      ? ("aichijp" as const)
      : isNyfbiWebRuntime()
        ? ("nyfbi" as const)
        : undefined;
  const postLoginPath = safePostLoginPath();
  const forceReauth =
    new URLSearchParams(window.location.search).get("reauth") === "1";
  if (forceReauth) {
    localStorage.removeItem("ksc_session_code");
    localStorage.removeItem("ksc_session_name");
    localStorage.removeItem("ksc_session_role");
  }

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreExpired, setRestoreExpired] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [qrMessage, setQrMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const autoLoginAttemptedRef = useRef(false);

  const claimCode = useMutation(api.authCodes.claimCode);
  const navigate = useNavigate();
  const savedCode = localStorage.getItem("ksc_session_code") ?? "";
  const savedDeviceId = localStorage.getItem("ksc_device_id") ?? "";
  const savedSession = useQuery(
    api.authCodes.getSessionRole,
    savedCode && savedDeviceId
      ? {
          code: savedCode,
          deviceId: savedDeviceId,
          ...(authSurface ? { surface: authSurface } : {}),
        }
      : "skip",
  );

  useEffect(() => {
    if (!savedSession) return;
    localStorage.setItem("ksc_session_code", savedSession.code);
    localStorage.setItem("ksc_session_name", savedSession.name);
    localStorage.setItem("ksc_session_role", savedSession.role);
    window.dispatchEvent(new Event("chatconnect-session-changed"));
    navigate(
      postLoginPath ??
        (savedSession.role === "admin" || savedSession.role === "super_admin"
          ? "/admin"
          : "/consultation"),
      { replace: true },
    );
  }, [navigate, postLoginPath, savedSession]);

  useEffect(() => {
    if (!savedCode || !savedDeviceId || savedSession !== null) return;
    localStorage.removeItem("ksc_session_code");
    localStorage.removeItem("ksc_session_name");
    localStorage.removeItem("ksc_session_role");
  }, [savedCode, savedDeviceId, savedSession]);

  useEffect(() => {
    if (!savedCode || !savedDeviceId || savedSession !== undefined) {
      setRestoreExpired(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRestoreExpired(true);
      localStorage.removeItem("ksc_session_code");
      localStorage.removeItem("ksc_session_name");
      localStorage.removeItem("ksc_session_role");
      window.dispatchEvent(new Event("chatconnect-session-changed"));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [savedCode, savedDeviceId, savedSession]);

  useEffect(() => {
    document.title = useAichijpLoginShell
      ? "ご利用者ログイン｜愛知県向け届出・申請サポート"
      : copy.title;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute(
      "content",
      useAichijpLoginShell
        ? "発行済みの認証コードをお持ちの方専用のオンライン入口です。"
        : copy.description,
    );
  }, [copy.description, copy.title, useAichijpLoginShell]);

  const loginWithCode = useCallback(
    async (loginCode: string, loginName: string) => {
      if (!loginCode.trim()) return;
      setBusy(true);
      setQrMessage("");
      try {
        const deviceId = persistentDeviceId();
        const result = await withTimeout(
          claimCode({
            code: loginCode.trim().toUpperCase(),
            deviceId,
            deviceType: deviceType(),
            deviceContext: deviceContext(),
            ...(authSurface ? { surface: authSurface } : {}),
            name: loginName.trim() || copy.defaultName,
          }),
          12000,
        );
        localStorage.setItem(
          "ksc_session_code",
          loginCode.trim().toUpperCase(),
        );
        localStorage.setItem("ksc_session_name", result.name);
        localStorage.setItem("ksc_session_role", result.role);
        navigate(
          postLoginPath ??
            (result.role === "admin" || result.role === "super_admin"
              ? "/admin"
              : "/consultation"),
          { replace: true },
        );
      } catch (error) {
        window.alert(
          error instanceof Error && error.message === "LOGIN_TIMEOUT"
            ? copy.loginTimeout
            : uiErrorMessage(error, copy.loginError),
        );
      } finally {
        setBusy(false);
      }
    },
    [
      authSurface,
      claimCode,
      copy.defaultName,
      copy.loginError,
      copy.loginTimeout,
      navigate,
      postLoginPath,
    ],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (useAichijpLoginShell && !name.trim()) return;
    await loginWithCode(code, name);
  };

  useEffect(() => {
    const autoLoginSession = resolveAutoLoginSession({
      isDev: import.meta.env.DEV,
      code: autoLoginCode,
      name: autoLoginName,
      savedCode,
      hasSavedSession: Boolean(savedSession),
    });
    if (!autoLoginSession || autoLoginAttemptedRef.current) return;
    autoLoginAttemptedRef.current = true;
    setCode(autoLoginSession.code);
    setName(autoLoginSession.name);
    void loginWithCode(autoLoginSession.code, autoLoginSession.name);
  }, [loginWithCode, savedCode, savedSession]);

  const handleQrButton = () => {
    setHelpOpen(false);
    const Detector = (
      window as { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;
    if (!Detector) {
      setQrMessage(copy.qrUnsupported);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleQrFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const Detector = (
        window as { BarcodeDetector?: BarcodeDetectorConstructor }
      ).BarcodeDetector;
      if (!Detector) {
        setQrMessage(copy.qrUnsupported);
        return;
      }
      const detector = new Detector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const [result] = await detector.detect(bitmap);
      bitmap.close();
      const rawValue = result?.rawValue
        ? extractCodeFromQr(result.rawValue)
        : "";
      if (!rawValue) {
        setQrMessage(copy.qrNotFound);
        return;
      }
      setCode(rawValue.toUpperCase());
      setQrMessage(copy.qrReady);
      codeInputRef.current?.focus();
    } catch {
      setQrMessage(copy.qrFailed);
    }
  };

  if (
    savedCode &&
    savedDeviceId &&
    savedSession === undefined &&
    !restoreExpired
  ) {
    return (
      <main
        className={
          useAichijpLoginShell
            ? "aichijp-login aichijp-login--restore"
            : usePrivateLoginShell
              ? "nyfbi-login nyfbi-login--restore"
              : "japan-portal japan-portal--restore"
        }
      >
        <div
          className={
            useAichijpLoginShell
              ? "aichijp-login__loader"
              : usePrivateLoginShell
                ? "nyfbi-login__loader"
                : "japan-loader"
          }
        >
          <LoaderCircle className="animate-spin" size={24} />
          {copy.restore}
        </div>
      </main>
    );
  }

  if (useAichijpLoginShell) {
    return (
      <main className="aichijp-login">
        <div className="aichijp-login__background" aria-hidden="true" />

        <header className="aichijp-login__site-header">
          <div className="aichijp-login__brand" aria-label="トップページ">
            <span className="aichijp-login__brand-mark" aria-hidden="true" />
            <span className="aichijp-login__brand-copy">
              <strong>愛知県向け届出・申請サポート</strong>
              <small>届出・申請サポート入口</small>
            </span>
          </div>
          <span className="aichijp-login__domain">aichijp.com</span>
        </header>

        <div className="aichijp-login__main">
          <div className="aichijp-login__main-inner">
            <section
              className="aichijp-login__hero-copy"
              aria-label="サービス案内"
            >
              <p className="aichijp-login__hero-kicker">
                愛知県向けオンライン受付
              </p>
              <h1>
                届出・申請を、
                <br />
                より分かりやすく。
              </h1>
              <p className="aichijp-login__hero-description">
                発行済みの認証コードをお持ちの方専用のオンライン入口です。
              </p>
            </section>

            <form
              onSubmit={submit}
              className="aichijp-login__card"
              aria-labelledby="aichijp-login-title"
            >
              <p className="aichijp-login__card-kicker">専用認証入口</p>
              <h2 id="aichijp-login-title">ご利用者ログイン</h2>
              <p className="aichijp-login__intro">
                発行された認証コードとお名前を入力してください。
              </p>

              <div className="aichijp-login__field">
                <label htmlFor="aichijp-code">
                  <span>認証コード</span>
                  <span className="aichijp-login__required">必須</span>
                </label>
                <input
                  id="aichijp-code"
                  ref={codeInputRef}
                  value={code}
                  onChange={(event) =>
                    setCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  placeholder="英字5文字"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  required
                />
              </div>

              <div className="aichijp-login__field">
                <label htmlFor="aichijp-name">
                  <span>氏名</span>
                  <span className="aichijp-login__required">必須</span>
                </label>
                <input
                  id="aichijp-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="お名前を入力"
                  autoComplete="name"
                  required
                />
              </div>

              <button
                className="aichijp-login__primary"
                disabled={busy || !code.trim() || !name.trim()}
              >
                {busy ? "認証中…" : "認証して進む"}
              </button>
            </form>
          </div>
        </div>

        <footer className="aichijp-login__footer">
          <span>© 2026 aichijp.com</span>
          <span>民間運営のご利用者専用オンライン入口</span>
        </footer>
      </main>
    );
  }

  if (usePrivateLoginShell) {
    return (
      <main className="nyfbi-login">
        <section className="nyfbi-login__shell">
          <header className="nyfbi-login__hero">
            <div className="nyfbi-login__hero-art" aria-hidden="true" />
          </header>

          <div className="nyfbi-login__form-column">
            <form
              onSubmit={submit}
              className="nyfbi-login__card"
              aria-label={copy.title}
            >
              <div className="nyfbi-login__utility">
                <LanguageSelector />
              </div>
              <header className="nyfbi-login__header">
                <div
                  className="nyfbi-login__shield"
                  data-testid="private-service-shield"
                >
                  <ShieldCheck aria-hidden="true" size={28} strokeWidth={1.8} />
                </div>
                <p className="nyfbi-login__eyebrow">{copy.securityLine}</p>
                <h1>{copy.title}</h1>
              </header>

              <div className="nyfbi-login__form-heading">
                <h2>{copy.cardTitle}</h2>
                <p>{copy.cardSubtitle}</p>
              </div>

              <label
                className="nyfbi-login__input"
                aria-label={copy.codePlaceholder}
              >
                <LockKeyhole size={20} />
                <input
                  ref={codeInputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={copy.codePlaceholder}
                  autoComplete="one-time-code"
                />
              </label>

              <label
                className="nyfbi-login__input"
                aria-label={copy.namePlaceholder}
              >
                <UserRound size={20} />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={copy.namePlaceholder}
                  autoComplete="name"
                />
              </label>

              <button
                className="nyfbi-login__primary"
                disabled={busy || !code.trim()}
              >
                {busy ? copy.submitBusy : copy.submitIdle}
              </button>

              <div className="nyfbi-login__divider">
                <span />
                <small>{copy.divider}</small>
                <span />
              </div>

              <button
                type="button"
                className="nyfbi-login__secondary"
                onClick={handleQrButton}
              >
                <QrCode size={20} />
                {copy.qrButton}
              </button>

              <button
                type="button"
                className="nyfbi-login__help-toggle"
                onClick={() => setHelpOpen((current) => !current)}
              >
                <span>
                  <CircleHelp size={18} />
                  {copy.supportCta}
                </span>
                <ChevronRight
                  size={18}
                  className={helpOpen ? "rotate-90" : ""}
                />
              </button>

              {helpOpen ? (
                <div className="nyfbi-login__help-panel">
                  <strong>{copy.supportTitle}</strong>
                  <p>{copy.supportBody}</p>
                  <p>{copy.supportBodySecondary}</p>
                </div>
              ) : null}

              {qrMessage ? (
                <p className="nyfbi-login__inline-message">{qrMessage}</p>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleQrFile}
              />
            </form>

            <footer className="nyfbi-login__footer">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{copy.privateServiceNotice}</span>
            </footer>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="japan-portal">
      <section className="japan-shell">
        <header className="japan-hero">
          <div className="japan-hero__art" aria-hidden="true" />
        </header>

        <form onSubmit={submit} className="japan-card">
          <div className="mb-4 flex justify-end">
            <LanguageSelector />
          </div>
          <div className="japan-card__header">
            <h1>{copy.cardTitle}</h1>
            <p>{copy.cardSubtitle}</p>
          </div>

          <label className="japan-input" aria-label={copy.codePlaceholder}>
            <LockKeyhole size={20} />
            <input
              ref={codeInputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={copy.codePlaceholder}
              autoComplete="one-time-code"
            />
          </label>

          <label className="japan-input" aria-label={copy.namePlaceholder}>
            <UserRound size={20} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              autoComplete="name"
            />
          </label>

          <button
            className="japan-card__primary"
            disabled={busy || !code.trim()}
          >
            {busy ? copy.submitBusy : copy.submitIdle}
          </button>

          <div className="japan-divider">
            <span />
            <small>{copy.divider}</small>
            <span />
          </div>

          <button
            type="button"
            className="japan-card__secondary"
            onClick={handleQrButton}
          >
            <QrCode size={20} />
            {copy.qrButton}
          </button>

          <button
            type="button"
            className="japan-help-toggle"
            onClick={() => setHelpOpen((current) => !current)}
          >
            <span>
              <CircleHelp size={18} />
              {copy.supportCta}
            </span>
            <ChevronRight size={18} className={helpOpen ? "rotate-90" : ""} />
          </button>

          {helpOpen ? (
            <div className="japan-help-panel">
              <strong>{copy.supportTitle}</strong>
              <p>{copy.supportBody}</p>
              <p>{copy.supportBodySecondary}</p>
            </div>
          ) : null}

          {qrMessage ? (
            <p className="japan-inline-message">{qrMessage}</p>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleQrFile}
          />
        </form>

        <footer className="japan-footer">
          <ShieldCheck size={16} />
          <span>{copy.securityLine}</span>
        </footer>
      </section>
    </main>
  );
}
