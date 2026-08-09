// ---------------------------------------------------------------------------
// Decision layer.
//
// A workflow "decision" step evaluates declarative rules against the instance
// context and produces a STRUCTURED decision — decision, confidence,
// rationale, evidence references, recommended next step, risk, and whether a
// human review is required. Decisions only PROPOSE; the action runtime
// authorizes and executes. No hidden chain-of-thought is ever exposed.
//
// PURE module.
// ---------------------------------------------------------------------------

import type { RiskLevel } from "../tools/registry";
import type { DecisionRule } from "./contract";
import { evaluateCondition } from "./conditions";

export interface EvidenceReference {
  kind: "document" | "entity" | "assertion" | "event";
  documentId?: string;
  entityId?: string;
  title?: string;
}

export interface StructuredDecision {
  decision: string;
  confidence: number;
  rationale: string;
  evidenceReferences: EvidenceReference[];
  recommendedNextStep: string | null;
  risk: RiskLevel;
  requiresHumanReview: boolean;
}

export interface DecisionContext {
  /** Context plus rule inputs. */
  [key: string]: unknown;
}

/**
 * Evaluate rules in order; the first rule whose condition matches wins.
 * Missing context fails closed — a rule that cannot be evaluated never
 * silently approves an action.
 */
export function evaluateRules(
  rules: DecisionRule[],
  context: DecisionContext,
  defaults: {
    decision: string;
    confidence: number;
    rationale: string;
    risk: RiskLevel;
    requiresHumanReview: boolean;
    recommendedNextStep?: string | null;
  },
): StructuredDecision {
  const evidenceRefs = extractEvidence(context);
  for (const rule of rules) {
    const match = evaluateCondition(rule.if, context);
    if (!match.result) continue;
    const t = rule.then;
    return {
      decision: t.decision,
      confidence: clamp(t.confidence),
      rationale: match.error ? `${t.rationale} (condition error: ${match.error})` : t.rationale,
      evidenceReferences: evidenceRefs,
      recommendedNextStep: t.nextStepId ?? null,
      risk: defaults.risk,
      requiresHumanReview: t.requiresHumanReview,
    };
  }
  return {
    decision: defaults.decision,
    confidence: clamp(defaults.confidence),
    rationale: defaults.rationale,
    evidenceReferences: evidenceRefs,
    recommendedNextStep: defaults.recommendedNextStep ?? null,
    risk: defaults.risk,
    requiresHumanReview: defaults.requiresHumanReview,
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function extractEvidence(context: DecisionContext): EvidenceReference[] {
  const raw = context.evidenceReferences;
  if (!Array.isArray(raw)) return [];
  const out: EvidenceReference[] = [];
  for (const ref of raw) {
    if (ref && typeof ref === "object") {
      const r = ref as Record<string, unknown>;
      out.push({
        kind: (r.kind as EvidenceReference["kind"]) ?? "document",
        documentId: typeof r.documentId === "string" ? r.documentId : undefined,
        entityId: typeof r.entityId === "string" ? r.entityId : undefined,
        title: typeof r.title === "string" ? r.title : undefined,
      });
    }
  }
  return out.slice(0, 10);
}
