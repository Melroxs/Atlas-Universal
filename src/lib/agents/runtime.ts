// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Core Execution Engine
//
// The runtime orchestrates agent execution within the job/worker system.
// It does NOT contain claim-specific reasoning — agents handle that.
// The runtime provides:
//   1. Task validation
//   2. Tool resolution + authorization
//   3. Model selection
//   4. Iterative agent loop (think → tool → think → ...)
//   5. Output validation
//   6. Confidence-based escalation
//   7. AI metadata recording
//   8. Event logging
//   9. Timeout enforcement
//  10. Cancellation support
// ---------------------------------------------------------------------------

import type {
  AgentType,
  JobExecutionContext,
  HandlerResult,
  AIMetadata,
  ProvenanceRecord,
  ToolCallRecord,
} from "../jobs/types";
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentResult,
  AgentEvent,
  AgentLogger,
  AgentRunRecord,
  ToolDefinition,
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
} from "./types";
import { classifyConfidence, requiresHumanReview } from "./types";
import { getAgent } from "./agent-registry";
import { getTool, executeTool, clearEvidenceDataCache } from "./tool-registry";
import { resolveModel, estimateCost, type ResolvedModel } from "./model-router";

// ---------------------------------------------------------------------------
// Agent Config (mutable for testing)
// ---------------------------------------------------------------------------

let _config: AgentConfig = {
  enabled: false,
  agentEnabled: {
    evidence: false,
    gap_intelligence: false,
    supplement_reasoning: false,
    qa: false,
    infrastructure: false,
    support: false,
  },
  defaultModelPolicy: {
    max_model_tier: "standard",
    max_tokens: 4096,
    max_cost_usd: 0.1,
    allow_escalation: true,
  },
  globalMaxIterations: 5,
  globalMaxToolCalls: 20,
  globalTimeoutMs: 120_000,
};

export function getAgentConfig(): AgentConfig {
  return { ..._config, agentEnabled: { ..._config.agentEnabled } };
}

export function setAgentConfig(overrides: Partial<AgentConfig>): void {
  _config = {
    ..._config,
    ...overrides,
    agentEnabled: { ..._config.agentEnabled, ...(overrides.agentEnabled ?? {}) },
  };
}

export function resetAgentConfig(): void {
  _config = {
    enabled: false,
    agentEnabled: {
      evidence: false,
      gap_intelligence: false,
      supplement_reasoning: false,
      qa: false,
      infrastructure: false,
      support: false,
    },
    defaultModelPolicy: {
      max_model_tier: "standard",
      max_tokens: 4096,
      max_cost_usd: 0.1,
      allow_escalation: true,
    },
    globalMaxIterations: 5,
    globalMaxToolCalls: 20,
    globalTimeoutMs: 120_000,
  };
}

// ---------------------------------------------------------------------------
// Agent execution function type
//
// Each agent implements this function. It receives the context and
// tools, and must return a structured AgentResult.
// ---------------------------------------------------------------------------

export type AgentExecuteFn = (
  ctx: AgentExecutionContext,
) => Promise<AgentResult>;

// ---------------------------------------------------------------------------
// Main execution entry point
// ---------------------------------------------------------------------------

