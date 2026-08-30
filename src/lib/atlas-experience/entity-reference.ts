// ---------------------------------------------------------------------------
// Atlas Entity Reference Model
//
// A lightweight, reusable abstraction for referring to any Atlas entity.
// This is the foundation for entity navigation, breadcrumbs, relationship
// resolution, and the connected entity experience.
// ---------------------------------------------------------------------------

import { type AtlasEntityType } from "./context";

// ---------------------------------------------------------------------------
// Entity Reference — a lightweight pointer to any Atlas entity
// ---------------------------------------------------------------------------

export type EntityType =
  | "workspace"
  | "company"
  | "claim"
  | "supplement"
  | "document"
  | "evidence"
  | "recommendation"
  | "activity"
  | "action"
  | "organization"
  | "workflow"
  | "archive"
  | "knowledge"
  | "event"
  | "unknown";

export interface AtlasEntityReference {
  /** Entity type */
  type: EntityType;
  /** Stable ID (the _id from the database) */
  id: string;
  /** Display label (claim number, company name, document title, etc.) */
  label: string;
  /** Optional subtitle (status, type, date, etc.) */
  subtitle?: string;
  /** Navigation href */
  href?: string;
  /** Parent entity (for hierarchical navigation) */
  parent?: AtlasEntityReference;
  /** Financial amount if applicable */
  financialImpact?: number;
  /** Status string */
  status?: string;
}

/** An entity relation for relationship navigation */
export interface AtlasEntityRelation {
  /** The related entity */
  entity: AtlasEntityReference;
  /** The relationship type */
  relationship: "parent" | "child" | "sibling" | "related";
  /** The relationship label */
  label: string;
}

/** A timeline entry for entity history */
export interface AtlasEntityTimelineEntry {
  /** Unique ID */
  id: string;
  /** Entry type */
  type: "human_action" | "atlas_discovery" | "system_event" | "external_activity";
  /** Display label */
  label: string;
  /** Optional detail text */
  detail?: string;
  /** Timestamp */
  timestamp: string;
  /** Related entity ID */
  entityId?: string;
  /** Related entity type */
  entityType?: EntityType;
}

// ---------------------------------------------------------------------------
// Entity Reference Factories — create references from existing data shapes
// ---------------------------------------------------------------------------

/**
 * Create an entity reference from minimal data.
 */
export function createEntityReference(
  type: EntityType,
  id: string,
  label: string,
  options?: { subtitle?: string; href?: string; financialImpact?: number; status?: string }
): AtlasEntityReference {
  return { type, id, label, ...options };
}

/**
 * Create an entity reference from a claim.
 */
export function createClaimReference(claim: {
  _id: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  status?: string;
  outstanding?: number;
}): AtlasEntityReference {
  const label = claim.claimNumber ?? claim.customer ?? claim.property ?? "Unnamed claim";
  const subtitle = claim.status ? claim.status.replace(/_/g, " ") : undefined;

  return {
    type: "claim",
    id: claim._id,
    label,
    subtitle,
    href: `/dashboard/revenue-recovery/${claim._id}`,
    financialImpact: claim.outstanding ?? undefined,
    status: claim.status ?? undefined,
  };
}

/**
 * Create an entity reference from a document.
 */
export function createDocumentReference(doc: {
  _id: string;
  title?: string | null;
  classification?: string | null;
  status?: string | null;
}): AtlasEntityReference {
  return {
    type: "document",
    id: doc._id,
    label: doc.title ?? "Untitled document",
    subtitle: doc.classification ?? undefined,
    href: `/dashboard/knowledge/${doc._id}`,
    status: doc.status ?? undefined,
  };
}

/**
 * Create an entity reference from a recommendation.
 */
export function createRecommendationReference(rec: {
  _id: string;
  title: string;
  priority: string;
  status: string;
}): AtlasEntityReference {
  return {
    type: "recommendation",
    id: rec._id,
    label: rec.title,
    subtitle: `${rec.priority} priority · ${rec.status}`,
    href: "/dashboard/recommendations",
    status: rec.status,
  };
}

/**
 * Create an entity reference from a supplement.
 */
export function createSupplementReference(sup: {
  _id: string;
  claimNumber?: string | null;
  reason?: string;
  status?: string;
  requestedAmount?: number;
}): AtlasEntityReference {
  return {
    type: "supplement",
    id: sup._id,
    label: `Supplement for ${sup.claimNumber ?? "claim"}`,
    subtitle: sup.reason ?? sup.status?.replace(/_/g, " "),
    financialImpact: sup.requestedAmount ?? undefined,
    status: sup.status ?? undefined,
  };
}

/**
 * Create an entity reference from a workflow.
 */
export function createWorkflowReference(wf: {
  _id: string;
  name?: string | null;
  status?: string;
}): AtlasEntityReference {
  return {
    type: "workflow",
    id: wf._id,
    label: wf.name ?? "Unnamed workflow",
    subtitle: wf.status?.replace(/_/g, " "),
    href: "/dashboard/workflows",
    status: wf.status ?? undefined,
  };
}

/**
 * Create an entity reference from a knowledge entity.
 */
export function createKnowledgeReference(entity: {
  _id: string;
  name?: string | null;
  type?: string | null;
}): AtlasEntityReference {
  return {
    type: "knowledge",
    id: entity._id,
    label: entity.name ?? "Unnamed entity",
    subtitle: entity.type ?? undefined,
    href: `/dashboard/knowledge/${entity._id}`,
  };
}

// ---------------------------------------------------------------------------
// Entity Type Labels — human-readable names for each entity type
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  workspace: "Workspace",
  company: "Company",
  claim: "Claim",
  supplement: "Supplement",
  document: "Document",
  evidence: "Evidence",
  recommendation: "Recommendation",
  activity: "Activity",
  action: "Action",
  organization: "Organization",
  workflow: "Workflow",
  archive: "Archive",
  knowledge: "Knowledge",
  event: "Event",
  unknown: "Entity",
};

/**
 * Get a human-readable label for an entity type.
 */
export function getEntityTypeLabel(type: EntityType): string {
  return ENTITY_TYPE_LABELS[type] ?? "Entity";
}

/**
 * Convert an AtlasEntityType (from context) to a EntityType.
 */
export function entityTypeToReferenceType(entityType: AtlasEntityType): EntityType {
  const mapping: Record<AtlasEntityType, EntityType> = {
    workspace: "workspace",
    company: "company",
    claim: "claim",
    document: "document",
    knowledge: "knowledge",
    recommendation: "recommendation",
    workflow: "workflow",
    supplement: "supplement",
    evidence: "evidence",
    archive: "archive",
    unknown: "unknown",
  } as Record<AtlasEntityType, EntityType>;
  return mapping[entityType] ?? "unknown";
}

/**
 * Get the icon name for an entity type (for use with Lucide icons).
 */
export const ENTITY_TYPE_ICONS: Record<EntityType, string> = {
  workspace: "Building2",
  company: "Building2",
  claim: "Flame",
  supplement: "ClipboardCheck",
  document: "FileText",
  evidence: "Shield",
  recommendation: "Sparkles",
  organization: "Building2",
  activity: "Activity",
  action: "Zap",
  workflow: "GitBranch",
  archive: "Archive",
  knowledge: "Brain",
  event: "Calendar",
  unknown: "Circle",
};
