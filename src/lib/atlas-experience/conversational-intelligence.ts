// ---------------------------------------------------------------------------
// Atlas Conversational Intelligence Layer
//
// Provides the unified context contract, intent classification, grounded
// answer generation, explainability, provenance, entity-aware conversation,
// navigation actions, prepared-action architecture, safety classification,
// conversation memory, and clarification behavior for Ask Atlas.
//
// This module is consumed by both text and voice interfaces, ensuring
// parity in intelligence while allowing differences in presentation.
// ---------------------------------------------------------------------------

import type { AtlasEntityReference } from "./entity-reference";
import type { AttentionItem } from "./attention";
import type { AtlasActivity } from "./activity";
import type { AtlasDecision } from "./decision";
import type { AtlasSignal } from "./signal";
import type { NextBestAction, AskAtlasContext } from "./command-center";
import type { WorkspaceHealth } from "./context";

// ---------------------------------------------------------------------------
// 1. Unified Conversation Context
// ---------------------------------------------------------------------------

export interface AtlasConversationContext {
  workspace: {
    id: string;
    name?: string;
  };
  user: {
    role?: string;
  };
  system: {
    status: string;
    health?: WorkspaceHealth;
  };
  currentEntity?: AtlasEntityReference;
  attention: {
    critical: AttentionItem[];
    important: AttentionItem[];
    totalCount: number;
  };
  activity: {
    recent: AtlasActivity[];
    todayCount: number;
  };
  decisions: {
    pending: AtlasDecision[];
    highImpact: AtlasDecision[];
    pendingApprovals: number;
  };
  signals: {
    recent: AtlasSignal[];
    unseen: AtlasSignal[];
  };
  nextBestAction?: NextBestAction;
  evidence?: {
    relevant: number;
    gaps: number;
    contradictions: number;
  };
  askAtlasContext?: AskAtlasContext;
  /** Current Atlas investigation context — entity, insight, assessment, action */
  investigation?: AtlasInvestigationContext;
}

/** Investigation context carried through conversation — entity, insight, assessment, prepared action */
export interface AtlasInvestigationContext {
  entity?: { id: string; type: string; name?: string };
  originatingInsight?: { title: string; description?: string; financialImpact?: number };
  assessment?: string;
  confidence?: "high" | "medium" | "low";
  recommendation?: string;
  preparedAction?: { status: string; type?: string; reason?: string; amount?: number; isStale?: boolean; staleChanges?: Array<{ label: string; description?: string }>; actionId?: string; preparedAt?: string };
  evidenceSummary?: Array<{ title: string; classification?: string }>;
  gaps?: Array<{ label: string; severity: string }>;
}

// ---------------------------------------------------------------------------
// 2. Context Builder — produces compact structured context from raw data
// ---------------------------------------------------------------------------

export interface ContextBuilderInput {
  workspaceId: string;
  workspaceName?: string;
  userRole?: string;
  health: WorkspaceHealth;
  attentionItems: AttentionItem[];
  activities: AtlasActivity[];
  decisions: AtlasDecision[];
  signals: AtlasSignal[];
  nextBestAction?: NextBestAction | null;
  currentEntity?: AtlasEntityReference;
  entityEvidence?: {
    relevant: number;
    gaps: number;
    contradictions: number;
  };
  /** Current Atlas investigation context — passed from useAtlasContext */
  investigation?: AtlasInvestigationContext;
}

/**
 * Build a compact, structured AtlasConversationContext from raw data.
 * Produces only what the model needs — not the entire database.
 */
export function buildConversationContext(input: ContextBuilderInput): AtlasConversationContext {
  const critical = input.attentionItems.filter(
    (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
  );
  const important = input.attentionItems.filter(
    (a) => a.status === "open" && a.severity === "medium",
  );

  const now = Date.now();
  const dayMs = 86_400_000;
  const recentActivities = input.activities
    .filter((a) => a.timestamp >= now - dayMs * 2)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);
  const todayCount = input.activities.filter((a) => a.timestamp >= now - dayMs).length;

  const pendingDecisions = input.decisions.filter((d) => d.status === "new");
  const highImpact = input.decisions.filter(
    (d) => d.status === "new" && d.importance.impact !== undefined && d.importance.impact > 0,
  );
  const pendingApprovals = input.decisions.filter(
    (d) => d.requiresApproval && d.status === "new",
  ).length;

  const recentSignals = input.signals.slice(0, 5);

  return {
    workspace: {
      id: input.workspaceId,
      name: input.workspaceName,
    },
    user: {
      role: input.userRole,
    },
    system: {
      status: input.health.documents > 0 || input.health.entities > 0 ? "online" : "initializing",
      health: input.health,
    },
    currentEntity: input.currentEntity,
    attention: {
      critical,
      important,
      totalCount: input.attentionItems.filter((a) => a.status === "open").length,
    },
    activity: {
      recent: recentActivities,
      todayCount,
    },
    decisions: {
      pending: pendingDecisions,
      highImpact,
      pendingApprovals,
    },
    signals: {
      recent: recentSignals,
      unseen: recentSignals.filter((s) => s.significance === "critical" || s.significance === "important"),
    },
    nextBestAction: input.nextBestAction ?? undefined,
    evidence: input.entityEvidence,
    investigation: input.investigation,
  };
}

