import { api } from "@/lib/api";
import type { PilotInsightRow } from "@/lib/api";
import { PageHeader, EmptyPanel } from "@/components/atlas-ui";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { invalidateQueries } from "@/hooks/use-supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Bug,
  CheckCircle2,
  Lightbulb,
  Loader2,
  MessageSquare,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const INSIGHT_TYPES = [
  { value: "friction", label: "Friction", icon: Target },
  { value: "feature_request", label: "Feature Request", icon: Lightbulb },
  { value: "bug", label: "Bug", icon: Bug },
  { value: "positive_feedback", label: "Positive Feedback", icon: CheckCircle2 },
  { value: "workflow", label: "Workflow Insight", icon: TrendingUp },
  { value: "objection", label: "Objection", icon: MessageSquare },
];

const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "acknowledged", "in_progress", "resolved", "wont_fix"];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  acknowledged: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  resolved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  wont_fix: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
};

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface InsightForm {
  insightType: string;
  title: string;
  description: string;
  priority: string;
}

const EMPTY_FORM: InsightForm = {
  insightType: "friction",
  title: "",
  description: "",
  priority: "medium",
};

export default function PilotInsights() {
  const insights = useQuery(api.pilotIntelligence.listInsights);
  const createInsight = useMutation(api.pilotIntelligence.createInsight);
  const updateInsightStatus = useMutation(api.pilotIntelligence.updateInsightStatus);
  const deleteInsight = useMutation(api.pilotIntelligence.deleteInsight);

  const [addOpen, setAddOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [form, setForm] = useState<InsightForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const isLoading = insights === undefined;

  const filtered = (insights ?? []).filter((i) => {
    if (filterType !== "all" && i.insight_type !== filterType) return false;
    if (filterStatus !== "all" && i.status !== filterStatus) return false;
    return true;
  });

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setBusy(true);
    try {
      await createInsight({
        insightType: form.insightType,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
      });
      invalidateQueries();
      toast.success("Insight added");
      setAddOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add insight");
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (id: string, status: string) => {
    try {
      await updateInsightStatus({ id, status });
      invalidateQueries();
      toast.success(`Insight marked as ${status.replace("_", " ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await deleteInsight({ id });
      invalidateQueries();
      toast.success("Insight deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading insights…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pilot Intelligence"
        title="Insights"
        description="Track friction, feature requests, bugs, positive feedback, and workflow insights from pilot companies."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add Insight
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {INSIGHT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel icon={Target}
          title="No insights yet"
          description="Add your first insight from a pilot company session or observation."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 size-4" />
              Add Insight
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((insight) => {
            const Icon = INSIGHT_TYPES.find((t) => t.value === insight.insight_type)?.icon ?? Target;
            return (
              <div
                key={insight.id}
                className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-muted/50 p-1.5">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{insight.title}</h3>
                        <Badge variant="outline" className={cn("text-[10px]", PRIORITY_COLORS[insight.priority ?? "medium"])}>
                          {insight.priority}
                        </Badge>
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_COLORS[insight.status ?? "open"])}>
                          {(insight.status ?? "open").replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {(INSIGHT_TYPES.find((t) => t.value === insight.insight_type)?.label ?? insight.insight_type)}
                        </Badge>
                      </div>
                      {insight.description && (
                        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">
                          {insight.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{formatDate(insight.created_at)}</span>
                        {insight.source && <span>Source: {insight.source}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {insight.status !== "resolved" && insight.status !== "wont_fix" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatus(insight.id, "resolved")}
                        title="Mark resolved"
                        className="text-green-600 hover:text-green-700"
                      >
                        <CheckCircle2 className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(insight.id, insight.title)}
                      className="text-destructive/70 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Insight Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Insight</DialogTitle>
            <DialogDescription>
              Record a friction point, feature request, bug, or other observation from a pilot company.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Insight Type</Label>
                <Select value={form.insightType} onValueChange={(v) => setForm({ ...form, insightType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSIGHT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ins-title">Title *</Label>
              <Input
                id="ins-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Brief title for this insight"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ins-desc">Description</Label>
              <Textarea
                id="ins-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Detailed description of the observation..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy || !form.title.trim()}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add Insight
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
