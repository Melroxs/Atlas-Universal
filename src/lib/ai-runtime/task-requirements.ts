// ---------------------------------------------------------------------------
// Atlas AI Runtime — Task Requirements
//
// Defines capability requirements for each Atlas AI task. The task router
// uses these requirements to select the best model for each workload.
// ---------------------------------------------------------------------------

import type { CapabilityLevel } from "./types";
import type { AtlasAITask } from "./tasks";

// ---------------------------------------------------------------------------
// Capability requirement
// ---------------------------------------------------------------------------

export interface CapabilityReq {
  /** Minimum level needed. */
  level: CapabilityLevel;
  /** Whether this is strictly required (task fails without it). */
  required: boolean;
  /** Weight for scoring (higher = more important for model selection). */
  weight: number;
}

// ---------------------------------------------------------------------------
// Task requirement profile
// ---------------------------------------------------------------------------

export interface TaskRequirementProfile {
  /** Task identifier. */
  task: AtlasAITask;
  /** Human-readable name. */
  name: string;

  // Capability requirements
  reasoning: CapabilityReq;
  structuredOutput: CapabilityReq;
  streaming: CapabilityReq;
  toolCalling: CapabilityReq;
  embeddings: CapabilityReq;
  vision: CapabilityReq;
  documentUnderstanding: CapabilityReq;
  longContext: CapabilityReq;
  speed: CapabilityReq;

  // Constraints
  minContextTokens: number;
  minOutputTokens: number;
  maxCostPer1kTokens: number;

  // Routing hints
  preferredTiers: Array<"fast" | "standard" | "strong">;
  preferredProviders: string[]; // empty = any

  // Fallback behavior
  allowFallback: boolean;
  maxFallbackAttempts: number;
}

// ---------------------------------------------------------------------------
// Level-to-score mapping
// ---------------------------------------------------------------------------

function levelToScore(level: CapabilityLevel): number {
  switch (level) {
    case "high": return 8;
    case "medium": return 5;
    case "low": return 2;
  }
}

export { levelToScore };

// ---------------------------------------------------------------------------
// Task requirement definitions
//
// Derived from actual Atlas workloads discovered in Phase 2.
// ---------------------------------------------------------------------------

