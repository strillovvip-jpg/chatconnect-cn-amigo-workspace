import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import NotFound from "./pages/NotFound.tsx";
import ConsultationRoute from "./pages/consultation/index.tsx";
import ChatPage from "./pages/consultation/chat.tsx";
import AdminPage from "./pages/admin/page.tsx";
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

export default function App() {
  useServiceWorker();
  return (
    <DefaultProviders>
      <AppErrorBoundary>
        <BrowserRouter>
          <FeatureProvider>
            <AmigoFaceSwapBoot />
            <CallProvider>
              <GlobalNotificationProvider>
                <Routes>
                  <Route path="/" element={<ChinesePortal />} />
                  <Route
                    path="/consultation"
                    element={
                      <RequireRole role={["super_admin", "admin", "user"]}>
                        <ConsultationRoute />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/consultation/chat/:theirCode"
                    element={
                      <RequireRole role={["super_admin", "admin", "user"]}>
                        <ChatPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/cases"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/documents"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/authorization-codes"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/online-status"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/calls"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/managers"
                    element={
                      <RequireRole role="super_admin">
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/*"
                    element={
                      <RequireRole role={["super_admin", "admin"]}>
                        <NotFound />
                      </RequireRole>
                    }
                  />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
                {/* Global call UI — visible across all pages */}
                <CallOverlay />
                <GlobalTransferNotification />
                <AnimatePresence>
                  <CallPiP />
                </AnimatePresence>
              </GlobalNotificationProvider>
            </CallProvider>
          </FeatureProvider>
        </BrowserRouter>
      </AppErrorBoundary>
    </DefaultProviders>
  );
}
