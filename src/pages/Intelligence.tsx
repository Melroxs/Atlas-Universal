import { api } from "@/lib/api";
import { PageHeader, titleCase } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  BookOpen,
  Globe2,
  Layers,
  Loader2,
  Scale,
  Sparkles,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const PACK_TYPES = ["all", "core", "industry", "geographic", "regulatory", "benchmark"];

const TYPE_META: Record<string, { icon: typeof Layers; tone: string }> = {
  core: { icon: Zap, tone: "border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300" },
  industry: { icon: Workflow, tone: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300" },
  geographic: { icon: Globe2, tone: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300" },
  regulatory: { icon: Scale, tone: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300" },
  benchmark: { icon: TrendingUp, tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300" },
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  terminology: "Terminology",
  rule: "Rule",
  entity_type: "Entity type",
  workflow: "Workflow",
  role: "Role",
  risk_pattern: "Risk pattern",
  document_expectation: "Document expectation",
  benchmark: "Benchmark",
  kpi: "KPI",
  regulatory: "Regulatory",
};

export default function Intelligence() {
  const packs = useQuery(api.intelligence.listWorkspacePacks);
  const [filter, setFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const setPackActivation = useMutation(api.intelligence.setPackActivation);
  const packItems = useQuery(
    api.intelligence.listPackItems,
    selectedKey ? { packKey: selectedKey } : "skip",
  );

  const toggle = async (packKey: string, active: boolean) => {
    try {
      await setPackActivation({ packKey, active });
      toast.success(active ? "Pack activated" : "Pack dismissed", {
        description: active
          ? "Its intelligence now applies to comparisons and answers."
          : "Its intelligence is no longer applied.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update pack");
    }
  };

  const visible = (packs ?? []).filter(
    (p) => filter === "all" || p.packType === filter,
  );

  const selected = (packs ?? []).find((p) => p.key === selectedKey) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Intelligence Model"
        title="Versioned intelligence packs"
        description="Packs are modular bundles of industry, geographic, regulatory and benchmark knowledge. Activate the ones that apply to your company — Atlas applies them to every comparison and answer."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {PACK_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === t
                ? "border-teal-400/50 bg-teal-400/15 text-teal-700 dark:text-teal-200"
                : "border-border/70 text-muted-foreground hover:border-teal-400/30 hover:text-teal-700 dark:hover:text-teal-200",
            )}
          >
            {t === "all" ? "All" : titleCase(t)}
          </button>
        ))}
      </div>

      {/* Pack grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs === undefined ? (
          <div className="col-span-full flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading packs…
          </div>
        ) : visible.length === 0 ? (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            No packs in this category.
          </p>
        ) : (
          visible.map((p) => {
            const meta = TYPE_META[p.packType] ?? { icon: Layers, tone: "border-border/70 bg-muted/40 text-muted-foreground" };
            const Icon = meta.icon;
            return (
              <div
                key={p.key}
                className={cn(
                  "flex flex-col rounded-xl border bg-card/60 p-5 transition-colors",
                  p.activated
                    ? "border-teal-400/30"
                    : "border-border/70 hover:border-teal-400/20",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={cn("flex size-10 items-center justify-center rounded-lg ring-1", meta.tone)}>
                    <Icon className="size-5" />
                  </div>
                  <Switch
                    checked={p.activated}
                    onCheckedChange={(v) => void toggle(p.key, v)}
                    aria-label={`Toggle ${p.name}`}
                  />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{p.name}</h3>
                <div className="mt-1 flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-border/70 font-mono text-[10px] text-muted-foreground"
                  >
                    {p.packType}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    v{p.version}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-xs leading-5 text-muted-foreground">
                  {p.description}
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setSelectedKey(p.key)}
                  >
                    <BookOpen className="size-3.5" />
                    View contents
                  </Button>
                  {p.activated && (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-teal-600 dark:text-teal-300">
                      <Sparkles className="size-3" />
                      active
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pack contents dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedKey(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Layers className="size-4 text-teal-600 dark:text-teal-300" />
                  {selected.name}
                  <Badge
                    variant="outline"
                    className="border-border/70 font-mono text-[10px] text-muted-foreground"
                  >
                    v{selected.version}
                  </Badge>
                </DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {packItems === undefined ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading items…
                  </div>
                ) : packItems.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    This pack has no items yet.
                  </p>
                ) : (
                  packItems.map((item) => (
                    <div
                      key={item._id}
                      className="rounded-lg border border-border/60 bg-muted/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{item.title}</p>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-border/70 font-mono text-[10px] text-muted-foreground"
                        >
                          {ITEM_TYPE_LABEL[item.itemType] ?? item.itemType}
                        </Badge>
                      </div>
                      {item.summary && (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.summary}
                        </p>
                      )}
                      {item.content &&
                        typeof item.content === "object" &&
                        Object.keys(item.content).length > 0 && (
                          <pre className="atlas-scroll mt-2 overflow-x-auto rounded-md border border-border/50 bg-background/50 p-2 font-mono text-[10px] leading-4 text-muted-foreground/80">
                            {JSON.stringify(item.content, null, 1).slice(0, 900)}
                          </pre>
                        )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
