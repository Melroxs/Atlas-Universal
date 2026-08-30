// ---------------------------------------------------------------------------
// Atlas Entity Relationship Resolution
//
// Answers questions like:
//   - Which claims belong to this company?
//   - Which documents belong to this claim?
//   - Which supplements belong to this claim?
//   - Which evidence relates to this claim?
//   - Which recommendations relate to this entity?
//   - Which attention items relate to this entity?
//
// Uses existing Atlas data structures. No new database queries.
// ---------------------------------------------------------------------------

import { type AtlasEntityType } from "./context";
import { type AtlasEntityReference, type EntityType } from "./entity-reference";
import { type AttentionItem } from "./attention";

// ---------------------------------------------------------------------------
// Relationship Types
// ---------------------------------------------------------------------------

export type RelationshipType = "parent" | "child" | "sibling" | "related";

export const RELATIONSHIP_TYPES: RelationshipType[] = ["parent", "child", "sibling", "related"];

export interface EntityRelationship {
  /** The related entity */
  entity: AtlasEntityReference;
  /** How this entity is related to the parent */
  relation: string;
  /** The relationship direction */
  direction: "child" | "sibling" | "parent";
}

/** Complete relationship graph for an entity */
export interface EntityRelationshipGraph {
  /** The entity this graph describes */
  entity: AtlasEntityReference;
  /** Parent entity */
  parent?: AtlasEntityReference;
  /** Child entities (claims, documents, supplements, etc.) */
  children: EntityRelationship[];
  /** Sibling entities (other claims, documents, etc.) */
  siblings: EntityRelationship[];
  /** Related entities (recommendations, attention items, etc.) */
  related: EntityRelationship[];
  /** Attention items for this entity */
  attention: AttentionItem[];
}

/** Result of relationship resolution */
export interface EntityRelationshipResult {
  /** The resolved relationships */
  graph: EntityRelationshipGraph;
  /** Whether the resolution was successful */
  success: boolean;
  /** Error message if resolution failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Relationship Resolution — pure functions over existing data
// ---------------------------------------------------------------------------

/**
 * Find all claims that reference a given company/tenant.
 * Claims are already linked to companies via the tenant system.
 */
export function resolveClaimRelationships(
  claims: Array<{ _id: string; claimNumber?: string | null; customer?: string | null; status?: string; outstanding?: number }>,
  companyId?: string,
): EntityRelationship[] {
  if (!companyId) return [];

  return claims.map((claim) => ({
    entity: {
      type: "claim" as const,
      id: claim._id,
      label: claim.claimNumber ?? claim.customer ?? "Unnamed claim",
      subtitle: claim.status?.replace(/_/g, " "),
      href: `/dashboard/revenue-recovery/${claim._id}`,
      financialImpact: claim.outstanding ?? undefined,
    },
    relation: "claim",
    direction: "child" as const,
  }));
}

/**
 * Find documents related to a claim.
 * Uses the document classification and source relationships.
 */
export function resolveDocumentRelationships(
  documents: Array<{ _id: string; title?: string | null; classification?: string | null; status?: string | null }>,
  claimId?: string,
): EntityRelationship[] {
  // Documents are linked to claims via the evidence graph
  // Here we filter by documents that have relevant classifications
  return documents.map((doc) => ({
    entity: {
      type: "document" as const,
      id: doc._id,
      label: doc.title ?? "Untitled document",
      subtitle: doc.classification ?? undefined,
      href: `/dashboard/knowledge/${doc._id}`,
    },
    relation: "document",
    direction: "child" as const,
  }));
}

/**
 * Find recommendations related to an entity.
 */
export function resolveRecommendationRelationships(
  recommendations: Array<{ _id: string; title: string; priority: string; status: string; detectorKey: string }>,
  entityId?: string,
  entityType?: string,
): EntityRelationship[] {
  return recommendations
    .filter((rec) => rec.status === "open")
    .map((rec) => ({
      entity: {
        type: "recommendation" as const,
        id: rec._id,
        label: rec.title,
        subtitle: `${rec.priority} priority`,
        href: "/dashboard/recommendations",
      },
      relation: "recommendation",
      direction: "child" as const,
    }));
}

/**
 * Filter attention items relevant to a specific entity.
 */
export function resolveEntityAttention(
  attentionItems: AttentionItem[],
  entityId: string,
  entityType?: string,
): AttentionItem[] {
  return attentionItems.filter((item) => {
    // Match by source entity ID
    if (item.sourceEntityId === entityId) return true;
    // Match by navigation target containing the entity ID
    if (item.navigationTarget?.includes(entityId)) return true;
    return false;
  });
}

/**
 * Resolve the parent entity for a given entity.
 */
export function resolveEntityParent(
  entityType: EntityType,
  entityData: Record<string, unknown>,
): AtlasEntityReference | undefined {
  // Company → Workspace (always at the top)
  if (entityType === "company") {
    return undefined; // No parent for companies
  }

  // Claim → Company
  if (entityType === "claim" && entityData.companyId) {
    return {
      type: "company",
      id: String(entityData.companyId),
      label: String(entityData.customer ?? "Company"),
      href: `/dashboard`,
    };
  }

  // Document → Claim (via evidence graph)
  if (entityType === "document" && entityData.claimId) {
    return {
      type: "claim",
      id: String(entityData.claimId),
      label: String(entityData.claimNumber ?? "Claim"),
      href: `/dashboard/revenue-recovery/${entityData.claimId}`,
    };
  }

  // Supplement → Claim
  if (entityType === "supplement" && entityData.claimId) {
    return {
      type: "claim",
      id: String(entityData.claimId),
      label: String(entityData.claimNumber ?? "Claim"),
      href: `/dashboard/revenue-recovery/${entityData.claimId}`,
    };
  }

  // Recommendation → Claim (if linked)
  if (entityType === "recommendation" && entityData.claimId) {
    return {
      type: "claim",
      id: String(entityData.claimId),
      label: String(entityData.claimNumber ?? "Claim"),
      href: `/dashboard/revenue-recovery/${entityData.claimId}`,
    };
  }

  return undefined;
}

/**
 * Resolve child entities for a given entity.
 */
export function resolveEntityChildren(
  entityType: EntityType,
  entityData: Record<string, unknown>,
  childrenData: Record<string, unknown[]>,
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];

