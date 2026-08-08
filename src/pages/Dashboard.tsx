import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import {
  ConfidenceBar,
  EmptyPanel,
  KnowledgeBadge,
  PageHeader,
  Panel,
  PriorityBadge,
  RecStatusBadge,
  StatCard,
  formatDate,
  titleCase,
} from "@/components/atlas-ui";
import { Button } from "@/components/ui/button";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  ArrowRight,
  Database,
  FileUp,
  FlaskConical,
  MessageSquareText,
  Network,
  Radar,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const NODE_COLORS: Record<string, string> = {
  claim: "oklch(0.7 0.16 20)",
  carrier: "oklch(0.78 0.115 230)",
  adjuster: "oklch(0.72 0.13 300)",
  policyholder: "oklch(0.802 0.14 80)",
  property: "oklch(0.7 0.13 155)",
  financial: "oklch(0.75 0.132 178)",
  organization: "oklch(0.8 0.1 250)",
  person: "oklch(0.8 0.14 80)",
  system: "oklch(0.72 0.12 210)",
  project: "oklch(0.75 0.13 178)",
  product: "oklch(0.75 0.13 178)",
  location: "oklch(0.75 0.13 178)",
  document: "oklch(0.75 0.13 178)",
  inspection: "oklch(0.72 0.13 300)",
  estimate: "oklch(0.802 0.14 80)",
  supplement: "oklch(0.78 0.115 230)",
  unknown: "oklch(0.6 0 0)",
};

