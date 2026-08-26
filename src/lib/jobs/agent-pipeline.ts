// ---------------------------------------------------------------------------
// Atlas Agent Pipeline — Agent Steps for the Evidence Pipeline
//
// Extends the existing 7-step deterministic Evidence Pipeline with 4
// agent-powered steps that invoke the Agent Runtime through the existing
// Worker/Job infrastructure.
//
// Architecture:
//   Evidence Pipeline (deterministic steps 1-7)
//          ↓
//   Agent Pipeline (agent steps 8-11)
//          ↓
//   Human Review Gate
//          ↓
//   Decision Engine
//
// Each agent step:
//   - Receives output from previous deterministic + agent steps
//   - Invokes the Agent Runtime via executeAgent()
//   - Persists agent results as durable step outputs
//   - Maintains provenance and correlation IDs
//   - Is independently retryable
//   - Enforces tenant isolation
// ---------------------------------------------------------------------------

import type {
  AgentType,
  JobExecutionContext,
  HandlerResult,
} from "./types";
import type {
  AgentResult,
  AgentRunRecord,
} from "../agents/types";
import {
  executeAgent,
  getAgentConfig,
  registerAgent,
  registerTools,
  registerBuiltinTools,
  getAgent,
  EVIDENCE_AGENT_DEFINITION,
  GAP_INTELLIGENCE_AGENT_DEFINITION,
  SUPPLEMENT_REASONING_AGENT_DEFINITION,
  QA_AGENT_DEFINITION,
  executeEvidenceAgent,
  executeGapIntelligenceAgent,
  executeSupplementReasoningAgent,
  executeQAAgent,
} from "../agents";
import { loadEvidenceData } from "./evidence-data-loader";
import { EVIDENCE_PIPELINE_STEPS } from "./evidence-pipeline";

// ---------------------------------------------------------------------------
// Agent Pipeline Step Types
// ---------------------------------------------------------------------------

export const AGENT_PIPELINE_STEPS = {
  EVIDENCE_AGENT: "agent_evidence_analysis",
  GAP_INTELLIGENCE: "agent_gap_intelligence",
  SUPPLEMENT_REASONING: "agent_supplement_reasoning",
  QA_VALIDATION: "agent_qa_validation",
} as const;

export type AgentPipelineStepType =
  (typeof AGENT_PIPELINE_STEPS)[keyof typeof AGENT_PIPELINE_STEPS];

// ---------------------------------------------------------------------------
// Agent Step Result Types
// ---------------------------------------------------------------------------

export interface EvidenceAgentStepResult {
  agent_run_id: string;
  evidence_findings: Array<{
    finding: string;
    type: "fact" | "inference";
    confidence: number;
    sourceIds: string[];
  }>;
  completeness_score: number;
  missing_evidence: string[];
  summary: string;
  confidence: number;
  requires_human_review: boolean;
}

export interface GapAgentStepResult {
  agent_run_id: string;
  gaps: Array<{
    category: string;
    severity: "critical" | "important" | "informational";
    description: string;
    impact: string;
    recommendedAction: string;
  }>;
  overall_readiness: number;
  critical_gaps: string[];
  summary: string;
  confidence: number;
}

export interface SupplementAgentStepResult {
  agent_run_id: string;
  recommendations: Array<{
    opportunity: string;
    amount: number;
    amountSource: string;
    reasoning: string;
    supportingEvidence: string[];
    confidence: number;
    recommendedAction: string;
    requiresHumanReview: boolean;
  }>;
  total_recovery_potential: number;
  summary: string;
  confidence: number;
  requires_human_review: boolean;
}

