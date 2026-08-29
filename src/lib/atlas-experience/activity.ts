// ---------------------------------------------------------------------------
// Atlas Activity Model
//
// A unified representation of everything that happens across Atlas:
//   - human actions
//   - Atlas discoveries
//   - system events
//   - external activity
//
// This model normalizes existing Atlas data into a single coherent timeline
// that feeds the Dashboard, entity detail pages, Ask Atlas, and future agents.
// ---------------------------------------------------------------------------

import { type AtlasEntityReference, type EntityType } from "./entity-reference";

// ---------------------------------------------------------------------------
// Activity Types
// ---------------------------------------------------------------------------

/** The actor who caused the activity */
export interface ActivityActor {
  type: "user" | "atlas" | "system" | "external";
  id?: string;
  label: string;
}

/** Activity significance — not every event deserves equal attention */
export type ActivitySignificance = "important" | "notable" | "routine";

/** Activity categories for classification and filtering */
export type ActivityCategory =
  | "claim_created"
  | "claim_status_changed"
  | "claim_analysis_completed"
  | "claim_reconstruction_updated"
  | "document_uploaded"
  | "document_processing_completed"
  | "document_processing_failed"
  | "evidence_discovered"
  | "evidence_gap_identified"
  | "contradiction_found"
  | "supplement_created"
  | "supplement_status_changed"
  | "supplement_submitted"
  | "recommendation_generated"
  | "recommendation_approved"
  | "recommendation_rejected"
  | "recommendation_executed"
  | "workflow_started"
  | "workflow_completed"
  | "workflow_failed"
  | "workflow_approval_requested"
  | "workflow_approval_decision"
  | "job_created"
  | "job_completed"
  | "job_failed"
  | "job_retrying"
  | "revenue_opportunity_identified"
  | "recovery_amount_updated"
  | "knowledge_entity_created"
  | "knowledge_entity_confirmed"
  | "crm_lead_created"
  | "crm_lead_stage_changed"
  | "crm_email_sent"
  | "crm_email_received"
  | "crm_reply_received"
  | "crm_task_created"
  | "crm_task_completed"
  | "crm_demo_scheduled"
  | "user_action"
  | "system_error"
  | "integration_sync"
  | "unknown";

/** A unified activity record */
export interface AtlasActivity {
  /** Unique identifier */
  id: string;

  /** The entity this activity relates to */
  entity: AtlasEntityReference;

  /** Activity category */
  category: ActivityCategory;

  /** Who or what caused the activity */
  actor: ActivityActor;

  /** Human-readable title */
  title: string;

  /** Optional description/detail */
  summary?: string;

  /** When it happened (epoch ms) */
  timestamp: number;

  /** Activity source system */
  source?: string;

  /** Structured metadata */
  metadata?: Record<string, unknown>;

  /** Significance level */
  significance: ActivitySignificance;

  /** Related entities (e.g., a claim activity might reference a document) */
  relatedEntities?: AtlasEntityReference[];

  /** Whether this activity triggered an attention item */
  triggeredAttention?: boolean;
}

/** A date-grouped collection of activities for timeline display */
export interface ActivityDateGroup {
  /** Date label (e.g., "Today", "Yesterday", "Aug 28, 2026") */
  label: string;
  /** Activities for this date, sorted newest first */
  activities: AtlasActivity[];
}

