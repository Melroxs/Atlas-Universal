// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Intent Router
//
// Classifies voice transcripts into Atlas intents/tasks. Supports:
//   - Informational queries (claim status, evidence gaps)
//   - Analytical requests (analysis, comparison, summary)
//   - Action-oriented commands (create supplement, send email)
//
// The intent router does NOT execute actions — it classifies and delegates
// to the appropriate handler with proper safety gates.
// ---------------------------------------------------------------------------

import type { AtlasAITask } from "@/lib/ai-runtime/tasks";

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type VoiceIntentCategory =
  | "informational"
  | "analytical"
  | "action"
  | "conversational"
  | "unknown";

export interface VoiceIntent {
  /** Unique intent identifier. */
  id: string;
  /** Human-readable intent name. */
  name: string;
  /** Intent category. */
  category: VoiceIntentCategory;
  /** Corresponding Atlas AI task (if applicable). */
  atlasTask?: AtlasAITask;
  /** Action ID (for action intents). */
  actionId?: string;
  /** Confidence score (0–1). */
  confidence: number;
  /** Extracted entities from the transcript. */
  entities: VoiceIntentEntity[];
  /** Whether this intent requires confirmation. */
  requiresConfirmation: boolean;
  /** Original transcript. */
  transcript: string;
}

