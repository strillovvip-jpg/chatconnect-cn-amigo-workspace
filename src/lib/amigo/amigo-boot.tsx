import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { amigoFaceSwap } from "./face-swap.ts";

/**
 * Mounted once at app root. Initializes the Amigo Face Swap SDK at launch
 * after a successful login. FaceLatent is intentionally session-only because
 * the installed SDK exposes no supported serialization accessor. A cold app
 * start therefore stays not-ready until the user explicitly selects a photo.
 */
export function AmigoFaceSwapBoot() {
  const location = useLocation();
  const [credentials, setCredentials] = useState(() => ({
    code: localStorage.getItem("ksc_session_code") ?? "",
    deviceId: localStorage.getItem("ksc_device_id") ?? "",
  }));
  useEffect(() => {
    const sync = () =>
      setCredentials({
        code: localStorage.getItem("ksc_session_code") ?? "",
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
    window.addEventListener("chatconnect-session-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("chatconnect-session-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!credentials.code || !credentials.deviceId) return;
    if (location.pathname === "/") return;
    const timer = window.setTimeout(() => {
      void amigoFaceSwap.initialize().catch((error) => {
        console.error("[FaceSwap:boot] initialization failed", error);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [credentials.code, credentials.deviceId, location.pathname]);

  return null;
}