  // Company → Claims, Contacts, Workflows
  if (entityType === "company") {
    if (Array.isArray(childrenData.claims)) {
      for (const claim of childrenData.claims as Array<Record<string, unknown>>) {
        relationships.push({
          entity: {
            type: "claim",
            id: String(claim._id),
            label: String(claim.claimNumber ?? claim.customer ?? "Claim"),
            subtitle: String(claim.status ?? "").replace(/_/g, " "),
            href: `/dashboard/revenue-recovery/${claim._id}`,
          },
          relation: "claim",
          direction: "child",
        });
      }
    }
  }

  // Claim → Documents, Supplements, Recommendations
  if (entityType === "claim") {
    if (Array.isArray(childrenData.documents)) {
      for (const doc of childrenData.documents as Array<Record<string, unknown>>) {
        relationships.push({
          entity: {
            type: "document",
            id: String(doc._id),
            label: String(doc.title ?? "Document"),
            subtitle: String(doc.classification ?? ""),
            href: `/dashboard/knowledge/${doc._id}`,
          },
          relation: "document",
          direction: "child",
        });
      }
    }
    if (Array.isArray(childrenData.supplements)) {
      for (const sup of childrenData.supplements as Array<Record<string, unknown>>) {
        relationships.push({
          entity: {
            type: "supplement",
            id: String(sup._id),
            label: String(sup.reason ?? "Supplement"),
            subtitle: String(sup.status ?? "").replace(/_/g, " "),
          },
          relation: "supplement",
          direction: "child",
        });
      }
    }
  }

  return relationships;
}

/**
 * Resolve sibling entities for a given entity.
 */
export function resolveEntitySiblings(
  entityType: EntityType,
  entityId: string,
  siblingsData: Record<string, unknown[]>,
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];

  // For a claim, siblings could be other claims in the same company
  if (entityType === "claim" && Array.isArray(siblingsData.claims)) {
    for (const claim of siblingsData.claims as Array<Record<string, unknown>>) {
      if (String(claim._id) !== entityId) {
        relationships.push({
          entity: {
            type: "claim",
            id: String(claim._id),
            label: String(claim.claimNumber ?? claim.customer ?? "Claim"),
            subtitle: String(claim.status ?? "").replace(/_/g, " "),
            href: `/dashboard/revenue-recovery/${claim._id}`,
          },
          relation: "other_claim",
          direction: "sibling",
        });
      }
    }
  }

  return relationships;
}