const TASK_REQUIREMENTS: Record<AtlasAITask, TaskRequirementProfile> = {
  // -----------------------------------------------------------------------
  // Knowledge & embeddings
  // -----------------------------------------------------------------------
  embedding: {
    task: "embedding",
    name: "Document Embedding",
    reasoning: { level: "low", required: false, weight: 0 },
    structuredOutput: { level: "low", required: false, weight: 0 },
    streaming: { level: "low", required: false, weight: 0 },
    toolCalling: { level: "low", required: false, weight: 0 },
    embeddings: { level: "high", required: true, weight: 10 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "low", required: false, weight: 0 },
    longContext: { level: "low", required: false, weight: 0 },
    speed: { level: "high", required: false, weight: 8 },
    minContextTokens: 0,
    minOutputTokens: 0,
    maxCostPer1kTokens: 0.001,
    preferredTiers: ["fast"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 2,
  },

  embedding_query: {
    task: "embedding_query",
    name: "Query Embedding",
    reasoning: { level: "low", required: false, weight: 0 },
    structuredOutput: { level: "low", required: false, weight: 0 },
    streaming: { level: "low", required: false, weight: 0 },
    toolCalling: { level: "low", required: false, weight: 0 },
    embeddings: { level: "high", required: true, weight: 10 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "low", required: false, weight: 0 },
    longContext: { level: "low", required: false, weight: 0 },
    speed: { level: "high", required: false, weight: 9 },
    minContextTokens: 0,
    minOutputTokens: 0,
    maxCostPer1kTokens: 0.001,
    preferredTiers: ["fast"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 2,
  },

  // -----------------------------------------------------------------------
  // Conversational AI
  // -----------------------------------------------------------------------
  ask_atlas: {
    task: "ask_atlas",
    name: "Ask Atlas",
    reasoning: { level: "medium", required: false, weight: 6 },
    structuredOutput: { level: "high", required: true, weight: 8 },
    streaming: { level: "low", required: false, weight: 2 },
    toolCalling: { level: "medium", required: false, weight: 4 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "medium", required: false, weight: 3 },
    longContext: { level: "medium", required: false, weight: 3 },
    speed: { level: "high", required: false, weight: 7 },
    minContextTokens: 8_192,
    minOutputTokens: 600,
    maxCostPer1kTokens: 0.005,
    preferredTiers: ["fast", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  voice_conversation: {
    task: "voice_conversation",
    name: "Atlas Voice",
    reasoning: { level: "medium", required: false, weight: 6 },
    structuredOutput: { level: "medium", required: true, weight: 7 },
    streaming: { level: "low", required: false, weight: 2 },
    toolCalling: { level: "medium", required: false, weight: 4 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "medium", required: false, weight: 3 },
    longContext: { level: "medium", required: false, weight: 3 },
    speed: { level: "high", required: true, weight: 9 },
    minContextTokens: 8_192,
    minOutputTokens: 600,
    maxCostPer1kTokens: 0.005,
    preferredTiers: ["fast"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 2,
  },

  // -----------------------------------------------------------------------
  // CRM / outreach
  // -----------------------------------------------------------------------
  crm_outreach: {
    task: "crm_outreach",
    name: "CRM Outreach",
    reasoning: { level: "low", required: false, weight: 3 },
    structuredOutput: { level: "medium", required: false, weight: 4 },
    streaming: { level: "low", required: false, weight: 0 },
    toolCalling: { level: "low", required: false, weight: 0 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "low", required: false, weight: 0 },
    longContext: { level: "low", required: false, weight: 0 },
    speed: { level: "high", required: false, weight: 8 },
    minContextTokens: 4_096,
    minOutputTokens: 1_024,
    maxCostPer1kTokens: 0.003,
    preferredTiers: ["fast"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  email_generation: {
    task: "email_generation",
    name: "Email Generation",
    reasoning: { level: "low", required: false, weight: 3 },
    structuredOutput: { level: "medium", required: false, weight: 4 },
    streaming: { level: "low", required: false, weight: 0 },
    toolCalling: { level: "low", required: false, weight: 0 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 0 },
    documentUnderstanding: { level: "low", required: false, weight: 0 },
    longContext: { level: "low", required: false, weight: 0 },
    speed: { level: "high", required: false, weight: 8 },
    minContextTokens: 4_096,
    minOutputTokens: 1_024,
    maxCostPer1kTokens: 0.003,
    preferredTiers: ["fast"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  // -----------------------------------------------------------------------
  // Agent reasoning (future — higher capability requirements)
  // -----------------------------------------------------------------------
  evidence_reasoning: {
    task: "evidence_reasoning",
    name: "Evidence Reasoning",
    reasoning: { level: "high", required: true, weight: 10 },
    structuredOutput: { level: "high", required: true, weight: 9 },
    streaming: { level: "low", required: false, weight: 1 },
    toolCalling: { level: "medium", required: false, weight: 4 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "medium", required: false, weight: 3 },
    documentUnderstanding: { level: "high", required: false, weight: 6 },
    longContext: { level: "high", required: false, weight: 7 },
    speed: { level: "low", required: false, weight: 2 },
    minContextTokens: 32_768,
    minOutputTokens: 4_096,
    maxCostPer1kTokens: 0.01,
    preferredTiers: ["strong", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  gap_intelligence: {
    task: "gap_intelligence",
    name: "Gap Intelligence",
    reasoning: { level: "high", required: true, weight: 10 },
    structuredOutput: { level: "high", required: true, weight: 9 },
    streaming: { level: "low", required: false, weight: 1 },
    toolCalling: { level: "medium", required: false, weight: 4 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "medium", required: false, weight: 3 },
    documentUnderstanding: { level: "high", required: false, weight: 6 },
    longContext: { level: "high", required: false, weight: 7 },
    speed: { level: "low", required: false, weight: 2 },
    minContextTokens: 32_768,
    minOutputTokens: 4_096,
    maxCostPer1kTokens: 0.01,
    preferredTiers: ["strong", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  supplement_reasoning: {
    task: "supplement_reasoning",
    name: "Supplement Reasoning",
    reasoning: { level: "high", required: true, weight: 10 },
    structuredOutput: { level: "high", required: true, weight: 9 },
    streaming: { level: "low", required: false, weight: 1 },
    toolCalling: { level: "medium", required: false, weight: 4 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "medium", required: false, weight: 3 },
    documentUnderstanding: { level: "high", required: false, weight: 6 },
    longContext: { level: "high", required: false, weight: 7 },
    speed: { level: "low", required: false, weight: 2 },
    minContextTokens: 32_768,
    minOutputTokens: 4_096,
    maxCostPer1kTokens: 0.01,
    preferredTiers: ["strong", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  qa_reasoning: {
    task: "qa_reasoning",
    name: "QA Reasoning",
    reasoning: { level: "high", required: true, weight: 9 },
    structuredOutput: { level: "high", required: true, weight: 8 },
    streaming: { level: "low", required: false, weight: 1 },
    toolCalling: { level: "low", required: false, weight: 2 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 1 },
    documentUnderstanding: { level: "medium", required: false, weight: 4 },
    longContext: { level: "medium", required: false, weight: 5 },
    speed: { level: "low", required: false, weight: 3 },
    minContextTokens: 16_384,
    minOutputTokens: 2_048,
    maxCostPer1kTokens: 0.008,
    preferredTiers: ["strong", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },

  agent_reasoning: {
    task: "agent_reasoning",
    name: "Agent Reasoning",
    reasoning: { level: "high", required: true, weight: 9 },
    structuredOutput: { level: "medium", required: false, weight: 5 },
    streaming: { level: "high", required: false, weight: 6 },
    toolCalling: { level: "high", required: true, weight: 8 },
    embeddings: { level: "low", required: false, weight: 0 },
    vision: { level: "low", required: false, weight: 1 },
    documentUnderstanding: { level: "medium", required: false, weight: 4 },
    longContext: { level: "high", required: false, weight: 6 },
    speed: { level: "medium", required: false, weight: 5 },
    minContextTokens: 16_384,
    minOutputTokens: 4_096,
    maxCostPer1kTokens: 0.01,
    preferredTiers: ["strong", "standard"],
    preferredProviders: [],
    allowFallback: true,
    maxFallbackAttempts: 3,
  },
};

// ---------------------------------------------------------------------------
// Requirement query API
// ---------------------------------------------------------------------------

/**
 * Get requirements for a specific task.
 */
export function getTaskRequirements(task: AtlasAITask): TaskRequirementProfile {
  return TASK_REQUIREMENTS[task];
}

/**
 * Get all task requirement profiles.
 */
export function getAllTaskRequirements(): TaskRequirementProfile[] {
  return Object.values(TASK_REQUIREMENTS);
}

/**
 * Get tasks that require a specific capability.
 */
export function getTasksRequiringCapability(
  capability: keyof Pick<
    TaskRequirementProfile,
    "reasoning" | "structuredOutput" | "streaming" | "toolCalling" | "embeddings" | "vision" | "documentUnderstanding" | "longContext" | "speed"
  >,
  minLevel: CapabilityLevel = "medium",
): AtlasAITask[] {
  const minScore = levelToScore(minLevel);
  return Object.entries(TASK_REQUIREMENTS)
    .filter(([, profile]) => {
      const req = profile[capability];
      return req.level !== "low" && levelToScore(req.level) >= minScore;
    })
    .map(([task]) => task as AtlasAITask);
}
