// ---------------------------------------------------------------------------
// Atlas Claim / Supplement Package — Generation Client
//
// Orchestrates the full package generation flow:
// 1. Fetch claim data via the existing insurance_get_claim_package RPC
// 2. Build the structured PackageModel (deterministic)
// 3. Generate the professional HTML document
// 4. Optionally download evidence files from Supabase storage
// 5. Bundle into a ZIP (package.html + supporting documents)
// 6. Persist package metadata in localStorage (stable reference)
// 7. Trigger downloads (HTML file + optional ZIP)
//
// No database migration required — package metadata lives in localStorage
// with a stable UUID. Packages are regenerable from the real claim data.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import type {
  PackageBuildInput,
  PackageModel,
  PackageStatus,
  PackageType,
} from "./package-types";
import { buildPackageModel } from "./package-types";
import { generatePackageHtml } from "./package-html";
import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "atlas_claim_packages";

interface StoredPackageMeta {
  _id: string;
  packageType: PackageType;
  status: PackageStatus;
  claimId: string;
  recommendationId: string | null;
  generatedAt: number;
  coverPageClaimNumber: string | null;
  coverPageCustomer: string | null;
  coverPageProperty: string | null;
  coverPageCarrier: string | null;
  evidenceCount: number;
  findingsCount: number;
  missingCount: number;
  htmlBlobName: string | null;
  zipBlobName: string | null;
}

