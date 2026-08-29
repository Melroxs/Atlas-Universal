// ---------------------------------------------------------------------------
// Atlas Command Center
//
// Integrates Attention, Activity, and Decision systems into a unified
// operational command center. Answers:
//   - What matters?
//   - What changed?
//   - What should I do next?
// ---------------------------------------------------------------------------

import { type AttentionItem } from "./attention";
import { type AtlasActivity } from "./activity";
import { type AtlasDecision } from "./decision";
import { type WorkspaceHealth } from "./context";

// ---------------------------------------------------------------------------
// Command Center State
// ---------------------------------------------------------------------------

export interface CommandCenterState {
  /** System health */
  system: {
    online: boolean;
    health: WorkspaceHealth;
    statusMessage: string;
  };
  /** What matters — prioritized attention items */
  whatMatters: {
    items: AttentionItem[];
    criticalCount: number;
    highCount: number;
    totalImpact: number;
  };
  /** What changed — recent meaningful activity */
  whatChanged: {
    items: AtlasActivity[];
    todayCount: number;
    atlasDiscoveries: number;
  };
  /** What Atlas recommends — prioritized decisions */
  whatRecommends: {
    items: AtlasDecision[];
    pendingApprovals: number;
    highImpact: number;
  };
  /** Next best action */
  nextBestAction: NextBestAction | null;
}

// ---------------------------------------------------------------------------
// Next Best Action
// ---------------------------------------------------------------------------

