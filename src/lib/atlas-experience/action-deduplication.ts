// ---------------------------------------------------------------------------
// Atlas Action Deduplication
//
// Prevents duplicate action suggestions across:
//   - Command Center (NextBestAction, WhatMatters, WhatRecommends)
//   - Proactive Atlas (signals)
//   - Decision Cards
//   - Ask Atlas (conversational proposals)
//   - Entity detail pages
//
// When the same entity/action combination appears from multiple sources,
// consolidate into one canonical action preserving provenance from all
// originating signals.
// ---------------------------------------------------------------------------

import type { AtlasActionType } from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionProposalInput {
  /** Action type */
  actionType: AtlasActionType;
  /** Entity this action operates on */
  entity: AtlasEntityReference;
  /** Source system that generated this suggestion */
  source: "command_center" | "proactive" | "decision" | "conversation" | "entity_page" | "signal" | "attention";
  /** Source ID for traceability */
  sourceId?: string;
  /** Priority (lower = more important) */
  priority?: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

export interface DeduplicatedAction {
  /** Canonical action type */
  actionType: AtlasActionType;
  /** Entity */
  entity: AtlasEntityReference;
  /** All sources that suggested this action (preserves provenance) */
  sources: Array<{ source: string; sourceId?: string; context?: Record<string, unknown> }>;
  /** Best priority across all sources */
  priority: number;
}

// ---------------------------------------------------------------------------
// Deduplication key
// ---------------------------------------------------------------------------

/**
 * Generate a deduplication key for an action proposal.
 * Two proposals are considered the same action if they share:
 *   - tenant (via entity)
 *   - entity type + entity ID
 *   - action type
 */
function deduplicationKey(actionType: AtlasActionType, entity: AtlasEntityReference): string {
  return `${entity.type}:${entity.id}:${actionType}`;
}

// ---------------------------------------------------------------------------
// Main deduplication function
// ---------------------------------------------------------------------------

/**
 * Deduplicate action proposals across multiple sources.
 * Preserves provenance from all originating signals.
 */
export function deduplicateActionProposals(
  proposals: ActionProposalInput[],
): DeduplicatedAction[] {
  const seen = new Map<string, DeduplicatedAction>();

  for (const proposal of proposals) {
    const key = deduplicationKey(proposal.actionType, proposal.entity);
    const existing = seen.get(key);

    if (existing) {
      // Merge: add source, take lowest priority
      existing.sources.push({
        source: proposal.source,
        sourceId: proposal.sourceId,
        context: proposal.context,
      });
      if (proposal.priority !== undefined && proposal.priority < existing.priority) {
        existing.priority = proposal.priority;
      }
    } else {
      seen.set(key, {
        actionType: proposal.actionType,
        entity: proposal.entity,
        sources: [{
          source: proposal.source,
          sourceId: proposal.sourceId,
          context: proposal.context,
        }],
        priority: proposal.priority ?? 100,
      });
    }
  }

  // Sort by priority (lowest first)
  return Array.from(seen.values()).sort((a, b) => a.priority - b.priority);
}

// ---------------------------------------------------------------------------
// Convenience: collect proposals from multiple Atlas surfaces
// ---------------------------------------------------------------------------

export interface AtlasSurfaceProposals {
  attention?: Array<{ actionType: AtlasActionType; entity: AtlasEntityReference; id?: string }>;
  decisions?: Array<{ actionType: AtlasActionType; entity: AtlasEntityReference; id?: string }>;
  signals?: Array<{ actionType: AtlasActionType; entity: AtlasEntityReference; id?: string }>;
  conversation?: Array<{ actionType: AtlasActionType; entity: AtlasEntityReference; id?: string }>;
  commandCenter?: Array<{ actionType: AtlasActionType; entity: AtlasEntityReference; id?: string }>;
}

/**
 * Collect proposals from all Atlas surfaces and deduplicate them.
 * Returns a unified list of unique actions with provenance.
 */
export function collectAndDeduplicate(
  surfaces: AtlasSurfaceProposals,
): DeduplicatedAction[] {
  const allProposals: ActionProposalInput[] = [];

  if (surfaces.attention) {
    for (const p of surfaces.attention) {
      allProposals.push({ ...p, source: "attention", sourceId: p.id, priority: 10 });
    }
  }

  if (surfaces.decisions) {
    for (const p of surfaces.decisions) {
      allProposals.push({ ...p, source: "decision", sourceId: p.id, priority: 20 });
    }
  }

  if (surfaces.signals) {
    for (const p of surfaces.signals) {
      allProposals.push({ ...p, source: "signal", sourceId: p.id, priority: 30 });
    }
  }

  if (surfaces.conversation) {
    for (const p of surfaces.conversation) {
      allProposals.push({ ...p, source: "conversation", sourceId: p.id, priority: 5 });
    }
  }

  if (surfaces.commandCenter) {
    for (const p of surfaces.commandCenter) {
      allProposals.push({ ...p, source: "command_center", sourceId: p.id, priority: 15 });
    }
  }

  return deduplicateActionProposals(allProposals);
}
