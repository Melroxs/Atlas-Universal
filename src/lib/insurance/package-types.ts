// ---------------------------------------------------------------------------
// Atlas Claim / Supplement Package — types and builder.
//
// The package builder is a PURE function: it takes already-enriched claim data
// (from the existing insurance_get_claim_package RPC + boundary normalizers)
// and produces a structured PackageModel that drives the preview and download.
//
// Every factual field comes from the database. AI (Gemini) may optionally
// generate narrative summaries, but must never invent claim data.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Package lifecycle
// ---------------------------------------------------------------------------

export type PackageType = "claim" | "supplement";

export type PackageStatus =
  | "draft"
  | "generating"
  | "ready"
  | "failed";

// ---------------------------------------------------------------------------
// Package model (the structured output the preview renders)
// ---------------------------------------------------------------------------

export interface PackageEvidenceItem {
  documentId: string;
  title: string;
  classification: string | null;
  date: string | null;
  relevance: string;
  supportsFinding: string | null;
}

export interface PackageFinding {
  findingKey: string;
  title: string;
  category: string;
  description: string;
  confidence: number;
  estimatedAmount: number | null;
  evidence: string[];
  limitation: string;
  recommendedNextStep: string;
}

export interface PackageMissingInfo {
  category: string;
  description: string;
  whyNeeded: string;
}

export interface PackageExplanation {
  section: string;
  finding: string;
  evidence: string[];
  whyItMatters: string;
}

export interface PackageDiscrepancy {
  field: string;
  valueA: string;
  sourceA: string;
  valueB: string;
  sourceB: string;
  difference: string;
}

export interface PackageCoverPage {
  packageName: string;
  packageType: PackageType;
  claimNumber: string | null;
  customer: string | null;
  property: string | null;
  carrier: string | null;
  policyNumber: string | null;
  dateOfLoss: string | null;
  companyName: string;
  generatedDate: string;
  generatedTimestamp: number;
}

export interface PackageModel {
  // Metadata
  _id?: string;
  packageType: PackageType;
  status: PackageStatus;
  claimId: string;
  recommendationId?: string | null;
  generatedAt: number;
  storedHtmlPath?: string | null;
  storedZipPath?: string | null;

