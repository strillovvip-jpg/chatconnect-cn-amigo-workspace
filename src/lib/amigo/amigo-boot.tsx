import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { amigoFaceSwap } from "./face-swap.ts";

/**
 * Mounted once at app root. Initializes the Amigo Face Swap SDK at launch
 * and, after a successful login, enrolls the most recent face-library photo
 * so the AI video source has a target FaceLatent.
 */
export function AmigoFaceSwapBoot() {
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
    void amigoFaceSwap.initialize();
  }, []);

  const faces = useQuery(
    api.faceLibrary.listMine,
    credentials.code && credentials.deviceId ? credentials : "skip",
  );

  useEffect(() => {
    if (!amigoFaceSwap.isInitialized) return;
    if (!faces || faces.length === 0) return;
    const latest = faces[0];
    if (!latest.imageUrl) return;
    void amigoFaceSwap.enrollFace(latest.imageUrl);
  }, [faces]);

  return null;
}
