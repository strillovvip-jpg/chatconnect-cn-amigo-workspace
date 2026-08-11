import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import NotFound from "./pages/NotFound.tsx";
import { CallProvider } from "./contexts/call-context.tsx";
import {
  CallOverlay,
  CallPiP,
  GlobalTransferNotification,
} from "./components/call-ui.tsx";
import { AnimatePresence } from "motion/react";
import { RequireRole } from "./components/role-guard.tsx";
import { useServiceWorker } from "./hooks/use-service-worker.ts";
import { GlobalNotificationProvider } from "./contexts/notification-context.tsx";
import { AppErrorBoundary } from "./components/app-error-boundary.tsx";
import { FeatureProvider } from "./contexts/feature-context.tsx";
import ChinesePortal from "./pages/ChinesePortal.tsx";
import { AmigoFaceSwapBoot } from "./lib/amigo/amigo-boot.tsx";
import { I18nProvider, useI18n } from "./lib/i18n";
import { appBuildInfo } from "./lib/build-info";

const ConsultationRoute = lazy(() => import("./pages/consultation/index.tsx"));
const ChatPage = lazy(() => import("./pages/consultation/chat.tsx"));
const AdminPage = lazy(() => import("./pages/admin/page.tsx"));
const GuestVideoCallPage = lazy(() => import("./pages/guest-video-call.tsx"));

function RouteFallback() {
  const { messages } = useI18n();
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#0d1525] text-white">
      <div className="text-sm text-white/60">{messages.app.routeFallback}</div>
    </main>
  );
}

function AuthenticatedApp({ children }: { children: React.ReactNode }) {
  return (
    <FeatureProvider>
      <AmigoFaceSwapBoot />
      <CallProvider>
        <GlobalNotificationProvider>
          {children}
          <CallOverlay />
          <GlobalTransferNotification />
          <AnimatePresence>
            <CallPiP />
          </AnimatePresence>
        </GlobalNotificationProvider>
      </CallProvider>
    </FeatureProvider>
  );
}

function BundleDiagnosticBadge() {
  if (!appBuildInfo.diagnostic) return null;
  return (
    <div className="pointer-events-none fixed bottom-[max(0.75rem,var(--app-safe-area-bottom))] right-3 z-[99999] rounded-lg bg-fuchsia-600 px-3 py-2 font-mono text-xs font-bold text-white shadow-2xl">
      BUNDLE {appBuildInfo.buildNumber} · {appBuildInfo.gitCommit}
    </div>
  );
}

export default function App() {
  useServiceWorker();
  return (
    <DefaultProviders>
      <I18nProvider>
        <AppErrorBoundary>
          <BundleDiagnosticBadge />
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
              <Route path="/" element={<ChinesePortal />} />
              <Route
                path="/video_call/:id"
                element={<GuestVideoCallPage />}
              />
              <Route
                path="/consultation"
                element={
                  <RequireRole role={["super_admin", "admin", "user"]}>
                    <AuthenticatedApp>
                      <ConsultationRoute />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/consultation/chat/:theirCode"
                element={
                  <RequireRole role={["super_admin", "admin", "user"]}>
                    <AuthenticatedApp>
                      <ChatPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/cases"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/documents"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/authorization-codes"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/online-status"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/calls"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/managers"
                element={
                  <RequireRole role="super_admin">
                    <AuthenticatedApp>
                      <AdminPage />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <RequireRole role={["super_admin", "admin"]}>
                    <AuthenticatedApp>
                      <NotFound />
                    </AuthenticatedApp>
                  </RequireRole>
                }
              />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AppErrorBoundary>
      </I18nProvider>
    </DefaultProviders>
  );
}