/**
 * Build a compact context summary string for the AI model.
 * This is what gets sent to the model as structured context.
 */
export function buildContextSummary(context: AtlasConversationContext): string {
  const parts: string[] = [];

  // System status
  parts.push(`System: ${context.system.status}`);

  // Workspace
  if (context.workspace.name) {
    parts.push(`Workspace: ${context.workspace.name}`);
  }

  // Current entity
  if (context.currentEntity) {
    parts.push(
      `Current entity: ${context.currentEntity.type} — ${context.currentEntity.label} (${context.currentEntity.id})`,
    );
  }

  // Attention
  if (context.attention.totalCount > 0) {
    const criticalCount = context.attention.critical.length;
    const importantCount = context.attention.important.length;
    parts.push(
      `Attention: ${context.attention.totalCount} items (${criticalCount} critical, ${importantCount} important)`,
    );
    if (criticalCount > 0) {
      const topCritical = context.attention.critical[0];
      parts.push(`Top critical: ${topCritical.title} — ${topCritical.explanation}`);
    }
  } else {
    parts.push("Attention: clear");
  }

  // Activity
  if (context.activity.todayCount > 0) {
    parts.push(`Activity today: ${context.activity.todayCount} events`);
  }

  // Decisions
  if (context.decisions.pending.length > 0) {
    parts.push(
      `Pending decisions: ${context.decisions.pending.length} (${context.decisions.pendingApprovals} need approval)`,
    );
    const topDecision = context.decisions.pending[0];
    parts.push(`Top decision: ${topDecision.recommendation.title} — ${topDecision.recommendation.summary}`);
  }

  // Next best action
  if (context.nextBestAction) {
    parts.push(`Next best action: ${context.nextBestAction.title} — ${context.nextBestAction.reason}`);
  }

  // Evidence (if entity-specific)
  if (context.evidence) {
    parts.push(
      `Evidence: ${context.evidence.relevant} relevant, ${context.evidence.gaps} gaps, ${context.evidence.contradictions} contradictions`,
    );
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 3. Conversational Intents
// ---------------------------------------------------------------------------

export type ConversationalIntent =
  | "focus"
  | "status"
  | "changes"
  | "revenue"
  | "attention"
  | "decisions"
  | "approvals"
  | "evidence"
  | "why"
  | "entity"
  | "next"
  | "search"
  | "navigate"
  | "prepare"
  | "help"
  | "unknown";

export interface IntentClassification {
  intent: ConversationalIntent;
  confidence: number;
  entities: AtlasEntityReference[];
  followUp?: string;
}

// Intent patterns for deterministic classification
const INTENT_PATTERNS: Array<{
  intent: ConversationalIntent;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    intent: "focus",
    patterns: [
      /what should i focus on/i,
      /what needs my attention/i,
      /what's most important/i,
      /what matters most/i,
      /priorities/i,
    ],
    confidence: 0.9,
  },
  {
    intent: "status",
    patterns: [
      /how are things/i,
      /how's (?:everything|it going|the business)/i,
      /what's the status/i,
      /status update/i,
      /overview/i,
    ],
    confidence: 0.85,
  },
  {
    intent: "changes",
    patterns: [
      /what changed/i,
      /what's new/i,
      /what happened/i,
      /recent changes/i,
      /what did atlas (?:find|discover|notice)/i,
      /since (?:i was last here|yesterday|today)/i,
    ],
    confidence: 0.9,
  },
  {
    intent: "revenue",
    patterns: [
      /revenue/i,
      /money/i,
      /financial/i,
      /opportunity/i,
      /recovery/i,
      /outstanding/i,
      /leaving on the table/i,
      /biggest (?:opportunity|impact)/i,
    ],
    confidence: 0.85,
  },
  {
    intent: "attention",
    patterns: [
      /attention/i,
      /critical/i,
      /urgent/i,
      /needs? (?:review|action)/i,
      /what's (?:wrong|broken|failing)/i,
    ],
    confidence: 0.8,
  },
  {
    intent: "decisions",
    patterns: [
      /decision/i,
      /recommend/i,
      /suggest/i,
      /what (?:should|do) (?:i|we) do/i,
      /next step/i,
      /what do you recommend/i,
    ],
    confidence: 0.8,
  },
  {
    intent: "approvals",
    patterns: [
      /approval/i,
      /approve/i,
      /pending approval/i,
      /needs? my (?:approval|sign)/i,
      /awaiting/i,
    ],
    confidence: 0.85,
  },
  {
    intent: "evidence",
    patterns: [
      /evidence/i,
      /document/i,
      /missing/i,
      /gap/i,
      /contradiction/i,
      /what (?:evidence|documents?|information)/i,
      /is there (?:enough|sufficient)/i,
    ],
    confidence: 0.8,
  },
  {
    intent: "why",
    patterns: [
      /why (?:is|are|did|does|would|should)/i,
      /why (?:this|that|him|her|it)/i,
      /explain/i,
      /reason/i,
      /cause/i,
      /because/i,
    ],
    confidence: 0.85,
  },
  {
    intent: "entity",
    patterns: [
      /tell me about/i,
      /show me/i,
      /what(?:'s| is) (?:going on|happening) with/i,
      /info(?:rmation)? (?:on|about)/i,
      /details? (?:on|about|for)/i,
    ],
    confidence: 0.75,
  },
  {
    intent: "next",
    patterns: [
      /what(?:'s| is) (?:next|the next step)/i,
      /next (?:step|action|thing)/i,
      /what should i do (?:next|now)/i,
      /where (?:do|should) i start/i,
    ],
    confidence: 0.85,
  },
  {
    intent: "navigate",
    patterns: [
      /open (?:claim|document|company|supplement|recommendation)/i,
      /go to/i,
      /take me to/i,
      /show (?:me )?(?:the )?(?:claim|document|company)/i,
    ],
    confidence: 0.8,
  },
  {
    intent: "prepare",
    patterns: [
      /prepare/i,
      /draft/i,
      /create (?:a |the )?(?:supplement|email|task|report)/i,
      /generate/i,
      /build (?:the |a )?(?:package|supplement|report)/i,
    ],
    confidence: 0.8,
  },
  {
    intent: "help",
    patterns: [
      /help/i,
      /what can you do/i,
      /what do you know/i,
      /capabilities/i,
      /how (?:do i|can i|does this)/i,
    ],
    confidence: 0.9,
  },
];

/**
 * Classify a user message into a conversational intent.
 * Uses deterministic pattern matching — no AI model needed.
 */
export function classifyIntent(message: string, context?: AtlasConversationContext): IntentClassification {
  const trimmed = message.trim();

  // Check each intent pattern
  for (const { intent, patterns, confidence } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return {
          intent,
          confidence,
          entities: extractEntities(trimmed, context),
        };
      }
    }
  }

  // Entity detection: if a claim number or entity reference is found
  const entityRef = extractEntityReference(trimmed);
  if (entityRef) {
    return {
      intent: "entity",
      confidence: 0.7,
      entities: [entityRef],
    };
  }

  return {
    intent: "unknown",
    confidence: 0.3,
    entities: [],
  };
}

// ---------------------------------------------------------------------------
// 4. Entity Extraction
// ---------------------------------------------------------------------------

function extractEntities(text: string, context?: AtlasConversationContext): AtlasEntityReference[] {
  const entities: AtlasEntityReference[] = [];

  // Claim number patterns
  const claimMatch = text.match(/#?\s*(\d{3,6})/);
  if (claimMatch && context?.currentEntity?.type === "claim") {
    // If we're on a claim page, infer the entity from context
    entities.push(context.currentEntity);
  } else if (claimMatch) {
    entities.push({
      type: "claim",
      id: claimMatch[1],
      label: `Claim #${claimMatch[1]}`,
    });
  }

  return entities;
}

function extractEntityReference(text: string): AtlasEntityReference | null {
  // Claim patterns
  const claimMatch = text.match(/claim\s*#?\s*(\d{3,6})/i);
  if (claimMatch) {
    return {
      type: "claim",
      id: claimMatch[1],
      label: `Claim #${claimMatch[1]}`,
    };
  }

  // Document patterns
  const docMatch = text.match(/document\s*#?\s*(\d+)/i);
  if (docMatch) {
    return {
      type: "document",
      id: docMatch[1],
      label: `Document #${docMatch[1]}`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 5. Grounded Answer Generation
// ---------------------------------------------------------------------------

export interface AtlasAnswer {
  text: string;
  intent: ConversationalIntent;
  confidence: "high" | "moderate" | "low" | "unknown";
  whyItMatters?: string;
  impact?: string;
  nextAction?: string;
  evidence?: ConversationalEvidenceRef[];
  provenance?: AtlasProvenance;
  actions?: AtlasAction[];
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface ConversationalEvidenceRef {
  type: "document" | "finding" | "evidence" | "contradiction" | "gap" | "recommendation" | "activity";
  label: string;
  id?: string;
  href?: string;
  source?: string;
}

export interface AtlasProvenance {
  sources: Array<{
    type: string;
    label: string;
    count?: number;
  }>;
  summary: string;
}

/**
 * Generate a grounded answer from Atlas conversation context.
 * Every answer is traceable to real Atlas data.
 */
export function generateAnswer(
  message: string,
  context: AtlasConversationContext,
  classification: IntentClassification,
): AtlasAnswer {
  switch (classification.intent) {
    case "focus":
      return generateFocusAnswer(context);
    case "status":
      return generateStatusAnswer(context);
    case "changes":
      return generateChangesAnswer(context);
    case "revenue":
      return generateRevenueAnswer(context);
    case "attention":
      return generateAttentionAnswer(context);
    case "decisions":
      return generateDecisionsAnswer(context);
    case "approvals":
      return generateApprovalsAnswer(context);
    case "evidence":
      return generateEvidenceAnswer(context, classification);
    case "why":
      return generateWhyAnswer(context, classification);
    case "entity":
      return generateEntityAnswer(context, classification);
    case "next":
      return generateNextAnswer(context);
    case "navigate":
      return generateNavigateAnswer(context, classification);
    case "prepare":
      return generatePrepareAnswer(context, classification);
    case "help":
      return generateHelpAnswer(context);
    default:
      return generateDefaultAnswer(message, context);
  }
}

// ---------------------------------------------------------------------------
// Answer generators for each intent
// ---------------------------------------------------------------------------

function generateFocusAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const evidence: ConversationalEvidenceRef[] = [];
  const actions: AtlasAction[] = [];

  // Start with next best action if available
  if (context.nextBestAction) {
    parts.push(`You should focus on **${context.nextBestAction.title}**.`);
    parts.push(context.nextBestAction.reason);
    actions.push({
      type: "navigate",
      target: {
        type: context.nextBestAction.entity.type as AtlasEntityReference["type"],
        id: context.nextBestAction.entity.id,
        label: context.nextBestAction.entity.label,
        href: context.nextBestAction.entity.href,
      },
    });
  }

  // Add critical attention items
  if (context.attention.critical.length > 0) {
    const criticalItems = context.attention.critical.slice(0, 3);
    parts.push(`\n**${context.attention.critical.length} critical item${context.attention.critical.length === 1 ? "" : "s"}** need your attention:`);
    for (const item of criticalItems) {
      parts.push(`• ${item.title} — ${item.explanation}`);
      if (item.navigationTarget) {
        actions.push({
          type: "navigate",
          target: {
            type: "claim",
            id: item.sourceEntityId ?? "unknown",
            label: item.sourceEntityName ?? item.title,
            href: item.navigationTarget,
          },
        });
      }
    }
  }

  // Add pending decisions
  if (context.decisions.pendingApprovals > 0) {
    parts.push(`\n**${context.decisions.pendingApprovals} decision${context.decisions.pendingApprovals === 1 ? "" : "s"}** need your approval.`);
  }

  if (parts.length === 0) {
    parts.push("You're clear. No critical issues require your attention right now.");
    parts.push("Atlas will surface new findings as they appear.");
  }

  return {
    text: parts.join("\n"),
    intent: "focus",
    confidence: context.attention.totalCount > 0 ? "high" : "moderate",
    whyItMatters: context.attention.critical.length > 0
      ? "Critical items may affect revenue recovery or claim processing."
      : undefined,
    nextAction: context.nextBestAction?.title,
    evidence,
    provenance: buildProvenance(context),
    actions,
  };
}

function generateStatusAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];

  // System status
  parts.push(`Atlas is **${context.system.status}**.`);

  // Attention summary
  if (context.attention.totalCount > 0) {
    parts.push(`\n**${context.attention.totalCount} items** require attention.`);
    if (context.attention.critical.length > 0) {
      parts.push(`${context.attention.critical.length} are critical.`);
    }
  } else {
    parts.push("\nAll clear — no attention items.");
  }

  // Activity summary
  if (context.activity.todayCount > 0) {
    parts.push(`\n**${context.activity.todayCount} events** today.`);
  }

  // Decision summary
  if (context.decisions.pending.length > 0) {
    parts.push(`**${context.decisions.pending.length} decisions** pending.`);
  }

  return {
    text: parts.join("\n"),
    intent: "status",
    confidence: "high",
    provenance: buildProvenance(context),
  };
}

function generateChangesAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const evidence: ConversationalEvidenceRef[] = [];

  if (context.activity.recent.length === 0) {
    parts.push("No significant changes detected recently.");
    return {
      text: parts.join("\n"),
      intent: "changes",
      confidence: "moderate",
      provenance: buildProvenance(context),
    };
  }

  parts.push(`**${context.activity.todayCount || context.activity.recent.length} recent changes:**\n`);

  for (const activity of context.activity.recent.slice(0, 5)) {
    const source = activity.actor.type === "atlas" ? "Atlas" : activity.actor.label;
    parts.push(`• **${source}** — ${activity.title}`);
    if (activity.summary) {
      parts.push(`  ${activity.summary}`);
    }
    if (activity.entity.href) {
      evidence.push({
        type: "activity",
        label: activity.title,
        id: activity.id,
        href: activity.entity.href,
        source: activity.actor.type,
      });
    }
  }

  return {
    text: parts.join("\n"),
    intent: "changes",
    confidence: "high",
    evidence,
    provenance: buildProvenance(context),
  };
}

function generateRevenueAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const evidence: ConversationalEvidenceRef[] = [];
  const actions: AtlasAction[] = [];

  // Revenue attention items
  const revenueItems = context.attention.critical
    .concat(context.attention.important)
    .filter(
      (a) =>
        a.category === "revenue_opportunity" ||
        a.category === "supplement_opportunity" ||
        a.title.toLowerCase().includes("revenue") ||
        a.title.toLowerCase().includes("supplement") ||
        a.title.toLowerCase().includes("recovery"),
    );

  if (revenueItems.length > 0) {
    parts.push(`**${revenueItems.length} revenue opportunit${revenueItems.length === 1 ? "y" : "ies"} identified:**\n`);
    for (const item of revenueItems.slice(0, 3)) {
      parts.push(`• ${item.title}`);
      if (item.meta?.financialImpact) {
        const impact = item.meta.financialImpact as number;
        parts.push(`  Potential impact: $${impact.toLocaleString()}`);
      }
      if (item.navigationTarget) {
        actions.push({
          type: "navigate",
          target: {
            type: "claim",
            id: item.sourceEntityId ?? "unknown",
            label: item.sourceEntityName ?? item.title,
            href: item.navigationTarget,
          },
        });
      }
    }
  } else if (context.decisions.highImpact.length > 0) {
    parts.push("**High-impact opportunities:**\n");
    for (const d of context.decisions.highImpact.slice(0, 3)) {
      parts.push(`• ${d.recommendation.title}`);
      if (d.importance.impact) {
        parts.push(`  Potential: $${d.importance.impact.toLocaleString()}`);
      }
    }
  } else {
    parts.push("No active revenue opportunities identified at this time.");
    parts.push("Atlas monitors claim data for potential recovery opportunities.");
  }

  return {
    text: parts.join("\n"),
    intent: "revenue",
    confidence: revenueItems.length > 0 ? "high" : "moderate",
    impact: revenueItems.length > 0
      ? revenueItems.reduce((sum, item) => sum + ((item.meta?.financialImpact as number) ?? 0), 0) > 0
        ? `Total potential: $${revenueItems
            .reduce((sum, item) => sum + ((item.meta?.financialImpact as number) ?? 0), 0)
            .toLocaleString()}`
        : undefined
      : undefined,
    evidence,
    provenance: buildProvenance(context),
    actions,
  };
}

function generateAttentionAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const evidence: ConversationalEvidenceRef[] = [];
  const actions: AtlasAction[] = [];

  if (context.attention.totalCount === 0) {
    parts.push("No attention items. You're clear.");
    return {
      text: parts.join("\n"),
      intent: "attention",
      confidence: "high",
      provenance: buildProvenance(context),
    };
  }

  parts.push(`**${context.attention.totalCount} items** require attention:\n`);

  const allItems = [...context.attention.critical, ...context.attention.important].slice(0, 5);
  for (const item of allItems) {
    const severity = item.severity === "critical" ? "🔴" : item.severity === "high" ? "🟠" : "🔵";
    parts.push(`${severity} **${item.title}**`);
    parts.push(`  ${item.explanation}`);
    if (item.navigationTarget) {
      actions.push({
        type: "navigate",
        target: {
          type: item.sourceEntityType as AtlasEntityReference["type"] ?? "claim",
          id: item.sourceEntityId ?? "unknown",
          label: item.sourceEntityName ?? item.title,
          href: item.navigationTarget,
        },
      });
    }
  }

  return {
    text: parts.join("\n"),
    intent: "attention",
    confidence: "high",
    evidence,
    provenance: buildProvenance(context),
    actions,
  };
}

function generateDecisionsAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const actions: AtlasAction[] = [];

  if (context.decisions.pending.length === 0) {
    parts.push("No pending decisions. Atlas will surface new recommendations as they appear.");
    return {
      text: parts.join("\n"),
      intent: "decisions",
      confidence: "high",
      provenance: buildProvenance(context),
    };
  }

  parts.push(`**${context.decisions.pending.length} decisions** for your review:\n`);

  for (const d of context.decisions.pending.slice(0, 3)) {
    parts.push(`• **${d.recommendation.title}**`);
    parts.push(`  ${d.recommendation.summary}`);
    if (d.importance.impact) {
      parts.push(`  Impact: $${d.importance.impact.toLocaleString()}`);
    }
    if (d.requiresApproval) {
      parts.push(`  ⚠️ Requires your approval`);
    }
    if (d.entity.href) {
      actions.push({
        type: "navigate",
        target: d.entity,
      });
    }
  }

  return {
    text: parts.join("\n"),
    intent: "decisions",
    confidence: "high",
    provenance: buildProvenance(context),
    actions,
  };
}

function generateApprovalsAnswer(context: AtlasConversationContext): AtlasAnswer {
  const parts: string[] = [];
  const actions: AtlasAction[] = [];

  const approvals = context.decisions.pending.filter((d) => d.requiresApproval);

  if (approvals.length === 0) {
    parts.push("No decisions currently need your approval.");
    return {
      text: parts.join("\n"),
      intent: "approvals",
      confidence: "high",
      provenance: buildProvenance(context),
    };
  }

  parts.push(`**${approvals.length} decision${approvals.length === 1 ? "" : "s"}** awaiting your approval:\n`);

  for (const d of approvals.slice(0, 3)) {
    parts.push(`• **${d.recommendation.title}**`);
    parts.push(`  ${d.recommendation.summary}`);
    if (d.entity.href) {
      actions.push({
        type: "navigate",
        target: d.entity,
      });
    }
  }

  return {
    text: parts.join("\n"),
    intent: "approvals",
    confidence: "high",
    provenance: buildProvenance(context),
    actions,
  };
}

function generateEvidenceAnswer(
  context: AtlasConversationContext,
  _classification: IntentClassification,
): AtlasAnswer {
  const parts: string[] = [];

  if (context.evidence) {
    if (context.evidence.gaps > 0) {
      parts.push(`**${context.evidence.gaps} evidence gap${context.evidence.gaps === 1 ? "" : "s"}** identified.`);
    }
    if (context.evidence.contradictions > 0) {
      parts.push(`**${context.evidence.contradictions} contradiction${context.evidence.contradictions === 1 ? "" : "s"}** found.`);
    }
    if (context.evidence.relevant > 0) {
      parts.push(`${context.evidence.relevant} relevant evidence items.`);
    }
    if (context.evidence.gaps === 0 && context.evidence.contradictions === 0) {
      parts.push("Evidence looks complete for the current context.");
    }
  } else {
    parts.push("Evidence information is not available for the current context.");
    parts.push("Navigate to a specific claim or document to see evidence details.");
  }

  return {
    text: parts.join("\n"),
    intent: "evidence",
    confidence: context.evidence ? "high" : "low",
    provenance: buildProvenance(context),
  };
}

function generateWhyAnswer(
  context: AtlasConversationContext,
  _classification: IntentClassification,
): AtlasAnswer {
  const parts: string[] = [];

  // Explain the next best action
  if (context.nextBestAction) {
    parts.push(`Atlas recommends **${context.nextBestAction.title}**.`);
    parts.push(`\n**Why:** ${context.nextBestAction.reason}`);

    if (context.attention.critical.length > 0) {
      parts.push(`\n**Evidence:** ${context.attention.critical.length} critical attention item${context.attention.critical.length === 1 ? "" : "s"} support this recommendation.`);
    }
    if (context.decisions.highImpact.length > 0) {
      parts.push(`**Impact:** High-impact decisions are pending.`);
    }

    return {
      text: parts.join("\n"),
      intent: "why",
      confidence: "high",
      whyItMatters: context.nextBestAction.reason,
      provenance: buildProvenance(context),
      actions: context.nextBestAction.entity.href
        ? [{
            type: "navigate",
            target: {
              type: context.nextBestAction.entity.type as AtlasEntityReference["type"],
              id: context.nextBestAction.entity.id,
              label: context.nextBestAction.entity.label,
              href: context.nextBestAction.entity.href,
            },
          }]
        : [],
    };
  }

  // Explain attention items
  if (context.attention.critical.length > 0) {
    const top = context.attention.critical[0];
    parts.push(`Atlas flagged **${top.title}** because:`);
    parts.push(top.explanation);
    if (top.navigationTarget) {
      parts.push(`\n[Open ${top.sourceEntityType ?? "item"}]`);
    }
    return {
      text: parts.join("\n"),
      intent: "why",
      confidence: "high",
      whyItMatters: top.explanation,
      provenance: buildProvenance(context),
    };
  }

  parts.push("Atlas is monitoring your workspace and will surface findings as they emerge.");
  return {
    text: parts.join("\n"),
    intent: "why",
    confidence: "moderate",
    provenance: buildProvenance(context),
  };
}

function generateEntityAnswer(
  context: AtlasConversationContext,
  classification: IntentClassification,
): AtlasAnswer {
  const entity = classification.entities[0] ?? context.currentEntity;

  if (!entity) {
    return {
      text: "Which entity would you like to know about? You can mention a claim number, document, or company.",
      intent: "entity",
      confidence: "low",
      needsClarification: true,
      clarificationQuestion: "Which entity would you like to explore?",
    };
  }

  const parts: string[] = [];
  parts.push(`**${entity.label}** (${entity.type})`);

  // Add attention context for this entity
  const entityAttention = context.attention.critical
    .concat(context.attention.important)
    .filter((a) => a.sourceEntityId === entity.id);

  if (entityAttention.length > 0) {
    parts.push(`\n**${entityAttention.length} attention item${entityAttention.length === 1 ? "" : "s"}:**`);
    for (const a of entityAttention.slice(0, 3)) {
      parts.push(`• ${a.title} — ${a.explanation}`);
    }
  }

  // Add decisions for this entity
  const entityDecisions = context.decisions.pending.filter((d) => d.entity.id === entity.id);
  if (entityDecisions.length > 0) {
    parts.push(`\n**${entityDecisions.length} recommendation${entityDecisions.length === 1 ? "" : "s"}:**`);
    for (const d of entityDecisions.slice(0, 3)) {
      parts.push(`• ${d.recommendation.title}`);
    }
  }

  // Add current action status if a preparation is active
  if (context.investigation?.preparedAction) {
    const pa = context.investigation.preparedAction;
    const statusLabel =
      pa.status === "preparing" ? "Atlas is assembling the proposal"
      : pa.status === "prepared" ? "A supplement proposal is ready for your review"
      : pa.status === "awaiting_confirmation" ? "Awaiting your approval to submit"
      : pa.status === "executing" ? "Atlas is executing the approved action"
      : pa.status === "executed" ? "The action completed successfully"
      : pa.status === "failed" ? "The last action failed — nothing was submitted"
      : pa.status === "stale" ? "The proposal needs to be re-checked — source data changed"
      : null;
    if (statusLabel) {
      parts.push(`\n**Action status:** ${statusLabel}.`);
      if (pa.isStale) {
        parts.push(`\n⚠️ The information changed after preparation. Re-prepare before approving.`);
      }
    }
  }

  const actions: AtlasAction[] = [];
  if (entity.href) {
    actions.push({
      type: "navigate",
      target: entity,
    });
  }

  return {
    text: parts.join("\n"),
    intent: "entity",
    confidence: "high",
    provenance: buildProvenance(context),
    actions,
  };
}

function generateNextAnswer(context: AtlasConversationContext): AtlasAnswer {
  if (context.nextBestAction) {
    return {
      text: `**Next step:** ${context.nextBestAction.title}\n\n${context.nextBestAction.reason}`,
      intent: "next",
      confidence: "high",
      nextAction: context.nextBestAction.title,
      provenance: buildProvenance(context),
      actions: context.nextBestAction.entity.href
        ? [{
            type: "navigate",
            target: {
              type: context.nextBestAction.entity.type as AtlasEntityReference["type"],
              id: context.nextBestAction.entity.id,
              label: context.nextBestAction.entity.label,
              href: context.nextBestAction.entity.href,
            },
          }]
        : [],
    };
  }

  return {
    text: "No specific next action identified. Atlas is monitoring your workspace for new findings.",
    intent: "next",
    confidence: "moderate",
    provenance: buildProvenance(context),
  };
}

function generateNavigateAnswer(
  _context: AtlasConversationContext,
  classification: IntentClassification,
): AtlasAnswer {
  const entity = classification.entities[0];

  if (!entity) {
    return {
      text: "Where would you like to navigate? You can mention a claim, document, or company.",
      intent: "navigate",
      confidence: "low",
      needsClarification: true,
      clarificationQuestion: "Which entity would you like to open?",
    };
  }

  return {
    text: `Opening ${entity.label}...`,
    intent: "navigate",
    confidence: "high",
    actions: [{
      type: "navigate",
      target: entity,
    }],
  };
}

function generatePrepareAnswer(
  _context: AtlasConversationContext,
  classification: IntentClassification,
): AtlasAnswer {
  const entity = classification.entities[0];

  return {
    text: entity
      ? `I can prepare this for review. I'll use ${entity.label} and its related data.\n\n[Prepare draft] [Cancel]`
      : "What would you like me to prepare? I can draft supplements, emails, or reports based on your existing data.",
    intent: "prepare",
    confidence: "moderate",
    actions: entity
      ? [{
          type: "prepare",
          actionType: "draft",
          entity,
        }]
      : [],
    provenance: buildProvenance(_context),
  };
}

function generateHelpAnswer(_context: AtlasConversationContext): AtlasAnswer {
  return {
    text: `**Atlas can help you with:**\n\n• **Focus** — "What should I focus on?"\n• **Status** — "How are things?"\n• **Changes** — "What changed?"\n• **Revenue** — "Where are the opportunities?"\n• **Attention** — "What needs my attention?"\n• **Decisions** — "What decisions need me?"\n• **Evidence** — "What evidence are we missing?"\n• **Why** — "Why are you recommending this?"\n• **Entity** — "Tell me about Claim #1042"\n• **Next** — "What should I do next?"\n• **Navigate** — "Open Claim #1042"\n• **Prepare** — "Prepare the supplement"\n\nAll answers come from your actual Atlas data — never fabricated.`,
    intent: "help",
    confidence: "high",
  };
}

function generateDefaultAnswer(message: string, context: AtlasConversationContext): AtlasAnswer {
  // Try to provide a useful default based on context
  if (context.attention.critical.length > 0) {
    return {
      text: `I'm not sure how to answer that, but I notice you have **${context.attention.critical.length} critical items** that may need your attention. Would you like me to walk you through them?`,
      intent: "unknown",
      confidence: "low",
      needsClarification: true,
      clarificationQuestion: "Would you like me to show your critical attention items?",
      provenance: buildProvenance(context),
    };
  }

  return {
    text: `I'm not sure how to answer that. Try asking about:\n• Your priorities\n• Recent changes\n• Revenue opportunities\n• Evidence status\n• Or say "help" to see what I can do.`,
    intent: "unknown",
    confidence: "low",
    needsClarification: true,
    clarificationQuestion: "What would you like to know about your workspace?",
  };
}

// ---------------------------------------------------------------------------
// 6. Provenance Builder
// ---------------------------------------------------------------------------

function buildProvenance(context: AtlasConversationContext): AtlasProvenance {
  const sources: AtlasProvenance["sources"] = [];

  if (context.attention.totalCount > 0) {
    sources.push({ type: "attention", label: "Attention intelligence", count: context.attention.totalCount });
  }
  if (context.activity.recent.length > 0) {
    sources.push({ type: "activity", label: "Recent activity", count: context.activity.recent.length });
  }
  if (context.decisions.pending.length > 0) {
    sources.push({ type: "decisions", label: "Pending decisions", count: context.decisions.pending.length });
  }
  if (context.signals.recent.length > 0) {
    sources.push({ type: "signals", label: "Proactive signals", count: context.signals.recent.length });
  }
  if (context.nextBestAction) {
    sources.push({ type: "next_action", label: "Next best action" });
  }
  if (context.evidence) {
    sources.push({ type: "evidence", label: "Evidence analysis" });
  }

  const summary = sources.length > 0
    ? `Based on: ${sources.map((s) => s.label).join(", ")}`
    : "Based on workspace state";

  return { sources, summary };
}

// ---------------------------------------------------------------------------
// 7. Action Types
// ---------------------------------------------------------------------------

export type AtlasAction =
  | {
      type: "navigate";
      target: AtlasEntityReference;
    }
  | {
      type: "show_evidence";
      target: AtlasEntityReference;
    }
  | {
      type: "show_decision";
      decisionId: string;
    }
  | {
      type: "prepare";
      actionType: string;
      entity: AtlasEntityReference;
    }
  | {
      type: "ask_followup";
      question: string;
    };

// ---------------------------------------------------------------------------
// 8. Safety Classification
// ---------------------------------------------------------------------------

export type SafetyLevel = "low" | "medium" | "high";

/**
 * Classify the safety level of a proposed action.
 * Low-risk: navigation, information retrieval
 * Medium-risk: preparing drafts
 * High-risk: executing actions, sending communications, changing records
 */
export function classifyActionSafety(action: AtlasAction): SafetyLevel {
  switch (action.type) {
    case "navigate":
    case "show_evidence":
    case "show_decision":
    case "ask_followup":
      return "low";
    case "prepare":
      return "medium";
    default:
      return "high";
  }
}

/**
 * Check if an action requires confirmation before execution.
 */
export function requiresConfirmation(action: AtlasAction): boolean {
  const safety = classifyActionSafety(action);
  return safety === "medium" || safety === "high";
}

// ---------------------------------------------------------------------------
// 9. Conversation Memory
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  intent?: ConversationalIntent;
  entityContext?: AtlasEntityReference;
  timestamp: number;
}

