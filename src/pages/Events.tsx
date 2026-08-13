import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import {
  EmptyPanel,
  EventStatusBadge,
  PageHeader,
  SeverityBadge,
  StatCard,
  formatDate,
} from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSearch,
  Loader2,
  Lock,
  Radar,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types (mirror of the server surface — nothing hardcoded)
// ---------------------------------------------------------------------------

interface EventRow {
  _id: Id<"events">;
  eventType: string;
  provider: string;
  status: string;
  sourceResourceId: string;
  connectorName: string | null;
  eventName: string;
  resourceName: string;
  summary: string | null;
  intelligence: Record<string, unknown> | null;
  actionId: Id<"toolActions"> | null;
  occurredAt: number;
  receivedAt: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  sourceMechanism: string;
  payload: Record<string, unknown>;
  duplicateOf: Id<"events"> | null;
}

interface StatsResult {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  duplicates: number;
  actionsTriggered: number;
  retried: number;
  avgProcessingMs: number | null;
  sourceMechanisms: string[];
}

interface PolicyRow {
  eventType: string;
  name: string;
  description: string;
  sourceMechanism: string;
  handlerId: string | null;
  policy: {
    _id: Id<"eventPolicies">;
    eventType: string;
    enabled: boolean;
    autoLowRiskWrite: boolean;
  } | null;
}

interface NotificationItem {
  _id: Id<"notifications">;
  severity: string;
  title: string;
  description: string | null;
  sourceEventId: Id<"events"> | null;
  actionId: Id<"toolActions"> | null;
  read: boolean;
  createdAt: number;
}

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

const EVENT_TYPE_LABELS: Record<string, string> = {
  "drive.file_created": "File created",
  "drive.file_updated": "File updated",
  "drive.file_deleted": "File deleted",
  "drive.file_moved": "File moved",
  "drive.permission_changed": "Sharing changed",
};

