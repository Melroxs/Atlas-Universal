// ---------------------------------------------------------------------------
// Atlas AI Runtime — Task Registry
//
// Maps Atlas business operations to AI runtime tasks. Each task identifies
// a specific AI workload so the runtime can route to the best provider/model
// for that operation. Tasks are discovered from actual Atlas functionality,
// not invented.
// ---------------------------------------------------------------------------

import type { ModelTier, ProviderId } from "./types";

// ---------------------------------------------------------------------------
// Task identifiers (derived from actual Atlas call sites)
// ---------------------------------------------------------------------------

export type AtlasAITask =
  // Knowledge & embeddings
  | "embedding"
  | "embedding_query"

  // Conversational AI (Ask Atlas, Atlas Voice, assistant panel)
  | "ask_atlas"
  | "voice_conversation"

  // CRM / outreach
  | "crm_outreach"
  | "email_generation"

  // Agent reasoning (disabled by default, future)
  | "evidence_reasoning"
  | "gap_intelligence"
  | "supplement_reasoning"
  | "qa_reasoning"
  | "agent_reasoning";

// ---------------------------------------------------------------------------
// Task configuration
// ---------------------------------------------------------------------------

export interface TaskConfig {
  /** Human-readable task name. */
  name: string;
  /** Description of what this task does. */
  description: string;
  /** Preferred model tier for this task. */
  preferredTier: ModelTier;
  /** Preferred provider (if any; otherwise auto-selected). */
  preferredProvider?: ProviderId;
  /** Max output tokens for this task. */
  maxTokens: number;
  /** Temperature for this task. */
  temperature: number;
  /** Whether this task requires structured (JSON) output. */
  requiresStructuredOutput: boolean;
  /** Whether this task requires streaming. */
  supportsStreaming: boolean;
  /** Estimated cost weight (relative, for budget allocation). */
  costWeight: number;
}

// ---------------------------------------------------------------------------
// Task registry
// ---------------------------------------------------------------------------

const TASK_REGISTRY: Record<AtlasAITask, TaskConfig> = {
  // -----------------------------------------------------------------------
  // Knowledge & embeddings
  // -----------------------------------------------------------------------
  embedding: {
    name: "Document Embedding",
    description: "Generate embedding vectors for document chunks during ingestion",
    preferredTier: "fast",
    maxTokens: 0, // embeddings don't have output tokens
    temperature: 0,
    requiresStructuredOutput: false,
    supportsStreaming: false,
    costWeight: 0.5,
  },
  embedding_query: {
    name: "Query Embedding",
    description: "Generate embedding vectors for search queries",
    preferredTier: "fast",
    maxTokens: 0,
    temperature: 0,
    requiresStructuredOutput: false,
    supportsStreaming: false,
    costWeight: 0.3,
  },

  // -----------------------------------------------------------------------
  // Conversational AI
  // -----------------------------------------------------------------------
  ask_atlas: {
    name: "Ask Atlas",
    description: "Evidence-grounded conversational AI for the Ask Atlas panel and voice assistant",
    preferredTier: "fast",
    maxTokens: 600,
    temperature: 0.2,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 1.0,
  },
  voice_conversation: {
    name: "Atlas Voice",
    description: "Voice-based conversational AI (same pipeline as Ask Atlas)",
    preferredTier: "fast",
    maxTokens: 600,
    temperature: 0.2,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 1.0,
  },

  // -----------------------------------------------------------------------
  // CRM / outreach
  // -----------------------------------------------------------------------
  crm_outreach: {
    name: "CRM Outreach",
    description: "Generate personalized outreach emails for lead management",
    preferredTier: "fast",
    maxTokens: 1024,
    temperature: 0.7,
    requiresStructuredOutput: false,
    supportsStreaming: false,
    costWeight: 0.8,
  },
  email_generation: {
    name: "Email Generation",
    description: "Generate email content for CRM sequences and templates",
    preferredTier: "fast",
    maxTokens: 1024,
    temperature: 0.7,
    requiresStructuredOutput: false,
    supportsStreaming: false,
    costWeight: 0.8,
  },

  // -----------------------------------------------------------------------
  // Agent reasoning (future — disabled by default)
  // -----------------------------------------------------------------------
  evidence_reasoning: {
    name: "Evidence Reasoning",
    description: "Analyze evidence for contradictions, completeness, and gaps",
    preferredTier: "standard",
    maxTokens: 4096,
    temperature: 0.1,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 2.0,
  },
  gap_intelligence: {
    name: "Gap Intelligence",
    description: "Identify missing evidence and coverage gaps in claims",
    preferredTier: "standard",
    maxTokens: 4096,
    temperature: 0.1,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 2.0,
  },
  supplement_reasoning: {
    name: "Supplement Reasoning",
    description: "Analyze and generate supplement items for insurance claims",
    preferredTier: "standard",
    maxTokens: 4096,
    temperature: 0.1,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 2.0,
  },
  qa_reasoning: {
    name: "QA Reasoning",
    description: "Quality assurance review of AI-generated outputs",
    preferredTier: "standard",
    maxTokens: 2048,
    temperature: 0.1,
    requiresStructuredOutput: true,
    supportsStreaming: false,
    costWeight: 1.5,
  },
  agent_reasoning: {
    name: "Agent Reasoning",
    description: "Generic agent reasoning for tool-calling loops",
    preferredTier: "standard",
    maxTokens: 4096,
    temperature: 0.2,
    requiresStructuredOutput: false,
    supportsStreaming: true,
    costWeight: 1.5,
  },
};

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Get configuration for a specific task.
 */
export function getTaskConfig(task: AtlasAITask): TaskConfig {
  return TASK_REGISTRY[task];
}

/**
 * Get all registered tasks.
 */
export function getAllTasks(): Array<{ task: AtlasAITask } & TaskConfig> {
  return Object.entries(TASK_REGISTRY).map(([task, config]) => ({
    task: task as AtlasAITask,
    ...config,
  }));
}

/**
 * Check if a task identifier is valid.
 */
export function isValidTask(task: string): task is AtlasAITask {
  return task in TASK_REGISTRY;
}
