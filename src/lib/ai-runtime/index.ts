// ---------------------------------------------------------------------------
// Atlas AI Runtime — Barrel Export
//
// Import from "@/lib/ai-runtime" to access the provider-agnostic AI runtime.
// ---------------------------------------------------------------------------

// Runtime API
export {
  initAtlasAI,
  resetAtlasAI,
  generate,
  generateStructured,
  stream,
  embed,
  vision,
  type AtlasAIRuntimeConfig,
} from "./runtime";

// Provider registry
export {
  initializeRegistry,
  registerProvider,
  getProvider,
  getAllProviders,
  getAvailableProviders,
  isProviderAvailable,
  findProviderForModel,
  findProvidersForTier,
  resetRegistry,
} from "./registry";

// Providers (for direct registration)
export { GeminiProvider } from "./providers/gemini";
export { NvidiaNimProvider } from "./providers/nvidia-nim";

// Configuration
export {
  loadProviderConfigs,
  resetConfigCache,
  isGeminiConfigured,
  isNvidiaNimConfigured,
  getDefaultFallbackConfig,
} from "./config";

// Usage tracking
export {
  recordUsage,
  getUsageRecords,
  getUsageByProvider,
  getErrorRateByProvider,
  getTotalCost,
  resetUsageRecords,
} from "./usage-tracker";

// Errors
export {
  createAIRuntimeError,
  isRetryableCode,
  httpStatusToErrorCode,
  classifyFetchError,
  sanitizeErrorMessage,
} from "./errors";

// Task registry
export {
  getTaskConfig,
  getAllTasks,
  isValidTask,
  type AtlasAITask,
  type TaskConfig,
} from "./tasks";

// Model registry (Phase 3)
export {
  initializeModelRegistry,
  resetModelRegistry,
  isModelRegistryInitialized,
  getModelProfile,
  getAllModelProfiles,
  getAvailableModels,
  findModels,
  recordModelFailure,
  recordModelSuccess,
  setModelDisabled,
  getModelRegistryStatus,
  type ModelRoutingProfile,
  type CapabilityRequirement,
} from "./model-registry";

// Task requirements (Phase 3)
export {
  getTaskRequirements,
  getAllTaskRequirements,
  getTasksRequiringCapability,
  levelToScore,
  type TaskRequirementProfile,
  type CapabilityReq,
} from "./task-requirements";

// Task router (Phase 3)
export {
  initTaskRouter,
  resetTaskRouter,
  getRoutingConfig,
  updateRoutingConfig,
  routeTask,
  reportTaskSuccess,
  reportTaskFailure,
  getRoutingStatus,
  type RoutingMode,
  type RoutingConfig,
  type RoutingDecision,
} from "./task-router";

// Task-aware runtime (Phase 3)
export {
  taskGenerate,
  taskGenerateStructured,
  taskEmbed,
  type TaskGenerateRequest,
  type TaskStructuredRequest,
  type TaskEmbedRequest,
} from "./task-runtime";

// Evaluation framework (Phase 4)
export {
  runBenchmark,
  type BenchmarkConfig,
} from "./eval/runner";

export {
  getAllCases,
  getCasesForTask,
  getCasesForDomain,
  getCasesByDifficulty,
  getCaseById,
  getDatasetSummary,
} from "./eval/dataset";

export {
  scoreStructuralValidity,
  scoreKeywordCoverage,
  scoreGrounding,
  scoreHallucination,
  scoreCompleteness,
  computeOverallScore,
  scoreCaseResult,
} from "./eval/criteria";

export {
  generateScorecards,
  generateRecommendations,
  formatScorecards,
  formatRecommendations,
} from "./eval/scorecard";

export {
  generateRoutingSuggestions,
  applyRoutingSuggestions,
  diffScorecards,
  type RoutingSuggestion,
  type BenchmarkDiff,
} from "./eval/router-integration";

export type {
  EvalCase,
  EvalCaseResult,
  EvalRun,
  ModelScorecard,
  BenchmarkRecommendation,
} from "./eval/types";

// Types
export type {
  ProviderId,
  ProviderConfig,
  ModelConfig,
  ModelTier,
  ModelCapabilities,
  GenerateRequest,
  GenerateResult,
  StructuredOutputRequest,
  StructuredOutputResult,
  StreamRequest,
  StreamChunk,
  EmbedRequest,
  EmbedResult,
  VisionRequest,
  ToolDefinition,
  ToolCallRequest,
  ToolCall,
  ToolCallResult,
  AIProviderAdapter,
  AIRuntimeError,
  AIRuntimeErrorCode,
  TokenUsage,
  UsageRecord,
  FallbackConfig,
} from "./types";
