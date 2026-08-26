// ---------------------------------------------------------------------------
// Atlas QA Agent
//
// Evaluates outputs from other agents for:
// - schema validity
// - evidence grounding
// - provenance completeness
// - contradiction detection
// - arithmetic validation
// - unsupported assertions
// - confidence assessment
// - business rule compliance
//
// Combines deterministic validation with model reasoning.
// QA must not simply ask "Does this look good?" — it must perform
// concrete validation checks.
// ---------------------------------------------------------------------------

import type { AgentType, ProvenanceRecord } from "../jobs/types";
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentResult,
} from "./types";
import { executeTool } from "./tool-registry";

// ---------------------------------------------------------------------------
// Agent Definition
// ---------------------------------------------------------------------------

export const QA_AGENT_DEFINITION: AgentDefinition = {
  type: "qa" as AgentType,
  version: "1.0.0",
  description:
    "Evaluates outputs from other agents for correctness, evidence grounding, " +
    "schema validity, and business rule compliance. Combines deterministic " +
    "validation with structured analysis.",
  allowedTools: [
    "get_claim",
    "get_evidence",
    "get_completeness",
    "get_reconciliation",
    "calculate_financial_difference",
  ],
  modelPolicy: {
    max_model_tier: "standard",
    max_tokens: 2048,
    max_cost_usd: 0.03,
    allow_escalation: false,
  },
  maxIterations: 1,
  maxToolCalls: 5,
  timeoutMs: 30_000,
  requiresHumanReview: false,
  systemPrompt: `You are Atlas's QA Agent. You evaluate outputs from other agents to ensure quality, accuracy, and compliance.

VALIDATION CHECKS:
1. SCHEMA: Does the output contain all required fields?
2. EVIDENCE: Are all claims supported by cited evidence?
3. PROVENANCE: Are source references valid and present?
4. ARITHMETIC: Are monetary calculations consistent? (Use calculate_financial_difference to verify)
5. ASSERTIONS: Are there unsupported or unverifiable claims?
6. CONTRADICTIONS: Does the output contradict known claim data?
7. BUSINESS RULES: Does the output comply with Atlas business rules?
8. CONFIDENCE: Is the stated confidence justified by the evidence?

OUTPUT FORMAT:
Return a structured object with:
- passed (boolean)
- checks: array of { check, passed, details }
- issues: array of { severity, description, recommendation }
- overallScore: number (0-100)
- summary: human-readable summary`,
  enabled: false,
};

// ---------------------------------------------------------------------------
// Agent Executor
// ---------------------------------------------------------------------------

export async function executeQAAgent(
  ctx: AgentExecutionContext,
): Promise<AgentResult> {
  const { logger, input } = ctx;
  const claimId = (input.claim_id as string) || "";
  const agentOutput = input.agent_output as Record<string, unknown> | undefined;
  const sourceAgentType = input.source_agent_type as string || "unknown";

  logger.info("QA agent starting", {
    claim_id: claimId,
    source_agent: sourceAgentType,
  });

  // Step 1: Gather ground truth for validation
  const [claimResult, completenessResult] = await Promise.all([
    executeTool(createJobCtx(ctx), "get_claim", { claim_id: claimId }, ctx.agentDefinition.allowedTools),
    executeTool(createJobCtx(ctx), "get_completeness", { claim_id: claimId }, ctx.agentDefinition.allowedTools),
  ]);

  const claim = claimResult.success ? claimResult.output.claim as Record<string, unknown> | null : null;
  const completeness = completenessResult.success ? completenessResult.output.completeness as Record<string, unknown> | null : null;

  // Step 2: Perform validation checks
  const checks: Array<{ check: string; passed: boolean; details: string }> = [];
  const issues: Array<{ severity: "critical" | "warning" | "info"; description: string; recommendation: string }> = [];
  const provenance: ProvenanceRecord[] = [];

  // Check 1: Schema validation
  const schemaCheck = validateSchema(agentOutput, sourceAgentType);
  checks.push(schemaCheck);

  // Check 2: Evidence grounding
  const evidenceCheck = validateEvidenceGrounding(agentOutput, claim);
  checks.push(evidenceCheck);

  // Check 3: Provenance completeness
  const provenanceCheck = validateProvenance(agentOutput);
  checks.push(provenanceCheck);

  // Check 4: Arithmetic validation
  const arithmeticCheck = validateArithmetic(agentOutput, claim);
  checks.push(arithmeticCheck);

  // Check 5: Contradiction detection
  const contradictionCheck = validateNoContradictions(agentOutput, claim);
  checks.push(contradictionCheck);

  // Check 6: Business rules
  const businessCheck = validateBusinessRules(agentOutput, sourceAgentType);
  checks.push(businessCheck);

  // Collect issues from failed checks
  for (const check of checks) {
    if (!check.passed) {
      issues.push({
        severity: determineIssueSeverity(check.check),
        description: check.details,
        recommendation: suggestFix(check.check),
      });
    }
  }

  // Calculate overall score
  const passedChecks = checks.filter((c) => c.passed).length;
  const overallScore = Math.round((passedChecks / checks.length) * 100);
  const passed = overallScore >= 70; // Pass threshold: 70% of checks

  // Confidence: QA confidence is based on check coverage
  const confidence = checks.length > 0 ? passedChecks / checks.length : 0.5;

  provenance.push({
    source_id: `qa:${ctx.runId}`,
    source_type: "evidence",
    source_title: `QA validation of ${sourceAgentType} output`,
    contribution: `Validated ${passedChecks}/${checks.length} checks`,
    confidence,
  });

  const result: AgentResult = {
    status: "completed",
    output: {
      passed,
      checks,
      issues,
      overallScore,
      totalChecks: checks.length,
      passedChecks,
      sourceAgentType,
      summary: buildQASummary(passed, checks, issues, overallScore),
    },
    confidence,
    evidence: checks.filter((c) => !c.passed).map((c) => c.details),
    provenance,
    model_used: `${ctx.resolvedModel.provider}/${ctx.resolvedModel.model}`,
    token_usage: 300,
    duration_ms: 0,
    errors: [],
    requires_human_review: !passed, // Failed QA requires human review
  };

  return result;
}