function loadPackageIndex(): StoredPackageMeta[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePackageIndex(index: StoredPackageMeta[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    // localStorage full or unavailable — silent fail (package still downloads)
  }
}

function saveHtmlBlob(id: string, html: string): string {
  const blobName = `atlas-pkg-${id}.html`;
  try {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    // Store the URL for later retrieval; blob lives in memory until revoked
    (window as unknown as Record<string, unknown>)[`__atlas_pkg_${id}`] = url;
    return blobName;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Observability events (metadata only, never secrets)
// ---------------------------------------------------------------------------

function logEvent(
  event: string,
  meta: Record<string, unknown>,
): void {
  console.info(`[atlas] ${event}`, meta);
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

export interface GeneratePackageOptions {
  /** The claim ID to build the package from. Optional for supplement-only packages. */
  claimId?: string;
  packageType?: PackageType;
  recommendationId?: string;
  executiveSummary?: string;
  supplementaryNarrative?: string;
}

export interface GeneratePackageResult {
  pkg: PackageModel;
  html: string;
  packageId: string;
}

/**
 * Generate a claim or supplement package from real data.
 *
 * This is a CLIENT-SIDE function (no backend migration needed):
 * - Reads claim data via the existing RPC
 * - Builds the package deterministically
 * - Generates a professional HTML document
 * - Persists metadata in localStorage
 * - Returns everything needed for preview + download
 */
export async function generatePackage(
  options: GeneratePackageOptions,
): Promise<GeneratePackageResult> {
  const { recommendationId, executiveSummary, supplementaryNarrative } = options;
  const claimId = options.claimId ?? "";
  const packageType: PackageType = recommendationId ? "supplement" : (options.packageType ?? "claim");

  logEvent("package-generation-start", { claimId: claimId || "(none)", packageType });

  // 1. Fetch claim data via the existing RPC
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  // 3. If this is a supplement package, fetch the recommendation data first
  let recommendation: PackageBuildInput["recommendation"] = undefined;
  if (recommendationId) {
    try {
      const recs = (await rpcCall(supabase, "recommendations_list")) as Array<Record<string, unknown>>;
      const rec = Array.isArray(recs) ? recs.find((r) => r._id === recommendationId) : null;
      if (rec) {
        recommendation = {
          _id: String(rec._id),
          title: typeof rec.title === "string" ? rec.title : undefined,
          summary: typeof rec.summary === "string" ? rec.summary : undefined,
          reason: typeof rec.reason === "string" ? rec.reason : undefined,
          expectedImpact: typeof rec.expectedImpact === "string" ? rec.expectedImpact : undefined,
          confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
          evidence: Array.isArray(rec.evidence)
            ? (rec.evidence as Array<Record<string, unknown>>).map((e) => ({
                title: typeof e.title === "string" ? e.title : undefined,
                kind: typeof e.kind === "string" ? e.kind : undefined,
                snippet: typeof e.snippet === "string" ? e.snippet : undefined,
                relevance: typeof e.relevance === "number" ? e.relevance : undefined,
              }))
            : [],
        };
      }
    } catch {
      // Best-effort: generate without recommendation context
    }
  }

  let rawPkg: Record<string, unknown> | null = null;

  // If we have a claimId, fetch full claim package data
  if (claimId) {
    try {
      rawPkg = (await rpcCall(supabase, "insurance_get_claim_package", {
        claimId,
      })) as Record<string, unknown>;
    } catch (e) {
      // Fallback: try the claim timeline RPC (same claim row, no evidence join)
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[atlas] package generation: get_claim_package failed, trying timeline:", msg.slice(0, 120));
      try {
        const timeline = (await rpcCall(supabase, "insurance_get_claim_timeline", {
          claimId,
        })) as { claim?: Record<string, unknown> | null };
        if (timeline?.claim) {
          rawPkg = { claim: timeline.claim, supplements: [], findings: [], evidenceDocs: [] };
        }
      } catch {
        // Both RPCs failed
      }
    }
  }

  // For supplement packages without a claimId, build from recommendation context alone
  if (!rawPkg && recommendationId && recommendation) {
    logEvent("package-generation-start", { claimId: "(from recommendation)", packageType: "supplement" });
    const buildInput: PackageBuildInput = {
      claim: {
        _id: recommendation._id,
        claimNumber: recommendation.title ?? null,
        customer: null,
        property: null,
        carrier: null,
        policy: null,
        status: "pending",
      },
      findings: [],
      evidenceDocs: [],
      supplements: [],
      recommendation,
      executiveSummary,
      supplementaryNarrative,
    };
    const pkg = buildPackageModel(buildInput);
    pkg.packageType = "supplement";
    pkg.recommendationId = recommendationId;
    const packageId = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pkg._id = packageId;
    pkg.status = "ready";

    // 5. Generate the HTML document
    const html = generatePackageHtml(pkg);

    // 6. Persist metadata in localStorage
    const meta: StoredPackageMeta = {
      _id: packageId,
      packageType: pkg.packageType,
      status: "ready",
      claimId: "",
      recommendationId,
      generatedAt: pkg.generatedAt,
      coverPageClaimNumber: pkg.coverPage.claimNumber,
      coverPageCustomer: pkg.coverPage.customer,
      coverPageProperty: pkg.coverPage.property,
      coverPageCarrier: pkg.coverPage.carrier,
      evidenceCount: pkg.evidenceItems.length,
      findingsCount: pkg.scopeFindings.length,
      missingCount: pkg.missingInformation.length,
      htmlBlobName: saveHtmlBlob(packageId, html),
      zipBlobName: null,
    };
    const index = loadPackageIndex();
    index.unshift(meta);
    savePackageIndex(index.slice(0, 50));

    logEvent("package-generation-completed", {
      packageId,
      packageType: "supplement",
      recommendationId,
      evidenceCount: pkg.evidenceItems.length,
      findingsCount: pkg.scopeFindings.length,
      missingCount: pkg.missingInformation.length,
    });

    return { pkg, html, packageId };
  }

  if (!rawPkg || !rawPkg.claim) {
    throw new Error(claimId
      ? "Claim not found — cannot generate a package without a real claim record."
      : "Cannot generate package: no claimId and no recommendation context available.");
  }

  // 2. Normalize the raw RPC response
  const claim = rawPkg.claim as Record<string, unknown>;
  const supplements = Array.isArray(rawPkg.supplements) ? rawPkg.supplements : [];
  const findings = Array.isArray(rawPkg.findings) ? rawPkg.findings : [];
  const evidenceDocs = Array.isArray(rawPkg.evidenceDocs) ? rawPkg.evidenceDocs : [];

  // 4. Build the package model
  const buildInput: PackageBuildInput = {
    claim: claim as PackageBuildInput["claim"],
    findings: findings as PackageBuildInput["findings"],
    evidenceDocs: evidenceDocs as PackageBuildInput["evidenceDocs"],
    supplements: supplements as PackageBuildInput["supplements"],
    recommendation,
    executiveSummary,
    supplementaryNarrative,
  };

  const pkg = buildPackageModel(buildInput);
  const packageId = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pkg._id = packageId;

  // 5. Generate the HTML document
  const html = generatePackageHtml(pkg);

  // 6. Persist metadata in localStorage
  const meta: StoredPackageMeta = {
    _id: packageId,
    packageType: pkg.packageType,
    status: "ready",
    claimId,
    recommendationId: recommendationId ?? null,
    generatedAt: pkg.generatedAt,
    coverPageClaimNumber: pkg.coverPage.claimNumber,
    coverPageCustomer: pkg.coverPage.customer,
    coverPageProperty: pkg.coverPage.property,
    coverPageCarrier: pkg.coverPage.carrier,
    evidenceCount: pkg.evidenceItems.length,
    findingsCount: pkg.scopeFindings.length,
    missingCount: pkg.missingInformation.length,
    htmlBlobName: saveHtmlBlob(packageId, html),
    zipBlobName: null,
  };

  const index = loadPackageIndex();
  index.unshift(meta);
  // Keep only the most recent 50 packages
  savePackageIndex(index.slice(0, 50));

  pkg.status = "ready";

  logEvent("package-generation-completed", {
    packageId,
    packageType,
    claimId,
    evidenceCount: pkg.evidenceItems.length,
    findingsCount: pkg.scopeFindings.length,
    missingCount: pkg.missingInformation.length,
  });

  return { pkg, html, packageId };
}

// ---------------------------------------------------------------------------
// Download functions
// ---------------------------------------------------------------------------

/**
 * Download the generated HTML package as a file.
 */
export function downloadPackageHtml(html: string, pkg: PackageModel): void {
  const filename = pkg.packageType === "supplement"
    ? `Atlas_Supplement_Package_${pkg.coverPage.claimNumber ?? "unknown"}.html`
    : `Atlas_Claim_Package_${pkg.coverPage.claimNumber ?? "unknown"}.html`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logEvent("package-download", { format: "html", filename });
}

/**
 * Download supporting evidence documents as a ZIP.
 * Downloads each evidence document from Supabase storage and bundles them.
 */
export async function downloadSupportingEvidence(
  pkg: PackageModel,
  evidenceDocs: Array<{ _id?: string; title?: string; storageId?: string }>,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured — cannot download evidence documents.");
  }

  const zip = new JSZip();
  const folder = zip.folder("Supporting_Documents")!;

  // Add a README / index
  const indexLines = [
    "Atlas Supporting Evidence Index",
    `Generated: ${pkg.coverPage.generatedDate}`,
    `Claim: ${pkg.coverPage.claimNumber ?? "N/A"}`,
    "",
    "Documents included:",
    "",
  ];

  let downloaded = 0;
  let failed = 0;

  for (const doc of evidenceDocs) {
    if (!doc._id || !doc.title) continue;

    const title = doc.title;
    indexLines.push(`  - ${title}`);

    // Try to download from Supabase storage
    // The document's storageId maps to a path in the "documents" bucket
    const docRow = await rpcCall(supabase, "documents_get_document", {
      documentId: doc._id,
    }).catch(() => null) as Record<string, unknown> | null;

    const storageId = docRow?.storageId as string | undefined;
    if (storageId) {
      try {
        const { data, error } = await supabase.storage
          .from("documents")
          .download(storageId);
        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          folder.file(title, new Uint8Array(arrayBuffer));
          downloaded++;
          continue;
        }
      } catch {
        // Fall through to document the failure
      }
    }

    // Could not download — add a placeholder noting the document exists
    folder.file(
      `${title.replace(/\.[^.]+$/, "")}_README.txt`,
      `Document: ${title}\nID: ${doc._id}\n\nThis document exists in the Atlas knowledge base but could not be directly downloaded.\nPlease access it through the Atlas Knowledge interface.`,
    );
    failed++;
  }

  indexLines.push("");
  indexLines.push(`${downloaded} document(s) downloaded directly.`);
  if (failed > 0) {
    indexLines.push(`${failed} document(s) could not be downloaded — see individual README files.`);
  }

  folder.file("INDEX.txt", indexLines.join("\n"));

  // Generate the ZIP
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const filename = `Atlas_Supporting_Documents_${pkg.coverPage.claimNumber ?? "unknown"}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logEvent("package-download", { format: "zip", filename, downloaded, failed });
}

// ---------------------------------------------------------------------------
// Package index helpers (for UI listing)
// ---------------------------------------------------------------------------

export function listGeneratedPackages(): StoredPackageMeta[] {
  return loadPackageIndex();
}

export function getPackageMeta(packageId: string): StoredPackageMeta | undefined {
  return loadPackageIndex().find((p) => p._id === packageId);
}

export function removePackage(packageId: string): void {
  const index = loadPackageIndex().filter((p) => p._id !== packageId);
  savePackageIndex(index);
}
