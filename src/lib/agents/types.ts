// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Type Definitions
//
// Extends the existing Agent types in jobs/types.ts with agent definition
// contracts, tool contracts, execution context, and configuration.
// ---------------------------------------------------------------------------

import type {
  AgentType,
  AgentTool,
  ModelPolicy,
  AIMetadata,
  ProvenanceRecord,
  ToolCallRecord,
  HumanReviewRecord,
  JobPriority,
} from "../jobs/types";

// Re-export AgentResult from the canonical source
export type { AgentResult } from "../jobs/types";

// ---------------------------------------------------------------------------
// Agent Definition — registered specification for an agent
// ---------------------------------------------------------------------------

export type ToolRiskLevel = "read" | "low_risk_write" | "high_risk_write" | "external_action";

export interface ToolDefinition {
  name: string;
  description: string;
  risk_level: ToolRiskLevel;
  readOnly: boolean;
  /** JSON Schema-like input validation. */
  input_schema: Record<string, unknown>;
  /** Whether this tool enforces tenant isolation internally. */
  tenant_isolated: boolean;
}

export interface AgentDefinition {
  type: AgentType;
  version: string;
  description: string;
  /** Tool names this agent is allowed to use. */
  allowedTools: string[];
  /** Model policy for this agent type. */
  modelPolicy: ModelPolicy;
  /** Maximum reasoning iterations before forced stop. */
  maxIterations: number;
  /** Maximum total tool calls per execution. */
  maxToolCalls: number;
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /** Whether this agent's output requires human review. */
  requiresHumanReview: boolean;
  /** System prompt template for the agent. */
  systemPrompt: string;
  /** Whether this agent is enabled by default. */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Agent Execution Context — runtime info passed to the agent
// ---------------------------------------------------------------------------

export interface AgentExecutionContext {
  /** Unique ID for this execution run. */
  runId: string;
  /** Agent definition being executed. */
  agentDefinition: AgentDefinition;
  /** Tenant ID — always from trusted context, never from user input. */
  tenantId: string;
  /** User ID who initiated the task. */
  userId: string | null;
  /** Job ID this agent is executing within. */
  jobId: string;
  /** Step ID within the job. */
  stepId: string | null;
  /** Correlation ID for tracing across pipeline steps. */
  correlationId: string;
  /** The task input. */
  input: Record<string, unknown>;
  /** Tools available to this agent. */
  tools: Map<string, ToolDefinition>;
  /** Model policy resolved for this execution. */
  resolvedModel: { provider: string; model: string };
  /** Structured logger. */
  logger: AgentLogger;
  /** Abort signal for timeout/cancellation. */
  signal: AbortSignal;
  /** Running tally of tool calls. */
  toolCallCount: number;
  /** Running tally of iterations. */
  iterationCount: number;
}

// ---------------------------------------------------------------------------
// Agent Logger — structured observability
// ---------------------------------------------------------------------------

export interface AgentLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Agent Run Record — persistent tracking
// ---------------------------------------------------------------------------

export interface AgentRunRecord {
  _id: string;
  tenant_id: string;
  user_id: string | null;
  job_id: string;
  step_id: string | null;
  agent_type: AgentType;
  agent_version: string;
  provider: string | null;
  model: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | "pending_review";
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown> | null;
  token_usage: number;
  estimated_cost_usd: number | null;
  confidence: number | null;
  requires_human_review: boolean;
  error: string | null;
  tool_calls: ToolCallRecord[];
  ai_metadata: AIMetadata | null;
  provenance: ProvenanceRecord[];
  events: AgentEvent[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Agent Event — traceable execution events
// ---------------------------------------------------------------------------

export type AgentEventType =
  | "agent.started"
  | "agent.tool_called"
  | "agent.tool_completed"
  | "agent.model_called"
  | "agent.model_completed"
  | "agent.validation_failed"
  | "agent.review_requested"
  | "agent.completed"
  | "agent.failed"
  | "agent.retry";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent Configuration — feature flags
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Master switch for the agent runtime. */
  enabled: boolean;
  /** Per-agent-type enablement. */
  agentEnabled: Record<AgentType, boolean>;
  /** Default model policy. */
  defaultModelPolicy: ModelPolicy;
  /** Global max iterations. */
  globalMaxIterations: number;
  /** Global max tool calls. */
  globalMaxToolCalls: number;
  /** Global timeout. */
  globalTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Default agent configuration
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
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
    preferred_provider: undefined,
    preferred_model: undefined,
    max_model_tier: "standard",
    max_tokens: 4096,
    max_cost_usd: 0.1,
    allow_escalation: true,
  },
  globalMaxIterations: 5,
  globalMaxToolCalls: 20,
  globalTimeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Confidence-based escalation
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export function classifyConfidence(
  confidence: number | null,
): ConfidenceLevel {
  if (confidence === null || confidence === undefined) return "medium";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function requiresHumanReview(confidence: number | null): boolean {
  return classifyConfidence(confidence) === "low";
}
