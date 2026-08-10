// ---------------------------------------------------------------------------
// Everest — Investigation Engine
//
// §23. Reusable, multi-source investigations: given a question and resolved
// entities, Atlas gathers events, documents, workflows, approvals, actions,
// memories and authority context; identifies blockers; ranks evidence; and
// produces an evidence-grounded explanation + recommended next step. It never
// fabricates missing evidence — unavailable sources are stated as limitations.
//
// §24. Structured, reusable contract (id, tenantId, question, intent,
// entities, evidence, findings, blockers, confidence, recommendedNextStep,
// availableActions, requiredApprovals, limitations, createdAt). Consumed by
// Ask, the dashboard, workflows and future voice — same business logic.
//
// PURE module — deterministic, dependency-free, unit-testable.
// ---------------------------------------------------------------------------

import { confidenceFromEvidence, type DecisionEvidenceRef } from "../ops/decision";

export type InvestigationIntent =
  | "informational"
  | "investigative"
  | "status"
  | "operational"
  | "mixed";

export interface InvestigationEntity {
  entityId: string;
  name: string;
  entityTypeKey?: string;
  matchBasis?: string;
  matchScore?: number;
}

export interface InvestigationEvidence {
  kind: string; // event | workflow | approval | action | document | entity | authority | memory | deadline
  sourceId: string;
  title: string;
  snippet?: string;
  timestamp?: number;
  entityId?: string;
  relevance: number; // 0..1
  evidenceState: "verified" | "inferred" | "uncertain" | "unavailable";
}

export interface InvestigationFinding {
  text: string;
  evidenceIds: string[];
  kind: string;
}

export interface InvestigationBlocker {
  text: string;
  evidenceIds: string[];
  severity: "low" | "medium" | "high";
}

export interface InvestigationResult {
  id: string;
  tenantId: string;
  question: string;
  intent: InvestigationIntent;
  entities: InvestigationEntity[];
  evidence: InvestigationEvidence[];
  findings: InvestigationFinding[];
  blockers: InvestigationBlocker[];
  confidence: number;
  confidenceState: string;
  recommendedNextStep: string;
  availableActions: Array<{ toolId: string; label: string; risk: "low" | "medium" | "high" }>;
  requiredApprovals: string[];
  limitations: string[];
  createdAt: number;
}

export interface InvestigationInput {
  tenantId: string;
  question: string;
  intent: InvestigationIntent;
  now: number;
  /** Entities resolved for the question. */
  entities: InvestigationEntity[];
  /** Raw evidence gathered by the caller (one array per source). */
  events: Array<{ id: string; eventType: string; receivedAt: number; payload?: unknown }>;
  documents: Array<{ id: string; title: string; createdAt?: number }>;
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
  memories: Array<{ id: string; statement: string; memoryType: string; confidence: string }>;
  authority: Array<{
    knowledgeId: string;
    title: string;
    statement: string;
    sourceName: string;
    authorityTier: string;
  }>;
  /** Organizational state items (from the state engine) relevant to the topic. */
  stateItems: Array<{
    kind: string;
    title: string;
    detail: string;
    entityRef?: string;
    urgency: string;
    evidence: Array<{ kind: string; sourceId: string; title: string; snippet?: string; timestamp?: number }>;
  }>;
}

function relevanceScore(query: string, text: string, recency: number | undefined, now: number): number {
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);
  const hay = text.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t)).length;
  let score = tokens.length === 0 ? 0.2 : hits / Math.max(1, tokens.length) * 0.7;
  if (recency) {
    const days = Math.max(0, (now - recency) / 86_400_000);
    score += Math.max(0, 0.3 - days * 0.02);
  }
  return Math.min(1, Math.round(score * 100) / 100);
}

