import { api } from "@/lib/api";
import type { PilotSessionRow } from "@/lib/api";
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
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SESSION_TYPES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "checkin", label: "Check-in" },
  { value: "demo", label: "Demo" },
  { value: "training", label: "Training" },
  { value: "feedback", label: "Feedback" },
  { value: "support", label: "Support" },
];

const OUTCOMES = [
  { value: "positive", label: "Positive", icon: ThumbsUp, color: "text-green-600" },
  { value: "neutral", label: "Neutral", icon: Clock, color: "text-gray-500" },
  { value: "needs_followup", label: "Needs Follow-up", icon: MessageSquare, color: "text-amber-600" },
  { value: "negative", label: "Negative", icon: ThumbsDown, color: "text-red-600" },
];

const OUTCOME_COLORS: Record<string, string> = {
  positive: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
  needs_followup: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  negative: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface SessionForm {
  sessionType: string;
  title: string;
  summary: string;
  attendee: string;
  durationMin: string;
  outcome: string;
}

const EMPTY_FORM: SessionForm = {
  sessionType: "checkin",
  title: "",
  summary: "",
  attendee: "",
  durationMin: "",
  outcome: "",
};

export default function PilotSessions() {
  const sessions = useQuery(api.pilotIntelligence.listSessions);
  const companies = useQuery(api.pilotIntelligence.listCompanies);
  const createSession = useMutation(api.pilotIntelligence.createSession);
  const deleteSession = useMutation(api.pilotIntelligence.deleteSession);

  const [addOpen, setAddOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [form, setForm] = useState<SessionForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const isLoading = sessions === undefined;

  const filtered = (sessions ?? []).filter((s) => {
    if (filterType !== "all" && s.session_type !== filterType) return false;
    return true;
  });

  const companyMap = new Map((companies ?? []).map((c) => [c.id, c.name]));

  const handleCreate = async () => {
    setBusy(true);
    try {
      await createSession({
        sessionType: form.sessionType,
        title: form.title.trim() || undefined,
        summary: form.summary.trim() || undefined,
        attendee: form.attendee.trim() || undefined,
        durationMin: form.durationMin ? parseInt(form.durationMin, 10) : undefined,
        outcome: form.outcome || undefined,
      });
      invalidateQueries();
      toast.success("Session recorded");
      setAddOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record session");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session record?")) return;
    try {
      await deleteSession({ id });
      invalidateQueries();
      toast.success("Session deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading sessions…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pilot Intelligence"
        title="Sessions"
        description="Track onboarding calls, check-ins, demos, training, and feedback sessions with pilot companies."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Record Session
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {SESSION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel icon={Calendar}
          title="No sessions recorded yet"
          description="Record your first session with a pilot company."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 size-4" />
              Record Session
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((session) => {
            const outcome = OUTCOMES.find((o) => o.value === session.outcome);
            const OutcomeIcon = outcome?.icon ?? Clock;
            return (
              <div
                key={session.id}
                className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-muted/50 p-1.5">
                      <Calendar className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">
                          {(session.title || SESSION_TYPES.find((t) => t.value === session.session_type)?.label) ?? session.session_type}
                        </h3>
                        <Badge variant="secondary" className="text-[10px]">
                          {SESSION_TYPES.find((t) => t.value === session.session_type)?.label ?? session.session_type}
                        </Badge>
                        {session.outcome && (
                          <Badge variant="outline" className={cn("text-[10px]", OUTCOME_COLORS[session.outcome])}>
                            <OutcomeIcon className="mr-1 size-3" />
                            {outcome?.label ?? session.outcome}
                          </Badge>
                        )}
                      </div>
                      {session.summary && (
                        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">
                          {session.summary}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{formatDate(session.created_at)}</span>
                        {session.attendee && <span>Attendee: {session.attendee}</span>}
                        {session.duration_min && <span>{session.duration_min} min</span>}
                        {session.company_id && companyMap.has(session.company_id) && (
                          <Badge variant="secondary" className="text-[10px]">
                            {companyMap.get(session.company_id)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(session.id)}
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

      {/* Record Session Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Session</DialogTitle>
            <DialogDescription>
              Log a session with a pilot company — onboarding, check-in, demo, training, or feedback.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Session Type</Label>
                <Select value={form.sessionType} onValueChange={(v) => setForm({ ...form, sessionType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Outcome</Label>
                <Select value={form.outcome} onValueChange={(v) => setForm({ ...form, outcome: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ses-title">Title</Label>
              <Input
                id="ses-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Brief title for this session"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ses-attendee">Attendee</Label>
                <Input
                  id="ses-attendee"
                  value={form.attendee}
                  onChange={(e) => setForm({ ...form, attendee: e.target.value })}
                  placeholder="Who attended"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ses-duration">Duration (min)</Label>
                <Input
                  id="ses-duration"
                  type="number"
                  value={form.durationMin}
                  onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
                  placeholder="30"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ses-summary">Summary / Notes</Label>
              <Textarea
                id="ses-summary"
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                placeholder="What happened in this session..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Record Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