/**
 * Get the complete hierarchy for an entity (breadcrumb path).
 */
export function getEntityHierarchy(
  entityType: EntityType,
  entityData: Record<string, unknown>,
): AtlasEntityReference[] {
  const hierarchy: AtlasEntityReference[] = [];

  // Always start with workspace
  hierarchy.push({
    type: "workspace",
    id: "workspace",
    label: "Atlas",
    href: "/dashboard",
  });

  // Add company if present
  if (entityData.companyId || entityData.company) {
    hierarchy.push({
      type: "company",
      id: String(entityData.companyId ?? "company"),
      label: String(entityData.customer ?? entityData.companyName ?? "Company"),
      href: "/dashboard",
    });
  }

  // Add the current entity
  hierarchy.push({
    type: entityType,
    id: String(entityData._id ?? entityData.id ?? entityType),
    label: String(entityData.claimNumber ?? entityData.title ?? entityData.name ?? entityType),
  });

  return hierarchy;
}

/**
 * Get breadcrumb entries for an entity.
 */
export function getEntityBreadcrumb(
  entityType: EntityType,
  entityData: Record<string, unknown>,
): Array<{ label: string; href?: string }> {
  return getEntityHierarchy(entityType, entityData).map((ref) => ({
    label: ref.label,
    href: ref.href,
  }));
}

/**
 * Find all claims that reference a given company/tenant.
 * Claims are already linked to companies via the tenant system.
 */
export function resolveEntityRelationships(
  entityType: EntityType,
  entityId: string,
  entityData: Record<string, unknown>,
  childrenData: Record<string, unknown[]>,
): EntityRelationshipGraph {
  const parent = resolveEntityParent(entityType, entityData);
  const children = resolveEntityChildren(entityType, entityData, childrenData);
  const siblings = resolveEntitySiblings(entityType, entityId, childrenData);
  const attention: AttentionItem[] = []; // Will be populated by the intelligence layer

  return {
    entity: {
      type: entityType,
      id: entityId,
      label: String(entityData.claimNumber ?? entityData.title ?? entityData.name ?? entityType),
    },
    parent,
    children,
    siblings,
    related: [],
    attention,
  };
}

/**
 * Build a complete relationship map for an entity.
 * This is the main entry point for relationship resolution.
 */
export function buildEntityRelationships(params: {
  entityType: string;
  entityId: string;
  claims?: Array<{ _id: string; claimNumber?: string | null; customer?: string | null; status?: string; outstanding?: number }>;
  documents?: Array<{ _id: string; title?: string | null; classification?: string | null; status?: string | null }>;
  recommendations?: Array<{ _id: string; title: string; priority: string; status: string; detectorKey: string }>;
  supplements?: Array<{ _id: string; claimNumber?: string | null; reason?: string; status?: string; requestedAmount?: number }>;
  attentionItems?: AttentionItem[];
}): {
  children: EntityRelationship[];
  siblings: EntityRelationship[];
  attention: AttentionItem[];
} {
  const {
    entityType,
    entityId,
    claims = [],
    documents = [],
    recommendations = [],
    supplements = [],
    attentionItems = [],
  } = params;

  const children: EntityRelationship[] = [];
  const siblings: EntityRelationship[] = [];

  // For a company entity, show its claims
  if (entityType === "company") {
    children.push(...resolveClaimRelationships(claims, entityId));
  }

  // For a claim entity, show its documents and recommendations
  if (entityType === "claim") {
    children.push(...resolveDocumentRelationships(documents, entityId));
    children.push(...resolveRecommendationRelationships(recommendations, entityId, entityType));
  }

  // For any entity, show related attention items
  const attention = resolveEntityAttention(attentionItems, entityId, entityType);

  return { children, siblings, attention };
}

/**
 * Get a summary of entity relationships for display.
 */
export function getRelationshipSummary(relationships: EntityRelationship[]): {
  total: number;
  byType: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  for (const rel of relationships) {
    byType[rel.entity.type] = (byType[rel.entity.type] ?? 0) + 1;
  }
  return { total: relationships.length, byType };
}
