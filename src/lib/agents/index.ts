// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Barrel Export
//
// Import from "@/lib/agents" to access the agent runtime.
// ---------------------------------------------------------------------------

// Types
export type {
  AgentDefinition,
  AgentExecutionContext,
  AgentResult,
  AgentRunRecord,
  AgentEvent,
  AgentEventType,
  AgentConfig,
  AgentLogger,
  ToolDefinition,
  ToolRiskLevel,
  ConfidenceLevel,
} from "./types";
export {
  classifyConfidence,
  requiresHumanReview,
  DEFAULT_AGENT_CONFIG,
} from "./types";

// Agent Registry
export {
  registerAgent,
  registerAgents,
  getAgent,
  getAgentVersion,
  hasAgent,
  listAgents,
  listAgentTypes,
  clearAgents,
} from "./agent-registry";

// Tool Registry
export {
  registerTool,
  registerTools,
  getTool,
  hasTool,
  listTools,
  clearTools,
  isToolAuthorized,
  executeTool,
  registerBuiltinTools,
  clearEvidenceDataCache,
  type ToolExecutor,
  type RegisteredTool,
} from "./tool-registry";

// Model Router
export {
  resolveModel,
  estimateCost,
  configureProviders,
  getAvailableProviders,
  markProviderAvailable,
  type ProviderConfig,
  type ModelConfig,
  type ResolvedModel,
} from "./model-router";

// Runtime
export {
  executeAgent,
  getAgentConfig,
  setAgentConfig,
  resetAgentConfig,
  type AgentExecuteFn,
} from "./runtime";

// Agent Definitions
export { EVIDENCE_AGENT_DEFINITION, executeEvidenceAgent } from "./evidence-agent";
export { GAP_INTELLIGENCE_AGENT_DEFINITION, executeGapIntelligenceAgent } from "./gap-agent";
export { SUPPLEMENT_REASONING_AGENT_DEFINITION, executeSupplementReasoningAgent } from "./supplement-agent";
export { QA_AGENT_DEFINITION, executeQAAgent } from "./qa-agent";
export {
  createReviewRequest,
  getReviewRequest,
  listPendingReviews,
  listJobReviews,
  approveReview,
  rejectReview,
  requestChanges,
  toHumanReviewRecord,
  clearReviews,
  type ReviewRequest,
} from "./human-review";
export {
  createReview,
  getReview,
  listReviews as listDbReviews,
  listJobReviews as listDbJobReviews,
  approveReview as approveDbReview,
  rejectReview as rejectDbReview,
  requestChanges as requestDbChanges,
  countPendingReviews as countDbPendingReviews,
  isValidTransition,
  getValidTransitions,
  type HumanReviewRow,
} from "./human-review-api";
