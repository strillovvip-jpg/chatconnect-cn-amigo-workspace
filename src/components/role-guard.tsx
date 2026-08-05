import { useQuery } from "convex/react";
import { Navigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";

export function Forbidden() {
  return (
    <main className="min-h-screen grid place-items-center bg-[#0d1525] text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold">无法访问此页面</h1>
        <p className="mt-3 opacity-60">您没有查看此页面的权限。</p>
      </div>
    </main>
  );
}

type Role = "super_admin" | "admin" | "user";
export function RequireRole({
  role,
  children,
}: {
  role: Role | Role[];
  children: React.ReactNode;
}) {
  const code = localStorage.getItem("ksc_session_code") ?? "";
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const session = useQuery(
    api.authCodes.getSessionRole,
    code && deviceId ? { code, deviceId } : "skip",
  );
  if (!code || !deviceId) return <Navigate to="/" replace />;
  if (session === undefined)
    return (
      <main className="min-h-screen grid place-items-center bg-[#0d1525] text-white">
        正在验证权限...
      </main>
    );
  const allowed = Array.isArray(role)
    ? role.includes(session?.role ?? "user")
    : session?.role === role;
  if (!session || !allowed) return <Forbidden />;
  return <>{children}</>;
}
