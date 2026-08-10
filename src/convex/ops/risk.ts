// ---------------------------------------------------------------------------
// Atlas — Universal Risk & Anomaly Detection (pure)
//
// Risk findings always distinguish:
//   observed fact  — what Atlas actually recorded
//   inferred risk  — what Atlas believes the fact implies
//   consequence    — what could happen, explicitly hedged
// Never states legal non-compliance unless the evidence + authority framework
// genuinely supports it. Explainable, deterministic, no opaque ML.
// ---------------------------------------------------------------------------

export const RISK_CATEGORIES = [
  "operational",
  "financial",
  "workflow",
  "deadline",
  "compliance_concern",
  "data_quality",
  "missing_evidence",
  "connector",
  "authorization",
  "customer_service",
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export interface RiskFinding {
  id: string;
  category: RiskCategory;
  severity: "high" | "medium" | "low";
  title: string;
  /** What Atlas actually recorded — the observed fact. */
  observed: string;
  /** What Atlas infers from that fact. */
  inferredRisk: string;
  /** What could happen, hedged. */
  potentialConsequence: string;
  confidence: number;
  evidenceState: "verified" | "inferred";
  /** Never compliance language unless genuinely supported. */
  complianceFlag: boolean;
  sourceRef?: string;
}

export interface AnomalyFinding {
  id: string;
  pattern: string;
  severity: "high" | "medium" | "low";
  title: string;
  /** The deterministic baseline Atlas compares against. */
  baseline: string;
  /** The observed deviation. */
  observed: string;
  confidence: number;
  sourceRef?: string;
}

// --- Deterministic anomaly patterns ---------------------------------------------

export const ANOMALY_PATTERNS = [
  "unusual_volume",
  "unexpected_status_change",
  "repeated_failures",
  "unusually_long_duration",
  "missing_expected_document",
  "repeated_action_failure",
  "deadline_without_progress",
  "contradictory_records",
] as const;

export type AnomalyPattern = (typeof ANOMALY_PATTERNS)[number];

/** Repeated failures: >= threshold occurrences of the same failing thing. */
export function repeatedFailures(input: {
  entity: string;
  count: number;
  threshold?: number;
  kind: string;
}): AnomalyFinding | null {
  const threshold = input.threshold ?? 3;
  if (input.count < threshold) return null;
  return {
    id: `anomaly-failures-${stableToken(input.entity)}`,
    pattern: "repeated_failures",
    severity: input.count >= threshold * 2 ? "high" : "medium",
    title: `Repeated ${input.kind} failures: ${input.entity}`,
    baseline: `Expects 0 or occasional ${input.kind} failures; threshold is ${threshold}.`,
    observed: `${input.count} recorded failures.`,
    confidence: Math.min(0.9, 0.5 + input.count * 0.08),
    sourceRef: input.entity,
  };
}

/** Unusually long duration vs a configured expected window. */
export function unusuallyLong(input: {
  entity: string;
  durationHours: number;
  expectedHours: number;
  kind: string;
}): AnomalyFinding | null {
  if (input.durationHours <= input.expectedHours * 1.5) return null;
  return {
    id: `anomaly-duration-${stableToken(input.entity)}`,
    pattern: "unusually_long_duration",
    severity: input.durationHours >= input.expectedHours * 3 ? "high" : "medium",
    title: `${input.kind} is unusually long: ${input.entity}`,
    baseline: `Typical duration ≈ ${input.expectedHours}h.`,
    observed: `Current duration ≈ ${Math.round(input.durationHours)}h (${Math.round((input.durationHours / Math.max(1, input.expectedHours)) * 100)}% of baseline).`,
    confidence: 0.7,
    sourceRef: input.entity,
  };
}

/** Deadline approaching with no recorded progress. */
export function deadlineWithoutProgress(input: {
  entity: string;
  deadlineAt: number;
  now: number;
  lastProgressAt?: number | null;
  hoursThreshold?: number;
}): AnomalyFinding | null {
  const threshold = input.hoursThreshold ?? 48;
  const remaining = (input.deadlineAt - input.now) / 3600_000;
  if (remaining > threshold) return null;
  const noProgress = !input.lastProgressAt || input.now - input.lastProgressAt > 24 * 3600_000;
  if (!noProgress) return null;
  return {
    id: `anomaly-deadline-${stableToken(input.entity)}`,
    pattern: "deadline_without_progress",
    severity: remaining <= 24 ? "high" : "medium",
    title: `Deadline approaching without progress: ${input.entity}`,
    baseline: "Expects recorded progress as a deadline approaches.",
    observed: `${Math.round(remaining)}h to deadline; no progress recorded in the last 24h.`,
    confidence: 0.75,
    sourceRef: input.entity,
  };
}

/** Missing expected document/evidence given an active expectation. */
export function missingExpected(input: {
  entity: string;
  expectedKind: string;
}): AnomalyFinding | null {
  return {
    id: `anomaly-missing-${stableToken(input.entity)}`,
    pattern: "missing_expected_document",
    severity: "medium",
    title: `Missing expected ${input.expectedKind}: ${input.entity}`,
    baseline: `A ${input.expectedKind} is expected for this ${input.entity}.`,
    observed: "No matching record exists in the workspace.",
    confidence: 0.6,
    sourceRef: input.entity,
  };
}

/** Two records that contradict each other on the same subject. */
export function contradictoryRecords(input: {
  entity: string;
  field: string;
  valueA: string;
  valueB: string;
}): AnomalyFinding | null {
  if (input.valueA === input.valueB) return null;
  return {
    id: `anomaly-contradiction-${stableToken(input.entity)}`,
    pattern: "contradictory_records",
    severity: "high",
    title: `Contradictory records for ${input.entity}`,
    baseline: `Expected consistent values for "${input.field}".`,
    observed: `Record A: ${input.valueA} vs Record B: ${input.valueB}.`,
    confidence: 0.8,
    sourceRef: input.entity,
  };
}

// --- Risk findings ---------------------------------------------------------------

/** Authorization risk: an actor lacking the role required for an operation. */
export function authorizationRisk(input: {
  actor: string;
  action: string;
  requiredRole: string;
  actualRole: string;
}): RiskFinding {
  return {
    id: `risk-auth-${stableToken(input.action)}`,
    category: "authorization",
    severity: "high",
    title: `Authorization shortfall: ${input.action}`,
    observed: `${input.actor} (${input.actualRole}) attempted ${input.action}.`,
    inferredRisk: "The actor lacks the role the policy requires.",
    potentialConsequence: "The action may be performed against policy or denied by the runtime.",
    confidence: 0.9,
    evidenceState: "verified",
    complianceFlag: false,
    sourceRef: input.action,
  };
}

/** Connector risk: repeated failures or stale sync on a connected system. */
export function connectorRisk(input: {
  provider: string;
  status: string;
  consecutiveFailures: number;
}): RiskFinding {
  const severity = input.consecutiveFailures >= 3 || input.status === "error" ? "high" : "medium";
  return {
    id: `risk-connector-${stableToken(input.provider)}`,
    category: "connector",
    severity,
    title: `Connector health risk: ${input.provider}`,
    observed: `Status "${input.status}" with ${input.consecutiveFailures} consecutive failure(s).`,
    inferredRisk: "Connected data may be stale or unavailable.",
    potentialConsequence: "Events and intelligence derived from this source could be incomplete or outdated.",
    confidence: 0.8,
    evidenceState: "verified",
    complianceFlag: false,
    sourceRef: input.provider,
  };
}

/** Missing-evidence risk: an expected evidence category has no material. */
export function missingEvidenceRisk(input: {
  subject: string;
  missingCategories: string[];
}): RiskFinding {
  return {
    id: `risk-evidence-${stableToken(input.subject)}`,
    category: "missing_evidence",
    severity: input.missingCategories.length >= 3 ? "high" : "medium",
    title: `Evidence gaps: ${input.subject}`,
    observed: `Missing categories: ${input.missingCategories.join(", ")}.`,
    inferredRisk: "The evidence set may not support the amounts or decisions they back.",
    potentialConsequence: "Carriers or reviewers may reduce or deny amounts that lack supporting evidence.",
    confidence: 0.65,
    evidenceState: "inferred",
    complianceFlag: false,
    sourceRef: input.subject,
  };
}

/** Compliance-concern finding — only ever a concern, never a ruling. */
export function complianceConcern(input: {
  subject: string;
  authoritySource: string;
  area: string;
}): RiskFinding {
  return {
    id: `risk-compliance-${stableToken(input.subject)}`,
    category: "compliance_concern",
    severity: "medium",
    title: `Compliance-related concern: ${input.area}`,
    observed: `Activity related to "${input.area}" was detected for ${input.subject}.`,
    inferredRisk: "Applicability may exist under the cited authority — review required.",
    potentialConsequence: "If applicable and unaddressed, this could carry operational or legal exposure.",
    confidence: 0.5,
    evidenceState: "inferred",
    complianceFlag: false,
    sourceRef: input.authoritySource,
  };
}

// --- Deterministic tokenization (shared with decision.ts) ------------------------

export function stableToken(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