export interface QAStepResult {
  agent_run_id: string;
  passed: boolean;
  checks: Array<{ check: string; passed: boolean; details: string }>;
  issues: Array<{ severity: string; description: string; recommendation: string }>;
  overall_score: number;
  summary: string;
  requires_human_review: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline step types
// ---------------------------------------------------------------------------

import type { PipelineStepDefinition } from "./types";

// ---------------------------------------------------------------------------
// Agentic pipeline definition — extends the deterministic 7-step pipeline
// ---------------------------------------------------------------------------

export function getAgentPipelineSteps(): PipelineStepDefinition[] {
  return [
    {
      id: "agent_evidence_analysis",
      type: AGENT_PIPELINE_STEPS.EVIDENCE_AGENT,
      depends_on: [
        EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
        EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
      ],
      input_mapping: {},
      max_attempts: 3,
      timeout_ms: 120_000,
      requires_review: false,
    },
    {
      id: "agent_gap_intelligence",
      type: AGENT_PIPELINE_STEPS.GAP_INTELLIGENCE,
      depends_on: [
        AGENT_PIPELINE_STEPS.EVIDENCE_AGENT,
        EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS,
      ],
      input_mapping: {},
      max_attempts: 3,
      timeout_ms: 90_000,
      requires_review: false,
    },
    {
      id: "agent_supplement_reasoning",
      type: AGENT_PIPELINE_STEPS.SUPPLEMENT_REASONING,
      depends_on: [
        AGENT_PIPELINE_STEPS.EVIDENCE_AGENT,
        AGENT_PIPELINE_STEPS.GAP_INTELLIGENCE,
        EVIDENCE_PIPELINE_STEPS.RECONCILIATION,
      ],
      input_mapping: {},
      max_attempts: 3,
      timeout_ms: 120_000,
      requires_review: true,
    },
    {
      id: "agent_qa_validation",
      type: AGENT_PIPELINE_STEPS.QA_VALIDATION,
      depends_on: [
        AGENT_PIPELINE_STEPS.SUPPLEMENT_REASONING,
      ],
      input_mapping: {},
      max_attempts: 2,
      timeout_ms: 60_000,
      requires_review: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Register all agent types with the registry
// ---------------------------------------------------------------------------

let _agentPipelineRegistered = false;

export function registerAgentPipeline(): void {
  if (_agentPipelineRegistered) return;

  // Register agent definitions
  registerAgent(EVIDENCE_AGENT_DEFINITION);
  registerAgent(GAP_INTELLIGENCE_AGENT_DEFINITION);
  registerAgent(SUPPLEMENT_REASONING_AGENT_DEFINITION);
  registerAgent(QA_AGENT_DEFINITION);

  // Register built-in tools
  registerBuiltinTools();

  _agentPipelineRegistered = true;
}

// ---------------------------------------------------------------------------
// Helper: get previous step result from job steps
// ---------------------------------------------------------------------------

function getPreviousStepResult<T>(ctx: JobExecutionContext, stepType: string): T | null {
  const prevStep = ctx.steps.find(
    (s) => s.step_type === stepType && s.status === "completed" && s.output,
  );
  if (!prevStep?.output) return null;
  return prevStep.output as unknown as T;
}

// ---------------------------------------------------------------------------
// Helper: build agent context from pipeline state
// ---------------------------------------------------------------------------

function buildAgentInput(
  ctx: JobExecutionContext,
  extraInput: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload = ctx.job.payload as Record<string, unknown>;
  return {
    claim_id: payload.claim_id,
    tenant_id: ctx.job.tenant_id,
    user_id: ctx.job.user_id,
    correlation_id: payload.correlation_id,
    ...extraInput,
  };
}

// ---------------------------------------------------------------------------
// Agent Step 1: Evidence Agent
// ---------------------------------------------------------------------------

export async function handleEvidenceAgentStep(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  registerAgentPipeline();

  const config = getAgentConfig();
  if (!config.enabled || !config.agentEnabled.evidence) {
    // Agent not enabled — return a pass-through result
    return {
      success: true,
      result: {
        agent_run_id: "skipped",
        evidence_findings: [],
        completeness_score: 0,
        missing_evidence: [],
        summary: "Evidence Agent not enabled — deterministic pipeline results only",
        confidence: null,
        requires_human_review: false,
      } as unknown as Record<string, unknown>,
    };
  }

  const input = buildAgentInput(ctx);

  const result = await executeAgent(ctx, "evidence", input, executeEvidenceAgent);

  if (!result.success) {
    return result;
  }

  const agentResult = (result.result as Record<string, unknown>) as unknown as AgentResult;
  const runRecord = (result.result as Record<string, unknown>)?.run_record as AgentRunRecord | undefined;

  const stepResult: EvidenceAgentStepResult = {
    agent_run_id: runRecord?._id ?? "unknown",
    evidence_findings: (agentResult.output.evidenceFindings as EvidenceAgentStepResult["evidence_findings"]) ?? [],
    completeness_score: (agentResult.output.completenessScore as number) ?? 0,
    missing_evidence: (agentResult.output.missingEvidence as string[]) ?? [],
    summary: (agentResult.output.summary as string) ?? "",
    confidence: agentResult.confidence ?? 0,
    requires_human_review: agentResult.requires_human_review,
  };

  return {
    success: true,
    result: stepResult as unknown as Record<string, unknown>,
    ai_metadata: runRecord?.ai_metadata ?? undefined,
    requires_human_review: agentResult.requires_human_review,
  };
}

// ---------------------------------------------------------------------------
// Agent Step 2: Gap Intelligence Agent
// ---------------------------------------------------------------------------

export async function handleGapIntelligenceStep(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  registerAgentPipeline();

  const config = getAgentConfig();
  if (!config.enabled || !config.agentEnabled.gap_intelligence) {
    return {
      success: true,
      result: {
        agent_run_id: "skipped",
        gaps: [],
        overall_readiness: 0,
        critical_gaps: [],
        summary: "Gap Intelligence Agent not enabled",
        confidence: null,
      } as unknown as Record<string, unknown>,
    };
  }

  // Gather context from previous steps
  const evidenceResult = getPreviousStepResult<EvidenceAgentStepResult>(
    ctx,
    AGENT_PIPELINE_STEPS.EVIDENCE_AGENT,
  );
  const completenessResult = getPreviousStepResult<Record<string, unknown>>(
    ctx,
    "evidence_completeness_analysis",
  );

  const input = buildAgentInput(ctx, {
    evidence_agent_output: evidenceResult,
    completeness: completenessResult,
  });

  const result = await executeAgent(ctx, "gap_intelligence", input, executeGapIntelligenceAgent);

  if (!result.success) {
    return result;
  }

  const agentResult = (result.result as Record<string, unknown>) as unknown as AgentResult;
  const runRecord = (result.result as Record<string, unknown>)?.run_record as AgentRunRecord | undefined;

  const stepResult: GapAgentStepResult = {
    agent_run_id: runRecord?._id ?? "unknown",
    gaps: (agentResult.output.gaps as GapAgentStepResult["gaps"]) ?? [],
    overall_readiness: (agentResult.output.overallReadiness as number) ?? 0,
    critical_gaps: (agentResult.output.criticalGaps as string[]) ?? [],
    summary: (agentResult.output.summary as string) ?? "",
    confidence: agentResult.confidence ?? 0,
  };

  return {
    success: true,
    result: stepResult as unknown as Record<string, unknown>,
    ai_metadata: runRecord?.ai_metadata ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Agent Step 3: Supplement Reasoning Agent
// ---------------------------------------------------------------------------

export async function handleSupplementReasoningStep(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  registerAgentPipeline();

  const config = getAgentConfig();
  if (!config.enabled || !config.agentEnabled.supplement_reasoning) {
    return {
      success: true,
      result: {
        agent_run_id: "skipped",
        recommendations: [],
        total_recovery_potential: 0,
        summary: "Supplement Reasoning Agent not enabled",
        confidence: null,
        requires_human_review: false,
      } as unknown as Record<string, unknown>,
    };
  }

  // Gather context from all previous steps
  const evidenceResult = getPreviousStepResult<EvidenceAgentStepResult>(
    ctx,
    AGENT_PIPELINE_STEPS.EVIDENCE_AGENT,
  );
  const gapResult = getPreviousStepResult<GapAgentStepResult>(
    ctx,
    AGENT_PIPELINE_STEPS.GAP_INTELLIGENCE,
  );
  const reconciliationResult = getPreviousStepResult<Record<string, unknown>>(
    ctx,
    "evidence_reconciliation",
  );

  const input = buildAgentInput(ctx, {
    evidence_agent_output: evidenceResult,
    gap_agent_output: gapResult,
    reconciliation: reconciliationResult,
  });

  const result = await executeAgent(ctx, "supplement_reasoning", input, executeSupplementReasoningAgent);

  if (!result.success) {
    return result;
  }

  const agentResult = (result.result as Record<string, unknown>) as unknown as AgentResult;
  const runRecord = (result.result as Record<string, unknown>)?.run_record as AgentRunRecord | undefined;

  const stepResult: SupplementAgentStepResult = {
    agent_run_id: runRecord?._id ?? "unknown",
    recommendations: (agentResult.output.recommendations as SupplementAgentStepResult["recommendations"]) ?? [],
    total_recovery_potential: (agentResult.output.totalRecoveryPotential as number) ?? 0,
    summary: (agentResult.output.summary as string) ?? "",
    confidence: agentResult.confidence ?? 0,
    requires_human_review: agentResult.requires_human_review,
  };

  return {
    success: true,
    result: stepResult as unknown as Record<string, unknown>,
    ai_metadata: runRecord?.ai_metadata ?? undefined,
    requires_human_review: agentResult.requires_human_review,
  };
}

// ---------------------------------------------------------------------------
// Agent Step 4: QA Validation
// ---------------------------------------------------------------------------

export async function handleQAValidationStep(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  registerAgentPipeline();

  const config = getAgentConfig();
  if (!config.enabled || !config.agentEnabled.qa) {
    return {
      success: true,
      result: {
        agent_run_id: "skipped",
        passed: true,
        checks: [],
        issues: [],
        overall_score: 100,
        summary: "QA Agent not enabled — auto-pass",
        requires_human_review: false,
      } as unknown as Record<string, unknown>,
    };
  }

  // Gather the supplement agent output for QA validation
  const supplementResult = getPreviousStepResult<SupplementAgentStepResult>(
    ctx,
    AGENT_PIPELINE_STEPS.SUPPLEMENT_REASONING,
  );

  const input = buildAgentInput(ctx, {
    agent_output: supplementResult ? {
      recommendations: supplementResult.recommendations,
      totalRecoveryPotential: supplementResult.total_recovery_potential,
      summary: supplementResult.summary,
    } : {},
    source_agent_type: "supplement_reasoning",
  });

  const result = await executeAgent(ctx, "qa", input, executeQAAgent);

  if (!result.success) {
    return result;
  }

  const agentResult = (result.result as Record<string, unknown>) as unknown as AgentResult;
  const runRecord = (result.result as Record<string, unknown>)?.run_record as AgentRunRecord | undefined;

  const stepResult: QAStepResult = {
    agent_run_id: runRecord?._id ?? "unknown",
    passed: (agentResult.output.passed as boolean) ?? false,
    checks: (agentResult.output.checks as QAStepResult["checks"]) ?? [],
    issues: (agentResult.output.issues as QAStepResult["issues"]) ?? [],
    overall_score: (agentResult.output.overallScore as number) ?? 0,
    summary: (agentResult.output.summary as string) ?? "",
    requires_human_review: agentResult.requires_human_review,
  };

  return {
    success: true,
    result: stepResult as unknown as Record<string, unknown>,
    ai_metadata: runRecord?.ai_metadata ?? undefined,
    requires_human_review: agentResult.requires_human_review,
  };
}

// ---------------------------------------------------------------------------
// Agent Pipeline Handler Registry
// ---------------------------------------------------------------------------

export const AGENT_PIPELINE_HANDLERS: Record<
  string,
  (ctx: JobExecutionContext) => Promise<HandlerResult>
> = {
  [AGENT_PIPELINE_STEPS.EVIDENCE_AGENT]: handleEvidenceAgentStep,
  [AGENT_PIPELINE_STEPS.GAP_INTELLIGENCE]: handleGapIntelligenceStep,
  [AGENT_PIPELINE_STEPS.SUPPLEMENT_REASONING]: handleSupplementReasoningStep,
  [AGENT_PIPELINE_STEPS.QA_VALIDATION]: handleQAValidationStep,
};

/** Register all agent pipeline handlers with the global handler registry. */
export function registerAgentPipelineHandlers(): void {
  // Dynamic import to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerJobHandler } = require("./handler-registry");
  for (const [stepType, handler] of Object.entries(AGENT_PIPELINE_HANDLERS)) {
    registerJobHandler(stepType, handler);
  }
  registerAgentPipeline();
}
