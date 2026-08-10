// ---------------------------------------------------------------------------
// Everest — Organizational State Engine
//
// §16. Atlas derives what is happening in the company from REAL records only:
//   entities · workflows · approvals · actions · events · decisions ·
//   connections · authority knowledge. It never fabricates metrics — every
//   state claim traces back to an actual Atlas record (evidence reference).
//
// §17. Temporal interpretation uses the organization's calendar context
//   (timezone, business days, hours, holidays) via the Everest temporalOps.
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

import { deadlineStatus } from "./temporalOps";

export type StateItemKind =
  | "active_work"
  | "stalled_work"
  | "overdue_work"
  | "pending_approval"
  | "failed_workflow"
  | "recent_event"
  | "recent_action"
  | "unresolved_issue"
  | "authority_change"
  | "stale_knowledge"
  | "missing_information"
  | "upcoming_deadline"
  | "bottleneck"
  | "connector_health";

export interface StateEvidence {
  kind: string;
  sourceId: string;
  title: string;
  snippet?: string;
  timestamp?: number;
  evidenceState: "verified" | "inferred" | "unavailable";
}

export interface StateItem {
  kind: StateItemKind;
  title: string;
  detail: string;
  evidence: StateEvidence[];
  entityRef?: string;
  confidence: number;
  urgency: "low" | "medium" | "high";
  timestamp?: number;
}

export interface OrgStateInput {
  now: number;
  /** Calendar context — matches the organizationContext shape. */
  timezone: string;
  businessDays?: number[];
  businessHours?: { start?: string; end?: string };
  holidays?: string[];
  /** Entities of project-ish/work-item types with their status. */
  entities: Array<{
    id: string;
    name: string;
    entityTypeKey: string;
    status?: string;
    lastObservedAt?: number;
    attributes?: Record<string, unknown>;
  }>;
  workflows: Array<{
    id: string;
    definitionId: string;
    status: string;
    startedAt: number;
    updatedAt: number;
    failureReason?: string | null;
  }>;
  approvals: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: number;
    expiresAt?: number | null;
  }>;
  actions: Array<{
    id: string;
    toolId: string;
    status: string;
    startedAt?: number;
    completedAt?: number;
    error?: string | null;
  }>;
  events: Array<{ id: string; eventType: string; receivedAt: number }>;
  decisions: Array<{ id: string; title: string; status: string; createdAt: number }>;
  authorityChanges: Array<{
    id: string;
    knowledgeTitle: string;
    status: string;
    severity: string;
    changeType: string;
  }>;
  staleKnowledge: Array<{ knowledgeId: string; title: string; status: string }>;
  connections: Array<{
    id: string;
    provider: string;
    status: string;
    healthStatus?: string | null;
    lastSyncAt?: number;
  }>;
}

