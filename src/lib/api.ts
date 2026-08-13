// ---------------------------------------------------------------------------
// Atlas function registry — the single contract between the frontend and the
// Supabase backend.
//
// Every entry maps to one of:
//   query    — Postgres RPC (read), returns jsonb
//   mutation — Postgres RPC (write), returns jsonb
//   edge     — Supabase Edge Function (external API / heavy compute)
//   client   — pure client-side implementation (deterministic, no backend)
//
// RPC names are `snake_case` functions defined in supabase/migrations/.
// Edge functions live in supabase/functions/<name>/index.ts.
//
// TResult is the shape the page consumes. RPC results are jsonb, so the
// shapes below are the typed contract (the old Convex codegen equivalent).
// ---------------------------------------------------------------------------

import {
  enrichClaimFromEvidence,
  type ClaimSnapshot,
  type EvidenceDocLike,
} from "@/lib/insurance/logic";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";

export type FnKind = "query" | "mutation" | "edge" | "client";

/** Loose jsonb object. */
export type Obj = Record<string, any>;
/** Loose jsonb array of objects. */
export type ObjArray = Obj[];

export interface ApiFn<TResult = any> {
  name: string;
  kind: FnKind;
  clientImpl?: (args?: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Post-processes the RPC result into the shape the page consumes. */
  transform?: (data: unknown) => unknown;
}

/**
 * Priority used when sorting claim evidence for enrichment: financial and
 * estimating documents (estimate/xactimate/invoice/payment) are the ones the
 * amount analyzers can actually read, so they are fetched first and never
 * dropped by the detail-fetch cap. Scope/policy/supporting docs follow.
 */
function evidencePriority(classification?: string | null): number {
  const c = (classification ?? "").toLowerCase();
  if (/(estimate|xactimate|invoice|financial|ledger|payment)/.test(c)) return 5;
  if (/scope/.test(c)) return 4;
  if (/policy/.test(c)) return 3;
  if (/(photo|image)/.test(c)) return 2;
  if (/(report|communication|correspondence|supplement|regulatory|claim)/.test(c)) return 1;
  return 0;
}

export interface TenantDocRow {
  _id: string;
  title?: string | null;
  sourceId?: string | null;
  summary?: string | null;
  classification?: string | null;
}

/**
 * List the tenant's documents for claim grounding.
 *
 * The documents_list_documents RPC caps its result at the 80 most recent
 * rows, which hides claim evidence that was ingested earlier (a real archive
 * can easily exceed that). Reading the tenant's own documents through the
 * authenticated REST client (RLS-scoped) removes the cap; the RPC remains as
 * a fallback if the direct read is ever unavailable.
 */
async function listTenantDocsForClaim(
  supabase: SupabaseClient,
): Promise<TenantDocRow[]> {
  try {
    const { data, error } = await supabase
      .from("documents")
      .select("_id, title, sourceId, summary, classification")
      .limit(1000);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data as TenantDocRow[];
    }
  } catch {
    // fall through to the RPC below
  }
  return ((await rpcCall(supabase, "documents_list_documents")) ?? []) as TenantDocRow[];
}

function def<TResult = any>(
  name: string,
  kind: FnKind,
  clientImpl?: ApiFn<TResult>["clientImpl"],
): ApiFn<TResult> {
  return { name, kind, clientImpl } as ApiFn<TResult>;
}

