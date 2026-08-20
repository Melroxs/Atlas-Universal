import { api } from "@/lib/api";
import type { PilotOutcomeRow } from "@/lib/api";
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
  DollarSign,
  FileText,
  Loader2,
  Package,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const OUTCOME_TYPES = [
  { value: "revenue_recovery", label: "Revenue Recovery", icon: TrendingUp },
  { value: "supplement_generated", label: "Supplement Generated", icon: FileText },
  { value: "claim_generated", label: "Claim Generated", icon: FileText },
  { value: "package_downloaded", label: "Package Downloaded", icon: Package },
  { value: "workflow_completed", label: "Workflow Completed", icon: Zap },
  { value: "other", label: "Other", icon: Target },
];

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface OutcomeForm {
  outcomeType: string;
  title: string;
  description: string;
  financialImpact: string;
}

const EMPTY_FORM: OutcomeForm = {
  outcomeType: "revenue_recovery",
  title: "",
  description: "",
  financialImpact: "",
};

export default function PilotOutcomes() {
  const outcomes = useQuery(api.pilotIntelligence.listOutcomes);
  const createOutcome = useMutation(api.pilotIntelligence.createOutcome);
  const deleteOutcome = useMutation(api.pilotIntelligence.deleteOutcome);

  const [addOpen, setAddOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [form, setForm] = useState<OutcomeForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const isLoading = outcomes === undefined;

  const filtered = (outcomes ?? []).filter((o) => {
    if (filterType !== "all" && o.outcome_type !== filterType) return false;
    return true;
  });

  const totalRevenue = filtered.reduce(
    (sum, o) => sum + (o.financial_impact ?? 0),
    0,
  );

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setBusy(true);
    try {
      await createOutcome({
        outcomeType: form.outcomeType,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        financialImpact: form.financialImpact ? parseFloat(form.financialImpact) : undefined,
      });
      invalidateQueries();
      toast.success("Outcome recorded");
      setAddOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record outcome");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await deleteOutcome({ id });
      invalidateQueries();
      toast.success("Outcome deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading outcomes…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pilot Intelligence"
        title="Outcomes"
        description="Track revenue recovery results, generated packages, and measurable product outcomes from pilot companies."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Record Outcome
          </Button>
        }
      />

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-600" />
              <span className="text-sm text-muted-foreground">Total Outcomes:</span>
              <span className="font-semibold">{filtered.length}</span>
            </div>
            {totalRevenue > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign className="size-4 text-emerald-600" />
                <span className="text-sm text-muted-foreground">Revenue Tracked:</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  ${totalRevenue.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {OUTCOME_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel icon={TrendingUp}
          title="No outcomes recorded yet"
          description="Record the first measurable outcome from a pilot company."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 size-4" />
              Record Outcome
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((outcome) => {
            const type = OUTCOME_TYPES.find((t) => t.value === outcome.outcome_type);
            const Icon = type?.icon ?? Target;
            return (
              <div
                key={outcome.id}
                className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-900/30">
                      <Icon className="size-4 text-emerald-600 dark:text-emerald-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{outcome.title}</h3>
                        <Badge variant="secondary" className="text-[10px]">
                          {type?.label ?? outcome.outcome_type}
                        </Badge>
                        {outcome.financial_impact != null && outcome.financial_impact > 0 && (
                          <Badge
                            variant="outline"
                            className="border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          >
                            ${outcome.financial_impact.toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      {outcome.description && (
                        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">
                          {outcome.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{formatDate(outcome.created_at)}</span>
                        {outcome.evidence_count != null && outcome.evidence_count > 0 && (
                          <span>{outcome.evidence_count} evidence items</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(outcome.id, outcome.title)}
                    className="text-destructive/70 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record Outcome Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Outcome</DialogTitle>
            <DialogDescription>
              Record a measurable outcome — revenue recovery, supplement generated, package downloaded, etc.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Outcome Type</Label>
                <Select value={form.outcomeType} onValueChange={(v) => setForm({ ...form, outcomeType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="out-financial">Financial Impact ($)</Label>
                <Input
                  id="out-financial"
                  type="number"
                  value={form.financialImpact}
                  onChange={(e) => setForm({ ...form, financialImpact: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="out-title">Title *</Label>
              <Input
                id="out-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Brief title for this outcome"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="out-desc">Description</Label>
              <Textarea
                id="out-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the outcome..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy || !form.title.trim()}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Record Outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
