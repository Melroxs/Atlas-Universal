// ---------------------------------------------------------------------------
// Atlas Context Provider
//
// Makes Atlas entity-aware: when the user is viewing a claim, company,
// document, or other entity, downstream components (Ask Atlas, attention
// items, recommendations) can access that context without prop drilling.
//
// This is a lightweight React context — NOT a global state manager.
// ---------------------------------------------------------------------------

import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AtlasEntityType =
  | "workspace"
  | "claim"
  | "company"
  | "document"
  | "knowledge"
  | "recommendation"
  | "workflow"
  | "supplement"
  | "evidence"
  | "archive"
  | "unknown";

export interface AtlasEntity {
  id: string;
  type: AtlasEntityType;
  name?: string;
  /** Additional metadata from the current page (claim number, status, etc.) */
  meta?: Record<string, unknown>;
}

/** Atlas Investigation Context — carries the full investigation state across routes */
export interface AtlasInvestigation {
  /** The entity being investigated */
  entity: AtlasEntity;
  /** The originating insight or signal that led to this investigation */
  originatingInsight?: {
    title: string;
    description?: string;
    financialImpact?: number;
    severity?: string;
  };
  /** Atlas's assessment of the entity */
  assessment?: string;
  /** Confidence level */
  confidence?: "high" | "medium" | "low";
  /** Key evidence items supporting the assessment */
  evidenceSummary?: Array<{ title: string; classification?: string; relevance?: string }>;
  /** Evidence gaps identified */
  gaps?: Array<{ label: string; severity: "critical" | "warning" | "info"; description?: string }>;
  /** Atlas recommendation */
  recommendation?: string;
  /** Where to return — the originating route/context */
  returnTo?: { label: string; path: string };
}

/** A lightweight breadcrumb step for context-aware navigation. */
export interface AtlasBreadcrumb {
  label: string;
  href?: string;
  /** Whether this step is the current (active) location */
  active?: boolean;
}

/** Workspace health snapshot — derived from existing data queries. */
export interface WorkspaceHealth {
  /** Number of documents in the knowledge base */
  documents: number;
  /** Number of entities extracted */
  entities: number;
  /** Number of open recommendations/signals */
  openSignals: number;
  /** Number of active workflows */
  activeWorkflows: number;
  /** Number of open claims */
  openClaims: number;
  /** Whether the pipeline is currently processing */
  pipelineActive: boolean;
}

/** Entity relationship for the unified entity model */
export interface EntityRelationship {
  /** The related entity */
  entity: AtlasEntity;
  /** The relationship type */
  relationship: "parent" | "child" | "sibling" | "related";
  /** The relationship label */
  label: string;
}

/** Entity timeline entry */
export interface EntityTimelineEntry {
  id: string;
  type: "human_action" | "atlas_discovery" | "system_event" | "external_activity";
  label: string;
  detail?: string;
  timestamp: string;
  entityId?: string;
  entityType?: AtlasEntityType;
}

export interface AtlasContextValue {
  /** The current workspace/tenant */
  workspace: { id: string; name: string } | null;
  /** The entity currently being viewed (if any) */
  entity: AtlasEntity | null;
  /** The current Atlas investigation context */
  investigation: AtlasInvestigation | null;
  /** Set investigation context */
  setInvestigation: (investigation: AtlasInvestigation | null) => void;
  /** The parent entity (if navigating a hierarchy) */
  parentEntity: AtlasEntity | null;
  /** Set parent entity context */
  setParentEntity: (entity: AtlasEntity | null) => void;
  /** Related entity IDs (for relationship navigation) */
  relatedEntities: AtlasEntity[];
  /** Set related entities */
  setRelatedEntities: (entities: AtlasEntity[]) => void;
  /** Entity relationships (for relationship navigation) */
  entityRelationships: EntityRelationship[];
  /** Set entity relationships */
  setEntityRelationships: (relationships: EntityRelationship[]) => void;
  /** Entity timeline entries */
  entityTimeline: EntityTimelineEntry[];
  /** Set entity timeline entries */
  setEntityTimeline: (entries: EntityTimelineEntry[]) => void;
  /** Current route path */
  routePath: string;
  /** Set entity context from page components */
  setEntity: (entity: AtlasEntity | null) => void;
  /** Whether the user is in an entity-focused view */
  isEntityFocused: boolean;
  /** Breadcrumb trail for context-aware navigation */
  breadcrumbs: AtlasBreadcrumb[];
  /** Set breadcrumbs from page components */
  setBreadcrumbs: (crumbs: AtlasBreadcrumb[]) => void;
  /** Workspace health snapshot */
  health: WorkspaceHealth;
  /** Update workspace health from data queries */
  setHealth: (health: Partial<WorkspaceHealth>) => void;
  /** Entity attention items (filtered for current entity) */
  entityAttentionCount: number;
  /** Set entity attention count */
  setEntityAttentionCount: (count: number) => void;
}

