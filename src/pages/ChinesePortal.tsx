import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  Shield,
  ShieldCheck,
  UserRound,
  Network,
} from "lucide-react";

function persistentDeviceId() {
  const key = "ksc_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    if (typeof crypto?.randomUUID === "function") id = crypto.randomUUID();
    else if (typeof crypto?.getRandomValues === "function")
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    else
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standalone ? "standalone" : "browser";
}

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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    try {
      const deviceId = persistentDeviceId();
      const result = await claimCode({
        code: code.trim().toUpperCase(),
        deviceId,
        deviceType: deviceType(),
        deviceContext: deviceContext(),
        name: name.trim(),
      });
      localStorage.setItem("ksc_session_code", code.trim().toUpperCase());
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
          : "无法登录，请重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  if (savedCode && savedDeviceId && savedSession === undefined)
    return (
      <main className="english-portal grid min-h-[100dvh] place-items-center">
        <div className="flex items-center gap-3 text-sm text-white/70">
          <LoaderCircle className="animate-spin" size={22} />
          正在恢复安全会话…
        </div>
      </main>
    );
  return (
    <main className="english-portal">
      <section className="portal-shell">
        <header>
          <div className="portal-brand">
            <Shield size={30} />
            <span>USA</span>
          </div>
          <p className="portal-kicker">安全访问 • 独立通信系统</p>
          <h1>
            安全信息
            <br />
            门户
          </h1>
          <p>专用通信网络</p>
        </header>
        <form onSubmit={submit} className="portal-card">
          <h2>
            <LockKeyhole size={15} /> 仅限授权访问
          </h2>
          <label>
            姓名
            <div className="portal-input">
              <UserRound size={19} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入姓名"
                autoComplete="name"
              />
            </div>
          </label>
          <label>
            授权码
            <div className="portal-input">
              <LockKeyhole size={19} />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="请输入授权码"
                autoComplete="one-time-code"
              />
            </div>
          </label>
          <button disabled={busy || !name.trim() || !code.trim()}>
            {busy ? "正在登录…" : "登录"}
            <ArrowRight size={20} />
          </button>
        </form>
        <div className="portal-assurance">
          <ShieldCheck size={20} />
          <div>
            <strong>安全通信门户</strong>
            <span>仅供获得授权的用户使用</span>
          </div>
        </div>
        <div className="portal-security-grid">
          <div>
            <LockKeyhole />
            <strong>
              加密
              <br />
              连接
            </strong>
            <span>安全传输保护您的通信内容。</span>
          </div>
          <div>
            <ShieldCheck />
            <strong>
              安全
              <br />
              平台
            </strong>
            <span>已启用高级访问控制。</span>
          </div>
          <div>
            <Network />
            <strong>
              仅限授权
              <br />
              用户
            </strong>
            <span>仅允许已批准的账户访问。</span>
          </div>
        </div>
        <footer>
          <LockKeyhole size={12} /> 严禁未经授权的访问
        </footer>
      </section>
    </main>
  );
}
