import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { useNavigate } from "react-router-dom";
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

const copy = {
  htmlLang: "ja",
  title: "頌進 | セキュア通信ポータル",
  description: "認証済み利用者向けの専用通信アプリ",
  restore: "セキュアセッションを復元中…",
  cardTitle: "ご利用を開始する",
  cardSubtitle: "認証コードを入力してください",
  codePlaceholder: "認証コード",
  namePlaceholder: "お名前（任意）",
  submitIdle: "ログイン",
  submitBusy: "ログイン中…",
  divider: "または",
  qrButton: "QRコードでログイン",
  supportCta: "認証コードをお持ちでない方はこちら",
  supportTitle: "認証コードの受け取り方法",
  supportBody:
    "発行担当者から共有された認証コード、または案内メール内のQRコードをご利用ください。",
  supportBodySecondary:
    "QRログインでは、端末内のQR画像を読み取り認証コード欄へ自動入力します。",
  securityLine: "安全な通信環境で保護されています",
  loginError: "ログインできません。もう一度お試しください。",
  loginTimeout:
    "接続に時間がかかっています。通信環境を確認して、もう一度お試しください。",
  qrUnsupported:
    "この端末ではQRコードの自動読み取りを利用できません。認証コードを手入力してください。",
  qrNotFound: "QRコードを認識できませんでした。もう一度お試しください。",
  qrReady: "QRコードから認証コードを読み取りました。",
  qrFailed: "QRログインの準備に失敗しました。認証コードを手入力してください。",
  defaultName: "ご利用者様",
} as const;

const forcedDeviceId = import.meta.env.VITE_FORCE_DEVICE_ID?.trim() || "";
const forcedDeviceContext = import.meta.env.VITE_FORCE_DEVICE_CONTEXT?.trim();
const autoLoginCode = import.meta.env.VITE_TEST_LOGIN_CODE?.trim().toUpperCase() || "";
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
  const mobile = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
  const iPad =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return mobile || iPad ? "mobile" : "desktop";
}

function deviceContext(): "browser" | "standalone" {
  if (forcedDeviceContext === "browser" || forcedDeviceContext === "standalone") {
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
      url.pathname
        .split("/")
        .filter(Boolean)
        .at(-1) ??
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

type QRCodeResult = { rawValue?: string };

type BarcodeDetectorInstance = {
  detect(source: ImageBitmap): Promise<QRCodeResult[]>;
};

type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorInstance;

export default function ChinesePortal() {
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
      ? { code: savedCode, deviceId: savedDeviceId }
      : "skip",
  );

  useEffect(() => {
    if (!savedSession) return;
    localStorage.setItem("ksc_session_code", savedSession.code);
    localStorage.setItem("ksc_session_name", savedSession.name);
    localStorage.setItem("ksc_session_role", savedSession.role);
    window.dispatchEvent(new Event("chatconnect-session-changed"));
    navigate(
      savedSession.role === "admin" || savedSession.role === "super_admin"
        ? "/admin"
        : "/consultation",
      { replace: true },
    );
  }, [navigate, savedSession]);

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
    document.documentElement.lang = copy.htmlLang;
    document.title = copy.title;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", copy.description);
  }, []);

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
            name: loginName.trim() || copy.defaultName,
          }),
          12000,
        );
        localStorage.setItem("ksc_session_code", loginCode.trim().toUpperCase());
        localStorage.setItem("ksc_session_name", result.name);
        localStorage.setItem("ksc_session_role", result.role);
        navigate(
          result.role === "admin" || result.role === "super_admin"
            ? "/admin"
            : "/consultation",
          { replace: true },
        );
      } catch (error) {
        window.alert(
          error instanceof ConvexError
            ? (error.data as { message: string }).message
            : error instanceof Error && error.message === "LOGIN_TIMEOUT"
              ? copy.loginTimeout
              : copy.loginError,
        );
      } finally {
        setBusy(false);
      }
    },
    [claimCode, navigate],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
    const Detector = (window as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
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
      const Detector = (window as { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;
      if (!Detector) {
        setQrMessage(copy.qrUnsupported);
        return;
      }
      const detector = new Detector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const [result] = await detector.detect(bitmap);
      bitmap.close();
      const rawValue = result?.rawValue ? extractCodeFromQr(result.rawValue) : "";
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

  if (savedCode && savedDeviceId && savedSession === undefined && !restoreExpired) {
    return (
      <main className="japan-portal japan-portal--restore">
        <div className="japan-loader">
          <LoaderCircle className="animate-spin" size={24} />
          {copy.restore}
        </div>
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
          <div className="japan-card__header">
            <h1>{copy.cardTitle}</h1>
            <p>{copy.cardSubtitle}</p>
          </div>

          <label className="japan-input" aria-label="認証コード">
            <LockKeyhole size={20} />
            <input
              ref={codeInputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={copy.codePlaceholder}
              autoComplete="one-time-code"
            />
          </label>

          <label className="japan-input" aria-label="お名前（任意）">
            <UserRound size={20} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              autoComplete="name"
            />
          </label>

          <button className="japan-card__primary" disabled={busy || !code.trim()}>
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

          {qrMessage ? <p className="japan-inline-message">{qrMessage}</p> : null}

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
