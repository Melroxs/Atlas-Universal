// ---------------------------------------------------------------------------
// Workflow Intelligence
//
// Collects attention signals from the Jobs/workflow infrastructure.
// Translates technical job failures into useful operational language.
// ---------------------------------------------------------------------------

import { type AttentionItem } from "./attention";
import { createAttentionItem } from "./intelligence";

// ---------------------------------------------------------------------------
// Input shapes — match existing Atlas job/workflow data
// ---------------------------------------------------------------------------

export interface WorkflowForIntelligence {
  _id: string;
  name?: string | null;
  status?: string;
  _creationTime: number;
  updatedAt?: number;
}

export interface JobStatsForIntelligence {
  failedJobs?: number;
  stuckJobs?: number;
  runningJobs?: number;
  pendingJobs?: number;
}

// ---------------------------------------------------------------------------
// Workflow Intelligence Collectors
// ---------------------------------------------------------------------------

/**
 * Generate attention items for failed workflows.
 * Translates technical failures into operational language.
 */
export function collectFailedWorkflows(
  workflows: WorkflowForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const wf of workflows) {
    if (wf.status !== "failed") continue;

    const name = wf.name ?? "Unnamed workflow";

    items.push(
      createAttentionItem({
        id: `workflow-failed-${wf._id}`,
        severity: "high",
        category: "workflow_failed",
        title: `Workflow "${name}" failed`,
        explanation: `A workflow has stopped unexpectedly and may need attention.`,
        sourceEntityId: wf._id,
        sourceEntityType: "workflow",
        sourceEntityName: name,
        nextAction: "Review workflow",
        navigationTarget: `/dashboard/workflows`,
        meta: {
          source: "workflows",
          workflowStatus: "failed",
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for workflows awaiting approval.
 * These are blocked until a human approves them.
 */
export function collectPendingApprovals(
  workflows: WorkflowForIntelligence[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const wf of workflows) {
    if (wf.status !== "awaiting_approval") continue;

    const name = wf.name ?? "Unnamed workflow";

    items.push(
      createAttentionItem({
        id: `workflow-pending-${wf._id}`,
        severity: "medium",
        category: "overdue_task",
        title: `"${name}" awaiting your approval`,
        explanation: `A workflow is blocked waiting for human approval before it can continue.`,
        sourceEntityId: wf._id,
        sourceEntityType: "workflow",
        sourceEntityName: name,
        nextAction: "Review and approve",
        navigationTarget: `/dashboard/workflows`,
        meta: {
          source: "workflows",
          workflowStatus: "awaiting_approval",
        },
      }),
    );
  }

  return items;
}

/**
 * Generate attention items for stuck/stale processing.
 * Uses document pipeline stats as a proxy for stuck processing.
 */
export function collectStuckProcessing(docStats: {
  processing?: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const processing = docStats.processing ?? 0;

  if (processing <= 0) return items;

  items.push(
    createAttentionItem({
      id: "workflow-stuck-processing",
      severity: "info",
      category: "ai_insight",
      title: "Background processing active",
      explanation: `${processing} item${processing === 1 ? "" : "s"} currently being processed. This typically completes within a few minutes.`,
      navigationTarget: "/dashboard/knowledge",
      meta: {
        source: "system",
        processingCount: processing,
      },
    }),
  );

  return items;
}

/**
 * Collect all workflow intelligence signals.
 */
export function collectWorkflowIntelligence(
  workflows: WorkflowForIntelligence[],
  docStats: { processing?: number },
): AttentionItem[] {
  return [
    ...collectFailedWorkflows(workflows),
    ...collectPendingApprovals(workflows),
    ...collectStuckProcessing(docStats),
  ];
}
