// ---------------------------------------------------------------------------
// Everest — Authority Impact Engine
//
// When authoritative knowledge changes, Atlas analyzes what may be affected —
// jurisdictions, industries, tenants, workflows, policies, evidence
// requirements — and produces a structured ImpactAssessment with a human
// review recommendation. Atlas NEVER claims an organization is non-compliant
// from an automated inference.
// ---------------------------------------------------------------------------

import type { ChangeType } from "./ingest";
import { tierWeight } from "./authority";

export type Severity = "high" | "medium" | "low";
export type Urgency = "immediate" | "soon" | "scheduled";

export interface ImpactInput {
  source: {
    sourceId: string;
    name: string;
    authorityTier: string;
    industry?: string | null;
    jurisdiction?: string | null;
  };
  knowledge: {
    knowledgeId: string;
    title: string;
    statement: string;
    industry?: string | null;
    jurisdiction?: string | null;
    effectiveDate?: number | null;
  };
  changeType: ChangeType;
  /** Tenants whose organization context matches jurisdiction/industry
   *  applicability (already evaluated — fail-closed). */
  affectedTenants: Array<{ tenantId: string; matchedBy: string[] }>;
  /** Workflow definitions that reference this knowledge's domain. */
  workflows: Array<{ id: string; name: string; industry: string }>;
  /** Industries declared by registered packs (industry pack names). */
  registeredIndustries: string[];
  /** Subjects/terms this knowledge touches, for workflow/policy matching. */
  subjects: string[];
}

export interface ImpactAssessment {
  sourceId: string;
  sourceName: string;
  authorityTier: string;
  knowledgeId: string;
  knowledgeTitle: string;
  changeType: ChangeType;
  affectedJurisdictions: string[];
  affectedIndustries: string[];
  affectedTenantIds: string[];
  affectedWorkflowIds: string[];
  affectedPolicyIds: string[];
  affectedEntityIds: string[];
  evidence: string[];
  confidence: number;
  severity: Severity;
  urgency: Urgency;
  recommendedAction: string;
  requiresHumanReview: boolean;
  status: "pending_review";
  /** Guardrail note — always present, never compliance language. */
  disclaimer: string;
}

const industryKey = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function severityFor(changeType: ChangeType, tierWeightValue: number): Severity {
  if (changeType === "new_requirement" || changeType === "removed_requirement") {
    return tierWeightValue >= 0.9 ? "high" : "medium";
  }
  if (changeType === "supersession") return tierWeightValue >= 0.75 ? "high" : "medium";
  if (changeType === "substantive_change") return "medium";
  if (changeType === "effective_date_change") return "medium";
  return "low";
}

function urgencyFor(changeType: ChangeType, severity: Severity): Urgency {
  if (severity === "high") return "immediate";
  if (changeType === "effective_date_change" || changeType === "supersession") return "soon";
  return "scheduled";
}

/**
 * Build an impact assessment for an authority change. Language is
 * evidence-grounded and hedged: "potentially affected", "review required",
 * "applicability detected" — never "non-compliant".
 */
export function buildImpactAssessment(input: ImpactInput): ImpactAssessment {
  const tw = tierWeight(input.source.authorityTier as never) ?? 0.5;
  const severity = severityFor(input.changeType, tw);
  const urgency = urgencyFor(input.changeType, severity);

  // Workflows whose declared industry matches the knowledge's industry.
  const knowledgeIndustryKey = industryKey(input.knowledge.industry);
  const matchedWorkflows = input.workflows.filter((w) => {
    if (knowledgeIndustryKey && industryKey(w.industry) === knowledgeIndustryKey) return true;
    return input.subjects.some((s) =>
      w.name.toLowerCase().includes(s.toLowerCase()),
    );
  });
  const affectedWorkflowIds = matchedWorkflows.map((w) => w.id);

  const affectedIndustries: string[] = [];
  if (input.knowledge.industry) {
    affectedIndustries.push(input.knowledge.industry);
    for (const reg of input.registeredIndustries) {
      if (industryKey(reg) === industryKey(input.knowledge.industry) && !affectedIndustries.includes(reg)) {
        affectedIndustries.push(reg);
      }
    }
  }

  const affectedJurisdictions = input.knowledge.jurisdiction
    ? [input.knowledge.jurisdiction]
    : [];

  const evidence = [
    `Authoritative source states: "${input.knowledge.statement}"`,
    input.knowledge.effectiveDate
      ? `Effective date: ${new Date(input.knowledge.effectiveDate).toISOString().slice(0, 10)}.`
      : "Effective date not stated by the source.",
    ...(matchedWorkflows.length > 0
      ? [`Workflow(s) reference this domain: ${matchedWorkflows.map((w) => w.name).join(", ")}.`]
      : ["No registered workflow currently references this domain."]),
    ...(input.affectedTenants.length > 0
      ? [`Applicability detected for ${input.affectedTenants.length} tenant workspace(s).`]
      : ["No tenant workspace currently matches the jurisdiction/industry applicability."]),
  ];

  const requiresHumanReview =
    severity === "high" || changeTypeIsSubstantive(input.changeType);

  const recommendedAction =
    severity === "high"
      ? "Review this change before any operational action. If it affects production workflows, prepare a review recommendation — do not modify workflows automatically."
      : severity === "medium"
        ? "Review the change and confirm whether current workflows, evidence requirements or policies need updating."
        : "Low-impact change — monitor; no immediate action required.";

  return {
    sourceId: input.source.sourceId,
    sourceName: input.source.name,
    authorityTier: input.source.authorityTier,
    knowledgeId: input.knowledge.knowledgeId,
    knowledgeTitle: input.knowledge.title,
    changeType: input.changeType,
    affectedJurisdictions,
    affectedIndustries,
    affectedTenantIds: input.affectedTenants.map((t) => t.tenantId),
    affectedWorkflowIds,
    affectedPolicyIds: [],
    affectedEntityIds: [],
    evidence,
    confidence: Math.min(0.9, 0.5 + tw * 0.4),
    severity,
    urgency,
    recommendedAction,
    requiresHumanReview,
    status: "pending_review",
    disclaimer:
      "This assessment is an automated inference from the authoritative source and Atlas's operating context. It indicates what may be affected and what should be reviewed — it is not a legal or compliance determination.",
  };
}

function changeTypeIsSubstantive(changeType: ChangeType): boolean {
  return (
    changeType === "new_requirement" ||
    changeType === "removed_requirement" ||
    changeType === "supersession" ||
    changeType === "substantive_change"
  );
}

/** The honest answer when two authorities conflict and cannot be resolved. */
export function conflictAssessment(sources: Array<{ name: string; tier: string; jurisdiction?: string | null }>) {
  return {
    conflict: true,
    sources: sources.map((s) => ({ name: s.name, authorityTier: s.tier, jurisdiction: s.jurisdiction ?? null })),
    resolution:
      sources.length >= 2 && tierWeight(sources[0].tier as never) !== tierWeight(sources[1].tier as never)
        ? `Higher-authority source (${sources[0].name}) takes precedence by tier.`
        : "Authority conflict requires review.",
    requiresReview: true,
  };
}
