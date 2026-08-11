import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { messages, resolveLocaleFromNavigator } from "./lib/i18n";

function renderFatal(message: string) {
  const locale = resolveLocaleFromNavigator();
  const copy = messages[locale].app;
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <main style="min-height:100dvh;display:grid;place-items:center;background:#0d1525;color:#fff;padding:24px;font-family:system-ui,sans-serif;">
      <div style="max-width:560px;text-align:center;">
        <h1 style="font-size:20px;font-weight:700;margin:0 0 12px;">${copy.fatalTitle}</h1>
        <p style="margin:0 0 16px;color:rgba(255,255,255,.68);font-size:14px;line-height:1.6;">${copy.fatalBody}</p>
        <pre style="margin:0;padding:16px;border-radius:14px;background:rgba(0,0,0,.28);text-align:left;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#fecaca;">${message.replace(/</g, "&lt;")}</pre>
      </div>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  const message = event.error?.message || event.message || "Unknown error";
  console.error("ChatConnect fatal error", event.error || event.message);
  renderFatal(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : JSON.stringify(reason) || messages[resolveLocaleFromNavigator()].app.genericError;
  console.error("ChatConnect unhandled rejection", reason);
  renderFatal(message || "Unhandled promise rejection");
});

try {
  createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("ChatConnect bootstrap error", error);
  renderFatal(message);
}
