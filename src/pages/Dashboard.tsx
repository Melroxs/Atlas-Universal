// ---------------------------------------------------------------------------
// Atlas Home — the primary intelligence experience
//
// This is Screen 02: "What matters right now?"
//
// Atlas greets the user, surfaces the most important next action,
// shows what matters, what changed, what Atlas recommends, and
// provides a direct entry to Ask Atlas.
//
// NOT a KPI dashboard. NOT a data summary.
// This is Atlas interpreting the business and telling you what matters.
// ---------------------------------------------------------------------------

import { useAuth } from "@/hooks/use-auth";
import { useAtlasContext } from "@/lib/atlas-experience/context";
import { useIntelligence } from "@/lib/atlas-experience/useIntelligence";
import { CommandCenter } from "@/components/atlas-experience/CommandCenter";
import { ProactiveAtlas } from "@/components/atlas-experience/ProactiveAtlas";
import { useQuery } from "@/hooks/use-supabase";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  BadgeDollarSign,
  ClipboardList,
  Compass,
  Database,
  FileSearch,
  MessageSquareText,
  Radar,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
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

function money(n?: number | null): string {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Atlas Home
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quickAsk, setQuickAsk] = useState("");
  const { health } = useAtlasContext();

  const workspace = useQuery(api.tenants.getMyWorkspace);
  const claimCounts = useQuery(api.insurance.claims.claimCounts);
  const claims = useQuery(api.insurance.claims.listClaims, {});

  const companyName = workspace?.profile?.companyName ?? workspace?.tenant?.name ?? "your business";
  const userName = user?.name?.split(" ")[0] ?? "there";

  const { items: attentionItems, totalFinancialImpact } = useIntelligence();
  const openAttention = attentionItems.filter((a) => a.status === "open").length;
  const criticalCount = attentionItems.filter(
    (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
  ).length;

  const submitAsk = () => {
    const q = quickAsk.trim();
    navigate(q ? `/dashboard/talk?q=${encodeURIComponent(q)}` : "/dashboard/talk");
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Atlas Arrival: greeting + intelligence summary ---- */}
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/30 p-6 sm:p-8">
        {/* Subtle teal glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-teal-400/5 via-transparent to-transparent" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Radar className="size-5 text-teal-600 dark:text-teal-300" />
            <span className="atlas-eyebrow">Atlas Home</span>
          </div>

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

          {/* Quick intelligence summary */}
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
      </div>

      {/* ---- Command Center: the primary Atlas operating experience ---- */}
      <CommandCenter />

      {/* ---- Proactive Atlas: Atlas noticed meaningful changes ---- */}
      <ProactiveAtlas />

      {/* ---- Quick Ask ---- */}
      <div className="group relative">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={quickAsk}
          onChange={(e) => setQuickAsk(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAsk()}
          placeholder={`Ask Atlas about ${companyName}… e.g. "What's outstanding on claim 1042?"`}
          className="h-12 w-full rounded-xl border border-border/70 bg-card/70 pl-11 pr-28 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-teal-400/50 focus:ring-2 focus:ring-teal-400/20"
        />
        <button
          type="button"
          onClick={submitAsk}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-teal-400 px-3 py-1.5 text-xs font-semibold text-teal-950 transition-colors hover:bg-teal-300"
        >
          <MessageSquareText className="size-3.5" />
          Ask
        </button>
      </div>

      {/* ---- Recovery snapshot ---- */}
      {claimCounts && (claimCounts.openClaims ?? 0) > 0 && (
        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-300" />
              <h2 className="text-sm font-semibold text-foreground">Revenue recovery</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/dashboard/revenue-recovery")}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-emerald-700 dark:hover:text-emerald-200"
            >
              Open <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Open claims</p>
              <p className="font-mono text-lg font-semibold text-foreground">
                {claimCounts.openClaims}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Potential recovery</p>
              <p className="font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-300">
                {money(claimCounts.potential)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Supplements ready</p>
              <p className="font-mono text-lg font-semibold text-foreground">
                {claimCounts.readyForSubmission ?? 0}
              </p>
            </div>
          </div>

          {/* Claims needing attention */}
          {claims && claims.length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Claims needing attention
              </p>
              <div className="space-y-1.5">
                {claims
                  .filter(
                    (c) =>
                      c.openFindings > 0 ||
                      (c.outstanding ?? 0) > 0 ||
                      c.completeness < c.completenessTotal ||
                      c.hasDiscrepancy,
                  )
                  .slice(0, 3)
                  .map((c) => (
                    <button
                      key={c._id}
                      type="button"
                      onClick={() => navigate(`/dashboard/revenue-recovery/${c._id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:border-emerald-400/40 hover:bg-muted/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {c.customer ?? c.property ?? c.claimNumber ?? "Unnamed claim"}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {(c.status ?? "opened").replace(/_/g, " ")}
                          {c.openFindings > 0 && ` · ${c.openFindings} finding${c.openFindings === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs font-semibold text-rose-600 dark:text-rose-300">
                        {money(c.outstanding)}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Empty state ---- */}
      {health.documents === 0 && health.entities === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 py-16 text-center">
          <Database className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">Your knowledge base is empty</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Upload documents (estimates, invoices, policies) to give Atlas context about your business.
            </p>
          </div>
          <Button onClick={() => navigate("/dashboard/knowledge")} className="gap-2">
            Upload documents
          </Button>
        </div>
      )}
    </div>
  );
}
