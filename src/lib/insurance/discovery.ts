// ---------------------------------------------------------------------------
// Atlas Claim Discovery + Evidence Reconstruction Engine (canonical, pure).
//
// PURPOSE (§"FINAL CLAIM DISCOVERY"): turn a messy collection of ingested
// company information into ACTUAL, persisted, evidence-backed claims. This
// module is the deterministic brain that decides WHEN the evidence supports
// the existence of a claim, WHAT fields can be reconstructed, WHERE every
// field came from (provenance), and WHAT to do next:
//
//   decision = "create"        → HIGH confidence, no existing claim → persist
//                                a real claim (the caller creates the record).
//   decision = "enrich"        → the evidence matches an existing claim →
//                                attach evidence + fill missing fields only.
//   decision = "propose"       → MEDIUM confidence → persist a reviewable
//                                reconstruction candidate (never a claim).
//   decision = "keep_evidence" → LOW confidence → keep documents available,
//                                manufacture nothing.
//
// Claim-number independence: a claim number is a strong signal but NOT the
// only way to discover a claim. Clusters are formed by claim number first,
// then by policy, then by (property + carrier + loss date). Two claims for
// the same customer/property are kept separate when their loss dates differ.
// Conflicting claim identifiers for the same property are NEVER merged —
// each becomes its own review cluster with an explicit identifier conflict.
//
// Determinism: every value is extracted from the evidence, every confidence
// is derived from a transparent scoring model (reasons are returned), every
// conflicting value is preserved (nothing is silently picked as the winner),
// and the output is order-independent (docs are sorted by id inside each
// cluster before extraction; clusters are keyed, not sequenced).
//
// DEPLOYMENT CONTRACT: pure TypeScript, no repository imports beyond the
// sibling pure modules — unit-tested directly and used by the client action
// (src/lib/api.ts → insurance.reconstructClaims) and the archive ingestion
// completion path.
// ---------------------------------------------------------------------------

import { extractClaimNumber, looksClaimRelated } from "./reconstruct";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A tenant document as seen by the discovery engine (text optional). */
export interface DiscoveryDoc {
  _id: string;
  title?: string | null;
  classification?: string | null;
  summary?: string | null;
  /** Optional extracted chunk text (bounded by the caller). */
  text?: string | null;
}

/** A persisted claim record (subset of the insuranceClaims row). */
export interface DiscoveryClaim {
  _id: string;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  carrier?: string | null;
  policy?: string | null;
  adjuster?: string | null;
  dateOfLoss?: number | null;
  causeOfLoss?: string | null;
  estimateAmount?: number | null;
  paymentAmount?: number | null;
  invoicedAmount?: number | null;
  approvedAmount?: number | null;
  deductible?: number | null;
  status?: string | null;
  confidence?: number;
  evidenceSummary?: string[] | null;
  evidenceDocumentIds?: unknown[] | null;
  provenance?: string | null;
}

/** A persisted reconstruction candidate (subset of claimCandidates). */
export interface DiscoveryCandidate {
  _id?: string;
  claimKey?: string | null;
  claimNumber?: string | null;
  customer?: string | null;
  property?: string | null;
  confidence?: number | null;
  status?: string | null;
  documentIds?: string[] | null;
  documentTitles?: string[] | null;
}

/** A reconstructed field value WITH its source (provenance). */
export interface ProvenanceValue {
  value: string;
  sourceDocumentId: string;
  sourceTitle: string;
  /** Extraction confidence for this value (0..1). */
  confidence: number;
  /** Documents that agree on this value. */
  agreeingSources: string[];
}

/** A preserved conflict — both sides kept, nothing silently resolved. */
export interface DiscoveryConflict {
  field: string;
  values: ProvenanceValue[];
  note: string;
}

export type DiscoveryTier = "HIGH" | "MEDIUM" | "LOW";
export type DiscoveryDecisionKind = "create" | "enrich" | "propose" | "keep_evidence";