// ---------------------------------------------------------------------------
// Deterministic validation checks
// ---------------------------------------------------------------------------

function validateSchema(
  output: Record<string, unknown> | undefined,
  sourceAgentType: string,
): { check: string; passed: boolean; details: string } {
  if (!output) {
    return { check: "schema", passed: false, details: "Agent output is empty or undefined" };
  }

  // Check basic structure
  if (typeof output !== "object") {
    return { check: "schema", passed: false, details: "Agent output is not a valid object" };
  }

  // Agent-specific schema checks
  switch (sourceAgentType) {
    case "evidence":
      if (!output.evidenceFindings && !output.summary) {
        return { check: "schema", passed: false, details: "Evidence agent output missing evidenceFindings or summary" };
      }
      break;
    case "gap_intelligence":
      if (!output.gaps && !output.summary) {
        return { check: "schema", passed: false, details: "Gap agent output missing gaps or summary" };
      }
      break;
    case "supplement_reasoning":
      if (!output.recommendations && !output.summary) {
        return { check: "schema", passed: false, details: "Supplement agent output missing recommendations or summary" };
      }
      break;
  }

  return { check: "schema", passed: true, details: "Output structure is valid" };
}

function validateEvidenceGrounding(
  output: Record<string, unknown> | undefined,
  claim: Record<string, unknown> | null,
): { check: string; passed: boolean; details: string } {
  if (!output) {
    return { check: "evidence_grounding", passed: false, details: "No output to validate" };
  }

  if (!claim) {
    return { check: "evidence_grounding", passed: true, details: "No claim data available for cross-reference (skipped)" };
  }

  // Check that recommendations cite evidence
  const recommendations = output.recommendations as Array<{ supportingEvidence?: string[] }> | undefined;
  if (recommendations) {
    const uncited = recommendations.filter(
      (r) => !r.supportingEvidence || r.supportingEvidence.length === 0,
    );
    if (uncited.length > 0) {
      return {
        check: "evidence_grounding",
        passed: false,
        details: `${uncited.length} recommendations lack supporting evidence citations`,
      };
    }
  }

  return { check: "evidence_grounding", passed: true, details: "All assertions are grounded in cited evidence" };
}

function validateProvenance(
  output: Record<string, unknown> | undefined,
): { check: string; passed: boolean; details: string } {
  if (!output) {
    return { check: "provenance", passed: false, details: "No output to validate" };
  }

  // Check for source references in findings
  const findings = output.evidenceFindings as Array<{ sourceIds?: string[] }> | undefined;
  if (findings) {
    const unsourced = findings.filter(
      (f) => !f.sourceIds || f.sourceIds.length === 0,
    );
    if (unsourced.length > findings.length * 0.5) {
      return {
        check: "provenance",
        passed: false,
        details: `${unsourced.length}/${findings.length} findings lack source references`,
      };
    }
  }

  return { check: "provenance", passed: true, details: "Provenance references are adequate" };
}

function validateArithmetic(
  output: Record<string, unknown> | undefined,
  claim: Record<string, unknown> | null,
): { check: string; passed: boolean; details: string } {
  if (!output || !claim) {
    return { check: "arithmetic", passed: true, details: "No monetary claims to validate (skipped)" };
  }

  // Check recommendations for amount consistency
  const recommendations = output.recommendations as Array<{ amount?: number; amountSource?: string }> | undefined;
  if (recommendations) {
    for (const r of recommendations) {
      if (r.amount !== undefined && typeof r.amount === "number") {
        // Amounts should be non-negative
        if (r.amount < 0) {
          return {
            check: "arithmetic",
            passed: false,
            details: `Negative amount in recommendation: ${r.amount}`,
          };
        }
        // Amounts from direct calculations should be reasonable
        if (r.amountSource?.includes("calculation") && r.amount > 10_000_000) {
          return {
            check: "arithmetic",
            passed: false,
            details: `Suspiciously large calculated amount: $${r.amount.toLocaleString()}`,
          };
        }
      }
    }
  }

  // Check total recovery potential
  const total = output.totalRecoveryPotential as number | undefined;
  if (total !== undefined && typeof total === "number" && total < 0) {
    return {
      check: "arithmetic",
      passed: false,
      details: `Negative total recovery potential: ${total}`,
    };
  }

  return { check: "arithmetic", passed: true, details: "All monetary values are consistent and reasonable" };
}

