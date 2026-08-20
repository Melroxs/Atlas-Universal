import '@vly-ai/integrations';
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/app-shell";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ClerkProvider } from "@clerk/clerk-react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Clerk publishable key — public by design (ships in browser bundle).
// Checks CLERK_PUBLISHABLE_KEY first, then VITE_CLERK_PUBLISHABLE_KEY for
// Vite compatibility. Falls back to empty string when not configured, which
// makes ClerkProvider render its children without auth (graceful degradation).
const CLERK_PUBLISHABLE_KEY =
  (import.meta.env.CLERK_PUBLISHABLE_KEY as string) ||
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) ||
  "";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const Pilot = lazy(() => import("./pages/Pilot.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Setup = lazy(() => import("./pages/Setup.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
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
const PilotIntelligence = lazy(() => import("./pages/PilotIntelligence.tsx"));
const PilotCompanies = lazy(() => import("./pages/PilotCompanies.tsx"));
const PilotSessions = lazy(() => import("./pages/PilotSessions.tsx"));
const PilotInsights = lazy(() => import("./pages/PilotInsights.tsx"));
const PilotOutcomes = lazy(() => import("./pages/PilotOutcomes.tsx"));

/** Protected section: auth gate + workspace shell (workspace gate inside). */
function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
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

/** Hard guard so runtime errors never leave the preview as a blank page. */
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
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
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
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        afterSignOutUrl="/"
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="atlas-theme">
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/pilot" element={<Pilot />} />
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
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedLayout>
                      <Dashboard />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/ask"
                  element={
                    <ProtectedLayout>
                      <Ask />
                    </ProtectedLayout>
                  }
                />
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
                <Route
                  path="/dashboard/recommendations"
                  element={
                    <ProtectedLayout>
                      <Recommendations />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/connections"
                  element={
                    <ProtectedLayout>
                      <Connections />
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
                <Route
                  path="/dashboard/team"
                  element={
                    <ProtectedLayout>
                      <Team />
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
                  path="/dashboard/settings"
                  element={
                    <ProtectedLayout>
                      <Settings />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/pilot-intelligence"
                  element={
                    <ProtectedLayout>
                      <PilotIntelligence />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/pilot-intelligence/companies"
                  element={
                    <ProtectedLayout>
                      <PilotCompanies />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/pilot-intelligence/sessions"
                  element={
                    <ProtectedLayout>
                      <PilotSessions />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/pilot-intelligence/insights"
                  element={
                    <ProtectedLayout>
                      <PilotInsights />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/dashboard/pilot-intelligence/outcomes"
                  element={
                    <ProtectedLayout>
                      <PilotOutcomes />
                    </ProtectedLayout>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
        </ThemeProvider>
      </ClerkProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