const PROJECT_TYPES = new Set([
  "project",
  "claim",
  "job",
  "work_order",
  "workorder",
  "ticket",
  "opportunity",
  "deal",
  "case",
]);
const WORK_ITEM_TYPES = new Set([...PROJECT_TYPES, "document", "contract", "invoice"]);

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(a: number, b: number): number {
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** §16 — derive the full organizational state snapshot from real records. */
export function buildOrganizationalState(input: OrgStateInput): StateItem[] {
  const out: StateItem[] = [];
  const now = input.now;
  const calendarCfg = {
    timezone: input.timezone,
    businessDays: input.businessDays ?? [1, 2, 3, 4, 5],
    businessHours: {
      start: input.businessHours?.start ?? "09:00",
      end: input.businessHours?.end ?? "17:00",
    },
    holidays: input.holidays ?? [],
  };

  // --- Active work ----------------------------------------------------------
  const activeWork = input.entities
    .filter((e) => PROJECT_TYPES.has(e.entityTypeKey))
    .filter((e) => {
      const st = (e.status ?? "active").toLowerCase();
      return ["active", "open", "in_progress", "running", "pending", "proposed"].includes(st);
    });
  if (activeWork.length > 0) {
    out.push({
      kind: "active_work",
      title: `${activeWork.length} active work item${activeWork.length === 1 ? "" : "s"}`,
      detail: activeWork.slice(0, 5).map((e) => e.name).join(" · "),
      evidence: activeWork.slice(0, 5).map((e) => ({
        kind: "entity",
        sourceId: e.id,
        title: e.name,
        snippet: `type ${e.entityTypeKey} · status ${e.status ?? "active"}`,
        timestamp: e.lastObservedAt ?? undefined,
        evidenceState: "verified",
      })),
      confidence: 1,
      urgency: "low",
    });
  }

  // --- Stalled work (§16) -----------------------------------------------------
  // No events/actions against the item for N days, or a workflow running
  // far beyond its expected window.
  const stalled = activeWork.filter(
    (e) => e.lastObservedAt && now - e.lastObservedAt > 7 * 86_400_000,
  );
  if (stalled.length > 0) {
    out.push({
      kind: "stalled_work",
      title: `${stalled.length} work item${stalled.length === 1 ? "" : "s"} show no activity for 7+ days`,
      detail: stalled
        .map((e) => `${e.name} (last activity ${fmt(e.lastObservedAt!)})`)
        .join(" · "),
      evidence: stalled.map((e) => ({
        kind: "entity",
        sourceId: e.id,
        title: e.name,
        snippet: `No observed activity since ${fmt(e.lastObservedAt!)}`,
        timestamp: e.lastObservedAt!,
        evidenceState: "verified",
      })),
      confidence: 0.85,
      urgency: "medium",
    });
  }

  // --- Failed workflows ---------------------------------------------------------
  const failed = input.workflows.filter((w) => w.status === "failed");
  for (const w of failed) {
    out.push({
      kind: "failed_workflow",
      title: `Workflow failed: ${w.definitionId}`,
      detail: w.failureReason ?? "A workflow failed during execution.",
      evidence: [
        {
          kind: "workflow",
          sourceId: w.id,
          title: w.definitionId,
          snippet: w.failureReason ?? "No failure reason recorded.",
          timestamp: w.updatedAt,
          evidenceState: "verified",
        },
      ],
      confidence: 1,
      urgency: "high",
    });
  }

  // --- Stalled / long-running workflows -------------------------------------------
  const running = input.workflows.filter((w) => w.status === "running");
  for (const w of running) {
    const hours = (now - w.startedAt) / 3600_000;
    if (hours > 48) {
      out.push({
        kind: "bottleneck",
        title: `Workflow running ${Math.round(hours)}h: ${w.definitionId}`,
        detail: `Started ${fmt(w.startedAt)} and still running beyond the 48h expected window.`,
        evidence: [
          {
            kind: "workflow",
            sourceId: w.id,
            title: w.definitionId,
            snippet: `Running ${Math.round(hours)}h since ${fmt(w.startedAt)}`,
            timestamp: w.startedAt,
            evidenceState: "verified",
          },
        ],
        confidence: 0.8,
        urgency: "medium",
      });
    }
  }

  // --- Pending approvals + deadlines (§17) -----------------------------------------
  const pending = input.approvals.filter((a) => a.status === "pending");
  for (const a of pending) {
    const dl = a.expiresAt
      ? deadlineStatus(a.expiresAt, now, calendarCfg, 2)
      : null;
    if (dl?.status === "overdue") {
      out.push({
        kind: "overdue_work",
        title: `Approval overdue: ${a.title}`,
        detail: `Created ${fmt(a.createdAt)} — the approval deadline has passed (${dl.label}).`,
        evidence: [
          {
            kind: "approval",
            sourceId: a.id,
            title: a.title,
            snippet: `Deadline ${fmt(a.expiresAt!)} passed`,
            timestamp: a.createdAt,
            evidenceState: "verified",
          },
        ],
        confidence: 1,
        urgency: "high",
      });
    } else if (dl?.status === "due_soon" || dl?.status === "due_today") {
      out.push({
        kind: "upcoming_deadline",
        title: `Approval due soon: ${a.title}`,
        detail: `${dl.label} — expires ${fmt(a.expiresAt!)}.`,
        evidence: [
          {
            kind: "approval",
            sourceId: a.id,
            title: a.title,
            snippet: dl.label,
            timestamp: a.expiresAt!,
            evidenceState: "verified",
          },
        ],
        confidence: 1,
        urgency: "medium",
      });
    } else {
      out.push({
        kind: "pending_approval",
        title: `Approval waiting: ${a.title}`,
        detail: `Pending since ${fmt(a.createdAt)} — review and decide.`,
        evidence: [
          {
            kind: "approval",
            sourceId: a.id,
            title: a.title,
            snippet: `Created ${fmt(a.createdAt)}`,
            timestamp: a.createdAt,
            evidenceState: "verified",
          },
        ],
        confidence: 1,
        urgency: "low",
      });
    }
  }

  // --- Unresolved issues (open decisions) --------------------------------------------
  const openDecisions = input.decisions.filter((d) => d.status === "open");
  if (openDecisions.length > 0) {
    out.push({
      kind: "unresolved_issue",
      title: `${openDecisions.length} open operational issue${openDecisions.length === 1 ? "" : "s"}`,
      detail: openDecisions
        .slice(0, 5)
        .map((d) => d.title)
        .join(" · "),
      evidence: openDecisions.slice(0, 5).map((d) => ({
        kind: "decision",
        sourceId: d.id,
        title: d.title,
        snippet: `Open since ${fmt(d.createdAt)}`,
        timestamp: d.createdAt,
        evidenceState: "verified",
      })),
      confidence: 0.9,
      urgency: "medium",
    });
  }

  // --- Recent events / actions -----------------------------------------------------------
  const recentEvents = input.events.filter((e) => now - e.receivedAt <= 7 * 86_400_000);
  if (recentEvents.length > 0) {
    const byType = new Map<string, number>();
    for (const e of recentEvents) {
      byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
    }
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    out.push({
      kind: "recent_event",
      title: `${recentEvents.length} event${recentEvents.length === 1 ? "" : "s"} in the last 7 days`,
      detail: top.map(([t, n]) => `${t.replace(/_/g, " ")} ×${n}`).join(" · "),
      evidence: recentEvents.slice(0, 5).map((e) => ({
        kind: "event",
        sourceId: e.id,
        title: e.eventType.replace(/_/g, " "),
        snippet: `Received ${fmt(e.receivedAt)}`,
        timestamp: e.receivedAt,
        evidenceState: "verified",
      })),
      confidence: 1,
      urgency: "low",
    });
  }
  const recentActions = input.actions.filter((a) => {
    const at = a.completedAt ?? a.startedAt;
    return at && now - at <= 7 * 86_400_000;
  });
  if (recentActions.length > 0) {
    out.push({
      kind: "recent_action",
      title: `${recentActions.length} tool action${recentActions.length === 1 ? "" : "s"} in the last 7 days`,
      detail: recentActions
        .slice(0, 5)
        .map((a) => a.toolId)
        .join(" · "),
      evidence: recentActions.slice(0, 5).map((a) => ({
        kind: "action",
        sourceId: a.id,
        title: a.toolId,
        snippet: a.status,
        timestamp: a.completedAt ?? a.startedAt,
        evidenceState: "verified",
      })),
      confidence: 1,
      urgency: "low",
    });
  }

  // --- Repeated failures = bottleneck ------------------------------------------------------
  const failedActions = input.actions.filter((a) => a.status === "failed");
  const byTool = new Map<string, number>();
  for (const a of failedActions) {
    byTool.set(a.toolId, (byTool.get(a.toolId) ?? 0) + 1);
  }
  for (const [toolId, count] of byTool) {
    if (count >= 2) {
      out.push({
        kind: "bottleneck",
        title: `Repeated action failures: ${toolId}`,
        detail: `${count} failed attempts recorded. Investigate before retrying.`,
        evidence: failedActions
          .filter((a) => a.toolId === toolId)
          .slice(0, 3)
          .map((a) => ({
            kind: "action",
            sourceId: a.id,
            title: a.toolId,
            snippet: a.error ?? "Action failed.",
            timestamp: a.completedAt ?? a.startedAt,
            evidenceState: "verified",
          })),
        confidence: 0.9,
        urgency: "high",
      });
    }
  }

  // --- Authority changes pending review -------------------------------------------------------
  const pendingChanges = input.authorityChanges.filter(
    (a) => a.status === "pending_review",
  );
  for (const a of pendingChanges) {
    out.push({
      kind: "authority_change",
      title: `Authority change needs review: ${a.knowledgeTitle}`,
      detail: `${a.changeType.replace(/_/g, " ")} — severity ${a.severity}.`,
      evidence: [
        {
          kind: "authority",
          sourceId: a.id,
          title: a.knowledgeTitle,
          snippet: `${a.changeType.replace(/_/g, " ")} · severity ${a.severity}`,
          evidenceState: "verified",
        },
      ],
      confidence: 0.9,
      urgency: a.severity === "high" ? "high" : "medium",
    });
  }

  // --- Stale knowledge ------------------------------------------------------------------------
  const stale = input.staleKnowledge.filter((k) => k.status === "superseded" || k.status === "expired");
  if (stale.length > 0) {
    out.push({
      kind: "stale_knowledge",
      title: `${stale.length} knowledge record${stale.length === 1 ? "" : "s"} superseded or expired`,
      detail: stale.slice(0, 4).map((k) => k.title).join(" · "),
      evidence: stale.slice(0, 4).map((k) => ({
        kind: "authority",
        sourceId: k.knowledgeId,
        title: k.title,
        snippet: `status ${k.status}`,
        evidenceState: "verified",
      })),
      confidence: 0.8,
      urgency: "low",
    });
  }

  // --- Connector health --------------------------------------------------------------------------
  for (const c of input.connections) {
    const unhealthy = c.healthStatus === "error" || c.status !== "connected";
    if (unhealthy) {
      out.push({
        kind: "connector_health",
        title: `Connector needs attention: ${c.provider}`,
        detail: `${c.status}${c.healthStatus ? ` · health ${c.healthStatus}` : ""}${c.lastSyncAt ? ` · last sync ${fmt(c.lastSyncAt)}` : ""}.`,
        evidence: [
          {
            kind: "connector",
            sourceId: c.id,
            title: c.provider,
            snippet: c.healthStatus ?? c.status,
            timestamp: c.lastSyncAt,
            evidenceState: "verified",
          },
        ],
        confidence: 1,
        urgency: "medium",
      });
    }
  }

  // --- Missing information (honest) ------------------------------------------------------------------
  if (input.entities.length === 0) {
    out.push({
      kind: "missing_information",
      title: "Knowledge graph is empty",
      detail:
        "No entities exist in this workspace yet. Organization-level intelligence is unavailable until documents are ingested or a connector syncs.",
      evidence: [],
      confidence: 1,
      urgency: "low",
    });
  }
  if (input.workflows.length === 0 && input.events.length === 0) {
    out.push({
      kind: "missing_information",
      title: "No operational signals yet",
      detail:
        "No workflows or events recorded. Atlas has nothing to monitor — connect a system or run a workflow to begin.",
      evidence: [],
      confidence: 1,
      urgency: "low",
    });
  }

  return out;
}

/** §17 — short, timezone-aware summary of the current state ("What happened
 *  today?"-style status answers). Never fabricates counts. */
export function stateSummary(input: OrgStateInput): string {
  const items = buildOrganizationalState(input);
  const urgent = items.filter((i) => i.urgency === "high");
  const medium = items.filter((i) => i.urgency === "medium");
  const lines: string[] = [];
  if (urgent.length > 0) {
    lines.push(
      `${urgent.length} item${urgent.length === 1 ? "" : "s"} need attention: ${urgent
        .map((i) => i.title)
        .join("; ")}.`,
    );
  } else {
    lines.push("No high-priority items are currently open.");
  }
  if (medium.length > 0) {
    lines.push(
      `Also worth a look: ${medium
        .slice(0, 4)
        .map((i) => i.title)
        .join("; ")}.`,
    );
  }
  const recent = input.events.filter((e) => input.now - e.receivedAt <= 86_400_000).length;
  const recentActions = input.actions.filter((a) => {
    const at = a.completedAt ?? a.startedAt;
    return at && input.now - at <= 86_400_000;
  }).length;
  lines.push(
    `In the last 24h (${input.timezone}): ${recent} event${recent === 1 ? "" : "s"}, ${recentActions} tool action${recentActions === 1 ? "" : "s"}.`,
  );
  return lines.join(" ");
}

/** Business-day awareness for the summary (timezone label). */
export function timezoneLabel(tz: string): string {
  return tz && tz !== "UTC" ? tz : "UTC (default — configure a timezone in Settings)";
}