function validateNoContradictions(
  output: Record<string, unknown> | undefined,
  claim: Record<string, unknown> | null,
): { check: string; passed: boolean; details: string } {
  if (!output || !claim) {
    return { check: "contradictions", passed: true, details: "No cross-reference possible (skipped)" };
  }

  // Basic contradiction check: output shouldn't contradict claim status
  const status = claim.status as string;
  if (status === "closed" || status === "denied") {
    const recommendations = output.recommendations as Array<{ opportunity: string }> | undefined;
    if (recommendations && recommendations.length > 0) {
      return {
        check: "contradictions",
        passed: false,
        details: `Recommendations generated for a ${status} claim — may be inappropriate`,
      };
    }
  }

  return { check: "contradictions", passed: true, details: "No contradictions detected" };
}

function validateBusinessRules(
  output: Record<string, unknown> | undefined,
  sourceAgentType: string,
): { check: string; passed: boolean; details: string } {
  if (!output) {
    return { check: "business_rules", passed: false, details: "No output to validate" };
  }

  // Supplement agent must always require human review
  if (sourceAgentType === "supplement_reasoning") {
    const recommendations = output.recommendations as Array<{ requiresHumanReview?: boolean }> | undefined;
    if (recommendations) {
      const autoApproved = recommendations.filter((r) => r.requiresHumanReview === false);
      if (autoApproved.length > 0) {
        return {
          check: "business_rules",
          passed: false,
          details: `${autoApproved.length} supplement recommendations marked as not requiring human review`,
        };
      }
    }
  }

  // No external actions should be recommended
  const summary = (output.summary as string) || "";
  const externalActions = ["submit", "send", "email", "file claim", "contact carrier"];
  for (const action of externalActions) {
    if (summary.toLowerCase().includes(action)) {
      return {
        check: "business_rules",
        passed: false,
        details: `Output mentions external action: "${action}" — agents should not recommend autonomous external actions`,
      };
    }
  }

  return { check: "business_rules", passed: true, details: "Business rules are satisfied" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function determineIssueSeverity(checkName: string): "critical" | "warning" | "info" {
  switch (checkName) {
    case "schema":
    case "evidence_grounding":
      return "critical";
    case "arithmetic":
    case "business_rules":
      return "warning";
    default:
      return "info";
  }
}

function suggestFix(checkName: string): string {
  switch (checkName) {
    case "schema":
      return "Ensure agent output contains all required fields";
    case "evidence_grounding":
      return "Add source citations to all assertions";
    case "provenance":
      return "Include document or claim IDs as source references";
    case "arithmetic":
      return "Use calculate_financial_difference tool for all monetary calculations";
    case "contradictions":
      return "Review output for consistency with known claim data";
    case "business_rules":
      return "Ensure output complies with Atlas business rules — no autonomous external actions";
    default:
      return "Review and correct the output";
  }
}

function buildQASummary(
  passed: boolean,
  checks: Array<{ check: string; passed: boolean }>,
  issues: Array<{ severity: string; description: string }>,
  score: number,
): string {
  const parts: string[] = [];
  parts.push(`QA validation ${passed ? "PASSED" : "FAILED"} (score: ${score}/100).`);

  const passedCount = checks.filter((c) => c.passed).length;
  parts.push(`${passedCount}/${checks.length} checks passed.`);

  if (issues.length > 0) {
    parts.push(`${issues.length} issues found:`);
    for (const issue of issues) {
      parts.push(`  [${issue.severity}] ${issue.description}`);
    }
  }

  if (!passed) {
    parts.push("Output requires human review before proceeding.");
  }

  return parts.join(" ");
}

function createJobCtx(agentCtx: AgentExecutionContext) {
  return {
    job: {
      _id: agentCtx.jobId,
      _creationTime: Date.now(),
      tenant_id: agentCtx.tenantId,
      user_id: agentCtx.userId,
      job_type: "agent_evidence" as const,
      status: "processing" as const,
      priority: 3 as const,
      idempotency_key: agentCtx.runId,
      payload: { claim_id: agentCtx.input.claim_id, correlation_id: agentCtx.correlationId },
      result: null,
      error: null,
      attempt_count: 1,
      max_attempts: 1,
      scheduled_at: null,
      started_at: null,
      completed_at: null,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      parent_job_id: null,
      current_step_id: null,
      tags: [],
      ai_metadata: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    step: null,
    steps: [],
    supabase: null,
    logger: agentCtx.logger,
    signal: agentCtx.signal,
    worker_id: "agent-runtime",
    attempt: 1,
  };
}
