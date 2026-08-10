// ---------------------------------------------------------------------------
// Atlas Universal — Workflow Registry
//
// Workflow definitions are explicit, versioned data — never hardcoded in UI
// or executors. The engine orchestrates the EXISTING primitives (events,
// tools/actions, knowledge, approvals, notifications, audit). Only workflows
// that genuinely run through the production engine are registered here.
//
// Roadmap connectors (Gmail, Slack, GitHub, Stripe, …) are NOT registered —
// no fake workflows, no claimed automations.
// ---------------------------------------------------------------------------

import type { WorkflowDefinition } from "./contract";

export const WORKFLOW_REGISTRY: WorkflowDefinition[] = [
  // -----------------------------------------------------------------------
  // Real workflow 1 — New Document Intelligence (read-oriented, safe)
  //
  // A new Drive file appears → Atlas knows it (the event handler ingested
  // it) → a decision evaluates whether it matters → if it does, Atlas
  // verifies the current state through the tool runtime (READ) and notifies
  // the workspace.
  // -----------------------------------------------------------------------
  {
    id: "drive.new_document_intelligence",
    name: "New document intelligence",
    description:
      "When a new file appears in the connected Drive, Atlas evaluates its importance, verifies its current state through the tool runtime, and notifies the workspace when it matters.",
    version: "1.0.0",
    industry: "universal",
    status: "active",
    trigger: { eventTypes: ["drive.file_created"], connector: "google_drive" },
    steps: [
      {
        id: "retrieve",
        type: "retrieve",
        source: "document_by_resource",
        storeKey: "document",
      },
      {
        id: "evaluate",
        type: "decision",
        storeKey: "decision",
        defaultNext: "complete",
        rules: [
          {
            if: { op: "exists", path: "document._id" },
            then: {
              decision: "important_document",
              confidence: 0.8,
              requiresHumanReview: false,
              nextStepId: "gate",
              rationale:
                "A new supported document was ingested — Atlas flags it for workspace visibility.",
            },
          },
          {
            if: {
              op: "contains",
              path: "document.mimeType",
              value: "application/pdf",
            },
            then: {
              decision: "important_document",
              confidence: 0.9,
              requiresHumanReview: false,
              nextStepId: "gate",
              rationale: "PDF documents are treated as high-value knowledge inputs.",
            },
          },
        ],
      },
      {
        id: "gate",
        type: "condition",
        condition: { op: "equals", path: "decision.decision", value: "important_document" },
        then: "verify",
        else: "complete",
      },
      {
        id: "verify",
        type: "action",
        toolId: "drive.get_file_metadata",
        args: [
          { key: "fileId", from: "context", path: "triggerEvent.payload.fileId" },
        ],
        storeKey: "lastAction",
      },
      {
        id: "notify_important",
        type: "notify",
        severity: "low",
        title: "New document ingested: {resourceName}",
        description:
          "Atlas verified the new file and added it to company knowledge. Evidence and interpretation are in Events.",
      },
      { id: "complete", type: "complete" },
    ],
    policies: {
      riskLevel: "READ",
      requiresApproval: false,
      maxActions: 2,
    },
    requiredConnectors: ["google_drive"],
    requiredTools: ["drive.get_file_metadata"],
    timeoutMs: 24 * 60 * 60 * 1000,
    retryPolicy: { maxAttempts: 3, baseMs: 15_000 },
    createdBy: "atlas-core",
    updatedAt: "2026-08-01",
  },

  // -----------------------------------------------------------------------
  // Real workflow 2 — Reviewed Document (event → decision → approval →
  // action → verification). Uses a SAFE, reversible Drive metadata write:
  // it sets a short "Reviewed by Atlas" description (never content).
  // -----------------------------------------------------------------------
  {
    id: "drive.review_updated_document",
    name: "Reviewed document marker",
    description:
      "When an existing document changes in Drive, Atlas proposes marking it as reviewed by adding a short description to the file metadata (no content change). A manager approves; the action executes through the tool runtime and the result is verified.",
    version: "1.0.0",
    industry: "universal",
    status: "active",
    trigger: { eventTypes: ["drive.file_updated"], connector: "google_drive" },
    steps: [
      {
        id: "retrieve",
        type: "retrieve",
        source: "document_by_resource",
        storeKey: "document",
      },
      {
        id: "assess",
        type: "decision",
        storeKey: "decision",
        defaultNext: "complete",
        rules: [
          {
            if: { op: "exists", path: "document._id" },
            then: {
              decision: "mark_reviewed",
              confidence: 0.85,
              requiresHumanReview: true,
              nextStepId: "approve",
              rationale:
                "A known document changed — Atlas proposes a reversible metadata marker so the workspace can see it was reviewed.",
            },
          },
        ],
      },
      {
        id: "approve",
        type: "approval",
        role: "manager",
        title: "Mark document as reviewed by Atlas",
        description:
          "Atlas wants to mark the recently updated document \"{resourceName}\" as reviewed. It will set the file's description to \"Reviewed by Atlas\" — metadata only, file content is never changed. Reversible: the description can be removed at any time.",
        consequences:
          "The connected Google Drive file's description field changes. No content, permissions, location or deletion.",
        reversibility: "Reversible — remove or overwrite the description.",
        expiresAfterMs: 48 * 60 * 60 * 1000,
      },
      {
        id: "mark_reviewed",
        type: "action",
        toolId: "drive.update_file",
        args: [
          { key: "fileId", from: "context", path: "triggerEvent.payload.fileId" },
          { key: "description", from: "context", path: "reviewDescription" },
        ],
        storeKey: "lastAction",
      },
      {
        id: "done",
        type: "notify",
        severity: "low",
        title: "Document review marker applied: {resourceName}",
        description:
          "The updated document was marked as reviewed by Atlas. The Drive write was verified against the live file state.",
      },
      { id: "complete", type: "complete" },
    ],
    policies: {
      riskLevel: "LOW_WRITE",
      requiresApproval: true,
      allowedTools: ["drive.update_file", "drive.get_file_metadata"],
      maxActions: 2,
    },
    requiredConnectors: ["google_drive"],
    requiredTools: ["drive.update_file", "drive.get_file_metadata"],
    timeoutMs: 72 * 60 * 60 * 1000,
    retryPolicy: { maxAttempts: 3, baseMs: 15_000 },
    approvalRole: "manager",
    createdBy: "atlas-core",
    updatedAt: "2026-08-01",
  },

  // -----------------------------------------------------------------------
  // Real workflow 3 — New evidence → Revenue review (Insurance Restoration)
  //
  // Phase 12: the revenue-recovery vertical's first-class workflow. When a
  // new document lands in the connected Drive, Atlas retrieves it, decides
  // whether it could affect open claims/revenue (estimate, invoice, scope,
  // supplement, photo evidence), verifies its current state through the tool
  // runtime (READ), and notifies the workspace when it matters. Durable,
  // read-oriented, no approval, no writes to Drive.
  // -----------------------------------------------------------------------
  {
    id: "revenue.new_evidence_review",
    name: "New evidence → revenue review",
    description:
      "When a new document appears in the connected Drive, Atlas evaluates whether it could affect open claims and revenue (estimate, invoice, scope, supplement or evidence material) and notifies the workspace to review the affected revenue position.",
    version: "1.0.0",
    industry: "insurance_restoration",
    status: "active",
    trigger: { eventTypes: ["drive.file_created"], connector: "google_drive" },
    steps: [
      {
        id: "retrieve_document",
        type: "retrieve",
        source: "document_by_resource",
        storeKey: "document",
      },
      {
        id: "assess_relevance",
        type: "decision",
        storeKey: "decision",
        defaultNext: "complete",
        rules: [
          {
            if: { op: "exists", path: "document._id" },
            then: {
              decision: "revenue_relevant",
              confidence: 0.7,
              requiresHumanReview: false,
              nextStepId: "gate",
              rationale:
                "A new supported document was ingested — Atlas checks whether it can affect the revenue position.",
            },
          },
          {
            if: {
              op: "contains",
              path: "document.classification",
              value: "financial",
            },
            then: {
              decision: "revenue_relevant",
              confidence: 0.85,
              requiresHumanReview: false,
              nextStepId: "gate",
              rationale:
                "Financial documents (invoices, statements) directly affect the revenue position and should be reviewed.",
            },
          },
          {
            if: {
              op: "contains",
              path: "document.classification",
              value: "estimate",
            },
            then: {
              decision: "revenue_relevant",
              confidence: 0.9,
              requiresHumanReview: false,
              nextStepId: "gate",
              rationale:
                "Estimates drive claim scope and billing — a new estimate may reveal missing scope or supplement opportunities.",
            },
          },
        ],
      },
      {
        id: "gate",
        type: "condition",
        condition: { op: "equals", path: "decision.decision", value: "revenue_relevant" },
        then: "verify_document",
        else: "complete",
      },
      {
        id: "verify_document",
        type: "action",
        toolId: "drive.get_file_metadata",
        args: [
          { key: "fileId", from: "context", path: "triggerEvent.payload.fileId" },
        ],
        storeKey: "lastAction",
      },
      {
        id: "notify_revenue_review",
        type: "notify",
        severity: "medium",
        title: "New evidence may affect revenue: {resourceName}",
        description:
          "A new document was ingested that could affect open claims or the revenue position. Review the affected claim package and Revenue Recovery before the next submission window.",
      },
      { id: "complete", type: "complete" },
    ],
    policies: {
      riskLevel: "READ",
      requiresApproval: false,
      maxActions: 2,
    },
    requiredConnectors: ["google_drive"],
    requiredTools: ["drive.get_file_metadata"],
    timeoutMs: 24 * 60 * 60 * 1000,
    retryPolicy: { maxAttempts: 3, baseMs: 15_000 },
    createdBy: "atlas-core",
    updatedAt: "2026-08-10",
  },
];

export const WORKFLOW_BY_ID: Record<string, WorkflowDefinition> = Object.fromEntries(
  WORKFLOW_REGISTRY.map((w) => [w.id, w]),
);

export function getWorkflowDefinition(id: string): WorkflowDefinition | undefined {
  return WORKFLOW_BY_ID[id];
}

/** Recommended industry-pack workflows (roadmap — never registered as real). */
export const ROADMAP_WORKFLOW_NOTES: Array<{ id: string; title: string; note: string }> = [
  { id: "gmail.inbox_triage", title: "Gmail inbox triage", note: "Requires the Gmail event source (roadmap)." },
  { id: "slack.mention_alert", title: "Slack mention alert", note: "Requires the Slack event source (roadmap)." },
  { id: "stripe.payment_review", title: "Payment review", note: "Requires the Stripe event source (roadmap)." },
];
