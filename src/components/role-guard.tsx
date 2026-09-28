import { useEffect } from "react";
import { useQuery } from "convex/react";
import { Navigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { useI18n } from "@/lib/i18n";
import { clearPersistedSession } from "@/lib/session-storage";
import { Capacitor } from "@capacitor/core";
import { isAichijpWebRuntime, isNyfbiWebRuntime } from "@/lib/runtime-surface";

export function Forbidden() {
  const { messages } = useI18n();
  return (
    <main className="min-h-screen grid place-items-center bg-[#0d1525] text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          {messages.roleGuard.forbiddenTitle}
        </h1>
        <p className="mt-3 opacity-60">{messages.roleGuard.forbiddenBody}</p>
      </div>
    </main>
  );
}

type Role = "super_admin" | "admin" | "user";

function InvalidSessionRedirect() {
  useEffect(() => {
    clearPersistedSession();
    window.dispatchEvent(new Event("chatconnect-session-changed"));
  }, []);

  return <Navigate to="/?reauth=1" replace />;
}

export function RequireRole({
  role,
  children,
}: {
  role: Role | Role[];
  children: React.ReactNode;
}) {
  const { messages } = useI18n();
  const code = localStorage.getItem("ksc_session_code") ?? "";
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const surface = Capacitor.isNativePlatform()
    ? ("app" as const)
    : isAichijpWebRuntime()
      ? ("aichijp" as const)
      : isNyfbiWebRuntime()
        ? ("nyfbi" as const)
        : undefined;
  const session = useQuery(
    api.authCodes.getSessionRole,
    code && deviceId
      ? { code, deviceId, ...(surface ? { surface } : {}) }
      : "skip",
  );
  if (!code || !deviceId) return <Navigate to="/" replace />;
  if (session === undefined)
    return (
      <main className="min-h-screen grid place-items-center bg-[#0d1525] text-white">
        {messages.roleGuard.verifying}
      </main>
    );
  const allowed = Array.isArray(role)
    ? role.includes(session?.role ?? "user")
    : session?.role === role;
  if (!session) return <InvalidSessionRedirect />;
  if (!allowed) return <Forbidden />;
  return <>{children}</>;
}