export default function Events() {
  const navigate = useNavigate();
  const events = useQuery(api.events.listEvents, {});
  const stats = useQuery(api.events.eventStats);
  const policies = useQuery(api.events.listEventPolicies);
  const notifications = useQuery(api.events.listNotifications, {});
  const workspace = useQuery(api.tenants.getMyWorkspace);

  const retryEvent = useMutation(api.events.retryEvent);
  const setEventPolicy = useMutation(api.events.setEventPolicy);
  const markRead = useMutation(api.events.markNotificationRead);

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<Id<"events"> | null>(null);
  const [retrying, setRetrying] = useState<Id<"events"> | null>(null);
  const [busyPolicy, setBusyPolicy] = useState<string | null>(null);

  const isManager = MANAGER_ROLES.includes(
    workspace?.membership?.role as (typeof MANAGER_ROLES)[number],
  );

  const detail = useQuery(
    api.events.getEventDetail,
    selectedId ? { eventId: selectedId } : "skip",
  ) as unknown as DetailResult | undefined;

  const statValues = useMemo(() => {
    const s = stats as StatsResult | undefined;
    return {
      total: s?.total ?? 0,
      processed: s?.byStatus.processed ?? 0,
      failed: s?.byStatus.failed ?? 0,
      retrying: s?.byStatus.retrying ?? 0,
      ignored: s?.byStatus.ignored ?? 0,
      duplicates: s?.duplicates ?? 0,
      actionsTriggered: s?.actionsTriggered ?? 0,
      avgMs: s?.avgProcessingMs ?? null,
    };
  }, [stats]);

  const filtered = useMemo(() => {
    const list = (events as EventRow[] | undefined) ?? [];
    return list.filter(
      (e) =>
        (statusFilter === "all" || e.status === statusFilter) &&
        (typeFilter === "all" || e.eventType === typeFilter),
    );
  }, [events, statusFilter, typeFilter]);

  const eventTypes = useMemo(() => {
    const list = (events as EventRow[] | undefined) ?? [];
    return Array.from(new Set(list.map((e) => e.eventType))).sort();
  }, [events]);

  const handleRetry = async (eventId: Id<"events">) => {
    setRetrying(eventId);
    try {
      const res = await retryEvent({ eventId });
      if (!res.ok) toast.error(res.reason ?? "Could not retry the event.");
      else toast.success("Event re-queued for processing.");
    } catch {
      toast.error("Could not retry the event.");
    } finally {
      setRetrying(null);
    }
  };

  const handlePolicyToggle = async (
    row: PolicyRow,
    key: "enabled" | "autoLowRiskWrite",
    value: boolean,
  ) => {
    if (!isManager) {
      toast.error("Only managers and above can change event policies.");
      return;
    }
    setBusyPolicy(row.eventType);
    try {
      await setEventPolicy({
        eventType: row.eventType,
        enabled: key === "enabled" ? value : row.policy?.enabled ?? true,
        autoLowRiskWrite:
          key === "autoLowRiskWrite" ? value : row.policy?.autoLowRiskWrite ?? false,
      });
      toast.success(`${EVENT_TYPE_LABELS[row.eventType] ?? row.eventType} policy updated.`);
    } catch {
      toast.error("Only managers and above can change event policies.");
    } finally {
      setBusyPolicy(null);
    }
  };

  const handleMarkRead = async (id: Id<"notifications">) => {
    try {
      await markRead({ id });
    } catch {
      // non-fatal
    }
  };

  const notifItems = (notifications as { items: NotificationItem[] } | undefined)?.items ?? [];
  const unreadCount =
    (notifications as { unreadCount: number } | undefined)?.unreadCount ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Event intelligence"
        title="Events"
        description="What happened in your connected systems, what Atlas understood, and what it did — every event recorded, tenant-scoped, idempotent."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
              <Clock className="mr-1 size-3" />
              Source: Google Drive · polling · 5 min
            </Badge>
            {unreadCount > 0 && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300">
                <Bell className="mr-1 size-3" />
                {unreadCount} unread
              </Badge>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Activity} label="Events received" value={statValues.total} hint="All persisted records" />
        <StatCard
          icon={CheckCircle2}
          label="Processed"
          value={statValues.processed}
          hint={statValues.avgMs ? `avg ${statValues.avgMs}ms` : "awaiting events"}
          accent="text-emerald-600 dark:text-emerald-300"
        />
        <StatCard
          icon={Zap}
          label="Actions triggered"
          value={statValues.actionsTriggered}
          hint="Through the tool runtime"
          accent="text-violet-600 dark:text-violet-300"
        />
        <StatCard
          icon={statValues.failed > 0 ? AlertTriangle : ShieldCheck}
          label="Failed / retrying"
          value={`${statValues.failed} / ${statValues.retrying}`}
          hint={`${statValues.duplicates} duplicates deduped`}
          accent={statValues.failed > 0 ? "text-rose-600 dark:text-rose-300" : "text-sky-600 dark:text-sky-300"}
        />
      </div>

      {/* Filters + list */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Radar className="size-4 text-cyan-600 dark:text-cyan-300" />
            Event activity
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {filtered.length} shown
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="processed">Processed</SelectItem>
                <SelectItem value="retrying">Retrying</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="Event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {eventTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {EVENT_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {events === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading events…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyPanel
            icon={Radar}
            title={events.length === 0 ? "No events yet" : "No events match this filter"}
            description={
              events.length === 0
                ? "Events appear here when Atlas observes real changes in a connected system. Connect Google Drive and changes will be detected by polling every 5 minutes."
                : "Try a different filter."
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((e) => (
              <button
                key={e._id}
                onClick={() => setSelectedId(e._id === selectedId ? null : e._id)}
                className={`w-full rounded-xl border text-left transition-colors ${
                  e._id === selectedId
                    ? "border-cyan-400/40 bg-cyan-400/5"
                    : "border-border/60 bg-card/50 hover:border-border/80 hover:bg-card"
                } px-4 py-3`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <FileSearch className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                  <span className="text-sm font-medium">
                    {e.summary ?? EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
                    {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
                  </Badge>
                  <EventStatusBadge status={e.status} />
                  {e.actionId ? (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300">
                      <Zap className="mr-1 size-3" />
                      action
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{e.connectorName}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                    {e.resourceName}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    {formatDate(e.receivedAt)}
                  </span>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground transition-transform ${
                      e._id === selectedId ? "rotate-90" : ""
                    }`}
                  />
                </div>
                {e.lastError && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                    <AlertTriangle className="size-3" />
                    {e.lastError}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Detail */}
      {detail ? (
        <EventDetailPanel
          detail={detail}
          onClose={() => setSelectedId(null)}
          onRetry={handleRetry}
          retrying={retrying}
          onOpenAction={() => {
            if (detail.action) navigate("/dashboard/actions");
          }}
        />
      ) : null}

      {/* Policies */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-teal-600 dark:text-teal-300" />
            Event automation policies
            {!isManager && (
              <span className="flex items-center gap-1 font-mono text-[10px] font-normal text-muted-foreground">
                <Lock className="size-3" /> managers only
              </span>
            )}
          </h2>
        </div>
        {policies === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading policies…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(policies as PolicyRow[]).map((row) => {
              const enabled = row.policy?.enabled ?? true;
              const autoWrite = row.policy?.autoLowRiskWrite ?? false;
              return (
                <Card key={row.eventType}>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {EVENT_TYPE_LABELS[row.eventType] ?? row.eventType}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {row.description}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase tracking-wide border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
                        {row.sourceMechanism}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/50 pt-3">
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={enabled}
                          disabled={!isManager || busyPolicy === row.eventType}
                          onCheckedChange={(v) => handlePolicyToggle(row, "enabled", v)}
                        />
                        Process events
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={autoWrite}
                          disabled={!isManager || busyPolicy === row.eventType}
                          onCheckedChange={(v) =>
                            handlePolicyToggle(row, "autoLowRiskWrite", v)
                          }
                        />
                        Auto low-risk writes
                      </label>
                      <span className="font-mono text-[10px] text-muted-foreground/70">
                        Reads auto · high-risk always confirmed
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Notifications */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4 text-amber-600 dark:text-amber-300" />
            Notifications
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              in-app · future channels: email, Slack, voice
            </span>
          </h2>
        </div>
        {notifications === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading notifications…
          </div>
        ) : notifItems.length === 0 ? (
          <EmptyPanel
            icon={Bell}
            title="No notifications"
            description="Atlas notifies the workspace when event processing fails or an event-triggered action needs approval."
          />
        ) : (
          <div className="space-y-2">
            {notifItems.map((n) => (
              <button
                key={n._id}
                onClick={() => handleMarkRead(n._id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  n.read
                    ? "border-border/60 bg-card/40"
                    : "border-amber-400/30 bg-amber-400/5"
                } hover:border-border/80`}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  {!n.read && <span className="size-1.5 rounded-full bg-amber-400" />}
                  <SeverityBadge severity={n.severity} />
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    {formatDate(n.createdAt)}
                  </span>
                </div>
                {n.description && (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{n.description}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel — what happened / source / resource / evidence / interpretation
// / result / verification / audit
// ---------------------------------------------------------------------------

interface DetailResult {
  event: EventRow & {
    eventId: string;
    intelligence: Record<string, unknown> | null;
    processingMs: number | null;
    processedAt: number | null;
  };
  connection: {
    name: string;
    accountEmail?: string;
  } | null;
  notifications: NotificationItem[];
  action: {
    _id: Id<"toolActions">;
    status: string;
    toolName: string;
    verificationStatus?: string | null;
    confirmedAt?: number | null;
    confirmedBy?: Id<"users"> | null;
    completedAt?: number | null;
    result?: Record<string, unknown> | null;
    error?: string | null;
  } | null;
}

function EventDetailPanel({
  detail,
  onClose,
  onRetry,
  retrying,
  onOpenAction,
}: {
  detail: DetailResult;
  onClose: () => void;
  onRetry: (eventId: Id<"events">) => void;
  retrying: Id<"events"> | null;
  onOpenAction: () => void;
}) {
  const evt = detail.event;
  const intel = evt.intelligence as Record<string, unknown> | null;
  const evidenceRefs = Array.isArray(intel?.evidenceRefs)
    ? (intel.evidenceRefs as Array<{ kind: string; documentId: string; title?: string }>)
    : [];
  const affectedEntities = Array.isArray(intel?.affectedEntities)
    ? (intel.affectedEntities as Array<{ entityId: string; name: string; entityTypeKey: string }>)
    : [];
  const recommendedAction =
    intel?.recommendedAction as { toolId: string; decision: string } | null;
  const policyApplied =
    intel?.policyApplied as { eventType: string; decision: string; reason: string } | null;
  const canRetry = evt.status === "failed" || evt.status === "retrying";

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );

  return (
    <Card className="border-cyan-400/20 bg-card/60">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Radar className="size-4 text-cyan-600 dark:text-cyan-300" />
            <h3 className="text-sm font-semibold">Event detail</h3>
            <EventStatusBadge status={evt.status} />
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {evt.eventId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canRetry && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={retrying === evt._id}
                onClick={() => onRetry(evt._id)}
              >
                <RefreshCw
                  className={`size-3 ${retrying === evt._id ? "animate-spin" : ""}`}
                />
                Retry
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="What happened">
            <p className="text-sm leading-6">{evt.summary ?? "—"}</p>
            {intel?.knowledgeUpdate ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {String(intel.knowledgeUpdate)}
              </p>
            ) : null}
          </Section>
          <Section title="Source">
            <p className="text-sm">
              {detail.connection?.name ?? evt.eventName}
              {detail.connection?.accountEmail && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {detail.connection.accountEmail}
                </span>
              )}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {evt.eventType} · received {formatDate(evt.receivedAt)} ·{" "}
              {evt.sourceMechanism}
            </p>
          </Section>
          <Section title="Resource">
            <p className="truncate text-sm">{evt.resourceName}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {evt.sourceResourceId}
            </p>
          </Section>
          <Section title="Atlas interpretation">
            <p className="text-xs leading-5 text-muted-foreground">
              {String(intel?.rationale ?? "No interpretation recorded.")}
            </p>
            {policyApplied && (
              <p className="mt-1.5 text-xs">
                <span className="font-mono uppercase tracking-wide text-[10px] text-violet-600 dark:text-violet-300">
                  {policyApplied.decision}
                </span>
                <span className="text-muted-foreground"> — {policyApplied.reason}</span>
              </p>
            )}
          </Section>
          <Section title="Evidence">
            {evidenceRefs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No documents linked.</p>
            ) : (
              evidenceRefs.map((ref, i) => (
                <p key={i} className="text-xs leading-5 text-muted-foreground">
                  <FileSearch className="mr-1 inline size-3 text-teal-600 dark:text-teal-300" />
                  {ref.title ?? ref.kind}
                </p>
              ))
            )}
            {affectedEntities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {affectedEntities.map((en) => (
                  <Badge key={en.entityId} variant="outline" className="font-mono text-[10px]">
                    {en.name}
                  </Badge>
                ))}
              </div>
            )}
          </Section>
          <Section title="Result">
            {evt.status === "processed" ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="size-3" />
                Processed in {evt.processingMs ?? "—"}ms
                {evt.attempts > 1 ? ` (${evt.attempts} attempts)` : ""}
              </p>
            ) : evt.status === "failed" || evt.status === "retrying" ? (
              <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                <AlertTriangle className="size-3" />
                {evt.lastError ?? evt.status} — attempt {evt.attempts}/{evt.maxAttempts}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{evt.status}</p>
            )}
            {recommendedAction && (
              <p className="mt-1.5 text-xs">
                Recommended tool:{" "}
                <span className="font-mono text-[11px]">{recommendedAction.toolId}</span>{" "}
                <span className="text-muted-foreground">({recommendedAction.decision})</span>
              </p>
            )}
          </Section>
        </div>

        {detail.action && (
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Zap className="size-4 text-violet-600 dark:text-violet-300" />
              <span className="text-sm font-medium">Action: {detail.action.toolName}</span>
              <Badge
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-wide border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300"
              >
                {detail.action.status.replace(/_/g, " ")}
              </Badge>
              {detail.action.verificationStatus && (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wide border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                >
                  {detail.action.verificationStatus}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8 gap-1.5 text-xs"
                onClick={onOpenAction}
              >
                Open in Actions
                <ChevronRight className="size-3" />
              </Button>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              This action ran through the Atlas tool runtime — proposal, risk policy,
              confirmation, execution, verification and audit are all recorded in the
              Actions surface.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
