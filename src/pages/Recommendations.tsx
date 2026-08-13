import { api } from "@/lib/api";
import {
  ConfidenceBar,
  PageHeader,
  PriorityBadge,
  RecStatusBadge,
  formatDate,
} from "@/components/atlas-ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "@/hooks/use-supabase";
import {
  AlertTriangle,
  ArrowDownCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Network,
  Radar,
  ShieldCheck,
  Target,
  XCircle,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const MANAGER_ROLES = ["owner", "admin", "manager"];

const STATUS_TABS = ["all", "open", "approved", "rejected", "dismissed", "executed"];

export default function Recommendations() {
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const recs = useQuery(api.recommendations.listRecommendations);
  const counts = useQuery(api.recommendations.recommendationCounts);

  const runDetectors = useAction(api.recommendations.runDetectors);
  const approve = useMutation(api.recommendations.approveRecommendation);
  const reject = useMutation(api.recommendations.rejectRecommendation);
  const dismiss = useMutation(api.recommendations.dismissRecommendation);
  const execute = useMutation(api.recommendations.markExecuted);

  const [tab, setTab] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const isManager = MANAGER_ROLES.includes(workspace?.membership?.role ?? "");

  const visible = useMemo(
    () => (recs ?? []).filter((r) => tab === "all" || r.status === tab),
    [recs, tab],
  );

  const act = async (
    key: string,
    fn: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRun = async () => {
    setDetecting(true);
    try {
      const res = await runDetectors();
      toast.success("Comparison engine finished", {
        description: `${res.created} new signal${res.created === 1 ? "" : "s"}, ${res.closed} resolved`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Detectors failed");
    } finally {
      setDetecting(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Recommendation Center"
        title="What matters, ranked"
        description="The comparison engine measures your workspace against company policies and activated intelligence — then surfaces evidence-backed recommendations for approval."
        actions={
          <Button onClick={handleRun} disabled={detecting} className="gap-2">
            <Radar className={cn("size-4", detecting && "animate-spin")} />
            {detecting ? "Comparing…" : "Run comparison"}
          </Button>
        }
      />

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((s) => {
          const n =
            s === "all"
              ? (recs ?? []).length
              : ((counts ?? {}) as Record<string, number | undefined>)[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setTab(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                tab === s
                  ? "border-teal-400/50 bg-teal-400/15 text-teal-700 dark:text-teal-200"
                  : "border-border/70 text-muted-foreground hover:border-teal-400/30 hover:text-teal-700 dark:hover:text-teal-200",
              )}
            >
              {s}
              <span className="font-mono text-[10px] opacity-70">{n}</span>
            </button>
          );
        })}
        {!isManager && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-teal-600 dark:text-teal-300" />
            Approve / reject requires manager role
          </span>
        )}
      </div>

      {/* Cards */}
      {recs === undefined ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading signals…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 py-16 text-center">
          <Target className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No {tab !== "all" ? tab : ""} recommendations</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            Run the comparison engine to detect documentation gaps, risks and opportunities in
            your workspace.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const deciding = busy === String(r._id);
            return (
              <div
                key={r._id}
                className={cn(
                  "rounded-xl border bg-card/60 p-5",
                  r.status === "open"
                    ? "border-teal-400/25"
                    : "border-border/60 opacity-80",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={r.priority} />
                  <RecStatusBadge status={r.status} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    {r.detectorKey.replace(/_/g, " ")}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
                    {formatDate(r.decidedAt ?? r._creationTime)}
                  </span>
                </div>

                <h3 className="mt-2.5 text-sm font-semibold">{r.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{r.summary}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground/80">
                  <span className="font-medium text-muted-foreground">Why: </span>
                  {r.reason}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    Confidence
                    <ConfidenceBar value={r.confidence} />
                  </span>
                  {r.expectedImpact && (
                    <span className="flex items-center gap-1.5">
                      <Zap className="size-3.5 text-emerald-600 dark:text-emerald-300" />
                      {r.expectedImpact}
                    </span>
                  )}
                  {r.risk && (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-300" />
                      {r.risk}
                    </span>
                  )}
                </div>

                {r.evidence.length > 0 && (
                  <details className="mt-3 rounded-lg border border-border/60 bg-muted/20">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <FileText className="size-3.5 text-teal-600 dark:text-teal-300" />
                      Evidence · {r.evidence.length} source{r.evidence.length === 1 ? "" : "s"}
                    </summary>
                    <div className="space-y-1.5 px-3 pb-3">
                      {r.evidence.map((e, i) => (
                        <div key={i} className="rounded-md border border-border/50 bg-background/40 p-2">
                          <p className="flex items-center gap-2 text-[11px] font-medium">
                            {e.kind === "entity" ? (
                              <Network className="size-3 text-teal-600 dark:text-teal-300" />
                            ) : (
                              <FileText className="size-3 text-cyan-600 dark:text-cyan-300" />
                            )}
                            {e.title ?? e.kind}
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                              rel {Math.round(e.relevance * 100)}%
                            </span>
                          </p>
                          {e.snippet && (
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {e.snippet}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {r.status === "open" && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={!isManager || deciding}
                            onClick={() =>
                              void act(String(r._id), () =>
                                approve({ recommendationId: r._id }),
                              "Recommendation approved")
                            }
                          >
                            <CheckCircle2 className="size-3.5" />
                            Approve
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isManager && <TooltipContent>Managers and above can approve.</TooltipContent>}
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={!isManager || deciding}
                            onClick={() =>
                              void act(String(r._id), () =>
                                reject({ recommendationId: r._id }),
                              "Recommendation rejected")
                            }
                          >
                            <XCircle className="size-3.5 text-rose-600 dark:text-rose-300" />
                            Reject
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isManager && <TooltipContent>Managers and above can reject.</TooltipContent>}
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={!isManager || deciding}
                            onClick={() =>
                              void act(String(r._id), () =>
                                execute({ recommendationId: r._id }),
                              "Marked as executed")
                            }
                          >
                            <Zap className="size-3.5 text-indigo-600 dark:text-indigo-300" />
                            Mark executed
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isManager && <TooltipContent>Managers and above can execute.</TooltipContent>}
                    </Tooltip>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground"
                      disabled={deciding}
                      onClick={() =>
                        void act(String(r._id), () =>
                          dismiss({ recommendationId: r._id }),
                        "Dismissed")
                      }
                    >
                      <ArrowDownCircle className="size-3.5" />
                      Dismiss
                    </Button>
                    {deciding && <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
