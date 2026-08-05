import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function useServiceWorker() {
  const toastShown = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const showUpdateToast = () => {
      if (toastShown.current) return;
      toastShown.current = true;

      toast("发现新版本", {
        duration: Infinity,
        action: {
          label: "立即更新",
          onClick: () => window.location.reload(),
        },
      });
    };

    navigator.serviceWorker
      .register("/sw.js?v=cn-full-v1", { updateViaCache: "none" })
      .then((registration) => {
        // Check if update is already waiting
        if (registration.waiting) {
          showUpdateToast();
          return;
        }

        // Listen for new updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdateToast();
            }
          });
        });
      })
      .catch((err) => console.log("Service Worker 注册失败：", err));
  }, []);
}