export interface ClaimDiscoveryDecision {
  /** Stable cluster key (claim number, else a deterministic composite key). */
  clusterKey: string;
  claimNumber?: ProvenanceValue;
  customer?: ProvenanceValue;
  property?: ProvenanceValue;
  policy?: ProvenanceValue;
  carrier?: ProvenanceValue;
  adjuster?: ProvenanceValue;
  dateOfLoss?: ProvenanceValue;
  causeOfLoss?: ProvenanceValue;
  estimateAmount?: ProvenanceValue;
  invoicedAmount?: ProvenanceValue;
  paymentAmount?: ProvenanceValue;
  approvedAmount?: ProvenanceValue;
  deductible?: ProvenanceValue;
  /** All evidence documents in the cluster (tenant-scoped ids). */
  evidenceIds: string[];
  evidenceTitles: string[];
  /** Distinct supporting document types (estimate, inspection, …). */
  docTypes: string[];
  /** Transparent 0..1 confidence from the scoring model below. */
  confidence: number;
  tier: DiscoveryTier;
  decision: DiscoveryDecisionKind;
  /** Set when decision === "enrich". */
  targetClaimId?: string;
  targetClaimNumber?: string | null;
  /** Preserved conflicting values (amounts, dates, identifiers…). */
  conflicts: DiscoveryConflict[];
  /** True when another cluster references the same property with a
   *  DIFFERENT claim number — both stay separate for human review. */
  identifierConflict?: string;
  /** Transparent scoring breakdown. */
  reasons: string[];
  /** Explainable one-liner ("Atlas grouped these N documents into…"). */
  summary: string;
}

