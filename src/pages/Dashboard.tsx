// ---------------------------------------------------------------------------
// Atlas Home — the primary intelligence experience
//
// This is NOT a KPI dashboard or data summary.
// This is Atlas interpreting the business and telling you what matters.
//
// ┌──────────────────────────────────────────────────────────────┐
// │                                                              │
// │  Good morning, Sarah.                                       │
// │                                                              │
// │  I've been reviewing Melroxs.                               │
// │  There are 3 things worth your attention.                   │
// │                                                              │
// │  [intelligence summary badges — subtle, not dominant]        │
// │                                                              │
// ──────────────────────────────────────────────────────────────
// │                                                              │
// │  COMMAND CENTER                                              │
// │  (Next best action, What matters, What changed,              │
// │   What Atlas recommends)                                     │
// │                                                              │
// ──────────────────────────────────────────────────────────────
// │                                                              │
// │  PROACTIVE ATLAS                                             │
// │  (What Atlas noticed)                                        │
// │                                                              │
// └──────────────────────────────────────────────────────────────┘

import { useAuth } from "@/hooks/use-auth";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import { useIntelligence } from "@/lib/atlas-experience/useIntelligence";
import { useOnboarding } from "@/lib/atlas-experience/useOnboarding";
import { CommandCenter } from "@/components/atlas-experience/CommandCenter";
import { ProactiveAtlas } from "@/components/atlas-experience/ProactiveAtlas";
import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Database,
  Radar,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Time-aware greeting
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}

// ---------------------------------------------------------------------------
// Atlas Home
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { user } = useAuth();
  const { health } = useAtlasContext();
  const navigate = useNavigate();
  const workspace = useQuery(api.tenants.getMyWorkspace);

  const companyName = workspace?.profile?.companyName ?? workspace?.tenant?.name ?? "your business";
  const userName = user?.name?.split(" ")[0] ?? "there";

  const onboarding = useOnboarding();
  const { items: attentionItems, totalFinancialImpact } = useIntelligence();
  const openAttention = attentionItems.filter((a) => a.status === "open").length;
  const criticalCount = attentionItems.filter(
    (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
  ).length;

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Atlas Arrival: greeting + intelligence summary ---- */}
      <div className="relative">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {getGreeting()}, {userName}.
        </h1>

        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {openAttention > 0 ? (
            <>
              I've been reviewing <span className="font-medium text-foreground">{companyName}</span>.
              {criticalCount > 0 ? (
                <>
                  {" "}There{" "}
                  <span className="font-medium text-rose-600 dark:text-rose-300">
                    {criticalCount === 1 ? "is one thing" : `are ${criticalCount} things`}
                  </span>{" "}
                  I'd like you to see.
                </>
              ) : (
                <>
                  {" "}There are{" "}
                  <span className="font-medium text-foreground">{openAttention}</span> thing{openAttention === 1 ? "" : "s"} worth your attention.
                </>
              )}
            </>
          ) : (
            <>
              I've been looking through what's happening in{" "}
              <span className="font-medium text-foreground">{companyName}</span>.
              Everything looks steady right now.
            </>
          )}
        </p>

        {/* Subtle intelligence indicators — not dominant badges */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {openAttention > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[11px] text-amber-600 dark:text-amber-300">
              <Sparkles className="mr-1 size-3" />
              {openAttention} attention item{openAttention === 1 ? "" : "s"}
            </Badge>
          )}
          {totalFinancialImpact > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-[11px] text-emerald-600 dark:text-emerald-300">
              <TrendingUp className="mr-1 size-3" />
              ${totalFinancialImpact.toLocaleString()} potential impact
            </Badge>
          )}
          {health.documents > 0 && (
            <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 text-[11px] text-teal-600 dark:text-teal-300">
              <Database className="mr-1 size-3" />
              Knowledge active
            </Badge>
          )}
        </div>
      </div>

      {/* ---- Command Center: the primary Atlas operating experience ---- */}
      <CommandCenter />

      {/* ---- Proactive Atlas: Atlas noticed meaningful changes ---- */}
      <ProactiveAtlas />

      {/* ---- Atlas Onboarding: Intelligent empty/activation state ---- */}
      {onboarding.state === "empty" && (
        <div className="rounded-2xl border border-teal-400/20 bg-teal-400/[0.03] p-8">
          <div className="mx-auto max-w-lg text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-teal-400/30 bg-teal-400/10">
              <Radar className="size-7 text-teal-600 dark:text-teal-300" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{onboarding.assessment}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {onboarding.nextStep}
            </p>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => navigate(onboarding.ctaTarget)}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-teal-950 transition-colors hover:bg-teal-300"
              >
                <Zap className="size-4" />
                {onboarding.primaryCta.label}
              </button>
              {onboarding.secondaryActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => navigate(action.target)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card/80"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- Atlas Processing: Active but not done ---- */}
      {onboarding.state === "processing" && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10">
              <Radar className="size-5 animate-pulse text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{onboarding.assessment}</p>
              <p className="mt-1 text-xs text-muted-foreground">{onboarding.nextStep}</p>
              <button
                type="button"
                onClick={() => navigate(onboarding.ctaTarget)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card/80"
              >
                {onboarding.primaryCta.label}
                <ArrowRight className="size-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Atlas Found Something ---- */}
      {onboarding.state === "opportunity_detected" && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10">
              <Sparkles className="size-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{onboarding.assessment}</p>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
                  {onboarding.findingCount} {onboarding.findingCount === 1 ? "opportunity" : "opportunities"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{onboarding.nextStep}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(onboarding.ctaTarget)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card/80"
                >
                  {onboarding.primaryCta.label}
                  <ArrowRight className="size-3" />
                </button>
                {onboarding.secondaryActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => navigate(action.target)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Empty state: new organization (fallback) ---- */}
      {onboarding.state !== "empty" && onboarding.state !== "processing" && onboarding.state !== "opportunity_detected" && health.documents === 0 && health.entities === 0 && health.openClaims === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 py-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-400/10">
              <Radar className="size-6 text-teal-600 dark:text-teal-300" />
            </div>
            <div className="max-w-md">
              <p className="text-sm font-semibold text-foreground">Atlas is ready</p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                Connect a system or add your first claim to begin. Atlas will continuously
                monitor your business and surface what matters.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/dashboard/connections"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card/80"
              >
                Connect a system
              </a>
              <a
                href="/dashboard/revenue-recovery"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card/80"
              >
                View claims
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