function MiniGraph({ nodes, edges }: { nodes: Array<{ id: string; type: string }>; edges: Array<{ source: string; target: string }> }) {
  const W = 300;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(cx, cy) - 34;
  const visible = nodes.slice(0, 12);
  const pos = new Map(
    visible.map((n, i) => {
      const a = (i / Math.max(visible.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return [n.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }];
    }),
  );
  if (visible.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {edges.map((e, i) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="oklch(1 0 0 / 0.12)"
            strokeWidth="1"
          />
        );
      })}
      {visible.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const color = NODE_COLORS[n.type] ?? NODE_COLORS.unknown;
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r="7" fill={color} opacity="0.25" />
            <circle cx={p.x} cy={p.y} r="4" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quickAsk, setQuickAsk] = useState("");

  const workspace = useQuery(api.tenants.getMyWorkspace);
  const docStats = useQuery(api.documents.documentStats);
  const entityStats = useQuery(api.knowledge.entityStats);
  const recCounts = useQuery(api.recommendations.recommendationCounts);
  const recs = useQuery(api.recommendations.listRecommendations);
  const activity = useQuery(api.history.recentActivity);
  const graph = useQuery(api.knowledge.graphSnapshot);
  const seedDemo = useMutation(api.seed.seedDemoData);
  const runDetectors = useAction(api.recommendations.runDetectors);

  const [seeding, setSeeding] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const companyName = workspace?.profile?.companyName ?? "your workspace";

  const openRecs = (recs ?? []).filter((r) => r.status === "open");
  const pendingRecs = (recs ?? []).filter((r) => r.status !== "open" && r.status !== "dismissed");

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedDemo();
      if (res.seeded) {
        toast.success("Demo knowledge loaded", {
          description: `${res.documents} documents · ${res.entities} entities · ${res.assertions} assertions`,
        });
      } else {
        toast.info("Demo data already loaded");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to seed demo data");
    } finally {
      setSeeding(false);
    }
  };

  const handleRunDetectors = async () => {
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

  const submitAsk = () => {
    const q = quickAsk.trim();
    navigate(q ? `/dashboard/ask?q=${encodeURIComponent(q)}` : "/dashboard/ask");
  };

  const empty =
    (docStats?.total ?? 0) === 0 && (entityStats?.entities ?? 0) === 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Atlas Home"
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${user?.name?.split(" ")[0] ?? "there"}`}
        description={`This is the live state of ${companyName} as Atlas understands it — knowledge, signals and activity.`}
        actions={
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleRunDetectors}
            disabled={detecting}
          >
            <Radar className={`size-4 text-teal-300 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Comparing…" : "Run comparison"}
          </Button>
        }
      />

      {/* Quick ask */}
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Database} label="Documents" value={docStats?.total ?? "—"} hint={`${docStats?.ready ?? 0} ready · ${docStats?.chunks ?? 0} chunks`} accent="text-cyan-300" />
        <StatCard icon={Network} label="Entities" value={entityStats?.entities ?? "—"} hint={`${entityStats?.relationships ?? 0} relationships`} accent="text-teal-300" />
        <StatCard icon={Sparkles} label="Assertions" value={entityStats?.assertions ?? "—"} hint="labeled knowledge statements" accent="text-violet-300" />
        <StatCard icon={Target} label="Open signals" value={recCounts?.open ?? "—"} hint={`${recCounts?.executed ?? 0} executed · ${recCounts?.approved ?? 0} approved`} accent="text-amber-300" />
      </div>

      {/* Knowledge graph + recommendations */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Network className="size-4 text-teal-300" />
              Knowledge graph
            </h2>
            <button
              type="button"
              onClick={() => navigate("/dashboard/knowledge")}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-teal-200"
            >
              Open knowledge base <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="px-5 py-4">
            {graph && graph.nodes.length > 0 ? (
              <>
                <MiniGraph nodes={graph.nodes} edges={graph.edges} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(entityStats?.typeCounts ?? {})
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([type, count]) => (
                      <span
                        key={type}
                        className="flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: NODE_COLORS[type] ?? NODE_COLORS.unknown }}
                        />
                        {titleCase(type)} · {count}
                      </span>
                    ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Network className="size-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No knowledge yet. Upload documents to grow your graph.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => navigate("/dashboard/knowledge")}>
                    <FileUp className="mr-2 size-3.5" />
                    Upload documents
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleSeed} disabled={seeding}>
                    <FlaskConical className="mr-2 size-3.5" />
                    {seeding ? "Loading…" : "Load demo"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="size-4 text-amber-300" />
              Priority signals
            </h2>
            <button
              type="button"
              onClick={() => navigate("/dashboard/recommendations")}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-teal-200"
            >
              All signals <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="divide-y divide-border/50">
            {openRecs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
                <Sparkles className="size-6 text-emerald-300/70" />
                <p className="text-sm text-muted-foreground">
                  No open signals. Run the comparison engine to scan for gaps and risks.
                </p>
              </div>
            ) : (
              openRecs.slice(0, 3).map((r) => (
                <button
                  key={r._id}
                  type="button"
                  onClick={() => navigate("/dashboard/recommendations")}
                  className="block w-full px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={r.priority} />
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatDate(r.decidedAt ?? r._creationTime)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-5">{r.title}</p>
                  <div className="mt-1.5">
                    <ConfidenceBar value={r.confidence} />
                  </div>
                </button>
              ))
            )}
            {pendingRecs.length > 0 && (
              <div className="flex items-center justify-between px-5 py-2.5 text-xs text-muted-foreground">
                <span>{pendingRecs.length} decided signal{pendingRecs.length === 1 ? "" : "s"} this period</span>
                <RecStatusBadge status={pendingRecs[0].status} />
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Activity */}
      <Panel>
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-cyan-300" />
            Recent activity
          </h2>
          <button
            type="button"
            onClick={() => navigate("/dashboard/audit")}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-teal-200"
          >
            Audit log <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="divide-y divide-border/50">
          {(activity ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            (activity ?? []).slice(0, 8).map((log) => (
              <div key={log._id} className="flex items-start gap-3 px-5 py-3">
                <div className="mt-1 size-2 shrink-0 rounded-full bg-teal-400/70" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium capitalize">
                      {log.actionType.replace(/_/g, " ")}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {log.targetType ? `· ${titleCase(log.targetType)}` : ""}
                    </span>
                  </p>
                  {log.metadata && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                      {JSON.stringify(log.metadata).slice(0, 120)}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">{log.actorName ?? "system"}</p>
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    {formatDate(log._creationTime)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>

      {/* Knowledge status strip */}
      {!empty && docStats && docStats.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-wider">Pipeline</span>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-300">
            {docStats.ready} ready
          </span>
          {docStats.processing > 0 && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-300">
              {docStats.processing} processing
            </span>
          )}
          {docStats.failed > 0 && (
            <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-rose-300">
              {docStats.failed} failed
            </span>
          )}
          <KnowledgeBadge classification="FACT" />
          <KnowledgeBadge classification="RULE" />
          <KnowledgeBadge classification="OBSERVATION" />
          <KnowledgeBadge classification="INFERENCE" />
          <KnowledgeBadge classification="RECOMMENDATION" />
        </div>
      )}

      {empty && (
        <EmptyPanel
          icon={Database}
          title="Your knowledge base is empty"
          description="Upload your first documents (SOPs, invoices, spreadsheets) or load the demo workspace to see Atlas in action."
          action={
            <div className="flex gap-2">
              <Button onClick={() => navigate("/dashboard/knowledge")}>
                <FileUp className="mr-2 size-4" />
                Upload documents
              </Button>
              <Button variant="outline" onClick={handleSeed} disabled={seeding}>
                <FlaskConical className="mr-2 size-4" />
                {seeding ? "Loading demo…" : "Load demo knowledge"}
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
}