const AtlasContext = createContext<AtlasContextValue | null>(null);

// ---------------------------------------------------------------------------
// Route → entity type mapping
// ---------------------------------------------------------------------------

const ROUTE_ENTITY_MAP: Array<{ pattern: RegExp; type: AtlasEntityType }> = [
  // Entity routes — actual Atlas entities the user investigates
  { pattern: /^\/dashboard\/revenue-recovery\/.+/, type: "claim" },
  { pattern: /^\/dashboard\/revenue-recovery$/, type: "claim" },
  { pattern: /^\/dashboard\/knowledge\/archives\/.+/, type: "archive" },
  { pattern: /^\/dashboard\/knowledge\/.+/, type: "knowledge" },
  { pattern: /^\/dashboard\/knowledge$/, type: "knowledge" },
  { pattern: /^\/dashboard\/recommendations$/, type: "recommendation" },
  { pattern: /^\/dashboard\/workflows\/.+/, type: "workflow" },
  { pattern: /^\/dashboard\/workflows$/, type: "workflow" },
  { pattern: /^\/dashboard\/brain$/, type: "knowledge" },
  { pattern: /^\/dashboard\/intelligence$/, type: "knowledge" },
  // Note: /dashboard/control, /dashboard/authority, /dashboard/connections,
  // /dashboard/team, /dashboard/audit, /dashboard/settings, /dashboard/actions,
  // /dashboard/users are admin/control surfaces, NOT entities.
  // They map to "unknown" by default and should NOT be added here.
];

// ---------------------------------------------------------------------------
// Investigation persistence (sessionStorage)
// ---------------------------------------------------------------------------

const INVESTIGATION_KEY_PREFIX = "atlas:investigation";

function getStorageKey(tenantId?: string | null): string {
  // Scope investigation persistence to tenant to prevent cross-organization leaks
  return tenantId ? `${INVESTIGATION_KEY_PREFIX}:${tenantId}` : INVESTIGATION_KEY_PREFIX;
}

function loadInvestigation(tenantId?: string | null): AtlasInvestigation | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const key = getStorageKey(tenantId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.entity && parsed.entity.id) {
      return parsed as AtlasInvestigation;
    }
    return null;
  } catch {
    return null;
  }
}

function saveInvestigation(inv: AtlasInvestigation | null, tenantId?: string | null): void {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    const key = getStorageKey(tenantId);
    if (inv) {
      window.sessionStorage.setItem(key, JSON.stringify(inv));
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable or full — silently ignore
  }
}

function clearInvestigation(tenantId?: string | null): void {
  saveInvestigation(null, tenantId);
}