export interface VoiceIntentEntity {
  type: "claim_id" | "document" | "person" | "date" | "action" | "general";
  value: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Intent patterns (derived from actual Atlas functionality)
// ---------------------------------------------------------------------------

interface IntentPattern {
  id: string;
  name: string;
  category: VoiceIntentCategory;
  atlasTask?: AtlasAITask;
  actionId?: string;
  patterns: RegExp[];
  requiresConfirmation: boolean;
  extractEntities?: (match: RegExpMatchArray, transcript: string) => VoiceIntentEntity[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ── Informational: claim status ──
  {
    id: "get_claim_status",
    name: "Get Claim Status",
    category: "informational",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:what(?:'s| is|'s the) (?:the )?status (?:of )?(?:claim )?)\s*(?:#?\s*)?([A-Z0-9-]+)/i,
      /(?:status (?:of )?(?:claim )?)\s*(?:#?\s*)?([A-Z0-9-]+)/i,
      /(?:tell me about|show me|what's going on with)\s+(?:claim\s+)?(?:#?\s*)?([A-Z0-9-]+)/i,
      /(?:where are we (?:on|with))\s+(?:claim\s+)?(?:#?\s*)?([A-Z0-9-]+)/i,
    ],
    requiresConfirmation: false,
    extractEntities: (match, transcript) => {
      const claimId = match[1]?.trim();
      return claimId ? [{ type: "claim_id", value: claimId, confidence: 0.9 }] : [];
    },
  },

  // ── Informational: evidence gaps ──
  {
    id: "evidence_gaps",
    name: "Evidence Gap Analysis",
    category: "informational",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:what(?:'s| is)?|which) (?:evidence|documents?|docs?) (?:are|is) (?:missing|we missing|need(?:ed)?|lacking)/i,
      /(?:what do we need|what's missing) (?:for|from|on|in)\s+/i,
      /(?:gap|gaps) (?:analysis|check|report)/i,
      /(?:are we (?:missing|lacking) (?:any|some))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Informational: contradiction detection ──
  {
    id: "contradictions",
    name: "Contradiction Detection",
    category: "informational",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:are there|do we have|any) (?:contradictions?|conflicts?|discrepancies?)/i,
      /(?:do (?:the )?(?:documents?|evidence|records?) (?:contradict|conflict|disagree))/i,
      /(?:what(?:'s| is) (?:conflicting|contradicting|inconsistent))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Analytical: claim analysis ──
  {
    id: "analyze_claim",
    name: "Analyze Claim",
    category: "analytical",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:analyze|analyse|review|assess)\s+(?:this|the|claim)\s+(?:claim\s+)?(?:#?\s*)?([A-Z0-9-]+)?/i,
      /(?:run|start) (?:a )?(?:claim )?(?:analysis|review)/i,
      /(?:how (?:does?|is) (?:this|the) claim) (?:looking|looking like|shape)/i,
    ],
    requiresConfirmation: false,
    extractEntities: (match) => {
      const claimId = match[1]?.trim();
      return claimId ? [{ type: "claim_id", value: claimId, confidence: 0.8 }] : [];
    },
  },

  // ── Analytical: supplement opportunities ──
  {
    id: "supplement_opportunities",
    name: "Supplement Opportunities",
    category: "analytical",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:find|look for|identify|are there any) (?:potential )?(?:supplement|supplemental) (?:opportunities?|items?|areas?)/i,
      /(?:what (?:supplements?|supplemental) (?:could|should|can) we (?:add|file|submit))/i,
      /(?:supplement (?:analysis|check|review))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Analytical: estimate comparison ──
  {
    id: "compare_estimate",
    name: "Compare Estimate",
    category: "analytical",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:compare|comparison|how (?:does?|is)) (?:the )?(?:estimate|scope|xactimate)/i,
      /(?:what(?:'s| is) (?:the )?(?:difference|gap|shortfall) (?:between|in) the (?:estimate|scope))/i,
      /(?:scope (?:analysis|comparison|review))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Analytical: summarize evidence ──
  {
    id: "summarize_evidence",
    name: "Summarize Evidence",
    category: "analytical",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:summarize|summary|give me (?:a )?summary) (?:the )?(?:evidence|documents?|docs?|records?)/i,
      /(?:what(?:'s| is) (?:in|the summary of) (?:the )?(?:evidence|documents?))/i,
      /(?:overview (?:of )?(?:the )?(?:evidence|claim|documents?))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Analytical: recommendation reasoning ──
  {
    id: "recommendation_reasoning",
    name: "Recommendation Reasoning",
    category: "analytical",
    atlasTask: "ask_atlas",
    patterns: [
      /(?:why|reasoning|explain)\s+(?:was|is|does|did) (?:this|that|the) (?:recommendation|finding|supplement)/i,
      /(?:what(?:'s| is) (?:the )?(?:basis|reasoning|justification) (?:for|behind))/i,
      /(?:explain (?:the )?(?:recommendation|finding|analysis))/i,
    ],
    requiresConfirmation: false,
  },

  // ── Action: create supplement ──
  {
    id: "create_supplement",
    name: "Create Supplement",
    category: "action",
    actionId: "create_supplement",
    atlasTask: "supplement_reasoning",
    patterns: [
      /(?:create|generate|build|draft|prepare) (?:a )?(?:new )?(?:supplement|supplemental)/i,
      /(?:file|submit) (?:a )?(?:new )?(?:supplement|supplemental)/i,
      /(?:let's (?:create|generate|build|file))/i,
    ],
    requiresConfirmation: true,
    extractEntities: (match, transcript) => {
      const claimMatch = transcript.match(/(?:for|on|in|claim)\s+(?:#?\s*)?([A-Z0-9-]+)/i);
      return claimMatch
        ? [{ type: "claim_id", value: claimMatch[1]!.trim(), confidence: 0.7 }]
        : [];
    },
  },

  // ── Action: send to adjuster ──
  {
    id: "send_to_adjuster",
    name: "Send to Adjuster",
    category: "action",
    actionId: "send_outreach_email",
    patterns: [
      /(?:send|email|submit|forward)\s+(?:this|it|the (?:supplement|claim|document))/i,
      /(?:send (?:this|it) to (?:the )?adjuster)/i,
      /(?:email (?:the )?adjuster)/i,
    ],
    requiresConfirmation: true,
  },

  // ── Action: generate claim package ──
  {
    id: "generate_package",
    name: "Generate Claim Package",
    category: "action",
    patterns: [
      /(?:generate|create|build|compile|prepare) (?:a )?(?:the )?(?:claim )?package/i,
      /(?:package (?:is|should be) (?:ready|complete))/i,
    ],
    requiresConfirmation: true,
  },

  // ── Conversational: greetings ──
  {
    id: "greeting",
    name: "Greeting",
    category: "conversational",
    atlasTask: "ask_atlas",
    patterns: [
      /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|how are you|what's up)\s*[!.]?$/i,
    ],
    requiresConfirmation: false,
  },

  // ── Conversational: help ──
  {
    id: "help",
    name: "Help",
    category: "conversational",
    atlasTask: "ask_atlas",
    patterns: [
      /^(?:help|what can you do|what are your capabilities|how (?:do I|can I|does this work))\s*[?.]?$/i,
    ],
    requiresConfirmation: false,
  },

  // ── Conversational: repeat ──
  {
    id: "repeat",
    name: "Repeat Last Response",
    category: "conversational",
    actionId: "replay_last_response",
    patterns: [
      /(?:repeat|say that again|what did you (?:say|mean)|come again|one more time)/i,
    ],
    requiresConfirmation: false,
  },

  // ── Conversational: interruption ──
  {
    id: "stop",
    name: "Stop",
    category: "conversational",
    patterns: [
      /^(?:stop|wait|never ?mind|cancel|quiet|be quiet|hold on|pause|shut up)\s*[!.]?$/i,
    ],
    requiresConfirmation: false,
  },
];

// ---------------------------------------------------------------------------
// Entity extraction helpers
// ---------------------------------------------------------------------------

const ENTITY_PATTERNS: Array<{
  type: VoiceIntentEntity["type"];
  pattern: RegExp;
}> = [
  { type: "claim_id", pattern: /(?:claim|case|file)\s*(?:#?\s*)([A-Z]{2,}[-\s]?\d{2,}[-\s]?\d{2,})/i },
  { type: "claim_id", pattern: /\b([A-Z]{2,}\d{4,})\b/ },
  { type: "date", pattern: /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/ },
  { type: "person", pattern: /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/ },
];

function extractEntities(transcript: string): VoiceIntentEntity[] {
  const entities: VoiceIntentEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern } of ENTITY_PATTERNS) {
    const matches = transcript.matchAll(new RegExp(pattern, "gi"));
    for (const match of matches) {
      const value = match[1]?.trim();
      if (value && !seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase());
        entities.push({ type, value, confidence: 0.7 });
      }
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

/**
 * Classify a voice transcript into an Atlas intent.
 *
 * Uses pattern matching against known Atlas functionality.
 * Returns the best matching intent, or "unknown" if no pattern matches.
 *
 * Classification is deterministic — no AI call required for intent routing.
 */
export function classifyVoiceIntent(transcript: string): VoiceIntent {
  const normalized = transcript.trim();

  if (!normalized) {
    return {
      id: "empty",
      name: "Empty Input",
      category: "unknown",
      confidence: 1.0,
      entities: [],
      requiresConfirmation: false,
      transcript: normalized,
    };
  }

  let bestMatch: { pattern: IntentPattern; match: RegExpMatchArray; score: number } | null = null;

  for (const pattern of INTENT_PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = normalized.match(regex);
      if (match) {
        // Score: longer match = higher confidence
        const matchLength = match[0]?.length ?? 0;
        const score = Math.min(0.5 + (matchLength / normalized.length) * 0.5, 1.0);

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { pattern, match, score };
        }
      }
    }
  }

  if (!bestMatch) {
    // No pattern matched — classify as general question → ask_atlas
    return {
      id: "general_question",
      name: "General Question",
      category: "informational",
      atlasTask: "ask_atlas",
      confidence: 0.3,
      entities: extractEntities(normalized),
      requiresConfirmation: false,
      transcript: normalized,
    };
  }

  const { pattern, match, score } = bestMatch;
  const extractedFromPattern = pattern.extractEntities?.(match, normalized) ?? [];
  const generalEntities = extractEntities(normalized);

  // Merge entities, preferring pattern-extracted ones
  const allEntities: VoiceIntentEntity[] = [...extractedFromPattern];
  const seen = new Set(extractedFromPattern.map((e) => e.value.toLowerCase()));
  for (const e of generalEntities) {
    if (!seen.has(e.value.toLowerCase())) {
      allEntities.push(e);
    }
  }

  return {
    id: pattern.id,
    name: pattern.name,
    category: pattern.category,
    atlasTask: pattern.atlasTask,
    actionId: pattern.actionId,
    confidence: score,
    entities: allEntities,
    requiresConfirmation: pattern.requiresConfirmation,
    transcript: normalized,
  };
}

/**
 * Check if an intent requires confirmation before execution.
 */
export function intentRequiresConfirmation(intent: VoiceIntent): boolean {
  return intent.requiresConfirmation;
}

/**
 * Get all supported intent patterns (for documentation/testing).
 */
export function getAllIntentPatterns(): Array<{ id: string; name: string; category: VoiceIntentCategory }> {
  return INTENT_PATTERNS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
  }));
}