/** Workspace-level activity summary */
export interface WorkspaceActivitySummary {
  /** When the most recent activity occurred */
  lastActivityAt: number | null;
  /** Count of important recent activities */
  recentImportantCount: number;
  /** Count of Atlas discoveries today */
  recentAtlasDiscoveries: number;
  /** Count of human actions today */
  recentHumanActions: number;
  /** Total activities in the time window */
  totalRecentCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Activity significance rules — maps category to default significance */
export const CATEGORY_SIGNIFICANCE: Record<ActivityCategory, ActivitySignificance> = {
  claim_created: "important",
  claim_status_changed: "notable",
  claim_analysis_completed: "notable",
  claim_reconstruction_updated: "notable",
  document_uploaded: "notable",
  document_processing_completed: "routine",
  document_processing_failed: "important",
  evidence_discovered: "notable",
  evidence_gap_identified: "important",
  contradiction_found: "important",
  supplement_created: "notable",
  supplement_status_changed: "notable",
  supplement_submitted: "important",
  recommendation_generated: "notable",
  recommendation_approved: "important",
  recommendation_rejected: "notable",
  recommendation_executed: "important",
  workflow_started: "routine",
  workflow_completed: "routine",
  workflow_failed: "important",
  workflow_approval_requested: "important",
  workflow_approval_decision: "notable",
  job_created: "routine",
  job_completed: "routine",
  job_failed: "important",
  job_retrying: "routine",
  revenue_opportunity_identified: "important",
  recovery_amount_updated: "notable",
  knowledge_entity_created: "routine",
  knowledge_entity_confirmed: "routine",
  crm_lead_created: "notable",
  crm_lead_stage_changed: "notable",
  crm_email_sent: "routine",
  crm_email_received: "notable",
  crm_reply_received: "important",
  crm_task_created: "routine",
  crm_task_completed: "routine",
  crm_demo_scheduled: "important",
  user_action: "routine",
  system_error: "important",
  integration_sync: "routine",
  unknown: "routine",
};

/** Human-readable labels for activity categories */
export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  claim_created: "Claim created",
  claim_status_changed: "Claim status changed",
  claim_analysis_completed: "Claim analysis completed",
  claim_reconstruction_updated: "Claim reconstruction updated",
  document_uploaded: "Document uploaded",
  document_processing_completed: "Document processing completed",
  document_processing_failed: "Document processing failed",
  evidence_discovered: "Evidence discovered",
  evidence_gap_identified: "Evidence gap identified",
  contradiction_found: "Contradiction found",
  supplement_created: "Supplement drafted",
  supplement_status_changed: "Supplement status changed",
  supplement_submitted: "Supplement submitted",
  recommendation_generated: "Recommendation generated",
  recommendation_approved: "Recommendation approved",
  recommendation_rejected: "Recommendation rejected",
  recommendation_executed: "Recommendation executed",
  workflow_started: "Workflow started",
  workflow_completed: "Workflow completed",
  workflow_failed: "Workflow failed",
  workflow_approval_requested: "Approval requested",
  workflow_approval_decision: "Approval decision made",
  job_created: "Job queued",
  job_completed: "Job completed",
  job_failed: "Job failed",
  job_retrying: "Job retrying",
  revenue_opportunity_identified: "Revenue opportunity identified",
  recovery_amount_updated: "Recovery amount updated",
  knowledge_entity_created: "Knowledge entity created",
  knowledge_entity_confirmed: "Knowledge entity confirmed",
  crm_lead_created: "Lead created",
  crm_lead_stage_changed: "Lead stage changed",
  crm_email_sent: "Email sent",
  crm_email_received: "Email received",
  crm_reply_received: "Reply received",
  crm_task_created: "Task created",
  crm_task_completed: "Task completed",
  crm_demo_scheduled: "Demo scheduled",
  user_action: "User action",
  system_error: "System error",
  integration_sync: "Integration sync",
  unknown: "Activity",
};

// ---------------------------------------------------------------------------
// Activity Factories — create AtlasActivity from existing data shapes
// ---------------------------------------------------------------------------

let activityCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++activityCounter}`;
}

/**
 * Create an activity from a claim event (from the existing claim timeline).
 */
export function claimEventToActivity(event: {
  label: string;
  detail?: string;
  ts: number;
  source: string;
}): AtlasActivity {
  const actorType: ActivityActor["type"] =
    event.source === "atlas" ? "atlas" : "system";

  // Classify the event based on its label
  let category: ActivityCategory = "user_action";
  const lower = event.label.toLowerCase();
  if (lower.includes("contradiction")) category = "contradiction_found";
  else if (lower.includes("evidence gap") || lower.includes("gap")) category = "evidence_gap_identified";
  else if (lower.includes("supplement") && lower.includes("recommend")) category = "recommendation_generated";
  else if (lower.includes("estimate") && lower.includes("upload")) category = "document_uploaded";
  else if (lower.includes("processing") || lower.includes("completed")) category = "document_processing_completed";
  else if (lower.includes("analysis")) category = "claim_analysis_completed";

  return {
    id: nextId("claim"),
    entity: { type: "claim", id: "", label: "" },
    category,
    actor: { type: actorType, label: actorType === "atlas" ? "Atlas" : "System" },
    title: event.label,
    summary: event.detail,
    timestamp: event.ts,
    significance: CATEGORY_SIGNIFICANCE[category],
  };
}

/**
 * Create an activity from an atlas_job_events record.
 */
export function jobEventToActivity(event: {
  _id: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  _creationTime: number;
  job_type?: string;
}): AtlasActivity {
  const eventType = event.event_type;
  let category: ActivityCategory = "job_created";
  if (eventType === "job_completed") category = "job_completed";
  else if (eventType === "job_failed") category = "job_failed";
  else if (eventType === "job_retrying") category = "job_retrying";
  else if (eventType === "step_completed") category = "job_completed";
  else if (eventType === "step_failed") category = "job_failed";

  const actorType: ActivityActor["type"] =
    event.actor === "system" ? "system" : event.actor === "atlas" ? "atlas" : "user";

  const jobType = event.job_type ?? String(event.payload?.job_type ?? "unknown");
  const title = eventType.replace(/_/g, " ");
  const jobLabel = jobType.replace(/_/g, " ");

  return {
    id: nextId("job"),
    entity: { type: "workflow", id: String(event.payload?.job_id ?? ""), label: jobLabel },
    category,
    actor: { type: actorType, label: actorType === "atlas" ? "Atlas" : actorType === "system" ? "System" : event.actor },
    title: `${jobLabel}: ${title}`,
    summary: typeof event.payload?.error === "string" ? event.payload.error : undefined,
    timestamp: event._creationTime,
    source: "jobs",
    metadata: event.payload,
    significance: CATEGORY_SIGNIFICANCE[category],
  };
}

/**
 * Create an activity from a recommendation event.
 */
export function recommendationEventToActivity(event: {
  _id: string;
  title: string;
  actionType: string;
  status: string;
  _creationTime: number;
}): AtlasActivity {
  let category: ActivityCategory = "recommendation_generated";
  if (event.actionType === "approved" || event.status === "approved") category = "recommendation_approved";
  else if (event.actionType === "rejected" || event.status === "rejected") category = "recommendation_rejected";
  else if (event.actionType === "executed" || event.status === "executed") category = "recommendation_executed";

  return {
    id: nextId("rec"),
    entity: { type: "recommendation", id: event._id, label: event.title },
    category,
    actor: { type: "user", label: "User" },
    title: CATEGORY_LABELS[category],
    summary: event.title,
    timestamp: event._creationTime,
    source: "recommendations",
    significance: CATEGORY_SIGNIFICANCE[category],
  };
}

/**
 * Create an activity from a document event.
 */
export function documentEventToActivity(event: {
  _id: string;
  title?: string;
  status?: string;
  actionType?: string;
  _creationTime: number;
}): AtlasActivity {
  let category: ActivityCategory = "document_uploaded";
  if (event.status === "ready" || event.actionType?.includes("completed")) category = "document_processing_completed";
  else if (event.status === "failed" || event.actionType?.includes("failed")) category = "document_processing_failed";

  return {
    id: nextId("doc"),
    entity: { type: "document", id: event._id, label: event.title ?? "Document" },
    category,
    actor: { type: "system", label: "System" },
    title: CATEGORY_LABELS[category],
    summary: event.title,
    timestamp: event._creationTime,
    source: "documents",
    significance: CATEGORY_SIGNIFICANCE[category],
  };
}

/**
 * Create an activity from a CRM event.
 */
export function crmEventToActivity(event: {
  _id: string;
  type: string;
  title?: string;
  description?: string;
  companyName?: string;
  _creationTime: number;
}): AtlasActivity {
  const eventType = event.type;
  let category: ActivityCategory = "crm_task_created";
  const lower = eventType.toLowerCase();
  if (lower.includes("lead") && lower.includes("created")) category = "crm_lead_created";
  else if (lower.includes("stage")) category = "crm_lead_stage_changed";
  else if (lower.includes("email") && lower.includes("sent")) category = "crm_email_sent";
  else if (lower.includes("email") && lower.includes("received")) category = "crm_email_received";
  else if (lower.includes("reply")) category = "crm_reply_received";
  else if (lower.includes("task") && lower.includes("complete")) category = "crm_task_completed";
  else if (lower.includes("demo")) category = "crm_demo_scheduled";

  return {
    id: nextId("crm"),
    entity: { type: "lead", id: event._id, label: event.companyName ?? "CRM" },
    category,
    actor: { type: "user", label: "User" },
    title: event.title ?? CATEGORY_LABELS[category],
    summary: event.description,
    timestamp: event._creationTime,
    source: "crm",
    significance: CATEGORY_SIGNIFICANCE[category],
  };
}