export interface NextBestAction {
  /** What to do */
  title: string;
  /** Why now */
  reason: string;
  /** Entity to navigate to */
  entity: { type: string; id: string; label: string; href?: string };
  /** Action type */
  actionType: "review" | "approve" | "investigate" | "follow_up";
  /** Priority score (lower = more important) */
  priorityScore: number;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------

/**
 * Compute system status message from workspace health.
 */
export function computeSystemStatus(health: WorkspaceHealth): {
  online: boolean;
  statusMessage: string;
  degraded: boolean;
} {
  const issues: string[] = [];

  if (health.documents === 0 && health.entities === 0) {
    issues.push("knowledge base is empty");
  }

  const degraded = issues.length > 0;
  const statusMessage = degraded
    ? `Atlas is online — ${issues.join("; ")}`
    : "Atlas is online";

  return { online: true, statusMessage, degraded };
}

// ---------------------------------------------------------------------------
// Next Best Action Selection
// ---------------------------------------------------------------------------

/**
 * Select the single most important next action from all available signals.
 *
 * Priority order:
 * 1. Critical attention items requiring immediate action
 * 2. High-priority recommendations requiring approval
 * 3. Revenue opportunities with financial impact
 * 4. Evidence gaps on active claims
 * 5. Workflow failures
 */
export function selectNextBestAction(params: {
  attentionItems: AttentionItem[];
  decisions: AtlasDecision[];
  activities: AtlasActivity[];
}): NextBestAction | null {
  const { attentionItems, decisions, activities } = params;

  // 1. Critical attention items
  const criticalAttention = attentionItems
    .filter((a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"))
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));

  if (criticalAttention.length > 0) {
    const top = criticalAttention[0];
    return {
      title: top.title,
      reason: top.explanation,
      entity: {
        type: top.sourceEntityType ?? "unknown",
        id: top.sourceEntityId ?? "",
        label: top.sourceEntityName ?? top.title,
        href: top.navigationTarget,
      },
      actionType: "investigate",
      priorityScore: top.severity === "critical" ? 0 : 1,
    };
  }

  // 2. High-priority recommendations requiring approval
  const pendingApprovals = decisions
    .filter((d) => d.requiresApproval && d.status === "new")
    .sort((a, b) => {
      const aSev = SEVERITY_ORDER[a.importance.severity] ?? 4;
      const bSev = SEVERITY_ORDER[b.importance.severity] ?? 4;
      if (aSev !== bSev) return aSev - bSev;
      return (b.importance.impact ?? 0) - (a.importance.impact ?? 0);
    });

  if (pendingApprovals.length > 0) {
    const top = pendingApprovals[0];
    return {
      title: top.recommendation.title,
      reason: top.recommendation.reasoning,
      entity: top.entity,
      actionType: "approve",
      priorityScore: 2 + (top.importance.impact ? Math.min(top.importance.impact / 10000, 2) : 0),
    };
  }

  // 3. Revenue opportunities with financial impact
  const revenueOpps = decisions
    .filter((d) => d.importance.impact !== undefined && d.importance.impact > 0 && d.status === "new")
    .sort((a, b) => (b.importance.impact ?? 0) - (a.importance.impact ?? 0));

  if (revenueOpps.length > 0) {
    const top = revenueOpps[0];
    return {
      title: top.recommendation.title,
      reason: `Potential impact: $${(top.importance.impact ?? 0).toLocaleString()}`,
      entity: top.entity,
      actionType: "review",
      priorityScore: 4,
    };
  }

  // 4. Evidence gaps
  const evidenceGaps = attentionItems
    .filter((a) => a.status === "open" && a.category === "evidence_gap")
    .sort((a, b) => b.timestamp - a.timestamp);

  if (evidenceGaps.length > 0) {
    const top = evidenceGaps[0];
    return {
      title: top.title,
      reason: top.explanation,
      entity: {
        type: top.sourceEntityType ?? "unknown",
        id: top.sourceEntityId ?? "",
        label: top.sourceEntityName ?? top.title,
        href: top.navigationTarget,
      },
      actionType: "investigate",
      priorityScore: 6,
    };
  }

  // 5. Workflow failures
  const workflowFailures = attentionItems
    .filter((a) => a.status === "open" && a.category === "workflow_failed")
    .sort((a, b) => b.timestamp - a.timestamp);

  if (workflowFailures.length > 0) {
    const top = workflowFailures[0];
    return {
      title: top.title,
      reason: top.explanation,
      entity: {
        type: top.sourceEntityType ?? "unknown",
        id: top.sourceEntityId ?? "",
        label: top.sourceEntityName ?? top.title,
        href: top.navigationTarget,
      },
      actionType: "investigate",
      priorityScore: 7,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Ask Atlas Structured Context
// ---------------------------------------------------------------------------

export interface AskAtlasContext {
  /** Workspace health summary */
  workspaceHealth: string;
  /** Critical attention items */
  criticalAttention: string;
  /** Important attention items */
  importantAttention: string;
  /** Recent significant activity */
  recentActivity: string;
  /** Pending decisions requiring approval */
  pendingDecisions: string;
  /** High-impact recommendations */
  highImpactRecommendations: string;
  /** Current entity context if any */
  currentEntity?: string;
}

/**
 * Build a compact structured context for Ask Atlas.
 * Uses real data only — never fabricates information.
 */
export function buildAskAtlasContext(params: {
  health: WorkspaceHealth;
  attentionItems: AttentionItem[];
  activities: AtlasActivity[];
  decisions: AtlasDecision[];
  currentEntity?: { type: string; id: string; label: string };
}): AskAtlasContext {
  const { health, attentionItems, activities, decisions, currentEntity } = params;

  // Health summary
  const healthParts: string[] = [];
  if (health.documents > 0) healthParts.push(`${health.documents} documents`);
  if (health.entities > 0) healthParts.push(`${health.entities} entities`);
  if (health.openClaims > 0) healthParts.push(`${health.openClaims} open claims`);
  const workspaceHealth = healthParts.length > 0
    ? `Workspace has ${healthParts.join(", ")}.`
    : "Workspace is empty.";

  // Critical attention
  const criticalItems = attentionItems.filter(
    (a) => a.status === "open" && (a.severity === "critical" || a.severity === "high"),
  );
  const criticalAttention = criticalItems.length > 0
    ? `${criticalItems.length} critical/high attention items: ${criticalItems.slice(0, 3).map((a) => a.title).join("; ")}.`
    : "No critical attention items.";

  // Important attention
  const importantItems = attentionItems.filter(
    (a) => a.status === "open" && a.severity === "medium",
  );
  const importantAttention = importantItems.length > 0
    ? `${importantItems.length} medium-priority items.`
    : "No medium-priority items.";

  // Recent activity
  const now = Date.now();
  const dayMs = 86_400_000;
  const recentItems = activities.filter((a) => a.timestamp >= now - dayMs);
  const recentActivity = recentItems.length > 0
    ? `${recentItems.length} activities today. ${recentItems.filter((a) => a.actor.type === "atlas").length} Atlas discoveries.`
    : "No recent activity.";

  // Pending decisions
  const pendingDecisionsList = decisions.filter((d) => d.requiresApproval && d.status === "new");
  const pendingDecisionText = pendingDecisionsList.length > 0
    ? `${pendingDecisionsList.length} decisions pending approval: ${pendingDecisionsList.slice(0, 2).map((d) => d.observation.title).join("; ")}.`
    : "No pending approvals.";

  // High-impact recommendations
  const highImpact = decisions.filter(
    (d) => d.importance.impact !== undefined && d.importance.impact > 0 && d.status === "new",
  );
  const highImpactText = highImpact.length > 0
    ? `${highImpact.length} high-impact recommendations totaling $${highImpact.reduce((sum, d) => sum + (d.importance.impact ?? 0), 0).toLocaleString()}.`
    : "No high-impact recommendations.";

  // Current entity
  const currentEntityText = currentEntity
    ? `Currently viewing: ${currentEntity.type} "${currentEntity.label}".`
    : undefined;

  return {
    workspaceHealth,
    criticalAttention,
    importantAttention,
    recentActivity,
    pendingDecisions: pendingDecisionText,
    highImpactRecommendations: highImpactText,
    currentEntity: currentEntityText,
  };
}