  // Content
  coverPage: PackageCoverPage;
  executiveSummary: string;
  claimInformation: Array<{ label: string; value: string | null; state: string }>;
  scopeFindings: PackageFinding[];
  requestedAdditionalScope: string[];
  whyThisScopeIsRequired: string;
  evidenceItems: PackageEvidenceItem[];
  missingInformation: PackageMissingInfo[];
  explanations: PackageExplanation[];
  discrepancies: PackageDiscrepancy[];
  claimTimeline: Array<{ date: string; event: string; source: string }>;
  reconciliationNotes: string[];
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Input shapes (from the existing normalized RPC data)
// ---------------------------------------------------------------------------

export interface PackageClaimInput {
  _id?: string;
  claimNumber?: string | null;
  dateOfLoss?: number | null;
  property?: string | null;
  causeOfLoss?: string | null;
  customer?: string | null;
  carrier?: string | null;
  policy?: string | null;
  adjuster?: string | null;
  status?: string | null;
  estimateAmount?: number | null;
  estimateLineItemCount?: number | null;
  invoicedAmount?: number | null;
  paymentAmount?: number | null;
  approvedAmount?: number | null;
  deductible?: number | null;
  expectedScope?: string[] | null;
  actualScope?: string[] | null;
  evidenceSummary?: string[] | null;
  provenance?: string | null;
  confidence?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface PackageFindingInput {
  _id?: string;
  findingKey?: string;
  title?: string;
  category?: string;
  description?: string;
  confidence?: number;
  estimatedAmount?: number | null;
  evidence?: string[];
  limitation?: string;
  recommendedNextStep?: string;
  status?: string;
}

export interface PackageEvidenceDocInput {
  _id?: string;
  title?: string;
  classification?: string | null;
  summary?: string | null;
  createdAt?: number | null;
}

export interface PackageSupplementInput {
  _id?: string;
  reason?: string | null;
  status?: string | null;
  amount?: number | null;
  approvedAmount?: number | null;
  deniedAmount?: number | null;
  justification?: string | null;
  affectedLineItems?: string[] | null;
  requestedItems?: string[] | null;
  evidence?: string[] | null;
  createdAt?: number | null;
}

export interface PackageRecommendationInput {
  _id?: string;
  title?: string;
  summary?: string;
  reason?: string;
  expectedImpact?: string;
  confidence?: number;
  evidence?: Array<{
    title?: string;
    kind?: string;
    snippet?: string;
    relevance?: number;
  }>;
}

export interface PackageTimelineEvent {
  ts?: number;
  kind?: string;
  label?: string;
  detail?: string;
  source?: string;
}

export interface PackageCompleteness {
  score?: number;
  complete?: number;
  total?: number;
  summary?: string;
  categories?: Array<{
    key?: string;
    label?: string;
    status?: string;
    note?: string;
  }>;
}

export interface PackageReconciliation {
  estimate?: number;
  paid?: number;
  outstanding?: number;
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Package builder input
// ---------------------------------------------------------------------------

export interface PackageBuildInput {
  claim: PackageClaimInput;
  findings: PackageFindingInput[];
  evidenceDocs: PackageEvidenceDocInput[];
  supplements: PackageSupplementInput[];
  completeness?: PackageCompleteness;
  reconciliation?: PackageReconciliation;
  timeline?: PackageTimelineEvent[];
  recommendation?: PackageRecommendationInput;
  executiveSummary?: string;
  supplementaryNarrative?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Not recorded";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Not recorded";
  return new Date(n).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function safeStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Package builder — pure function
// ---------------------------------------------------------------------------

export function buildPackageModel(input: PackageBuildInput): PackageModel {
  const { claim, findings, evidenceDocs, supplements } = input;

  // Cover page
  const coverPage: PackageCoverPage = {
    packageName: input.recommendation?.title
      ? `Supplement Package — ${input.recommendation.title}`
      : `Claim Package — ${claim.claimNumber ?? "No claim number"}`,
    packageType: input.recommendation ? "supplement" : "claim",
    claimNumber: safeStr(claim.claimNumber) ?? null,
    customer: safeStr(claim.customer) ?? null,
    property: safeStr(claim.property) ?? null,
    carrier: safeStr(claim.carrier) ?? null,
    policyNumber: safeStr(claim.policy) ?? null,
    dateOfLoss: typeof claim.dateOfLoss === "number" ? formatDate(claim.dateOfLoss) : null,
    companyName: "Atlas Insurance Intelligence",
    generatedDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    generatedTimestamp: Date.now(),
  };

  // Claim information section
  const claimInformation: PackageModel["claimInformation"] = [
    { label: "Claim Number", value: claim.claimNumber ?? null, state: claim.claimNumber ? "verified" : "missing" },
    { label: "Insured / Customer", value: claim.customer ?? null, state: claim.customer ? "verified" : "missing" },
    { label: "Property", value: claim.property ?? null, state: claim.property ? "verified" : "missing" },
    { label: "Carrier", value: claim.carrier ?? null, state: claim.carrier ? "verified" : "missing" },
    { label: "Policy Number", value: claim.policy ?? null, state: claim.policy ? "verified" : "missing" },
    { label: "Adjuster", value: claim.adjuster ?? null, state: claim.adjuster ? "verified" : "missing" },
    { label: "Date of Loss", value: typeof claim.dateOfLoss === "number" ? formatDate(claim.dateOfLoss) : null, state: typeof claim.dateOfLoss === "number" ? "verified" : "missing" },
    { label: "Cause of Loss", value: claim.causeOfLoss ?? null, state: claim.causeOfLoss ? "verified" : "missing" },
    { label: "Status", value: claim.status?.replace(/_/g, " ") ?? null, state: "verified" },
    { label: "Estimate", value: money(claim.estimateAmount), state: typeof claim.estimateAmount === "number" ? "verified" : "missing" },
    { label: "Payment Received", value: money(claim.paymentAmount), state: typeof claim.paymentAmount === "number" ? "verified" : "missing" },
    { label: "Invoiced Amount", value: money(claim.invoicedAmount), state: typeof claim.invoicedAmount === "number" ? "verified" : "missing" },
    { label: "Approved by Carrier", value: money(claim.approvedAmount), state: typeof claim.approvedAmount === "number" ? "verified" : "missing" },
    { label: "Deductible", value: money(claim.deductible), state: typeof claim.deductible === "number" ? "verified" : "missing" },
  ];

  // Scope findings — only open/active findings
  const scopeFindings: PackageFinding[] = findings
    .filter((f) => f.status !== "resolved" && f.status !== "dismissed")
    .map((f) => ({
      findingKey: f.findingKey ?? f._id ?? "",
      title: f.title ?? "Unnamed finding",
      category: f.category ?? "general",
      description: f.description ?? "",
      confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
      estimatedAmount: typeof f.estimatedAmount === "number" ? f.estimatedAmount : null,
      evidence: Array.isArray(f.evidence) ? f.evidence : [],
      limitation: f.limitation ?? "No limitation recorded.",
      recommendedNextStep: f.recommendedNextStep ?? "Review manually.",
    }));

  // Evidence items
  const evidenceItems: PackageEvidenceItem[] = evidenceDocs
    .filter((d): d is PackageEvidenceDocInput & { _id: string } => Boolean(d._id))
    .map((d) => {
      const matchingFinding = scopeFindings.find(
        (f) => f.evidence.some((e) => e.toLowerCase().includes((d.title ?? "").toLowerCase())),
      );
      return {
        documentId: d._id,
        title: d.title ?? "Untitled document",
        classification: d.classification ?? null,
        date: d.createdAt ? formatDate(d.createdAt) : null,
        relevance: d.classification
          ? `Classified as ${d.classification}`
          : "Supporting documentation",
        supportsFinding: matchingFinding?.title ?? null,
      };
    });

  // Missing information
  const missingInformation: PackageMissingInfo[] = [];
  if (!claim.claimNumber) {
    missingInformation.push({ category: "Claim Identification", description: "No claim number on file", whyNeeded: "Required to track the claim with the carrier" });
  }
  if (!claim.customer) {
    missingInformation.push({ category: "Insured Information", description: "No insured / customer name on file", whyNeeded: "Required for the claim cover page and correspondence" });
  }
  if (!claim.property) {
    missingInformation.push({ category: "Property Information", description: "No property address on file", whyNeeded: "Required to identify the loss location" });
  }
  if (!claim.carrier) {
    missingInformation.push({ category: "Carrier Information", description: "No carrier recorded", whyNeeded: "Required to route correspondence and track carrier decisions" });
  }
  if (typeof claim.estimateAmount !== "number") {
    missingInformation.push({ category: "Estimate", description: "No estimate amount on file", whyNeeded: "Required to establish the financial baseline" });
  }
  if (typeof claim.paymentAmount !== "number") {
    missingInformation.push({ category: "Payment Records", description: "No payment records on file", whyNeeded: "Required for financial reconciliation" });
  }
  // Check evidence gaps based on completeness
  if (input.completeness?.categories) {
    for (const cat of input.completeness.categories) {
      if (cat.status === "missing" || cat.status === "needs_review") {
        missingInformation.push({
          category: cat.label ?? "Unknown",
          description: cat.note ?? "Information not available",
          whyNeeded: `${cat.label ?? "This information"} is needed for a complete claim package`,
        });
      }
    }
  }

  // Evidence-grounded explanations
  const explanations: PackageExplanation[] = scopeFindings.map((f) => ({
    section: "Findings",
    finding: f.title,
    evidence: f.evidence,
    whyItMatters: f.limitation
      ? `Atlas identified this finding with ${Math.round(f.confidence * 100)}% confidence. ${f.description} ${f.limitation}`
      : `Atlas identified this finding with ${Math.round(f.confidence * 100)}% confidence. ${f.description}`,
  }));

  // Discrepancies (from completeness conflicted status)
  const discrepancies: PackageDiscrepancy[] = [];
  if (input.completeness?.categories) {
    for (const cat of input.completeness.categories) {
      if (cat.status === "conflicted") {
        discrepancies.push({
          field: cat.label ?? "Unknown",
          valueA: "Conflicting value A",
          sourceA: "Source document",
          valueB: "Conflicting value B",
          sourceB: "Another source document",
          difference: cat.note ?? "Values differ between sources",
        });
      }
    }
  }
  // Estimate vs invoice discrepancy
  if (
    typeof claim.estimateAmount === "number" &&
    typeof claim.invoicedAmount === "number" &&
    Math.abs(claim.estimateAmount - claim.invoicedAmount) > 0.01
  ) {
    discrepancies.push({
      field: "Estimate vs Invoice",
      valueA: money(claim.estimateAmount),
      sourceA: "Original estimate",
      valueB: money(claim.invoicedAmount),
      sourceB: "Invoice records",
      difference: `Difference of ${money(Math.abs(claim.estimateAmount - claim.invoicedAmount))}`,
    });
  }

  // Timeline
  const claimTimeline: PackageModel["claimTimeline"] = [];
  if (typeof claim.createdAt === "number") {
    claimTimeline.push({ date: formatDate(claim.createdAt), event: "Claim created", source: "Atlas" });
  }
  for (const t of input.timeline ?? []) {
    if (typeof t.ts === "number" && t.label) {
      claimTimeline.push({ date: formatDate(t.ts), event: String(t.label), source: t.source === "atlas" ? "Atlas" : "Source" });
    }
  }
  claimTimeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Reconciliation notes
  const reconciliationNotes = input.reconciliation?.notes ?? [];

  // Executive summary
  const executiveSummary =
    input.executiveSummary ??
    generateDeterministicSummary(claim, scopeFindings, evidenceItems, missingInformation);

  // Supplement-specific sections
  const requestedAdditionalScope: string[] = [];
  let whyThisScopeIsRequired = "";
  if (input.recommendation) {
    const rec = input.recommendation;
    requestedAdditionalScope.push(rec.summary ?? rec.title ?? "Additional scope requested");
    if (rec.expectedImpact) requestedAdditionalScope.push(`Expected impact: ${rec.expectedImpact}`);
    whyThisScopeIsRequired = rec.reason ?? "This scope is required based on the evidence analysis.";
    if (input.supplementaryNarrative) {
      whyThisScopeIsRequired = input.supplementaryNarrative;
    }
  } else {
    // For claim packages, the scope is the existing documented scope
    for (const s of claim.expectedScope ?? []) {
      requestedAdditionalScope.push(s);
    }
  }

  return {
    packageType: coverPage.packageType,
    status: "draft",
    claimId: String(claim._id ?? ""),
    recommendationId: input.recommendation?._id ?? null,
    generatedAt: Date.now(),
    coverPage,
    executiveSummary,
    claimInformation,
    scopeFindings,
    requestedAdditionalScope,
    whyThisScopeIsRequired,
    evidenceItems,
    missingInformation,
    explanations,
    discrepancies,
    claimTimeline,
    reconciliationNotes,
    disclaimer:
      "This package was assembled by Atlas Insurance Intelligence from the available records. " +
      "All factual fields come from documented sources — Atlas never invents claim data. " +
      "Missing information is explicitly identified. This document requires human review before submission.",
  };
}

// ---------------------------------------------------------------------------
// Deterministic summary generator (no AI needed)
// ---------------------------------------------------------------------------

function generateDeterministicSummary(
  claim: PackageClaimInput,
  findings: PackageFinding[],
  evidence: PackageEvidenceItem[],
  missing: PackageMissingInfo[],
): string {
  const parts: string[] = [];

  parts.push(
    `This package consolidates the available documentation for claim ${claim.claimNumber ?? "(no claim number)"}` +
    (claim.customer ? ` filed by ${claim.customer}` : "") +
    (claim.property ? ` regarding the property at ${claim.property}` : "") +
    (claim.carrier ? ` with ${claim.carrier}` : "") +
    "."
  );

  if (typeof claim.estimateAmount === "number") {
    parts.push(`The current estimate totals ${money(claim.estimateAmount)}.`);
  }

  if (typeof claim.paymentAmount === "number" && claim.paymentAmount > 0) {
    parts.push(`Payments received to date total ${money(claim.paymentAmount)}.`);
  }

  if (findings.length > 0) {
    const highConf = findings.filter((f) => f.confidence >= 0.7);
    parts.push(
      `Atlas identified ${findings.length} potential finding${findings.length === 1 ? "" : "s"}` +
      (highConf.length > 0 ? ` (${highConf.length} with high confidence)` : "") +
      " that may affect the claim."
    );
  }

  if (evidence.length > 0) {
    const classifications = [...new Set(evidence.map((e) => e.classification).filter(Boolean))];
    parts.push(
      `${evidence.length} supporting document${evidence.length === 1 ? "" : "s"} are included` +
      (classifications.length > 0 ? ` (${classifications.join(", ")})` : "") +
      "."
    );
  }

  if (missing.length > 0) {
    parts.push(
      `${missing.length} item${missing.length === 1 ? "" : "s"} of required information ${missing.length === 1 ? "is" : "are"} not yet available and are explicitly noted below.`
    );
  }

  return parts.join(" ");
}
