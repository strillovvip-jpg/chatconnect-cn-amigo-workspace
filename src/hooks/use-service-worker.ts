import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { messages, resolveLocaleFromNavigator } from "@/lib/i18n";

export function useServiceWorker() {
  const toastShown = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Native iOS bundles serve local assets. Persisted service workers and caches
    // can outlive a previous build and point the WebView at stale hashed files,
    // which presents as a black screen on launch.
    if (Capacitor.isNativePlatform()) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.allSettled(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .then(() =>
          "caches" in window
            ? caches
                .keys()
                .then((keys) =>
                  Promise.allSettled(keys.map((key) => caches.delete(key))),
                )
            : undefined,
        )
        .catch((err) =>
          console.warn("Service Worker cleanup failed:", err),
        );
      return;
    }

    const showUpdateToast = () => {
      if (toastShown.current) return;
      toastShown.current = true;
      const locale = resolveLocaleFromNavigator();
      const copy = messages[locale].serviceWorker;

      toast(copy.updateAvailable, {
        duration: Infinity,
        action: {
          label: copy.updateNow,
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
      .catch((err) => console.log("Service Worker register failed:", err));
  }, []);
}
