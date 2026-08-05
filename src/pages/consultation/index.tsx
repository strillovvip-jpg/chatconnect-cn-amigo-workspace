import { useLocation, useNavigate } from "react-router-dom";
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
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    userName?: string;
    userCode?: string;
  } | null;
  const userName =
    state?.userName ?? localStorage.getItem("ksc_session_name") ?? "访客";
  const userCode =
    state?.userCode ?? localStorage.getItem(`ksc_session_code`) ?? "";

  const handleLogout = () => {
    localStorage.removeItem("ksc_session_code");
    localStorage.removeItem("ksc_session_role");
    window.dispatchEvent(new Event("chatconnect-session-changed"));
    navigate("/");
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
          <p className="text-sm opacity-60">未找到登录会话，请重新登录。</p>
          <button
            onClick={() => navigate("/")}
            className="text-sm underline opacity-60 cursor-pointer"
          >
            返回登录页面
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
