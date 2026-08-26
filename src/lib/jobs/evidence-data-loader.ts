// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Worker-Side Data Loader
//
// Fetches real Atlas claim, document, and evidence data via existing Supabase
// RPCs. The worker runs in the same process as the SPA and uses the same
// authenticated Supabase client. All data access is RLS-gated.
//
// This module does NOT introduce new database queries or bypass RLS.
// It reuses existing RPC contracts.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";
import type { ClaimSnapshot } from "@/lib/insurance/logic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw claim data as returned by insurance_get_claim_package. */
export interface ClaimPackageData {
  claim: Record<string, unknown> | null;
  supplements: Array<Record<string, unknown>>;
  findings: Array<Record<string, unknown>>;
  evidenceDocs: Array<Record<string, unknown>>;
}

/** Normalized document record from the documents table. */
export interface AtlasDocument {
  _id: string;
  tenantId: string;
  claimId?: string | null;
  name?: string;
  type?: string;
  status?: string;
  chunks?: Array<{ content: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Full data context for the evidence pipeline. */
export interface EvidenceData {
  claimPackage: ClaimPackageData | null;
  claimSnapshot: ClaimSnapshot | null;
  documents: AtlasDocument[];
  tenantId: string;
  claimId: string | null;
}

// ---------------------------------------------------------------------------
// Data Loading Functions
// ---------------------------------------------------------------------------

/**
 * Load the claim package (claim + supplements + findings + evidence docs)
 * via the existing insurance_get_claim_package RPC.
 *
 * Returns null if no claim data exists for this claim ID.
 */
export async function loadClaimPackage(
  claimId: string,
): Promise<ClaimPackageData | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const result = (await rpcCall(supabase, "insurance_get_claim_package", {
      claimId,
    })) as ClaimPackageData | null;
    return result;
  } catch {
    // Claim may not exist yet (discovery pipeline). Return null gracefully.
    return null;
  }
}

/**
 * Convert the raw RPC claim record to a ClaimSnapshot for the pure
 * Evidence Engine functions (analyzeClaimCompleteness, reconcileClaim, etc.).
 */
export function toClaimSnapshot(
  rawClaim: Record<string, unknown> | null | undefined,
): ClaimSnapshot | null {
  if (!rawClaim) return null;
  return {
    _id: (rawClaim._id as string) || undefined,
    claimNumber: (rawClaim.claimNumber as string) || undefined,
    dateOfLoss:
      typeof rawClaim.dateOfLoss === "number" ? rawClaim.dateOfLoss : undefined,
    property: (rawClaim.property as string) || undefined,
    causeOfLoss: (rawClaim.causeOfLoss as string) || undefined,
    lossDescription: (rawClaim.lossDescription as string) || undefined,
    customer: (rawClaim.customer as string) || undefined,
    carrier: (rawClaim.carrier as string) || undefined,
    policy: (rawClaim.policy as string) || undefined,
    adjuster: (rawClaim.adjuster as string) || undefined,
    status: (rawClaim.status as string) || undefined,
    estimateAmount:
      typeof rawClaim.estimateAmount === "number"
        ? rawClaim.estimateAmount
        : undefined,
    estimateLineItemCount:
      typeof rawClaim.estimateLineItemCount === "number"
        ? rawClaim.estimateLineItemCount
        : undefined,
    invoicedAmount:
      typeof rawClaim.invoicedAmount === "number"
        ? rawClaim.invoicedAmount
        : undefined,
    paymentAmount:
      typeof rawClaim.paymentAmount === "number"
        ? rawClaim.paymentAmount
        : undefined,
    approvedAmount:
      typeof rawClaim.approvedAmount === "number"
        ? rawClaim.approvedAmount
        : undefined,
    collectedAmount:
      typeof rawClaim.collectedAmount === "number"
        ? rawClaim.collectedAmount
        : undefined,
    openBalance:
      typeof rawClaim.openBalance === "number" ? rawClaim.openBalance : undefined,
    deductible:
      typeof rawClaim.deductible === "number" ? rawClaim.deductible : undefined,
    policyLimits:
      typeof rawClaim.policyLimits === "number" ? rawClaim.policyLimits : undefined,
    scopeItems: Array.isArray(rawClaim.scopeItems)
      ? rawClaim.scopeItems.map((s: Record<string, unknown>) => ({
          name: s.name as string,
          inEstimate: s.inEstimate as boolean,
        }))
      : undefined,
    expectedScope: Array.isArray(rawClaim.expectedScope)
      ? (rawClaim.expectedScope as string[])
      : undefined,
    actualScope: Array.isArray(rawClaim.actualScope)
      ? (rawClaim.actualScope as string[])
      : undefined,
    evidenceSummary: Array.isArray(rawClaim.evidenceSummary)
      ? (rawClaim.evidenceSummary as string[])
      : undefined,
    evidenceDocumentIds: Array.isArray(rawClaim.evidenceDocumentIds)
      ? rawClaim.evidenceDocumentIds
      : undefined,
    timeline: Array.isArray(rawClaim.timeline)
      ? (rawClaim.timeline as Array<Record<string, unknown>>)
      : undefined,
    confidence:
      typeof rawClaim.confidence === "number" ? rawClaim.confidence : undefined,
    provenance:
      (rawClaim.provenance as string) || undefined,
    createdAt:
      typeof rawClaim.createdAt === "number" ? rawClaim.createdAt : undefined,
    updatedAt:
      typeof rawClaim.updatedAt === "number" ? rawClaim.updatedAt : undefined,
  };
}

/**
 * Load all documents for a tenant via the existing documents RPC.
 * Uses insurance_get_claim_package's evidenceDocs if available,
 * otherwise fetches directly.
 */
export async function loadTenantDocuments(
  tenantId: string,
  claimId?: string | null,
): Promise<AtlasDocument[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  try {
    // If we have a claim, the package already includes evidence docs.
    if (claimId) {
      const pkg = await loadClaimPackage(claimId);
      if (pkg?.evidenceDocs) {
        return pkg.evidenceDocs as unknown as AtlasDocument[];
      }
    }

    // Fallback: query documents table directly via RPC
    const result = await rpcCall(supabase, "documents_list", {
      tenantId,
    });
    return Array.isArray(result) ? (result as unknown as AtlasDocument[]) : [];
  } catch {
    return [];
  }
}

/**
 * Load a full evidence data context for the pipeline.
 * This is the main entry point for pipeline handlers.
 */
export async function loadEvidenceData(
  tenantId: string,
  claimId: string | null,
): Promise<EvidenceData> {
  let claimPackage: ClaimPackageData | null = null;
  let claimSnapshot: ClaimSnapshot | null = null;

  if (claimId) {
    claimPackage = await loadClaimPackage(claimId);
    claimSnapshot = toClaimSnapshot(claimPackage?.claim);
  }

  const documents = await loadTenantDocuments(tenantId, claimId);

  return {
    claimPackage,
    claimSnapshot,
    documents,
    tenantId,
    claimId,
  };
}
