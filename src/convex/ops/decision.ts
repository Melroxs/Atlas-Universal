// ---------------------------------------------------------------------------
// Atlas — Universal Decision Engine (pure)
//
// DECISION ≠ AUTHORIZATION ≠ EXECUTION ≠ VERIFICATION.
//
// This module decides what should happen next and why, grounded in evidence.
// It never grants permission to act — the tool/action policy remains
// authoritative. Pure, dependency-free, deterministic for tests.
// ---------------------------------------------------------------------------

// --- Decision types ----------------------------------------------------------

export const DECISION_TYPES = [
  "classify",
  "prioritize",
  "recommend",
  "investigate",
  "route",
  "escalate",
  "approve",
  "reject",
  "initiate_workflow",
  "prepare_action",
  "monitor",
  "defer",
  "request_information",
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];

// --- Confidence states --------------------------------------------------------

export const CONFIDENCE_STATES = [
  "verified",
  "high",
  "moderate",
  "low",
  "uncertain",
  "conflicting",
  "insufficient_evidence",
] as const;

export type ConfidenceState = (typeof CONFIDENCE_STATES)[number];

// --- Risk & urgency -----------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";
export type UrgencyLevel = "low" | "medium" | "high";
export type ApprovalRequirement =
  | "none"
  | "confirmation"
  | "manager_approval"
  | "owner_approval";

// --- Evidence reference -------------------------------------------------------

export interface DecisionEvidenceRef {
  kind: string; // event | workflow | approval | action | document | entity | authority | memory | deadline
  sourceId?: string;
  title?: string;
  snippet?: string;
  timestamp?: number;
  entityId?: string;
  authorityTier?: string;
  confidence?: number;
  /** verified | inferred | uncertain | stale | disputed | unavailable */
  evidenceState: string;
}

// --- Decision contract --------------------------------------------------------

export interface DecisionInput {
  tenantId: string;
  type: DecisionType;
  subject: string;
  title: string;
  summary: string;
  context?: unknown;
  evidence?: DecisionEvidenceRef[];
  entityContext?: unknown;
  businessContext?: unknown;
  industryContext?: unknown;
  authorityContext?: unknown;
  temporalContext?: unknown;
  options?: Array<{ label: string; description: string; risk?: RiskLevel }>;
  policyResult?: {
    confirmed?: boolean;
    policyReason?: string;
    riskLevel?: RiskLevel;
  };
}

export interface Decision {
  tenantId: string;
  decisionId: string;
  type: DecisionType;
  subject: string;
  title: string;
  summary: string;
  context: unknown | undefined;
  evidence: DecisionEvidenceRef[];
  entityContext: unknown | undefined;
  businessContext: unknown | undefined;
  industryContext: unknown | undefined;
  authorityContext: unknown | undefined;
  temporalContext: unknown | undefined;
  options: Array<{ label: string; description: string; risk?: RiskLevel }>;
  recommendation: string | null;
  confidenceState: ConfidenceState;
  confidence: number;
  riskLevel: RiskLevel;
  riskReason: string | null;
  impact: string | null;
  urgency: UrgencyLevel;
  policyResult: unknown | undefined;
  approvalRequirement: ApprovalRequirement;
  status: "open";
  dedupeKey: string;
  createdAt: number;
}

// --- Confidence ------------------------------------------------------------------

/** Map evidence states + count to an explicit confidence state. Never turns
 *  uncertainty into certainty merely to produce an answer. */
export function confidenceFromEvidence(
  refs: DecisionEvidenceRef[],
  base = 0.5,
): { state: ConfidenceState; score: number } {
  if (refs.length === 0) {
    return { state: "insufficient_evidence", score: Math.min(base, 0.35) };
  }
  const states = refs.map((r) => r.evidenceState);
  if (states.some((s) => s === "conflicting" || s === "disputed")) {
    return { state: "conflicting", score: 0.3 };
  }
  if (states.some((s) => s === "stale" || s === "unavailable")) {
    return { state: "low", score: Math.min(base, 0.45) };
  }
  const verified = states.filter((s) => s === "verified").length;
  const inferred = states.filter((s) => s === "inferred").length;
  const ratio = verified / states.length;
  if (ratio >= 0.9) return { state: "verified", score: Math.min(0.95, base + 0.4) };
  if (ratio >= 0.5) return { state: "high", score: Math.min(0.85, base + 0.3) };
  if (inferred > verified && ratio < 0.5) return { state: "uncertain", score: Math.max(0.2, base - 0.15) };
  if (ratio > 0) return { state: "moderate", score: base };
  return { state: "low", score: Math.max(0.2, base - 0.2) };
}