function defT<TResult = any>(
  name: string,
  kind: FnKind,
  transform: ApiFn<TResult>["transform"],
  clientImpl?: ApiFn<TResult>["clientImpl"],
): ApiFn<TResult> {
  return { name, kind, transform, clientImpl } as ApiFn<TResult>;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** profiles row (users_current_user). */
export interface UserRow {
  _id: string;
  _creationTime?: number;
  name?: string | null;
  image?: string | null;
  email?: string | null;
  emailVerificationTime?: number | null;
  isAnonymous?: boolean;
  role?: string | null;
  [k: string]: any;
}

/** tenants_get_my_workspace. */
export interface WorkspaceShape {
  tenant: Obj | null;
  profile: Obj | null;
  membership: Obj | null;
  systems: ObjArray;
  packs: ObjArray;
  members: ObjArray;
  invites: ObjArray;
  [k: string]: any;
}

/** A knowledge/claim document. */
export interface DocShape extends Obj {
  _id: string;
  _creationTime?: number;
  title?: string;
  fileName?: string;
  status?: string;
  [k: string]: any;
}

/** connections_list_catalog entry — mirrors the page's local CatalogEntry. */
export interface CatalogEntryShape extends Obj {
  id: string;
  name: string;
  category: string;
  authType: "oauth2" | "api_key" | "none";
  capabilities: string[];
  requiredEnvVars: string[];
  oauthScopes: string[];
  configured: boolean;
  missingEnvVars: string[];
  displayStatus: string;
  setupInstructions: string;
  docsUrl: string | null;
  connection: any;
}

/** insurance_recovery_analytics item shapes. */
export interface RecoveryTrendPointShape extends Obj {
  month: string;
  label: string;
  claimsCreated: number;
  findingsOpened: number;
  supplementsSubmitted: number;
}

export interface CarrierRecoveryRowShape extends Obj {
  carrier: string;
  claimCount: number;
  outstanding: number;
  potential: number;
}

export interface LifecycleStageShape extends Obj {
  status: string;
  label: string;
  count: number;
}

/** insurance_get_claim_package. */
export interface ClaimPackageShape extends Obj {
  claim: Obj;
  supplements: ObjArray;
  findings: Array<Obj & { evidence: string[] }>;
  evidenceDocs: ObjArray;
  completeness: Obj & {
    score: number;
    complete: number;
    total: number;
    categories: Array<Obj & { key: string; label: string; note: string }>;
  };
  reconciliation: Obj & {
    outstanding: number;
    notes: string[];
  };
  timeline: ObjArray;
  packageModel: Obj & {
    fields: Array<Obj & { key: string; label: string; value?: string }>;
  };
}

/** insurance_get_supplement_document. */
export interface SupplementDocumentShape extends Obj {
  status?: string;
  requestedAmount?: number;
  disclaimer: string;
  sections: Array<{ title: string; body: string[] }>;
}

/** archive_get_detail. */
export interface ArchiveDetailShape extends Obj {
  archive: Obj & {
    warnings: string[];
    stats: Obj;
    status: string;
  };
  files: ObjArray;
  docs: Obj;
  candidates: ObjArray;
}

/** Tool schema — mirrors the page's local ToolRow (tools_list). */
export interface ToolFieldShape {
  key: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  description: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  longText?: boolean;
  [k: string]: any;
}

export interface ToolRowShape extends Obj {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string | null;
  version: string;
  capabilities: string[];
  riskLevel: string;
  riskLabel: string;
  confirmationRequired: boolean;
  policyReason: string;
  implementationStatus: string;
  minRole: string;
  inputFields: ToolFieldShape[];
  requiredScopes: string[];
  documentationUrl: string | null;
  enabled: boolean;
  connected: boolean;
  scopesOk: boolean;
  canRun: boolean;
}

/** everest_list_authoritative_knowledge. */
export interface AuthoritativeKnowledgeShape extends Obj {
  jurisdiction: Obj;
  tiers: Obj;
  sources: ObjArray;
  knowledge: ObjArray;
}

/** everest_authority_monitor. */
export interface AuthorityMonitorShape extends Obj {
  now: number;
  sources: Array<
    Obj & {
      recentChecks: ObjArray;
      sourceId: string;
      name: string;
    }
  >;
}

/** everest_get_organization_context. */
export interface OrganizationContextShape extends Obj {
  context: Obj | null;
  organization: Obj;
  locations: ObjArray;
  user: Obj | null;
  timezoneNote?: string | null;
}

/** everest_get_industry_coverage. */
export interface IndustryCoverageShape extends Obj {
  coverage: Array<
    Obj & {
      name: string;
      overall: string;
      note: string;
      axes: ObjArray;
    }
  >;
}

/** everest_get_industry_excellence. */
export interface IndustryExcellenceShape extends Obj {
  excellence: ObjArray;
}

/** everest_get_value_intelligence. */
export interface ValueIntelligenceShape extends Obj {
  engine:
    | (Obj & {
        detectionSignals: string[];
        evidenceRequirements: string[];
        recommendedActions: string[];
        limitations: string[];
        affectedEntities: string[];
        calculationMethod: string;
        measurableOutcome: string;
      })
    | null;
  opportunities: ObjArray;
}

/** everest_get_insurance_intelligence. */
export interface EverestInsuranceShape extends Obj {
  lifecycle: Array<{ stage: string; description: string }>;
  evidenceCategories: Array<{
    key: string;
    name: string;
    description: string;
    examples: string[];
  }>;
  baseline: Obj & {
    entities: ObjArray;
    knowledgeKinds: Obj & {
      domain: string[];
      organization: string[];
      evidence: string[];
    };
  };
}

/** everest_business_brain (client-built from static atlas data). */
export interface BusinessBrainShape extends Obj {
  businessTypes: ObjArray;
  financialKnowledge: Obj & {
    revenue: ObjArray;
    expenses: ObjArray;
    profitability: ObjArray;
    incomeStatementFlow: ObjArray;
    accountingIdentity: Obj;
  };
  orgRoles: ObjArray;
  businessObjects: ObjArray;
  lifecycles: Array<Obj & { stages: string[] }>;
  maturity: ObjArray;
  orgStructures: ObjArray;
  businessFunctions: ObjArray;
  disambiguation?: Obj;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const api = {
  users: {
    currentUser: def<UserRow | null>("users_current_user", "query"),
  },
  authStatus: {
    authStatus: def<{ supabaseConfigured: boolean; guestConfigured: boolean; authUsable: boolean }>(
      "auth_status",
      "query",
    ),
  },
  tenants: {
    getMyWorkspace: def<WorkspaceShape | null>("tenants_get_my_workspace", "query"),
    createTenant: def<{ tenantId: string }>("tenants_create_tenant", "mutation"),
    inviteMember: def<Obj>("tenants_invite_member", "mutation"),
    claimInvites: def<{ claimed: number }>("tenants_claim_invites", "mutation"),
    updateMemberRole: def<{ ok: boolean }>("tenants_update_member_role", "mutation"),
    removeMember: def<{ ok: boolean }>("tenants_remove_member", "mutation"),
  },
  onboarding: {
    updateCompanyProfile: def<{ ok: boolean }>("onboarding_update_company_profile", "mutation"),
    saveCompanySystem: def<{ ok: boolean }>("onboarding_save_company_system", "mutation"),
    completeOnboarding: def<{ ok: boolean }>("onboarding_complete_onboarding", "mutation"),
  },
  intelligence: {
    seedIntelligence: def<{ seeded: number }>(
      "intelligence_seed_packs",
      "client",
      async () => {
        const [{ PACK_SEEDS }, { getSupabaseClient }] = await Promise.all([
          import("@/lib/atlas-data/packs"),
          import("@/lib/supabase"),
        ]);
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Supabase is not configured.");
        const { data, error } = await supabase.rpc("intelligence_seed_packs", {
          p_packs: PACK_SEEDS,
        });
        if (error) throw error;
        return data as { seeded: number };
      },
    ),
    listWorkspacePacks: def<ObjArray>("intelligence_list_workspace_packs", "query"),
    listPackItems: def<ObjArray>("intelligence_list_pack_items", "query"),
    setPackActivation: def<{ activatedPacks: Obj }>("intelligence_set_pack_activation", "mutation"),
  },
  documents: {
    listDocuments: def<DocShape[]>("documents_list_documents", "query"),
    documentStats: def<Obj>("documents_document_stats", "query"),
    getDocument: def<DocShape | null>("documents_get_document", "query"),
    getDocumentDetail: def<{
      doc: DocShape;
      chunks: ObjArray;
      entities: ObjArray;
      assertions: ObjArray;
    } | null>("documents_get_document_detail", "query"),
    deleteDocument: def<{ ok: boolean }>("documents_delete_document", "mutation"),
  },
  ingestion: {
    processDocument: def<{ ok: boolean; docId?: string; warnings?: string[] }>(
      "ingestion_process_document",
      "client",
      async (args) => {
        const { processDocumentClient } = await import("@/lib/actions/ingestion");
        const a = (args ?? {}) as Record<string, unknown>;
        const result = await processDocumentClient({
          storagePath: String(a.storageId ?? a.storagePath ?? ""),
          title: String(a.title ?? "Untitled document"),
          mimeType: String(a.mimeType ?? "application/octet-stream"),
          size: Number(a.size ?? 0),
          sourceType: String(a.sourceType ?? "upload"),
        });
        return { ok: true, docId: result.docId };
      },
    ),
    reprocessDocument: def<{ ok: boolean }>(
      "ingestion_reprocess_document",
      "client",
      async (args) => {
        const { processDocumentClient } = await import("@/lib/actions/ingestion");
        const a = (args ?? {}) as Record<string, unknown>;
        await processDocumentClient({
          storagePath: String(a.storageId ?? a.storagePath ?? ""),
          title: String(a.title ?? "Untitled document"),
          mimeType: String(a.mimeType ?? "application/octet-stream"),
          size: Number(a.size ?? 0),
          sourceType: String(a.sourceType ?? "upload"),
        });
        return { ok: true };
      },
    ),
  },
  knowledge: {
    listEntities: def<ObjArray>("knowledge_list_entities", "query"),
    entityStats: def<Obj & { typeCounts: Record<string, number> }>(
      "knowledge_entity_stats",
      "query",
    ),
    getEntity: def<{
      entity: Obj;
      relationships: ObjArray;
      assertions: ObjArray;
    } | null>("knowledge_get_entity", "query"),
    listAssertions: def<ObjArray>("knowledge_list_assertions", "query"),
    graphSnapshot: def<{
      nodes: Array<{ id: string; type: string }>;
      edges: Array<{ source: string; target: string }>;
    }>("knowledge_graph_snapshot", "query"),
    confirmEntity: def<{ ok: boolean }>("knowledge_confirm_entity", "mutation"),
  },
  recommendations: {
    listRecommendations: def<Array<Obj & { evidence: ObjArray }>>(
      "recommendations_list",
      "query",
    ),
    recommendationCounts: def<Obj>("recommendations_counts", "query"),
    runDetectors: def<Obj>(
      "recommendations_run_detectors",
      "client",
      async () => {
        const { runDetectorsClient } = await import("@/lib/actions/detectors");
        return runDetectorsClient();
      },
    ),
    approveRecommendation: def<{ ok: boolean }>("recommendations_decide", "mutation"),
    rejectRecommendation: def<{ ok: boolean }>("recommendations_decide", "mutation"),
    dismissRecommendation: def<{ ok: boolean }>("recommendations_decide", "mutation"),
    markExecuted: def<{ ok: boolean }>("recommendations_decide", "mutation"),
  },
  history: {
    listAskSessions: def<ObjArray>("history_list_ask_sessions", "query"),
    recentActivity: def<ObjArray>("history_recent_activity", "query"),
  },
  audit: {
    listAuditLogs: def<ObjArray>("audit_list_logs", "query"),
  },
  archive: {
    listArchives: def<ObjArray>("archive_list", "query"),
    archiveStats: def<Obj>("archive_stats", "query"),
    getArchiveDetail: def<ArchiveDetailShape | null>("archive_get_detail", "query"),
    beginArchive: def<{ archiveId: string }>("archive_begin", "mutation"),
    submitInventoryBatch: def<{ ok: boolean }>("archive_submit_inventory_batch", "mutation"),
    beginProcessing: def<{ ok: boolean; ingested: number; failed: number }>(
      "archive_begin_processing",
      "client",
      async (args) => {
        const { beginProcessingClient } = await import("@/lib/actions/archive");
        return beginProcessingClient({
          archiveId: String((args ?? {}).archiveId ?? ""),
        });
      },
    ),
    cancelArchive: def<{ ok: boolean }>("archive_cancel", "mutation"),
    retryFiles: def<{ ok: boolean; requeued: number }>(
      "archive_retry_files",
      "client",
      async (args) => {
        const { retryFilesClient } = await import("@/lib/actions/archive");
        return retryFilesClient({
          archiveId: String((args ?? {}).archiveId ?? ""),
          fileIds: ((args ?? {}).fileIds as string[]) ?? [],
        });
      },
    ),
    deleteArchive: def<{ ok: boolean }>("archive_delete", "mutation"),
  },
  events: {
    listEvents: def<ObjArray>("events_list", "query"),
    getEventDetail: def<Obj | null>("events_get_detail", "query"),
    eventStats: def<Obj>("events_stats", "query"),
    listEventPolicies: def<ObjArray>("events_list_policies", "query"),
    listNotifications: def<ObjArray>("events_list_notifications", "query"),
    retryEvent: def<Obj>("events_retry", "mutation"),
    setEventPolicy: def<{ ok: boolean }>("events_set_policy", "mutation"),
    markNotificationRead: def<{ ok: boolean }>("events_mark_notification_read", "mutation"),
  },
  workflows: {
    listWorkflowDefinitions: def<ObjArray>("workflows_list_definitions", "query"),
    getWorkflowDetail: def<Obj | null>("workflows_get_detail", "query"),
    listWorkflowInstances: def<ObjArray>("workflows_list_instances", "query"),
    getWorkflowInstanceDetail: def<Obj | null>("workflows_get_instance_detail", "query"),
    listWorkflowApprovals: def<ObjArray>("workflows_list_approvals", "query"),
    workflowStats: def<Obj>("workflows_stats", "query"),
    setWorkflowSetting: def<{ ok: boolean }>("workflows_set_setting", "mutation"),
    decideWorkflowApproval: def<Obj>("workflows_decide_approval", "mutation"),
    cancelWorkflowInstance: def<Obj>("workflows_cancel_instance", "mutation"),
    retryWorkflowInstance: def<Obj>("workflows_retry_instance", "mutation"),
  },
  connections: {
    listConnectorCatalog: def<CatalogEntryShape[]>("connections_list_catalog", "query"),
    beginGoogleDriveOAuth: def<Obj>("connections_begin_google_drive_oauth", "mutation"),
    disconnectGoogleDrive: def<{ ok: boolean }>("connections_disconnect_google_drive", "mutation"),
  },
  connectionsSync: {
    syncGoogleDrive: def<Obj>("connections-sync-google-drive", "edge"),
    testConnection: def<Obj>("connections-test-connection", "edge"),
    runDueSyncs: def<{ ok: boolean }>("connections-run-due-syncs", "edge"),
  },
  insurance: {
    claims: {
      listClaims: def<ObjArray>("insurance_list_claims", "query"),
      getClaimPackage: def<ClaimPackageShape | null>("insurance_get_claim_package", "query"),
      getClaimTimeline: def<ObjArray>("insurance_get_claim_timeline", "query"),
      getSupplementDocument: def<SupplementDocumentShape | null>(
        "insurance_get_supplement_document",
        "query",
      ),
      claimCounts: def<Obj & { recoveryPipeline: string[] }>(
        "insurance_claim_counts",
        "query",
      ),
      recoveryAnalytics: def<
        Obj & {
          recoveryPipeline: string[];
          trend: RecoveryTrendPointShape[];
          carriers: CarrierRecoveryRowShape[];
          statusDistribution: LifecycleStageShape[];
        }
      >("insurance_recovery_analytics", "query"),
      analyzeAllClaims: def<Obj>("insurance_analyze_all_claims", "query"),
      insuranceIntelligence: def<Obj>(
        "insurance_intelligence",
        "client",
        async () => ({
          summary: "",
          carriers: [],
          statusDistribution: [],
          recoveryPipeline: [],
          trend: [],
        }),
      ),
      createClaim: def<Obj>("insurance_create_claim", "mutation"),
      updateClaim: def<{ ok: boolean }>("insurance_update_claim", "mutation"),
      attachClaimEvidence: def<{ ok: boolean }>("insurance_attach_claim_evidence", "mutation"),
      runClaimAnalysis: def<{ ok: boolean; findings: number; evidence: number }>(
        "insurance_run_claim_analysis",
        "client",
        async (args) => {
          // The insurance_run_claim_analysis RPC does not exist in the
          // deployed schema — analysis runs the SAME deterministic analyzers
          // the demo loader uses, against the real claim record, and persists
          // findings via insurance_upsert_findings (idempotent on findingKey).
          const claimId = String((args ?? {}).claimId ?? "");
          const [{ rpcCall }, { buildClaimFindings, enrichClaimFromEvidence }, { getSupabaseClient }] =
            await Promise.all([
              import("@/lib/actions/rpc"),
              import("@/lib/insurance/logic"),
              import("@/lib/supabase"),
            ]);
          const supabase = getSupabaseClient();
          if (!supabase) throw new Error("Supabase is not configured.");
          let pkg: { claim?: Record<string, unknown> | null } | null = null;
          try {
            pkg = (await rpcCall(supabase, "insurance_get_claim_package", {
              claimId,
            })) as { claim?: Record<string, unknown> | null };
          } catch (e) {
            const err = e as { code?: string; message?: string };
            // Pre-migration 0009 insurance_get_claim_package raises 22023
            // (JSON-null scalar evidence) or 22P02 (legacy nested evidence
            // ids wrapped as {"value": …}). Both are valid claim states, so
            // fall back to the timeline RPC (same claim row, no evidence
            // join) and keep analysis working until the migration lands.
            const msg = String(err?.message ?? "");
            const isBrokenPackage =
              err?.code === "22023" ||
              err?.code === "22P02" ||
              msg.includes("cannot extract elements from a scalar") ||
              msg.includes("invalid input syntax for type uuid");
            if (!isBrokenPackage) {
              throw e;
            }
            const timeline = (await rpcCall(supabase, "insurance_get_claim_timeline", {
              claimId,
            })) as { claim?: Record<string, unknown> | null };
            pkg = { claim: timeline?.claim ?? null };
          }
          if (!pkg?.claim) throw new Error("Claim not found.");
          const claim = pkg.claim;
          const snapshot = {
            _id: claimId,
            claimNumber: (claim.claimNumber as string) ?? null,
            dateOfLoss: (claim.dateOfLoss as number | null) ?? null,
            property: (claim.property as string) ?? null,
            causeOfLoss: (claim.causeOfLoss as string) ?? null,
            lossDescription: (claim.lossDescription as string) ?? null,
            customer: (claim.customer as string) ?? null,
            carrier: (claim.carrier as string) ?? null,
            policy: (claim.policy as string) ?? null,
            adjuster: (claim.adjuster as string) ?? null,
            status: (claim.status as string) ?? null,
            estimateAmount: (claim.estimateAmount as number | null) ?? null,
            estimateLineItemCount: (claim.estimateLineItemCount as number | null) ?? null,
            invoicedAmount: (claim.invoicedAmount as number | null) ?? null,
            paymentAmount: (claim.paymentAmount as number | null) ?? null,
            approvedAmount: (claim.approvedAmount as number | null) ?? null,
            collectedAmount: (claim.collectedAmount as number | null) ?? null,
            openBalance: (claim.openBalance as number | null) ?? null,
            deductible: (claim.deductible as number | null) ?? null,
            policyLimits: (claim.policyLimits as number | null) ?? null,
            scopeItems: (claim.scopeItems as ClaimSnapshot["scopeItems"]) ?? null,
            expectedScope: (claim.expectedScope as string[]) ?? null,
            actualScope: (claim.actualScope as string[]) ?? null,
            evidenceSummary: (claim.evidenceSummary as string[]) ?? null,
            evidenceDocumentIds: (claim.evidenceDocumentIds as unknown[]) ?? null,
            provenance: (claim.provenance as string) ?? null,
            createdAt: (claim.createdAt as number | null) ?? null,
            updatedAt: (claim.updatedAt as number | null) ?? null,
          } as ClaimSnapshot;

          // Ground the (possibly sparse) claim in its actual evidence
          // documents: match tenant docs by claim number, pull their
          // extracted text, and derive the amounts / scope / evidence
          // categories the analyzers run on. Best-effort — if enrichment
          // fails, analysis still runs on the claim record itself.
          const claimNumForMatch = String(
            claim.claimNumber ?? snapshot.claimNumber ?? "",
          ).replace(/[-\s]/g, "").toUpperCase();
          let enrichedSnapshot = snapshot;
          if (claimNumForMatch) {
            try {
              const docs = await listTenantDocsForClaim(supabase);
              // Match the claim number in the title, the source path OR the
              // extracted content summary. Real archives (including the NPP
              // demo) deliberately scatter claim documents outside the claim
              // folder, so folder-derived matches alone miss the invoice,
              // payment and estimate docs — their content still names the
              // claim, and summaries are derived from that content.
              const matched = docs
                .filter((d) =>
                  `${d.title ?? ""} ${d.sourceId ?? ""} ${d.summary ?? ""}`
                    .toUpperCase()
                    .replace(/[-\s]/g, "")
                    .includes(claimNumForMatch),
                )
                .sort(
                  (a, b) =>
                    evidencePriority(b.classification) -
                    evidencePriority(a.classification),
                );
              // Fetch every matched claim document's extracted text (capped
              // only as a safety bound — a single claim rarely exceeds a few
              // dozen documents) so the analyzers see the invoice, payment and
              // estimate docs the way the individual-upload path does.
              const withText: EvidenceDocLike[] = [];
              for (const d of matched.slice(0, 40)) {
                const detail = (await rpcCall(
                  supabase,
                  "documents_get_document_detail",
                  { documentId: d._id },
                ).catch(() => null)) as { chunks?: Array<{ content?: string }> } | null;
                withText.push({
                  _id: d._id,
                  title: d.title,
                  classification: d.classification,
                  text: (detail?.chunks ?? []).map((c) => c.content ?? "").join("\n"),
                });
              }
              enrichedSnapshot = enrichClaimFromEvidence(snapshot, withText);
            } catch (e) {
              // Enrichment is best-effort — never block analysis on it.
              // eslint-disable-next-line no-console
              console.error("[atlas] claim evidence enrichment failed:", e);
            }
          }

          const findings = buildClaimFindings(enrichedSnapshot).map((f, i) => ({
            ...f,
            findingKey: `claim:${claimId}:${f.source ?? f.category}:${i}`,
          }));
          await rpcCall(supabase, "insurance_upsert_findings", {
            claimId,
            findings,
          });

          // Link every document that references this claim number as evidence
          // (tenant-scoped by the RPC).
          let evidenceLinked = 0;
          const claimNumber = claim.claimNumber as string | undefined;
          if (claimNumber) {
            const docs = await listTenantDocsForClaim(supabase);
            const num = claimNumber.replace(/[-\s]/g, "").toUpperCase();
            for (const d of docs) {
              const hay = `${d.title ?? ""} ${d.sourceId ?? ""} ${d.summary ?? ""}`
                .toUpperCase()
                .replace(/[-\s]/g, "");
              if (hay.includes(num)) {
                await rpcCall(supabase, "insurance_attach_claim_evidence", {
                  claimId,
                  documentId: d._id,
                }).catch(() => undefined);
                evidenceLinked++;
              }
            }
          }
          return { ok: true, findings: findings.length, evidence: evidenceLinked };
        },
      ),
      updateFindingStatus: def<{ ok: boolean }>("insurance_update_finding_status", "mutation"),
      createSupplement: def<{ ok: boolean }>("insurance_create_supplement", "mutation"),
      updateSupplementStatus: def<{ ok: boolean }>(
        "insurance_update_supplement_status",
        "mutation",
      ),
      recordClaimPayment: def<{ ok: boolean }>("insurance_record_claim_payment", "mutation"),
    },
    candidates: {
      listClaimCandidates: def<ObjArray>("insurance_list_claim_candidates", "query"),
      claimCandidateCounts: def<Obj>("insurance_claim_candidate_counts", "query"),
      approveClaimCandidate: def<Obj>("insurance_approve_claim_candidate", "mutation"),
      rejectClaimCandidate: def<{ ok: boolean }>("insurance_reject_claim_candidate", "mutation"),
      candidateSummary: def<Obj>("insurance_claim_candidate_summary", "query"),
      reconstructClaims: def<Obj>(
        "insurance_reconstruct_claims",
        "client",
        async () => {
          // Scan the knowledge base for deterministic claim identifiers and
          // persist evidence-backed POTENTIAL candidates (idempotent — the
          // backend dedupes on tenantId + claimKey). Archive imports already
          // reconstruct candidates during ingestion; this covers documents
          // that arrived through other sources.
          const [{ rpcCall }, { clusterDocumentsByClaimNumber }, { getSupabaseClient }] =
            await Promise.all([
              import("@/lib/actions/rpc"),
              import("@/lib/insurance/reconstruct"),
              import("@/lib/supabase"),
            ]);
          const supabase = getSupabaseClient();
          if (!supabase) throw new Error("Supabase is not configured.");
          const docs = ((await rpcCall(supabase, "documents_list_documents")) ?? []) as Array<{
            _id: string;
            title?: string | null;
          }>;
          const candidates = clusterDocumentsByClaimNumber(
            docs
              .filter((d) => d && typeof d.title === "string" && d.title)
              .map((d) => ({ _id: d._id, title: d.title as string })),
          );
          if (candidates.length === 0) {
            return { ok: true, candidates: 0, scanned: docs.length };
          }
          await rpcCall(supabase, "insurance_upsert_candidates", {
            candidates: candidates.map((c) => ({
              archiveId: null,
              claimKey: c.claimKey,
              claimNumber: c.claimNumber,
              customer: c.customer ?? null,
              property: c.property ?? null,
              fileCount: Math.max(1, c.documentIds.length),
              totalSize: null,
              confidence: c.confidence,
              filePaths: [],
              evidence: c.evidence,
            })),
          });
          return { ok: true, candidates: candidates.length, scanned: docs.length };
        },
      ),
    },
    demoData: {
      loadDemoData: def<Obj>("insurance_demo_load", "mutation"),
      removeDemoData: def<Obj>("insurance_demo_remove", "mutation"),
    },
  },
  tools: {
    tools: {
      listTools: def<ToolRowShape[]>("tools_list", "query"),
      listToolActions: def<ObjArray>("tools_list_actions", "query"),
    },
    execute: {
      executeTool: def<Obj>("tools-execute-tool", "edge"),
      confirmToolAction: def<Obj>("tools-confirm-tool-action", "edge"),
      cancelToolAction: def<Obj>("tools-cancel-tool-action", "edge"),
    },
  },
  conversation: {
    listConversationSessions: def<ObjArray>("conversation_list_sessions", "query"),
    getConversationSession: def<Obj | null>("conversation_get_session", "query"),
    deleteConversationSession: def<{ ok: boolean }>("conversation_delete_session", "mutation"),
    converse: def<Obj>("conversation-converse", "client", async (args) => {
      // Prefer the deployed Edge Function (AI-powered conversational brain).
      // When it isn't deployed / not configured in this project, fall back to
      // deterministic local retrieval over REAL ingested evidence so Ask Atlas
      // and voice never dead-end (Phase 15).
      const { getSupabaseClient } = await import("@/lib/supabase");
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const body = (args ?? {}) as Record<string, unknown>;
      try {
        const { data, error } = await supabase.functions.invoke(
          "conversation-converse",
          { body },
        );
        if (error) throw error;
        const payload = data as { data?: unknown; error?: string; ok?: boolean } | null;
        if (payload && typeof payload === "object" && payload.error) {
          throw new Error(payload.error);
        }
        if (payload && typeof payload === "object" && "data" in payload) {
          return payload.data as Obj;
        }
        return (payload ?? {}) as Obj;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isMissing =
          msg.includes("404") ||
          msg.toLowerCase().includes("not found") ||
          msg.toLowerCase().includes("failed to fetch") ||
          msg.toLowerCase().includes("function was not found");
        if (!isMissing) throw e;
        const { answerLocally } = await import("@/lib/ask/retrieval");
        const local = await answerLocally(
          supabase,
          String(body.transcript ?? body.query ?? ""),
          (body.sessionId as string | null) ?? null,
        );
        return local as unknown as Obj;
      }
    }),
  },
  voice: {
    voiceProviderStatus: def<{
      stt: string;
      tts: string;
      sttProvider: string;
      ttsProvider: string;
      serverConfigured: boolean;
    }>("voice_provider_status", "client", async () => ({
      stt: "browser",
      tts: "browser",
      sttProvider: "browser",
      ttsProvider: "browser",
      serverConfigured: false,
    })),
    synthesizeSpeech: def<Obj>("voice-synthesize", "edge"),
    transcribeAudio: def<Obj>("voice-transcribe", "edge"),
  },
  everest: {
    getOrganizationContext: def<OrganizationContextShape | null>(
      "everest_get_organization_context",
      "query",
    ),
    updateOrganizationContext: def<{ ok: boolean }>(
      "everest_update_organization_context",
      "mutation",
    ),
    upsertOperatingLocation: def<{ ok: boolean }>("everest_upsert_operating_location", "mutation"),
    removeOperatingLocation: def<{ ok: boolean }>("everest_remove_operating_location", "mutation"),
    getBusinessBrain: def<BusinessBrainShape>(
      "everest_business_brain",
      "client",
      async () => ({
        businessTypes: [],
        financialKnowledge: {
          revenue: [],
          expenses: [],
          profitability: [],
          incomeStatementFlow: [],
          accountingIdentity: {},
        },
        orgRoles: [],
        businessObjects: [],
        lifecycles: [],
        maturity: [],
        orgStructures: [],
        businessFunctions: [],
        disambiguation: undefined,
      }),
    ),
    listAuthoritativeKnowledge: def<AuthoritativeKnowledgeShape>(
      "everest_list_authoritative_knowledge",
      "query",
    ),
    getIndustryCoverage: def<IndustryCoverageShape | null>(
      "everest_industry_coverage",
      "query",
    ),
    getInsuranceIntelligence: def<EverestInsuranceShape | null>(
      "everest_insurance_intelligence",
      "query",
    ),
    getAuthorityMonitor: def<AuthorityMonitorShape | null>(
      "everest_authority_monitor",
      "query",
    ),
    listKnowledgeChanges: def<ObjArray>("everest_list_knowledge_changes", "query"),
    listImpactAssessments: def<ObjArray>("everest_list_impact_assessments", "query"),
    decideImpactReview: def<{ ok: boolean }>("everest_decide_impact_review", "mutation"),
    getIndustryExcellence: def<IndustryExcellenceShape | null>(
      "everest_industry_excellence",
      "query",
    ),
    getValueIntelligence: def<ValueIntelligenceShape | null>(
      "everest_value_intelligence",
      "query",
    ),
    analyzeClaimRecovery: def<Obj | null>("everest_analyze_claim_recovery", "query"),
    getOrganizationalState: def<Obj | null>("everest_get_organizational_state", "query"),
    runAuthorityCheckNow: def<{ status: string; createdVersionIds?: string[] }>(
      "everest-authority-check",
      "edge",
    ),
    runInvestigation: def<Obj>("everest-run-investigation", "edge"),
    seedEverest: def<{ seeded: number }>("everest_seed", "mutation"),
  },
  seed: {
    seedDemoData: def<Obj>("seed_demo_data", "mutation"),
    seedDemoClaims: def<{ ok: boolean }>("seed_demo_claims", "mutation"),
  },
} as const;

export type Api = typeof api;