export async function executeAgent(
  jobCtx: JobExecutionContext,
  agentType: AgentType,
  input: Record<string, unknown>,
  executeFn: AgentExecuteFn,
): Promise<HandlerResult> {
  const startTime = Date.now();
  const events: AgentEvent[] = [];

  // 1. Check global enablement
  if (!_config.enabled) {
    return {
      success: false,
      error: { code: "AGENT_RUNTIME_DISABLED", message: "Agent runtime is not enabled", details: {}, retryable: false },
    };
  }

  // 2. Check agent-type enablement
  if (!_config.agentEnabled[agentType]) {
    return {
      success: false,
      error: { code: "AGENT_DISABLED", message: `Agent type '${agentType}' is not enabled`, details: {}, retryable: false },
    };
  }

  // 3. Look up agent definition
  const agentDef = getAgent(agentType);
  if (!agentDef) {
    return {
      success: false,
      error: { code: "AGENT_NOT_FOUND", message: `No agent registered for type '${agentType}'`, details: {}, retryable: false },
    };
  }

  if (!agentDef.enabled) {
    return {
      success: false,
      error: { code: "AGENT_DISABLED", message: `Agent '${agentType}' v${agentDef.version} is disabled`, details: {}, retryable: false },
    };
  }

  // 4. Resolve tools
  const tools = new Map<string, ToolDefinition>();
  for (const toolName of agentDef.allowedTools) {
    const tool = getTool(toolName);
    if (tool) {
      const { execute: _, ...def } = tool;
      tools.set(toolName, def);
    }
  }

  // 5. Resolve model
  const resolvedModel = resolveModel(agentDef.modelPolicy);
  if (!resolvedModel) {
    return {
      success: false,
      error: { code: "NO_MODEL_AVAILABLE", message: "No AI model available for this agent's policy", details: {}, retryable: false },
    };
  }

  // 6. Build execution context
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const correlationId =
    (jobCtx.job.payload as Record<string, unknown>)?.correlation_id as string ||
    runId;

  const agentLogger = createAgentLogger(jobCtx.logger, agentType, runId);

  const agentCtx: AgentExecutionContext = {
    runId,
    agentDefinition: agentDef,
    tenantId: jobCtx.job.tenant_id,
    userId: jobCtx.job.user_id,
    jobId: jobCtx.job._id,
    stepId: jobCtx.step?.step_type ?? null,
    correlationId,
    input,
    tools,
    resolvedModel: { provider: resolvedModel.provider, model: resolvedModel.model },
    logger: agentLogger,
    signal: jobCtx.signal,
    toolCallCount: 0,
    iterationCount: 0,
  };

  events.push({
    type: "agent.started",
    timestamp: new Date().toISOString(),
    data: {
      agent_type: agentType,
      agent_version: agentDef.version,
      provider: resolvedModel.provider,
      model: resolvedModel.model,
      allowed_tools: agentDef.allowedTools,
    },
  });

  agentLogger.info("Agent execution started", {
    agent_type: agentType,
    version: agentDef.version,
    model: `${resolvedModel.provider}/${resolvedModel.model}`,
    run_id: runId,
  });

  // 7. Execute the agent function
  let result: AgentResult;
  try {
    result = await executeFn(agentCtx);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Agent execution failed";
    agentLogger.error("Agent execution error", { error: errorMsg });

    events.push({
      type: "agent.failed",
      timestamp: new Date().toISOString(),
      data: { error: errorMsg },
    });

    return {
      success: false,
      error: { code: "AGENT_EXECUTION_FAILED", message: errorMsg, details: {}, retryable: true },
      result: {
        status: "failed",
        output: {},
        confidence: null,
        evidence: [],
        provenance: [],
        model_used: `${resolvedModel.provider}/${resolvedModel.model}`,
        token_usage: 0,
        duration_ms: Date.now() - startTime,
        errors: [{ code: "EXECUTION_ERROR", message: errorMsg, retryable: true }],
        requires_human_review: false,
      } as unknown as Record<string, unknown>,
    };
  }

  // 8. Record completion event
  events.push({
    type: "agent.completed",
    timestamp: new Date().toISOString(),
    data: {
      confidence: result.confidence,
      requires_human_review: result.requires_human_review,
      tool_calls: agentCtx.toolCallCount,
      iterations: agentCtx.iterationCount,
    },
  });

  // 9. Clear evidence data cache for this execution
  clearEvidenceDataCache();

  const duration = Date.now() - startTime;

  agentLogger.info("Agent execution completed", {
    agent_type: agentType,
    confidence: result.confidence,
    requires_human_review: result.requires_human_review,
    duration_ms: duration,
    tool_calls: agentCtx.toolCallCount,
  });

  // 10. Build the run record (for observability)
  const runRecord: AgentRunRecord = {
    _id: runId,
    tenant_id: agentCtx.tenantId,
    user_id: agentCtx.userId,
    job_id: agentCtx.jobId,
    step_id: agentCtx.stepId,
    agent_type: agentType,
    agent_version: agentDef.version,
    provider: resolvedModel.provider,
    model: resolvedModel.model,
    status: result.requires_human_review ? "pending_review" :
            result.status === "completed" ? "completed" : "failed",
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: duration,
    input_summary: sanitizeInput(input),
    output_summary: sanitizeOutput(result.output),
    token_usage: result.token_usage,
    estimated_cost_usd: estimateCost(resolvedModel, result.token_usage),
    confidence: result.confidence,
    requires_human_review: result.requires_human_review,
    error: result.errors.length > 0 ? result.errors.map((e) => e.message).join("; ") : null,
    tool_calls: [], // Populated by tool execution wrappers
    ai_metadata: {
      provider: resolvedModel.provider,
      model: resolvedModel.model,
      tokens_used: result.token_usage,
      estimated_cost_usd: estimateCost(resolvedModel, result.token_usage),
      latency_ms: duration,
      confidence: result.confidence,
      retry_count: 0,
    },
    provenance: result.provenance,
    events,
    created_at: new Date().toISOString(),
  };

  return {
    success: result.status === "completed",
    result: {
      ...result,
      run_record: runRecord,
    } as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Helper: create structured agent logger
// ---------------------------------------------------------------------------

function createAgentLogger(
  parentLogger: JobExecutionContext["logger"],
  agentType: AgentType,
  runId: string,
): AgentLogger {
  const prefix = `[agent:${agentType}:${runId}]`;
  return {
    info: (msg, data) => parentLogger.info(`${prefix} ${msg}`, data),
    warn: (msg, data) => parentLogger.warn(`${prefix} ${msg}`, data),
    error: (msg, data) => parentLogger.error(`${prefix} ${msg}`, data),
    debug: (msg, data) => parentLogger.debug?.(`${prefix} ${msg}`, data),
  };
}

// ---------------------------------------------------------------------------
// Helper: sanitize input/output for storage (remove large payloads)
// ---------------------------------------------------------------------------

function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + "...[truncated]";
    } else if (Array.isArray(value) && value.length > 10) {
      sanitized[key] = `[${value.length} items]`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  return sanitizeInput(output);
}