// --- Risk -----------------------------------------------------------------------

const TYPE_BASE_RISK: Record<DecisionType, RiskLevel> = {
  classify: "low",
  prioritize: "low",
  recommend: "low",
  investigate: "low",
  route: "low",
  escalate: "medium",
  approve: "high",
  reject: "high",
  initiate_workflow: "medium",
  prepare_action: "medium",
  monitor: "low",
  defer: "low",
  request_information: "low",
};

/** Base risk by decision type, escalated by policy result + option risk. */
export function riskFor(input: DecisionInput): {
  level: RiskLevel;
  reason: string;
} {
  const base = TYPE_BASE_RISK[input.type] ?? "low";
  const policyRisk = input.policyResult?.riskLevel;
  const levels: RiskLevel[] = [base];
  if (policyRisk === "high") levels.push("high");
  else if (policyRisk === "medium") levels.push("medium");
  if (input.options?.some((o) => o.risk === "high")) levels.push("high");
  else if (input.options?.some((o) => o.risk === "medium")) levels.push("medium");
  const level = levels.includes("high")
    ? "high"
    : levels.includes("medium")
      ? "medium"
      : "low";
  const reason =
    level === "high"
      ? "High risk: the recommended direction changes an external system or commits the workspace. Human approval required."
      : level === "medium"
        ? "Medium risk: this direction triggers an operational step with lasting effect. Confirmation required."
        : "Low risk: informational or reversible. No approval required.";
  return { level, reason };
}

/** Approval requirement derived from risk — DECISION never bypasses policy. */
export function approvalFor(risk: RiskLevel): ApprovalRequirement {
  switch (risk) {
    case "high":
      return "manager_approval";
    case "medium":
      return "confirmation";
    default:
      return "none";
  }
}

// --- Urgency ---------------------------------------------------------------------

export function urgencyFor(
  temporalContext?: { deadlineAt?: number | null; now?: number | null },
  risk?: RiskLevel,
): UrgencyLevel {
  let u: UrgencyLevel = "low";
  if (risk === "high") u = "high";
  const deadlineAt = temporalContext?.deadlineAt;
  const now = temporalContext?.now;
  if (deadlineAt && now) {
    const hours = (deadlineAt - now) / 3600_000;
    if (hours <= 24) u = "high";
    else if (hours <= 72) u = u === "high" ? "high" : "medium";
  }
  return u;
}

// --- The decision pipeline --------------------------------------------------------

/**
 * Run the observable decision pipeline over an input. Every step is a pure
 * function so decisions are auditable: an answer to "why did Atlas decide
 * this?" can always be reconstructed from the inputs and the steps below.
 */
export function decide(input: DecisionInput, now = Date.now()): Decision {
  // 4. Retrieve evidence (input). 5-9. Contexts (input).
  // 10. Determine current state. 12. Evaluate risk. 13. Evaluate policy.
  const evidence = input.evidence ?? [];
  const confidence = confidenceFromEvidence(evidence);
  const risk = riskFor(input);
  const policyApproval = approvalFor(risk.level);
  const urgency = urgencyFor(
    input.temporalContext as { deadlineAt?: number | null; now?: number | null } | undefined,
    risk.level,
  );

  // 15. Recommend next step — grounded in evidence, never fabricated.
  const recommendation = recommendationFor(input, risk.level, confidence.state);

  // 16. Determine whether human approval is required.
  const approvalRequirement: ApprovalRequirement =
    risk.level === "high" ? "manager_approval" : policyApproval;

  // Deterministic dedupe id: same type + subject re-evaluated = same decision.
  const dedupeKey = `${input.type}:${stableToken(input.subject)}`;

  return {
    tenantId: input.tenantId,
    decisionId: dedupeKey,
    type: input.type,
    subject: input.subject,
    title: input.title,
    summary: input.summary,
    context: input.context,
    evidence,
    entityContext: input.entityContext,
    businessContext: input.businessContext,
    industryContext: input.industryContext,
    authorityContext: input.authorityContext,
    temporalContext: input.temporalContext,
    options: input.options ?? [],
    recommendation,
    confidenceState: confidence.state,
    confidence: confidence.score,
    riskLevel: risk.level,
    riskReason: risk.reason,
    impact: input.options?.find((o) => o.risk === "high")?.description ?? null,
    urgency,
    policyResult: input.policyResult,
    approvalRequirement,
    status: "open",
    dedupeKey,
    createdAt: now,
  };
}