function inferEntityType(path: string): AtlasEntityType {
  for (const { pattern, type } of ROUTE_ENTITY_MAP) {
    if (pattern.test(path)) return type;
  }
  if (path === "/dashboard") return "workspace";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Default health
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH: WorkspaceHealth = {
  documents: 0,
  entities: 0,
  openSignals: 0,
  activeWorkflows: 0,
  openClaims: 0,
  pipelineActive: false,
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AtlasContextProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const params = useParams();
  const { user } = useAuth();
  // Scope investigation persistence to tenant to prevent cross-org leaks
  const tenantId = user?.tenant_id ?? user?.id ?? null;
  const [entityOverride, setEntityOverride] = useState<AtlasEntity | null>(null);
  const [investigation, setInvestigation] = useState<AtlasInvestigation | null>(() => loadInvestigation(tenantId));
  const investigationRef = useRef(investigation);
  const [parentEntity, setParentEntity] = useState<AtlasEntity | null>(null);

  // Persist investigation to sessionStorage whenever it changes
  useEffect(() => {
    investigationRef.current = investigation;
    saveInvestigation(investigation, tenantId);
  }, [investigation, tenantId]);

  // When tenant changes (sign out, switch org), clear stale investigation
  useEffect(() => {
    setInvestigation((prev) => {
      const hydrated = loadInvestigation(tenantId);
      // If hydrated is null and we had something, it's a new tenant — start fresh
      return hydrated ?? null;
    });
  }, [tenantId]);

  // Wrapped setter that also clears sessionStorage on null
  const setInvestigationPersisted = useCallback((inv: AtlasInvestigation | null) => {
    setInvestigation(inv);
    saveInvestigation(inv, tenantId);
  }, [tenantId]);
  const [relatedEntities, setRelatedEntities] = useState<AtlasEntity[]>([]);
  const [entityRelationships, setEntityRelationships] = useState<EntityRelationship[]>([]);
  const [entityTimeline, setEntityTimeline] = useState<EntityTimelineEntry[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<AtlasBreadcrumb[]>([]);
  const [health, setHealthState] = useState<WorkspaceHealth>(DEFAULT_HEALTH);
  const [entityAttentionCount, setEntityAttentionCount] = useState(0);

  const setHealth = useCallback((partial: Partial<WorkspaceHealth>) => {
    setHealthState((prev) => ({ ...prev, ...partial }));
  }, []);

  const value = useMemo<AtlasContextValue>(() => {
    const path = location.pathname;

    // If a page has explicitly set an entity, use that
    if (entityOverride) {
      return {
        workspace: null,
        entity: entityOverride,
        investigation,
        setInvestigation: setInvestigationPersisted,
        parentEntity,
        setParentEntity,
        relatedEntities,
        setRelatedEntities,
        entityRelationships,
        setEntityRelationships,
        entityTimeline,
        setEntityTimeline,
        routePath: path,
        setEntity: setEntityOverride,
        isEntityFocused: true,
        breadcrumbs,
        setBreadcrumbs,
        health,
        setHealth,
        entityAttentionCount,
        setEntityAttentionCount,
      };
    }

    // Infer from route params
    const entityType = inferEntityType(path);
    const idParam = params.id as string | undefined;

    const entity: AtlasEntity | null = idParam
      ? { id: idParam, type: entityType }
      : entityType !== "unknown"
        ? { id: path, type: entityType }
        : null;

    return {
      workspace: null,
      entity: investigation?.entity ?? entity,
      investigation,
      setInvestigation: setInvestigationPersisted,
      parentEntity,
      setParentEntity,
      relatedEntities,
      setRelatedEntities,
      entityRelationships,
      setEntityRelationships,
      entityTimeline,
      setEntityTimeline,
      routePath: path,
      setEntity: setEntityOverride,
      isEntityFocused: entity !== null,
      breadcrumbs,
      setBreadcrumbs,
      health,
      setHealth,
      entityAttentionCount,
      setEntityAttentionCount,
    };
  }, [location.pathname, params.id, entityOverride, investigation, setInvestigationPersisted, parentEntity, relatedEntities, entityRelationships, entityTimeline, breadcrumbs, health, setHealth, entityAttentionCount, setEntityAttentionCount]);

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAtlasContext(): AtlasContextValue {
  const ctx = useContext(AtlasContext);
  if (!ctx) {
    // Graceful fallback — works outside the provider (e.g. landing page)
    return {
      workspace: null,
      entity: null,
      investigation: null,
      setInvestigation: () => {}, // noop outside provider
      parentEntity: null,
      setParentEntity: () => {},
      relatedEntities: [],
      setRelatedEntities: () => {},
      entityRelationships: [],
      setEntityRelationships: () => {},
      entityTimeline: [],
      setEntityTimeline: () => {},
      routePath: typeof window !== "undefined" ? window.location.pathname : "/",
      setEntity: () => {},
      isEntityFocused: false,
      breadcrumbs: [],
      setBreadcrumbs: () => {},
      health: DEFAULT_HEALTH,
      setHealth: () => {},
      entityAttentionCount: 0,
      setEntityAttentionCount: () => {},
    };
  }
  return ctx;
}

/**
 * Set entity context from a page component. Call this in a useEffect or
 * event handler to tell Atlas what the user is currently focused on.
 *
 * @example
 * const { setEntity } = useAtlasContext();
 * useEffect(() => {
 *   setEntity({ id: claimId, type: "claim", name: claimNumber });
 *   return () => setEntity(null);
 * }, [claimId]);
 */
export function useEntityScope(entity: AtlasEntity | null) {
  const { setEntity } = useAtlasContext();
  useMemo(() => {
    setEntity(entity);
  }, [entity, setEntity]);
}
