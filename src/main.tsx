import '@vly-ai/integrations';
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShellWithProvider } from "@/components/app-shell";
import { VoiceSessionProvider } from "@/components/voice-session";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Setup = lazy(() => import("./pages/Setup.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Attention = lazy(() => import("./pages/Attention.tsx"));
const Talk = lazy(() => import("./pages/Talk.tsx"));
const Ask = lazy(() => import("./pages/Ask.tsx"));
const Knowledge = lazy(() => import("./pages/Knowledge.tsx"));
const KnowledgeDetail = lazy(() => import("./pages/KnowledgeDetail.tsx"));
const ArchiveDetail = lazy(() => import("./pages/ArchiveDetail.tsx"));
const Intelligence = lazy(() => import("./pages/Intelligence.tsx"));
const BusinessBrain = lazy(() => import("./pages/BusinessBrain.tsx"));
const Recommendations = lazy(() => import("./pages/Recommendations.tsx"));
const Connections = lazy(() => import("./pages/Connections.tsx"));
const Actions = lazy(() => import("./pages/Actions.tsx"));
const Events = lazy(() => import("./pages/Events.tsx"));
const Workflows = lazy(() => import("./pages/Workflows.tsx"));
const WorkflowDetail = lazy(() => import("./pages/WorkflowDetail.tsx"));
const RevenueRecovery = lazy(() => import("./pages/RevenueRecovery.tsx"));
const ClaimDetail = lazy(() => import("./pages/ClaimDetail.tsx"));
const Team = lazy(() => import("./pages/Team.tsx"));
const Audit = lazy(() => import("./pages/Audit.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const UsersAccess = lazy(() => import("./pages/UsersAccess.tsx"));
const AccessDenied = lazy(() => import("./pages/AccessDenied.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));

/** Protected section: auth gate + workspace shell. */
function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShellWithProvider>{children}</AppShellWithProvider>
    </RequireAuth>
  );
}

// Loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="flex size-10 items-center justify-center rounded-xl bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
        <div className="size-5 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </div>
      <p className="text-xs text-muted-foreground">Loading…</p>
    </div>
  );
}

/** Error boundary for VlyToolbar */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Root error boundary — shows useful diagnostics instead of blank screen */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Atlas] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-rose-400/15 text-rose-600 ring-1 ring-rose-400/30">
              <span className="text-lg">!</span>
            </div>
            <p className="text-sm font-semibold">Atlas encountered an issue</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            <p className="mt-3 text-[11px] text-muted-foreground/70">
              Nothing was sent or changed. You can try refreshing the page.
            </p>
            {this.state.stack && (
              <pre className="mt-4 text-left text-[10px] leading-4 text-muted-foreground/60 max-h-32 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-3">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="atlas-theme">
        <VoiceSessionProvider>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/setup"
                element={
                  <RequireAuth>
                    <Setup />
                  </RequireAuth>
                }
              />

              {/* ---- Primary Atlas routes ---- */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedLayout>
                    <Dashboard />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/attention"
                element={
                  <ProtectedLayout>
                    <Attention />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/talk"
                element={
                  <ProtectedLayout>
                    <Talk />
                  </ProtectedLayout>
                }
              />

              {/* ---- Legacy Ask Atlas route (redirects to Talk) ---- */}
              <Route
                path="/dashboard/ask"
                element={
                  <ProtectedLayout>
                    <Talk />
                  </ProtectedLayout>
                }
              />

              {/* ---- Knowledge & Intelligence ---- */}
              <Route
                path="/dashboard/knowledge"
                element={
                  <ProtectedLayout>
                    <Knowledge />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/knowledge/archives/:id"
                element={
                  <ProtectedLayout>
                    <ArchiveDetail />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/knowledge/:id"
                element={
                  <ProtectedLayout>
                    <KnowledgeDetail />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/intelligence"
                element={
                  <ProtectedLayout>
                    <Intelligence />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/brain"
                element={
                  <ProtectedLayout>
                    <BusinessBrain />
                  </ProtectedLayout>
                }
              />

              {/* ---- Work ---- */}
              <Route
                path="/dashboard/recommendations"
                element={
                  <ProtectedLayout>
                    <Recommendations />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/actions"
                element={
                  <ProtectedLayout>
                    <Actions />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/events"
                element={
                  <ProtectedLayout>
                    <Events />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/workflows"
                element={
                  <ProtectedLayout>
                    <Workflows />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/workflows/:id"
                element={
                  <ProtectedLayout>
                    <WorkflowDetail />
                  </ProtectedLayout>
                }
              />

              {/* ---- Revenue Recovery ---- */}
              <Route
                path="/dashboard/revenue-recovery"
                element={
                  <ProtectedLayout>
                    <RevenueRecovery />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/revenue-recovery/:id"
                element={
                  <ProtectedLayout>
                    <ClaimDetail />
                  </ProtectedLayout>
                }
              />

              {/* ---- Administration ---- */}
              <Route
                path="/dashboard/connections"
                element={
                  <ProtectedLayout>
                    <Connections />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/team"
                element={
                  <ProtectedLayout>
                    <Team />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/settings"
                element={
                  <ProtectedLayout>
                    <Settings />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/audit"
                element={
                  <ProtectedLayout>
                    <Audit />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/dashboard/users"
                element={
                  <ProtectedLayout>
                    <UsersAccess />
                  </ProtectedLayout>
                }
              />

              {/* ---- Other ---- */}
              <Route path="/access-denied" element={<AccessDenied />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
        </VoiceSessionProvider>
      </ThemeProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