export interface ClaimDiscoveryReport {
  decisions: ClaimDiscoveryDecision[];
  /** Document count that carried no claim signals at all. */
  unclustered: number;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const norm = (s: string): string => (s ?? "").replace(/[-_\s]/g, "").toUpperCase();
const strip = (s: string): string => (s ?? "").replace(/[$,]/g, "").trim();

function normDate(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function money(v: string): string {
  const n = Number.parseFloat(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : v;
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Stable deterministic cluster key from composite evidence (no claim number). */
function compositeKey(parts: Array<string | undefined | null>): string {
  const joined = parts
    .map((p) => norm(p ?? ""))
    .filter((p) => p.length > 0)
    .join("|");
  if (!joined) return "";
  // FNV-1a → base36, stable across runs and orders.
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `PROV-${(h >>> 0).toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Deterministic signal extraction (title + summary + classification + text)
// ---------------------------------------------------------------------------

const CARRIER_RE =
  /\b(state farm|allstate|liberty mutual|geico|progressive|farmers(?: insurance)?|nationwide|travelers|the hartford|hartford|aig|chubb|safeco|american family|usaa|cincinnati(?: insurance)?|auto-?owners|erie(?: insurance)?|metlife|the general|root insurance|hippo|lemonade|openly|kin insurance|bamboo insurance|american integrity|heritage(?: insurance)?|universal property|citizens(?: property)?|empower|frontline|slide insurance|tower hill|security first|homeowners of america)\b/i;
const POLICY_RE =
  /\b(?:policy(?: number)?|pol)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-]{5,})\b/i;
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:STREET|ST|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|CT|COURT|CIR|CIRCLE|WAY|TER|TERRACE|PL|PLACE|HWY|HIGHWAY|PKWY|PARKWAY|SE|SW|NE|NW|N|S|E|W)\.?(?:,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)?\b/i;
const DOL_LABELED_RE =
  /\b(?:date of loss|loss date|dol|date of the loss)\s*[:#-]?\s*([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i;
const DOL_BARE_RE =
  /\b([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})\b/;
const CAUSE_RE =
  /\b(?:cause of loss|cause)\s*[:#-]\s*([A-Za-z][A-Za-z0-9 &'\-]{2,40})/i;
const ESTIMATE_TOTAL_RE =
  /(?:total\s+)?estimate\s*(?:total)?[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i;
const INVOICE_TOTAL_RE =
  /invoice\s+total[:$]\s*\$?\s*([\d,]+(?:\.\d{2})?)/i;
const PAYMENT_AMOUNT_RE =
  /payment\s+(?:amount|received|made)?\s*[:$]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i;
const DEDUCTIBLE_RE =
  /deductible\s*[:$]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i;

export interface ClaimSignals {
  claimNumber: string | null;
  policy: string | null;
  property: string | null;
  carrier: string | null;
  /** Normalized YYYY-MM-DD. */
  dateOfLoss: string | null;
  causeOfLoss: string | null;
  estimateAmount: number | null;
  invoicedAmount: number | null;
  paymentAmount: number | null;
  deductible: number | null;
  docType: string | null;
}

const CLASSIFICATION_MAP: Array<[RegExp, string]> = [
  [/fnol|first notice/i, "fnol"],
  [/policy|declaration|endorsement|coverage|binder/i, "policy"],
  [/estimate|xactimate|scope/i, "estimate"],
  [/inspection|damage assessment|adjuster.*report/i, "inspection"],
  [/photo|image|picture/i, "photo"],
  [/correspondence|email|letter|communication/i, "correspondence"],
  [/payment|paid|check|remittance/i, "payment"],
  [/invoice|billing|statement/i, "invoice"],
  [/supplement/i, "supplement"],
  [/report|proof of loss/i, "report"],
];

function docTypeFor(classification: string | null | undefined, title: string | null | undefined): string | null {
  const c = `${classification ?? ""} ${title ?? ""}`;
  for (const [re, type] of CLASSIFICATION_MAP) {
    if (re.test(c)) return type;
  }
  return null;
}

/** Extract every deterministic claim signal a single document carries. */
export function extractClaimSignals(doc: DiscoveryDoc): ClaimSignals {
  const title = doc.title ?? "";
  const summary = doc.summary ?? "";
  const classification = doc.classification ?? "";
  const text = doc.text ?? "";
  const all = `${title} ${summary} ${classification} ${text}`;

  // Claim number: title match is strongest, then full text.
  const titleNum = extractClaimNumber(title);
  const textNum = titleNum ? null : extractClaimNumber(all);
  const claimNumber = titleNum ?? textNum;

  const policy = firstMatch(all, POLICY_RE) ?? null;
  const property = all.match(ADDRESS_RE)?.[0]?.trim() ?? null;
  const carrier = all.match(CARRIER_RE)?.[0]?.trim() ?? null;
  const dol =
    firstMatch(all, DOL_LABELED_RE) ??
    // Bare month-day-year only when the document is loss-related — a random
    // date (e.g. an inspection date) must never be read as a loss date.
    (/claims?|loss|fnol|damage/i.test(all) ? firstMatch(all, DOL_BARE_RE) : null) ??
    null;
  const dateOfLoss = dol
    ? (() => {
        const iso = dol.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return iso[0];
        const parsed = Date.parse(dol);
        return Number.isNaN(parsed) ? null : normDate(new Date(parsed));
      })()
    : null;

  const num = (v: string | null): number | null => {
    const n = Number.parseFloat(strip(v ?? ""));
    return Number.isFinite(n) ? n : null;
  };
  const estimateAmount = num(firstMatch(all, ESTIMATE_TOTAL_RE));
  const invoicedAmount = num(firstMatch(all, INVOICE_TOTAL_RE));
  const paymentAmount = num(firstMatch(all, PAYMENT_AMOUNT_RE));
  const deductible = num(firstMatch(all, DEDUCTIBLE_RE));
  const causeOfLoss = firstMatch(all, CAUSE_RE) ?? null;

  return {
    claimNumber,
    policy,
    property,
    carrier,
    dateOfLoss,
    causeOfLoss,
    estimateAmount,
    invoicedAmount,
    paymentAmount,
    deductible,
    docType: docTypeFor(classification, title),
  };
}

// ---------------------------------------------------------------------------
// Evidence clustering
// ---------------------------------------------------------------------------

interface Cluster {
  key: string;
  claimNumber: string | null;
  docs: DiscoveryDoc[];
  candidateCustomer: string | null;
  candidateProperty: string | null;
  candidateClaimNumber: string | null;
}

/**
 * Cluster tenant documents into claim evidence sets. A claim number is the
 * strongest key but never required: policy, then (property + carrier + loss
 * date) fall back, so Atlas can still discover a claim when no document
 * contains a claim number. Loss dates PARTITION same-property clusters so
 * two claims for the same customer/property stay separate. Documents that
 * carry no claim signals are left unclustered (evidence kept, nothing
 * manufactured).
 */
export function clusterEvidence(
  docs: DiscoveryDoc[],
  candidates: DiscoveryCandidate[] = [],
): { clusters: Cluster[]; unclustered: number } {
  // Stable, deterministic per-document processing regardless of input order.
  const sorted = [...docs].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  const clusters = new Map<string, Cluster>();

  const get = (key: string, claimNumber: string | null): Cluster => {
    let c = clusters.get(key);
    if (!c) {
      c = { key, claimNumber, docs: [], candidateCustomer: null, candidateProperty: null, candidateClaimNumber: null };
      clusters.set(key, c);
    }
    return c;
  };

  const indexed = new Map<string, Cluster[]>();
  const candidateIndex = new Map<string, DiscoveryCandidate>();
  for (const cand of candidates) {
    if (!cand.claimKey) continue;
    candidateIndex.set(norm(cand.claimKey), cand);
  }

  for (const doc of sorted) {
    const signals = extractClaimSignals(doc);
    const claimKey = signals.claimNumber ? norm(signals.claimNumber) : null;

    let cluster: Cluster | null = null;
    if (claimKey) {
      cluster = get(claimKey, signals.claimNumber);
    } else if (signals.policy) {
      cluster = get(`POL:${norm(signals.policy)}`, null);
    } else if (signals.property && signals.carrier) {
      const datePart = signals.dateOfLoss ?? "no-date";
      cluster = get(`ADDR:${norm(signals.property)}|${norm(signals.carrier)}|${datePart}`, null);
    } else if (signals.property) {
      cluster = get(`ADDR:${norm(signals.property)}|no-carrier|${signals.dateOfLoss ?? "no-date"}`, null);
    }
    if (!cluster) {
      // No claim signals at all — evidence is kept for future reconciliation.
      continue;
    }
    cluster.docs.push(doc);
    // Index for candidate merging (claim number → cluster).
    if (claimKey) {
      const list = indexed.get(claimKey) ?? [];
      list.push(cluster);
      indexed.set(claimKey, list);
    }
  }

  // Merge persisted reconstruction candidates into their clusters (they carry
  // customer/property resolved during archive ingestion).
  for (const cand of candidates) {
    if (!cand.claimKey) continue;
    const key = norm(cand.claimKey);
    const list = indexed.get(key);
    const cluster = list?.[0];
    if (!cluster) continue;
    if (!cluster.candidateCustomer && cand.customer) cluster.candidateCustomer = cand.customer;
    if (!cluster.candidateProperty && cand.property) cluster.candidateProperty = cand.property;
    if (!cluster.candidateClaimNumber && cand.claimNumber) cluster.candidateClaimNumber = cand.claimNumber;
  }

  // Candidate-only clusters: a candidate whose documents were not scanned
  // (e.g. archive paths) still represents evidence — reconstruct it.
  for (const cand of candidates) {
    if (!cand.claimKey) continue;
    const key = norm(cand.claimKey);
    if (indexed.has(key)) continue;
    const docsFromCandidate = (cand.documentIds ?? [])
      .map((id) => sorted.find((d) => d._id === String(id)))
      .filter((d): d is DiscoveryDoc => Boolean(d));
    clusters.set(key, {
      key,
      claimNumber: cand.claimNumber ?? null,
      docs: docsFromCandidate,
      candidateCustomer: cand.customer ?? null,
      candidateProperty: cand.property ?? null,
      candidateClaimNumber: cand.claimNumber ?? null,
    });
  }

  return { clusters: [...clusters.values()], unclustered: sorted.length - [...clusters.values()].reduce((n, c) => n + c.docs.length, 0) };
}

// ---------------------------------------------------------------------------
// Confidence scoring (transparent)
// ---------------------------------------------------------------------------

export interface ScoredCluster {
  evidenceIds: string[];
  evidenceTitles: string[];
  docTypes: string[];
  claimNumber: ProvenanceValue | undefined;
  property: ProvenanceValue | undefined;
  policy: ProvenanceValue | undefined;
  carrier: ProvenanceValue | undefined;
  dateOfLoss: ProvenanceValue | undefined;
  causeOfLoss: ProvenanceValue | undefined;
  estimateAmount: ProvenanceValue | undefined;
  invoicedAmount: ProvenanceValue | undefined;
  paymentAmount: ProvenanceValue | undefined;
  deductible: ProvenanceValue | undefined;
  customer: ProvenanceValue | undefined;
  adjuster: ProvenanceValue | undefined;
  conflicts: DiscoveryConflict[];
  reasons: string[];
  confidence: number;
}

const TYPE_SUPPORT = new Set([
  "fnol",
  "policy",
  "estimate",
  "inspection",
  "photo",
  "correspondence",
  "payment",
  "invoice",
  "supplement",
  "report",
]);

/** Build a value with provenance from per-document signal candidates. */
function pickValue(
  field: string,
  candidates: Array<{ doc: DiscoveryDoc; value: string | number | null }>,
  fmt: (v: string | number) => string,
): { value: ProvenanceValue | undefined; conflicts: DiscoveryConflict[] } {
  const cleaned = candidates
    .filter((c) => c.value != null)
    .map((c) => ({ doc: c.doc, raw: fmt(c.value as string | number) }))
    .filter((c) => c.raw && c.raw !== "—");
  if (cleaned.length === 0) return { value: undefined, conflicts: [] };

  const byValue = new Map<string, Array<{ doc: DiscoveryDoc; raw: string }>>();
  for (const c of cleaned) {
    const list = byValue.get(c.raw) ?? [];
    list.push(c);
    byValue.set(c.raw, list);
  }
  const groups = [...byValue.entries()].sort(
    (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const [bestRaw, bestSources] = groups[0];
  const conflicts: DiscoveryConflict[] = [];
  if (groups.length > 1) {
    conflicts.push({
      field,
      values: groups.map(([raw, sources]) => ({
        value: raw,
        sourceDocumentId: sources[0].doc._id,
        sourceTitle: sources[0].doc.title ?? "Document",
        confidence: 0.6,
        agreeingSources: sources.map((s) => s.doc.title ?? "Document"),
      })),
      note: `“${field}” appears as ${groups
        .map(([raw]) => raw)
        .join(" and as ")} across the evidence. Both sources are preserved; reconcile before relying on either value.`,
    });
  }
  return {
    value: {
      value: bestRaw,
      sourceDocumentId: bestSources[0].doc._id,
      sourceTitle: bestSources[0].doc.title ?? "Document",
      confidence: Math.min(0.98, 0.7 + (bestSources.length - 1) * 0.08),
      agreeingSources: bestSources.map((s) => s.doc.title ?? "Document"),
    },
    conflicts,
  };
}

/**
 * Score a cluster and reconstruct its claim fields with provenance. The
 * scoring model is explicit — every point has a reason:
 *
 *   strong signals:  claim number (+0.35, +0.1 when consistent across docs),
 *                    policy (+0.15), property (+0.15), customer (+0.1),
 *                    carrier (+0.1), date of loss (+0.1)
 *   supporting:      cause of loss (+0.05), distinct supporting doc types
 *                    (+0.04 each, cap +0.2), cluster size ≥ 3 (+0.05)
 *
 * HIGH ≥ 0.60 (persist a claim), MEDIUM ≥ 0.35 (persist a reviewable
 * candidate), below that evidence is kept but nothing is manufactured.
 */
export function scoreCluster(
  cluster: Cluster,
  docsById: Map<string, DiscoveryDoc>,
): ScoredCluster {
  const reasons: string[] = [];
  let confidence = 0;

  const docValues = <T>(fn: (s: ClaimSignals) => T): Array<{ doc: DiscoveryDoc; value: T }> => {
    const out: Array<{ doc: DiscoveryDoc; value: T }> = [];
    for (const doc of cluster.docs) {
      const v = fn(extractClaimSignals(doc));
      if (v == null || v === "") continue;
      out.push({ doc, value: v });
    }
    return out;
  };

  const claimNumberCands = docValues((s) => s.claimNumber);
  let { value: claimNumber, conflicts: claimConflicts } = pickValue("Claim number", claimNumberCands, (v) => String(v));
  if (!claimNumber && cluster.candidateClaimNumber) {
    // A persisted reconstruction candidate (created during archive ingestion)
    // carries a claim identifier even when its evidence documents were not
    // re-scanned here. The candidate itself is evidence of a claim — credit
    // it so a candidate-only cluster is never silently dropped to
    // keep_evidence. It stays below the create threshold by design: a
    // candidate requires human approval before it becomes an authoritative
    // claim.
    claimNumber = {
      value: cluster.candidateClaimNumber,
      sourceDocumentId: cluster.docs[0]?._id ?? cluster.key,
      sourceTitle: "Atlas reconstruction candidate (archive-derived)",
      confidence: 0.7,
      agreeingSources: ["Atlas reconstruction candidate"],
    };
    reasons.push(`A reconstruction candidate for claim “${cluster.candidateClaimNumber}” already exists from archive ingestion.`);
  }
  if (claimNumber) {
    confidence += 0.35;
    reasons.push(`Claim number “${claimNumber.value}” found in ${claimNumber.agreeingSources.length} document(s) — strong identifier.`);
    if (claimNumber.agreeingSources.length >= 2) {
      confidence += 0.1;
      reasons.push("The same claim number is consistent across multiple documents.");
    }
  }

  const { value: policy, conflicts: policyConflicts } = pickValue("Policy number", docValues((s) => s.policy), (v) => String(v));
  if (policy) {
    confidence += 0.15;
    reasons.push(`Policy “${policy.value}” found — links the claim to coverage.`);
  }

  const { value: property, conflicts: propertyConflicts } = pickValue("Property", docValues((s) => s.property), (v) => String(v));
  if (property) {
    confidence += 0.15;
    reasons.push(`Property “${property.value}” found — ties the evidence to the insured location.`);
  }

  const { value: carrier, conflicts: carrierConflicts } = pickValue("Carrier", docValues((s) => s.carrier), (v) => String(v));
  if (carrier) {
    confidence += 0.1;
    reasons.push(`Carrier “${carrier.value}” identified.`);
  }

  const { value: dateOfLoss, conflicts: dolConflicts } = pickValue("Date of loss", docValues((s) => s.dateOfLoss), (v) => String(v));
  if (dateOfLoss) {
    confidence += 0.1;
    reasons.push(`Date of loss ${dateOfLoss.value} found.`);
  }

  const { value: causeOfLoss, conflicts: causeConflicts } = pickValue("Cause of loss", docValues((s) => s.causeOfLoss), (v) => String(v));
  if (causeOfLoss) {
    confidence += 0.05;
    reasons.push(`Cause of loss “${causeOfLoss.value}” found.`);
  }

  const { value: estimateAmount, conflicts: estConflicts } = pickValue("Estimate total", docValues((s) => s.estimateAmount), (v) => money(String(v)));
  const { value: invoicedAmount, conflicts: invConflicts } = pickValue("Invoice total", docValues((s) => s.invoicedAmount), (v) => money(String(v)));
  const { value: paymentAmount, conflicts: payConflicts } = pickValue("Payment amount", docValues((s) => s.paymentAmount), (v) => money(String(v)));
  const { value: deductible, conflicts: dedConflicts } = pickValue("Deductible", docValues((s) => s.deductible), (v) => money(String(v)));

  const docTypes = [...new Set(cluster.docs.map((d) => extractClaimSignals(d).docType).filter((t): t is string => t != null && TYPE_SUPPORT.has(t)))];
  const supportGain = Math.min(0.2, docTypes.length * 0.04);
  if (docTypes.length > 0) {
    confidence += supportGain;
    reasons.push(`Supporting evidence: ${docTypes.join(", ")}.`);
  }

  // Customer: from the persisted candidate (archive-resolved) when present.
  let customer: ProvenanceValue | undefined;
  if (cluster.candidateCustomer) {
    customer = {
      value: cluster.candidateCustomer,
      sourceDocumentId: cluster.docs[0]?._id ?? cluster.key,
      sourceTitle: "Atlas reconstruction candidate (archive-derived)",
      confidence: 0.8,
      agreeingSources: ["Atlas reconstruction candidate"],
    };
    confidence += 0.1;
    reasons.push(`Customer “${cluster.candidateCustomer}” resolved during ingestion.`);
  }

  if (cluster.docs.length >= 3) {
    confidence += 0.05;
    reasons.push(`${cluster.docs.length} evidence documents in the cluster.`);
  }

  const conflicts = [
    ...claimConflicts,
    ...policyConflicts,
    ...propertyConflicts,
    ...carrierConflicts,
    ...dolConflicts,
    ...causeConflicts,
    ...estConflicts,
    ...invConflicts,
    ...payConflicts,
    ...dedConflicts,
  ];

  const evidenceIds = cluster.docs.map((d) => d._id);
  const evidenceTitles = cluster.docs.map((d) => d.title ?? "Document");

  return {
    evidenceIds,
    evidenceTitles,
    docTypes,
    claimNumber,
    property,
    policy,
    carrier,
    dateOfLoss,
    causeOfLoss,
    estimateAmount,
    invoicedAmount,
    paymentAmount,
    deductible,
    customer,
    adjuster: undefined,
    conflicts,
    reasons,
    confidence: Math.round(Math.min(0.95, confidence) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Existing-claim matching + decisions
// ---------------------------------------------------------------------------

/**
 * Find the existing claim this evidence belongs to. Matching is strong and
 * conservative — a claim number match, a policy match, or the combination
 * (property + carrier + loss date) — so enrichment never hijacks a claim it
 * cannot tie to the evidence.
 */
export function matchExistingClaim(
  scored: ScoredCluster,
  claims: DiscoveryClaim[],
): DiscoveryClaim | null {
  const n = norm;
  const cn = scored.claimNumber ? n(scored.claimNumber.value) : null;
  const policy = scored.policy ? n(scored.policy.value) : null;
  const property = scored.property ? n(scored.property.value) : null;
  const carrier = scored.carrier ? n(scored.carrier.value) : null;
  const dol = scored.dateOfLoss?.value ?? null;

  for (const claim of claims) {
    if (cn && claim.claimNumber && n(claim.claimNumber) === cn) return claim;
  }
  for (const claim of claims) {
    if (policy && claim.policy && n(claim.policy) === policy) return claim;
  }
  for (const claim of claims) {
    // The claim record stores the FULL property address ("1427 Cypress Ridge
    // Drive, Lakeland FL 33813") while extraction captures the street portion
    // ("1427 Cypress Ridge Drive") — so matching is by normalized containment
    // either way, never a brittle exact-equality on a possibly longer string.
    const samePlace =
      property &&
      claim.property &&
      (n(claim.property) === property ||
        n(claim.property).includes(property) ||
        property.includes(n(claim.property)));
    const sameCarrier = carrier && claim.carrier && n(claim.carrier) === carrier;
    if (samePlace && sameCarrier) {
      const claimDol = claim.dateOfLoss ? normDate(claim.dateOfLoss) : null;
      if (dol && claimDol && dol === claimDol) return claim;
      if (!dol && !claimDol) return claim;
    }
  }
  return null;
}

/** Thresholds — a transparent line between create / propose / keep. */
export const DISCOVERY_THRESHOLDS = { HIGH: 0.6, MEDIUM: 0.35 } as const;

function tierFor(confidence: number): DiscoveryTier {
  if (confidence >= DISCOVERY_THRESHOLDS.HIGH) return "HIGH";
  if (confidence >= DISCOVERY_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

/**
 * Turn evidence clusters into reconstruction decisions. One decision per
 * cluster; every decision carries its evidence, confidence, reasons and
 * preserved conflicts. Existing claims are matched for enrichment BEFORE the
 * create/propose decision so incremental ingestion enriches the same claim
 * instead of creating a second one.
 */
export function decideClusters(
  clusters: Cluster[],
  claims: DiscoveryClaim[],
  docsById: Map<string, DiscoveryDoc>,
): ClaimDiscoveryDecision[] {
  const decisions: ClaimDiscoveryDecision[] = [];
  const claimNumbersByProperty = new Map<string, string[]>();

  const scored = clusters.map((c) => ({ cluster: c, scored: scoreCluster(c, docsById) }));
  // Sort deterministically (order-independent output).
  scored.sort((a, b) => {
    const an = a.scored.claimNumber?.value ?? "";
    const bn = b.scored.claimNumber?.value ?? "";
    if (an !== bn) return an < bn ? -1 : 1;
    return a.cluster.key < b.cluster.key ? -1 : a.cluster.key > b.cluster.key ? 1 : 0;
  });

  // Pass 1 — conflicting identifier detection: clusters sharing a property
  // with DIFFERENT claim numbers are flagged (never merged).
  for (const { scored: s } of scored) {
    if (!s.property || !s.claimNumber) continue;
    const p = norm(s.property.value);
    const list = claimNumbersByProperty.get(p) ?? [];
    list.push(s.claimNumber.value);
    claimNumbersByProperty.set(p, list);
  }

  for (const { cluster, scored: s } of scored) {
    const existing = matchExistingClaim(s, claims);
    const conflicts = [...s.conflicts];
    let identifierConflict: string | undefined;

    if (s.property && s.claimNumber) {
      const p = norm(s.property.value);
      const nums = [...new Set(claimNumbersByProperty.get(p) ?? [])];
      if (nums.length > 1) {
        identifierConflict = `Documents reference claim number${nums.length > 1 ? "s" : ""} ${nums
          .map((n) => `“${n}”`)
          .join(" and ")} for the same property. Atlas keeps them as separate review clusters — both identifiers and their sources are preserved; reconcile before merging.`;
        conflicts.push({
          field: "Claim identifier",
          values: nums.map((n) => ({
            value: n,
            sourceDocumentId: cluster.docs.find((d) => (extractClaimSignals(d).claimNumber ?? "") === n)?._id ?? "",
            sourceTitle:
              cluster.docs.find((d) => (extractClaimSignals(d).claimNumber ?? "") === n)?.title ?? "Document",
            confidence: 0.9,
            agreeingSources: cluster.docs
              .filter((d) => (extractClaimSignals(d).claimNumber ?? "") === n)
              .map((d) => d.title ?? "Document"),
          })),
          note: `Same property, different claim numbers (${nums.join(" vs ")}). Not merged automatically.`,
        });
      }
    }

    const tier = tierFor(s.confidence);
    let decision: DiscoveryDecisionKind;
    let targetClaimId: string | undefined;
    let targetClaimNumber: string | null | undefined;

    if (existing) {
      decision = "enrich";
      targetClaimId = existing._id;
      targetClaimNumber = existing.claimNumber ?? null;
    } else if (tier === "HIGH") {
      decision = "create";
    } else if (tier === "MEDIUM") {
      decision = "propose";
    } else {
      decision = "keep_evidence";
    }

    const summary =
      decision === "enrich"
        ? `Atlas matched ${cluster.docs.length} evidence item(s) to existing claim ${existing?.claimNumber ?? "without a claim number"} and will enrich it — no duplicate is created.`
        : decision === "create"
          ? `Atlas reconstructed ${cluster.docs.length === 1 ? "a claim from 1 evidence item" : `a claim from ${cluster.docs.length} evidence items`}${s.claimNumber ? ` (claim ${s.claimNumber.value})` : ""} with ${s.confidence} confidence (${tier}) and will persist it.`
          : decision === "propose"
            ? `Atlas found ${cluster.docs.length === 1 ? "a possible claim from 1 evidence item" : `a possible claim from ${cluster.docs.length} evidence items`} with ${s.confidence} confidence (${tier}) — a reviewable candidate is created; nothing is treated as a definitive claim.`
            : `Atlas found ${cluster.docs.length === 1 ? "1 evidence item" : `${cluster.docs.length} evidence items`} that do not yet establish a claim (${s.confidence} confidence) — the evidence stays available for future reconciliation.`;

    decisions.push({
      clusterKey: cluster.key,
      claimNumber: s.claimNumber,
      customer: s.customer,
      property: s.property,
      policy: s.policy,
      carrier: s.carrier,
      adjuster: s.adjuster,
      dateOfLoss: s.dateOfLoss,
      causeOfLoss: s.causeOfLoss,
      estimateAmount: s.estimateAmount,
      invoicedAmount: s.invoicedAmount,
      paymentAmount: s.paymentAmount,
      deductible: s.deductible,
      evidenceIds: s.evidenceIds,
      evidenceTitles: s.evidenceTitles,
      docTypes: s.docTypes,
      confidence: s.confidence,
      tier,
      decision,
      targetClaimId,
      targetClaimNumber,
      conflicts,
      identifierConflict,
      reasons: s.reasons,
      summary,
    });
  }

  return decisions;
}

// ---------------------------------------------------------------------------
// Top-level entry
// ---------------------------------------------------------------------------

/**
 * Discover claims from tenant evidence (documents + reconstruction
 * candidates) against the tenant's existing claims. Pure and deterministic —
 * the caller decides how to persist each decision.
 */
export function discoverClaims(
  docs: DiscoveryDoc[],
  candidates: DiscoveryCandidate[] = [],
  existingClaims: DiscoveryClaim[] = [],
): ClaimDiscoveryReport {
  const { clusters, unclustered } = clusterEvidence(docs, candidates);
  const docsById = new Map(docs.map((d) => [d._id, d]));
  const decisions = decideClusters(clusters, existingClaims, docsById);
  return { decisions, unclustered };
}

/** True when a document is worth scanning for claim signals. */
export function isDiscoveryCandidateDoc(doc: DiscoveryDoc): boolean {
  if (doc.classification) return true;
  return looksClaimRelated(`${doc.title ?? ""} ${doc.summary ?? ""}`);
}

// ---------------------------------------------------------------------------
// Row → engine mappers (client-side persistence boundary)
// ---------------------------------------------------------------------------

/** Map an insurance_list_claims row (raw claim object) to the engine type. */
export function toDiscoveryClaim(raw: Record<string, unknown>): DiscoveryClaim {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    _id: raw._id != null ? String(raw._id) : "",
    claimNumber: typeof raw.claimNumber === "string" ? raw.claimNumber : null,
    customer: typeof raw.customer === "string" ? raw.customer : null,
    property: typeof raw.property === "string" ? raw.property : null,
    carrier: typeof raw.carrier === "string" ? raw.carrier : null,
    policy: typeof raw.policy === "string" ? raw.policy : null,
    adjuster: typeof raw.adjuster === "string" ? raw.adjuster : null,
    dateOfLoss: num(raw.dateOfLoss),
    causeOfLoss: typeof raw.causeOfLoss === "string" ? raw.causeOfLoss : null,
    estimateAmount: num(raw.estimateAmount),
    paymentAmount: num(raw.paymentAmount),
    invoicedAmount: num(raw.invoicedAmount),
    approvedAmount: num(raw.approvedAmount),
    deductible: num(raw.deductible),
    status: typeof raw.status === "string" ? raw.status : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    evidenceSummary: Array.isArray(raw.evidenceSummary)
      ? raw.evidenceSummary.map((x) => String(x ?? ""))
      : null,
    evidenceDocumentIds: Array.isArray(raw.evidenceDocumentIds)
      ? raw.evidenceDocumentIds
      : null,
  };
}

/** Map an insurance_list_claim_candidates row to the engine type. */
export function toDiscoveryCandidate(raw: Record<string, unknown>): DiscoveryCandidate {
  return {
    _id: raw._id != null ? String(raw._id) : undefined,
    claimKey: typeof raw.claimKey === "string" ? raw.claimKey : null,
    claimNumber: typeof raw.claimNumber === "string" ? raw.claimNumber : null,
    customer: typeof raw.customer === "string" ? raw.customer : null,
    property: typeof raw.property === "string" ? raw.property : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    status: typeof raw.status === "string" ? raw.status : null,
    documentIds: Array.isArray(raw.documentIds)
      ? raw.documentIds.map((x) => String(x ?? ""))
      : null,
    documentTitles: Array.isArray(raw.documentTitles)
      ? raw.documentTitles.map((x) => String(x ?? ""))
      : null,
  };
}

/** "YYYY-MM-DD" → epoch-ms (the persisted claim contract stores bigint ms). */
export function toEpochMs(date: string): number | null {
  const ts = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ts) ? null : ts;
}

/** "$12,500" → number (claim amounts are stored as doubles). */
export function toMoney(moneyString: string): number | null {
  const n = Number.parseFloat(moneyString.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