export interface ConversationMemory {
  turns: ConversationTurn[];
  lastEntity?: AtlasEntityReference;
  lastIntent?: ConversationalIntent;
  contextEntity?: AtlasEntityReference;
}

/**
 * Track conversation context for follow-up questions.
 * Resolves references like "it", "that", "this claim" from conversation history.
 */
export function resolveFollowUp(
  message: string,
  memory: ConversationMemory,
): { resolved: string; entityContext?: AtlasEntityReference } {
  const lower = message.toLowerCase().trim();

  // Resolve "it", "that", "this" to the last discussed entity
  if (
    /^(it|that|this|them|those)\b/.test(lower) ||
    /^(open|show|view|go to)\s+(it|that|this)\b/.test(lower)
  ) {
    if (memory.lastEntity) {
      return {
        resolved: message,
        entityContext: memory.lastEntity,
      };
    }
  }

  // Resolve "why" to the last intent
  if (/^why\b/.test(lower) && memory.lastIntent) {
    return {
      resolved: message,
      entityContext: memory.contextEntity ?? memory.lastEntity,
    };
  }

  // Resolve "show me" / "open" without entity to current entity
  if (
    /^(show|open|view|go to)\s+(me\s+)?(the\s+)?(claim|document|company|recommendation)\b/.test(lower) &&
    !/\d+/.test(lower) &&
    memory.contextEntity
  ) {
    return {
      resolved: message,
      entityContext: memory.contextEntity,
    };
  }

  return { resolved: message };
}

/**
 * Build initial suggested questions based on current Atlas state.
 */
export function buildSuggestedQuestions(context: AtlasConversationContext): string[] {
  const suggestions: string[] = [];

  if (context.attention.critical.length > 0) {
    suggestions.push("What needs my attention?");
  }

  if (context.decisions.pendingApprovals > 0) {
    suggestions.push("What needs my approval?");
  }

  if (context.activity.todayCount > 0) {
    suggestions.push("What changed today?");
  }

  if (context.decisions.highImpact.length > 0) {
    suggestions.push("Where are the biggest opportunities?");
  }

  if (context.nextBestAction) {
    suggestions.push("What should I focus on?");
  }

  if (context.currentEntity) {
    suggestions.push(`What's happening with this ${context.currentEntity.type}?`);
  }

  // Always include at least 3 suggestions
  if (suggestions.length < 3) {
    if (!suggestions.includes("What should I focus on?")) {
      suggestions.push("What should I focus on?");
    }
    if (!suggestions.includes("What can you do?")) {
      suggestions.push("What can you do?");
    }
  }
  if (suggestions.length < 3) {
    suggestions.push("What changed today?");
  }

  return suggestions.slice(0, 4);
}
