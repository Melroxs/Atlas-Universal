// ---------------------------------------------------------------------------
// Atlas Control — the operating environment overview
//
// This is NOT a traditional Settings page.
// This is where Atlas explains itself:
//   - What it can see
//   - What it can do
//   - Who has authority
//   - What it has been doing
// ---------------------------------------------------------------------------

import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@/hooks/use-supabase";
import { canAccessPlatformAdmin, normalizeRole } from "@/lib/auth/access-gate";
import {
  Cable,
  ChevronRight,
  Eye,
  FileCheck,
  Globe,
  Loader2,
  Radar,
  ScrollText,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ControlSection {
  id: string;
  label: string;
  description: string;
  icon: typeof Radar;
  path: string;
  accent: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AtlasControl() {
  const { role } = useAuth();
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const catalog = useQuery(api.connections.listConnectorCatalog);
  const logs = useQuery(api.audit.listAuditLogs, { limit: 5 });
  const navigate = useNavigate();

  // Derive status from actual data
  const connectedCount =
    catalog?.filter((e: any) =>
      ["connected", "healthy", "degraded", "syncing"].includes(e.displayStatus),
    ).length ?? 0;

  const totalConnections = catalog?.length ?? 0;

  const hasDegraded =
    catalog?.some((e: any) => e.displayStatus === "degraded") ?? false;

  const hasError =
    catalog?.some((e: any) => e.displayStatus === "error") ?? false;

  const members = workspace?.members ?? [];
  const memberCount = members.length;

  const orgName =
    workspace?.tenant?.name ?? workspace?.profile?.companyName ?? "Your workspace";
  const industry = workspace?.profile?.industry ?? null;

  // Recent activity
  const recentLogs = (logs ?? []).slice(0, 3);

  // Authority: derive from role
  const normalizedRole = normalizeRole(role);
  const canPrepare =
    normalizedRole === "super_admin" ||
    normalizedRole === "atlas_admin" ||
    normalizedRole === "customer_admin";

  // Status derivation
  const statusLevel = (() => {
    if (hasError) return "error";
    if (hasDegraded) return "degraded";
    return "operational";
  })();

  // Control sections
  const sections: ControlSection[] = [
    {
      id: "connections",
      label: "Connections",
      description: "Systems Atlas can access",
      icon: Cable,
      path: "/dashboard/connections",
      accent: "text-sky-600 dark:text-sky-300",
    },
    {
      id: "people",
      label: "People",
      description: "Who works with Atlas",
      icon: Users,
      path: "/dashboard/team",
      accent: "text-teal-600 dark:text-teal-300",
    },
    {
      id: "authority",
      label: "Atlas Authority",
      description: "What Atlas is allowed to do",
      icon: ShieldCheck,
      path: "/dashboard/authority",
      accent: "text-violet-600 dark:text-violet-300",
    },
    {
      id: "activity",
      label: "Activity",
      description: "What Atlas has been doing",
      icon: ScrollText,
      path: "/dashboard/audit",
      accent: "text-cyan-600 dark:text-cyan-300",
    },
    {
      id: "organization",
      label: "Organization",
      description: "Workspace information",
      icon: Settings2,
      path: "/dashboard/settings",
      accent: "text-amber-600 dark:text-amber-300",
    },
  ];

  // Loading state
  if (workspace === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading Atlas status…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-teal-600 dark:text-teal-300">
          Atlas Control
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          Your operating environment
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgName}
          {industry ? ` · ${industry}` : ""}
        </p>
      </div>

      {/* ── Atlas Status ── */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Radar
            className={cn(
              "size-4",
              statusLevel === "operational"
                ? "text-emerald-600 dark:text-emerald-300"
                : statusLevel === "degraded"
                  ? "text-amber-600 dark:text-amber-300"
                  : "text-rose-600 dark:text-rose-300",
            )}
          />
          Atlas Status
        </h2>

        <div className="mt-4 flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              statusLevel === "operational"
                ? "bg-emerald-500"
                : statusLevel === "degraded"
                  ? "bg-amber-500"
                  : "bg-rose-500",
            )}
          />
          <span className="text-sm font-medium text-foreground">
            {statusLevel === "operational"
              ? "Operating normally"
              : statusLevel === "degraded"
                ? "One connection needs attention"
                : "Connection issue detected"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusItem
            label="Intelligence"
            status="operational"
            detail="Active"
          />
          <StatusItem
            label="Connections"
            status={connectedCount > 0 ? "operational" : "idle"}
            detail={
              connectedCount > 0
                ? `${connectedCount} connected`
                : "Not connected"
            }
          />
          <StatusItem
            label="Actions"
            status="operational"
            detail="Ready"
          />
          <StatusItem
            label="Voice"
            status="operational"
            detail="Available"
          />
        </div>

        {/* Degraded connection warning */}
        {(hasDegraded || hasError) && (
          <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-200">
              One or more connections need attention.{" "}
              <button
                onClick={() => navigate("/dashboard/connections")}
                className="font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-100"
              >
                View connections →
              </button>
            </p>
          </div>
        )}
      </section>

      {/* ── What Atlas Can See ── */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="size-4 text-sky-600 dark:text-sky-300" />
          What Atlas can see
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Atlas has access to these information sources in your workspace.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Claims", "Documents", "Evidence", "Organization data"].map((item) => (
            <span
              key={item}
              className="rounded-full border border-sky-400/25 bg-sky-400/8 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-200"
            >
              {item}
            </span>
          ))}
          {connectedCount > 0 && (
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/8 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-200">
              {connectedCount} connected system{connectedCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </section>

      {/* ── What Atlas Can Do ── */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-violet-600 dark:text-violet-300" />
          What Atlas can do
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Atlas operates within these boundaries. Execution always requires
          explicit approval.
        </p>
        <div className="mt-3 space-y-2">
          <AuthorityRow
            icon={<Eye className="size-3" />}
            label="Analyze"
            detail="Claims, documents, and evidence"
            allowed={true}
          />
          <AuthorityRow
            icon={<FileCheck className="size-3" />}
            label="Prepare"
            detail="Supplement drafts, recommendations"
            allowed={canPrepare}
          />
          <AuthorityRow
            icon={<Send className="size-3" />}
            label="Execute"
            detail="With explicit user approval"
            allowed={canPrepare}
          />
        </div>
        {!canPrepare && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Your current role allows Atlas to analyze and recommend. Preparation
            and execution require a manager role or above.
          </p>
        )}
      </section>

      {/* ── Recent Atlas Activity ── */}
      {recentLogs.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ScrollText className="size-4 text-cyan-600 dark:text-cyan-300" />
              Recent activity
            </h2>
            <button
              onClick={() => navigate("/dashboard/audit")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </button>
          </div>
          <div className="mt-3 space-y-0 divide-y divide-border/50">
            {recentLogs.map((log: any) => (
              <div key={log._id} className="flex items-start gap-3 py-2.5">
                <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-400/60" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {formatActionLabel(log.actionType)}
                  </p>
                  {log.targetType && (
                    <p className="text-xs text-muted-foreground">
                      {log.targetType}
                      {log.targetId ? ` · ${log.targetId.slice(0, 8)}` : ""}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">
                    {log.actorName ?? (log.actorType === "system" ? "Atlas" : "")}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    {formatRelativeTime(log._creationTime)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Control Navigation ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Control</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => navigate(section.path)}
              className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-border hover:bg-card/80"
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 transition-colors group-hover:bg-muted/80",
                  section.accent,
                )}
              >
                <section.icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {section.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {section.description}
                </p>
              </div>
              <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </button>
          ))}

          {/* Super admin only — Platform Administration */}
          {canAccessPlatformAdmin(role as any) && (
            <button
              onClick={() => navigate("/dashboard/users")}
              className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-border hover:bg-card/80"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-rose-600 transition-colors group-hover:bg-muted/80 dark:text-rose-300">
                <Globe className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Platform Administration
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Manage organizations and users
                </p>
              </div>
              <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </button>
          )}
        </div>
      </section>

      {/* ── Summary stats ── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {memberCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            people work with Atlas
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {connectedCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            connected system{connectedCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-center">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {(logs ?? []).length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            activity entries
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusItem({
  label,
  status,
  detail,
}: {
  label: string;
  status: "operational" | "idle" | "error";
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "operational"
              ? "bg-emerald-500"
              : status === "idle"
                ? "bg-muted-foreground/40"
                : "bg-rose-500",
          )}
        />
        <span className="text-xs text-foreground">{detail}</span>
      </div>
    </div>
  );
}

function AuthorityRow({
  icon,
  label,
  detail,
  allowed,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  allowed: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className={cn(allowed ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground/50")}>
        {icon}
      </span>
      <span className={cn("text-sm font-medium", allowed ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <span className="text-xs text-muted-foreground">—</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
      {!allowed && (
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          Requires elevated role
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatActionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    document_uploaded: "Document uploaded",
    document_deleted: "Document removed",
    detectors_ran: "Intelligence analyzed",
    recommendation_approved: "Recommendation approved",
    recommendation_rejected: "Recommendation rejected",
    recommendation_dismissed: "Recommendation dismissed",
    recommendation_executed: "Recommendation executed",
    pack_activated: "Intelligence pack activated",
    connection_created: "Connection created",
    connection_synced: "Connection synchronized",
    connection_deleted: "Connection removed",
    member_invited: "Team member invited",
    member_added: "Team member added",
    member_removed: "Team member removed",
    member_role_changed: "Team member role changed",
    tenant_created: "Workspace created",
    onboarding_completed: "Onboarding completed",
  };
  return labels[actionType] ?? actionType.replace(/_/g, " ");
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