/** Evidence-grounded recommendation — the "why" is always derivable. */
function recommendationFor(
  input: DecisionInput,
  risk: RiskLevel,
  confidenceState: ConfidenceState,
): string {
  if (confidenceState === "insufficient_evidence") {
    return "Insufficient evidence to recommend a direction — gather the missing evidence first.";
  }
  if (confidenceState === "conflicting") {
    return "Conflicting evidence — review the sources before acting; no direction is safe to auto-execute.";
  }
  const base: Record<DecisionType, string> = {
    classify: `Classify "${input.subject}" against the configured knowledge classes and record the result with its evidence.`,
    prioritize: `Prioritize "${input.subject}" relative to open work using severity, urgency and business impact.`,
    recommend: `Recommend: ${input.summary}. Confirm with the responsible owner before execution.`,
    investigate: `Investigate "${input.subject}" — trace the evidence trail to identify the root cause before acting.`,
    route: `Route "${input.subject}" to the responsible owner/role for review.`,
    escalate: `Escalate "${input.subject}" to a manager with the evidence summary and recommended response.`,
    approve: `Approve "${input.subject}" only with the full evidence set and, where required, manager sign-off.`,
    reject: `Reject "${input.subject}" with a documented reason and the evidence that supports it.`,
    initiate_workflow: `Start the relevant workflow for "${input.subject}" after confirmation.`,
    prepare_action: `Prepare the action for "${input.subject}" through the action runtime — never execute without authorization.`,
    monitor: `Monitor "${input.subject}" over the next monitoring window and review at the next checkpoint.`,
    defer: `Defer "${input.subject}" to the next scheduled review — no action now.`,
    request_information: `Request the missing information needed to decide "${input.subject}".`,
  };
  const suffix =
    risk === "high"
      ? " [Requires manager approval before any execution.]"
      : risk === "medium"
        ? " [Requires confirmation before execution.]"
        : "";
  return base[input.type] + suffix;
}

// --- Deterministic tokenization (FNV-1a 32-bit, dependency-free) -----------------

export function stableToken(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Priority score 0..1 — explicit factors, never fabricated impact. */
export function priorityScore(input: {
  severity: RiskLevel;
  urgency: UrgencyLevel;
  confidence: number;
  deadlineHours?: number | null;
  businessImpact?: string | null;
  hasAction: boolean;
}): { score: number; basis: string } {
  const severityW = input.severity === "high" ? 0.35 : input.severity === "medium" ? 0.22 : 0.1;
  const urgencyW = input.urgency === "high" ? 0.3 : input.urgency === "medium" ? 0.18 : 0.08;
  const confW = Math.min(0.25, input.confidence * 0.25);
  const deadlineW =
    input.deadlineHours != null && input.deadlineHours < 24
      ? Math.max(0, 0.1 - input.deadlineHours / 240)
      : 0;
  const actionW = input.hasAction ? 0.05 : 0;
  const score = Math.min(1, severityW + urgencyW + confW + deadlineW + actionW);
  const basis = [
    `severity ${input.severity}`,
    `urgency ${input.urgency}`,
    `confidence ${Math.round(input.confidence * 100)}%`,
    input.deadlineHours != null ? `${Math.round(input.deadlineHours)}h to deadline` : "no deadline",
    input.hasAction ? "action available" : "no action available",
  ].join(" · ");
  return { score, basis };
}

/** Honest impact label — says so when it cannot be calculated. */
export function businessImpactLabel(input: {
  amounts?: Array<{ label: string; amount: number }>;
}): string {
  const amounts = (input.amounts ?? []).filter((a) => typeof a.amount === "number");
  if (amounts.length === 0) {
    return "Financial impact cannot be calculated from the available evidence.";
  }
  return amounts.map((a) => `${a.label}: $${a.amount.toLocaleString()}`).join(" · ");
}
