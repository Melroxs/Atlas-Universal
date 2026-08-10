// ---------------------------------------------------------------------------
// Atlas — Daily Briefing Assembly (pure)
//
// Turns a computed organization-state snapshot into a real daily briefing.
// Every item must be backed by actual Atlas data. No filler, no fabrication:
// if a section is empty it says so, honestly.
// ---------------------------------------------------------------------------

import type { RiskFinding } from "./risk";
import type { DecisionType, RiskLevel, UrgencyLevel } from "./decision";

export interface BriefingItem {
  id: string;
  section: "attention" | "changes" | "opportunities" | "actions";
  title: string;
  detail: string;
  severity: RiskLevel | "info";
  urgency: UrgencyLevel;
  confidence: number;
  evidenceState: "verified" | "inferred";
  sourceRef?: string;
  kind: string;
}

export interface OrganizationStateInput {
  tenantId: string;
  now: number;
  timezone: string;
  pendingApprovals: Array<{
    id: string;
    title: string;
    createdAt: number;
    expiresAt?: number | null;
  }>;
  failedWorkflows: Array<{ id: string; name: string; failureReason?: string | null }>;
  activeWorkflows: Array<{ id: string; name: string; startedAt: number }>;
  stalledWorkflows: Array<{ id: string; name: string; startedAt: number }>;
  recentEvents: Array<{ id: string; eventType: string; receivedAt: number }>;
  authorityChanges: Array<{
    id: string;
    title: string;
    changeType: string;
    effectiveAt?: number | null;
    status: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    summary: string;
    priority: RiskLevel;
    confidence: number;
  }>;
  openDecisions: Array<{
    id: string;
    type: DecisionType;
    title: string;
    summary: string;
    riskLevel: RiskLevel;
    urgency: UrgencyLevel;
    confidence: number;
  }>;
  risks: RiskFinding[];
  overdueItems: Array<{ id: string; title: string; kind: string }>;
}

/** Build the briefing — derived entirely from the snapshot input. */
export function buildBriefing(state: OrganizationStateInput): BriefingItem[] {
  const items: BriefingItem[] = [];

  // --- Needs attention --------------------------------------------------------
  for (const o of state.overdueItems) {
    items.push({
      id: `attention-overdue-${o.id}`,
      section: "attention",
      title: `Overdue: ${o.title}`,
      detail: `This ${o.kind} has passed its expected deadline and needs a decision.`,
      severity: "high",
      urgency: "high",
      confidence: 0.9,
      evidenceState: "verified",
      sourceRef: o.id,
      kind: "overdue",
    });
  }
  for (const w of state.failedWorkflows) {
    items.push({
      id: `attention-wf-${w.id}`,
      section: "attention",
      title: `Failed workflow: ${w.name}`,
      detail: w.failureReason ?? "The workflow failed during execution and needs review.",
      severity: "high",
      urgency: "high",
      confidence: 1,
      evidenceState: "verified",
      sourceRef: w.id,
      kind: "workflow_failure",
    });
  }
  for (const a of state.pendingApprovals) {
    const expired = a.expiresAt && a.expiresAt < state.now;
    items.push({
      id: `attention-approval-${a.id}`,
      section: "attention",
      title: `Approval waiting: ${a.title}`,
      detail: expired
        ? "This approval has passed its deadline."
        : `Waiting since ${new Date(a.createdAt).toISOString().slice(0, 10)}.`,
      severity: expired ? "high" : "medium",
      urgency: expired ? "high" : "medium",
      confidence: 1,
      evidenceState: "verified",
      sourceRef: a.id,
      kind: "approval",
    });
  }
  for (const r of state.risks) {
    if (r.severity === "high") {
      items.push({
        id: `attention-risk-${r.id}`,
        section: "attention",
        title: `High-severity risk: ${r.title}`,
        detail: `${r.inferredRisk} ${r.potentialConsequence}`,
        severity: "high",
        urgency: "medium",
        confidence: r.confidence,
        evidenceState: r.evidenceState,
        sourceRef: r.sourceRef,
        kind: "risk",
      });
    }
  }

  // --- Important changes -------------------------------------------------------
  for (const e of state.recentEvents.slice(0, 8)) {
    items.push({
      id: `change-event-${e.id}`,
      section: "changes",
      title: `System event: ${e.eventType}`,
      detail: `Received ${new Date(e.receivedAt).toISOString().slice(0, 10)}.`,
      severity: "info",
      urgency: "low",
      confidence: 1,
      evidenceState: "verified",
      sourceRef: e.id,
      kind: "event",
    });
  }
  for (const a of state.authorityChanges) {
    items.push({
      id: `change-authority-${a.id}`,
      section: "changes",
      title: `Authority update: ${a.title}`,
      detail: `${a.changeType.replace(/_/g, " ")}${a.effectiveAt ? ` · effective ${new Date(a.effectiveAt).toISOString().slice(0, 10)}` : ""} · ${a.status.replace(/_/g, " ")}`,
      severity: a.status === "pending_review" ? "medium" : "info",
      urgency: a.effectiveAt && a.effectiveAt - state.now < 14 * 86_400_000 ? "medium" : "low",
      confidence: 0.9,
      evidenceState: "verified",
      sourceRef: a.id,
      kind: "authority",
    });
  }

  // --- Opportunities ------------------------------------------------------------
  for (const o of state.opportunities) {
    items.push({
      id: `opp-${o.id}`,
      section: "opportunities",
      title: `Potential opportunity: ${o.title}`,
      detail: o.summary,
      severity: o.priority,
      urgency: "medium",
      confidence: o.confidence,
      evidenceState: o.confidence >= 0.7 ? "inferred" : "inferred",
      sourceRef: o.id,
      kind: "opportunity",
    });
  }

  // --- Recommended actions --------------------------------------------------------
  for (const d of state.openDecisions.slice(0, 8)) {
    items.push({
      id: `action-decision-${d.id}`,
      section: "actions",
      title: `${d.type.replace(/_/g, " ")}: ${d.title}`,
      detail: d.summary,
      severity: d.riskLevel,
      urgency: d.urgency,
      confidence: d.confidence,
      evidenceState: "inferred",
      sourceRef: d.id,
      kind: "decision",
    });
  }

  return items;
}

/** Honest summary counts per section — zero sections say so, never padding. */
export function briefingSummary(items: BriefingItem[]): {
  attention: number;
  changes: number;
  opportunities: number;
  actions: number;
  highPriority: number;
} {
  return {
    attention: items.filter((i) => i.section === "attention").length,
    changes: items.filter((i) => i.section === "changes").length,
    opportunities: items.filter((i) => i.section === "opportunities").length,
    actions: items.filter((i) => i.section === "actions").length,
    highPriority: items.filter((i) => i.severity === "high").length,
  };
}

/** Greeting phrase — timezone-aware, never fabricated content. */
export function greeting(now: number, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  if (hour < 5) return "Good evening — here's the state of things:";
  if (hour < 12) return "Good morning — here's what matters today:";
  if (hour < 17) return "Good afternoon — here's what matters now:";
  return "Good evening — here's what matters now:";
}