/** §23 — run the investigation pipeline over the gathered evidence. */
export function investigate(input: InvestigationInput): InvestigationResult {
  const now = input.now;
  const q = input.question;
  const evidence: InvestigationEvidence[] = [];
  const findings: InvestigationFinding[] = [];
  const blockers: InvestigationBlocker[] = [];

  // Rank all evidence by relevance to the question + recency.
  const pushEvidence = (
    kind: InvestigationEvidence["kind"],
    sourceId: string,
    title: string,
    snippet: string | undefined,
    timestamp: number | undefined,
    relevance: number,
    entityId?: string,
  ) => {
    evidence.push({
      kind,
      sourceId,
      title,
      snippet,
      timestamp,
      entityId,
      relevance,
      evidenceState: "verified",
    });
  };

  for (const e of input.events) {
    pushEvidence(
      "event",
      e.id,
      e.eventType.replace(/_/g, " "),
      `Received ${new Date(e.receivedAt).toISOString()}`,
      e.receivedAt,
      relevanceScore(q, e.eventType, e.receivedAt, now),
    );
  }
  for (const d of input.documents) {
    pushEvidence(
      "document",
      d.id,
      d.title,
      d.createdAt ? `Created ${new Date(d.createdAt).toISOString().slice(0, 10)}` : undefined,
      d.createdAt,
      relevanceScore(q, d.title, d.createdAt, now),
    );
  }
  for (const w of input.workflows) {
    pushEvidence(
      "workflow",
      w.id,
      `${w.definitionId} — ${w.status}`,
      w.failureReason ?? `Started ${new Date(w.startedAt).toISOString().slice(0, 10)}`,
      w.updatedAt,
      relevanceScore(q, w.definitionId + " " + (w.failureReason ?? ""), w.updatedAt, now),
    );
  }
  for (const a of input.approvals) {
    pushEvidence(
      "approval",
      a.id,
      a.title,
      `${a.status} since ${new Date(a.createdAt).toISOString().slice(0, 10)}${a.expiresAt ? ` · expires ${new Date(a.expiresAt).toISOString().slice(0, 10)}` : ""}`,
      a.expiresAt ?? a.createdAt,
      relevanceScore(q, a.title, a.createdAt, now),
    );
  }
  for (const a of input.actions) {
    pushEvidence(
      "action",
      a.id,
      `${a.toolId} — ${a.status}`,
      a.error ?? undefined,
      a.completedAt ?? a.startedAt,
      relevanceScore(q, a.toolId, a.completedAt ?? a.startedAt, now),
    );
  }
  for (const m of input.memories) {
    pushEvidence(
      "memory",
      m.id,
      m.statement.slice(0, 90),
      m.memoryType,
      undefined,
      relevanceScore(q, m.statement, undefined, now),
    );
  }
  for (const k of input.authority) {
    pushEvidence(
      "authority",
      k.knowledgeId,
      k.title,
      `${k.sourceName} (${k.authorityTier.replace(/_/g, " ")}): ${k.statement.slice(0, 160)}`,
      undefined,
      relevanceScore(q, k.title + " " + k.statement, undefined, now),
    );
  }
  // State items contribute their evidence directly (they are already derived).
  for (const s of input.stateItems) {
    if (s.entityRef && input.entities.some((e) => e.entityId === s.entityRef)) {
      for (const ev of s.evidence) {
        pushEvidence(ev.kind, ev.sourceId, ev.title, ev.snippet, ev.timestamp, 0.9);
      }
    }
  }

  evidence.sort((a, b) => b.relevance - a.relevance);
  const top = evidence.slice(0, 12);

  // --- Findings: observable facts about the entities/topic ---------------------
  const related = (e: InvestigationEvidence) =>
    input.entities.length === 0 ||
    !e.entityId ||
    input.entities.some((en) => en.entityId === e.entityId);

  const failedWorkflows = input.workflows.filter((w) => w.status === "failed");
  for (const w of failedWorkflows.slice(0, 3)) {
    findings.push({
      text: `Workflow "${w.definitionId}" failed${w.failureReason ? `: ${w.failureReason}` : "."}`,
      evidenceIds: evidence.filter((e) => e.kind === "workflow" && e.sourceId === w.id).map((e) => e.sourceId),
      kind: "workflow_failure",
    });
    blockers.push({
      text: `Failed workflow: ${w.definitionId}`,
      evidenceIds: [w.id],
      severity: "high",
    });
  }

  const pendingApprovals = input.approvals.filter((a) => a.status === "pending");
  if (pendingApprovals.length > 0) {
    findings.push({
      text: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} pending${pendingApprovals[0] ? ` — oldest: "${pendingApprovals[0].title}" since ${new Date(pendingApprovals[0].createdAt).toISOString().slice(0, 10)}` : ""}.`,
      evidenceIds: pendingApprovals.map((a) => a.id),
      kind: "pending_approval",
    });
    if (pendingApprovals.some((a) => a.expiresAt && a.expiresAt < now)) {
      blockers.push({
        text: `${pendingApprovals.filter((a) => a.expiresAt && a.expiresAt < now).length} approval deadline(s) passed`,
        evidenceIds: pendingApprovals.filter((a) => a.expiresAt && a.expiresAt < now).map((a) => a.id),
        severity: "high",
      });
    }
  }

  const failedActions = input.actions.filter((a) => a.status === "failed");
  if (failedActions.length > 0) {
    const byTool = new Map<string, number>();
    for (const a of failedActions) byTool.set(a.toolId, (byTool.get(a.toolId) ?? 0) + 1);
    for (const [toolId, count] of byTool) {
      findings.push({
        text: `Tool "${toolId}" failed ${count} time${count === 1 ? "" : "s"}.`,
        evidenceIds: failedActions.filter((a) => a.toolId === toolId).map((a) => a.id),
        kind: "action_failure",
      });
      if (count >= 2) {
        blockers.push({
          text: `Repeated failures for tool "${toolId}"`,
          evidenceIds: failedActions.filter((a) => a.toolId === toolId).map((a) => a.id),
          severity: "medium",
        });
      }
    }
  }

  const runningLong = input.workflows.filter((w) => w.status === "running" && now - w.startedAt > 48 * 3600_000);
  for (const w of runningLong.slice(0, 2)) {
    blockers.push({
      text: `Workflow "${w.definitionId}" has been running ${Math.round((now - w.startedAt) / 3600_000)}h`,
      evidenceIds: [w.id],
      severity: "medium",
    });
  }

  if (input.events.length === 0 && input.workflows.length === 0) {
    findings.push({
      text: "No events or workflows are recorded for this workspace — there is no operational trail to investigate.",
      evidenceIds: [],
      kind: "no_data",
    });
  }

  // --- Confidence over the gathered evidence (never fabricated) -------------------
  const refs: DecisionEvidenceRef[] = top.map((e) => ({
    kind: e.kind,
    sourceId: e.sourceId,
    title: e.title,
    evidenceState: e.evidenceState,
    timestamp: e.timestamp,
  }));
  const confidence = confidenceFromEvidence(refs, 0.5);

  // --- Recommended next step (evidence-grounded) -----------------------------------
  let recommendedNextStep: string;
  if (blockers.length > 0) {
    const topBlocker = blockers.sort((a, b) =>
      b.severity === "high" ? 1 : a.severity === "high" ? -1 : 0,
    )[0];
    recommendedNextStep = `Address the blocker first: ${topBlocker.text}. ${
      topBlocker.severity === "high"
        ? "This likely requires a human decision — route it for approval."
        : "Review the evidence trail and resolve it, then verify the resulting state."
    }`;
  } else if (pendingApprovals.length > 0) {
    recommendedNextStep = `Process the ${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? "" : "s"} to unblock downstream work.`;
  } else if (top.length > 0 || input.stateItems.length > 0) {
    recommendedNextStep =
      "No blockers found. The records show normal activity — if something still looks wrong, check the connector health and recent events.";
  } else {
    recommendedNextStep =
      "Not enough organizational data to recommend a next step — ingest documents or connect a system first.";
  }

  // --- Available actions (advisory; never executed here) ----------------------------
  const availableActions: Array<{ toolId: string; label: string; risk: "low" | "medium" | "high" }> = [];
  if (failedWorkflows.length > 0) {
    availableActions.push({ toolId: "workflow.retry", label: "Retry failed workflows", risk: "medium" });
  }
  if (pendingApprovals.length > 0) {
    availableActions.push({ toolId: "approval.decide", label: "Review pending approvals", risk: "medium" });
  }
  if (failedActions.length > 0) {
    availableActions.push({ toolId: "action.retry", label: "Retry failed tool actions", risk: "medium" });
  }

  const requiredApprovals: string[] = [];
  if (blockers.some((b) => b.severity === "high")) {
    requiredApprovals.push("manager_approval: resolving high-severity blockers");
  }
  if (availableActions.some((a) => a.risk === "medium")) {
    requiredApprovals.push("confirmation: before executing any proposed action");
  }

  const limitations: string[] = [];
  if (input.events.length === 0) limitations.push("No events recorded — recency claims are limited.");
  if (input.documents.length === 0) limitations.push("No documents matched — document evidence is unavailable.");
  if (input.memories.length === 0) limitations.push("No relevant organizational memory found.");
  if (input.authority.length === 0) limitations.push("No matching authoritative knowledge.");
  if (confidence.state === "insufficient_evidence") {
    limitations.push("Evidence is insufficient for a confident conclusion.");
  }

  return {
    id: `inv-${now.toString(36)}-${(input.tenantId ?? "").slice(-6)}`,
    tenantId: input.tenantId,
    question: q,
    intent: input.intent,
    entities: input.entities,
    evidence: top,
    findings,
    blockers,
    confidence: confidence.score,
    confidenceState: confidence.state,
    recommendedNextStep,
    availableActions,
    requiredApprovals,
    limitations,
    createdAt: now,
  };
}

/** §22 — concise, evidence-based "why this matters" explanation. Never
 *  exposes chain-of-thought — only triggers, evidence and interpretation. */
export function investigationExplanation(r: InvestigationResult): string {
  const parts: string[] = [];
  parts.push(`Trigger: "${r.question}"`);
  if (r.entities.length > 0) {
    parts.push(
      `Entity context: ${r.entities.map((e) => e.name).join(", ")}`,
    );
  }
  if (r.findings.length > 0) {
    parts.push(`Findings: ${r.findings.map((f) => f.text).join(" ")}`);
  }
  if (r.blockers.length > 0) {
    parts.push(
      `Blockers: ${r.blockers.map((b) => b.text).join(" ")}`,
    );
  }
  parts.push(
    `Confidence: ${r.confidenceState} (${Math.round(r.confidence * 100)}%) based on ${r.evidence.length} evidence reference${r.evidence.length === 1 ? "" : "s"}.`,
  );
  if (r.availableActions.length > 0) {
    parts.push(
      `Actions available: ${r.availableActions.map((a) => a.label).join(", ")} — none executed without authorization.`,
    );
  }
  if (r.requiredApprovals.length > 0) {
    parts.push(`Approval required: ${r.requiredApprovals.join("; ")}.`);
  }
  parts.push(`Recommended next step: ${r.recommendedNextStep}`);
  if (r.limitations.length > 0) {
    parts.push(`Limitations: ${r.limitations.join(" ")}`);
  }
  return parts.join("\n");
}
