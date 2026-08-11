import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { logoutToLogin } from "@/lib/session-storage";
import ConsultationPage from "./page.tsx";

function getDeviceId(): string {
  const key = "ksc_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export default function ConsultationRoute() {
  const { messages } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    userName?: string;
    userCode?: string;
  } | null;
  const userName =
    state?.userName ??
    localStorage.getItem("ksc_session_name") ??
    messages.consultation.guestName;
  const userCode =
    state?.userCode ?? localStorage.getItem(`ksc_session_code`) ?? "";

  const handleLogout = () => {
    logoutToLogin();
  };

  if (!userCode) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "oklch(0.11 0.03 240)",
          color: "oklch(0.92 0.01 240)",
        }}
      >
        <div className="text-center space-y-3">
          <p className="text-sm opacity-60">
            {messages.consultation.sessionMissing}
          </p>
          <button
            onClick={() => navigate("/")}
            className="text-sm underline opacity-60 cursor-pointer"
          >
            {messages.consultation.backToLogin}
          </button>
        </div>
      </div>
    );
  }

  return (
    <ConsultationPage
      userName={userName}
      userCode={userCode}
      onLogout={handleLogout}
    />
  );
}
