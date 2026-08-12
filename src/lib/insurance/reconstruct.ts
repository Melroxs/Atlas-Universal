/**
 * Phase 14 — claim reconstruction (pure, deterministic).
 *
 * Atlas reconstructs POTENTIAL claims from company data using deterministic
 * identifiers (claim numbers in filenames, titles and text). It never turns
 * these into authoritative claims automatically — every candidate carries its
 * evidence, basis and confidence, and requires human approval (§5, §24).
 *
 * These functions are pure (no Convex imports) so the clustering and
 * confidence rules are unit tested and reused by the document scan, the
 * archive importer and the review UI.
 */

// ---------------------------------------------------------------------------
// Deterministic claim-number extraction (mirrors the archive client rules).
// ---------------------------------------------------------------------------

const CLAIM_NUMBER_PATTERNS: Array<RegExp> = [
  /(?:claim|clm)[-_. ]?(\d{3,12})/i,
  /\b(?:CL|CLM|CN)\d{4,12}(?=[._-]|\b)/i,
  /\b\d{4,12}(?=[._-]|\b)/,
];

/** Extract the first claim number found in arbitrary text, or null. */
export function extractClaimNumber(text: string): string | null {
  if (!text) return null;
  for (const re of CLAIM_NUMBER_PATTERNS) {
    const m = text.match(re);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return null;
}

/** Whether text looks claim-related at all (used to skip irrelevant docs). */
export function looksClaimRelated(text: string): boolean {
  return /claims?|adjuster|carrier|estimate|invoice|supplement|date of loss|insurance|policy|contract|payment|correspondence|scope/i.test(
    text ?? "",
  );
}

/** Derive a customer name from a path like “Clients/ABC Restoration/Claims/…”. */
export function deriveCustomerFromPath(path: string): string | null {
  const segments = (path ?? "").split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    if (/^(clients|customers)$/i.test(segments[i])) {
      const name = segments[i + 1]?.trim();
      if (name && !/^(claims?|invoices?|estimates?|202\d|20\d\d|photos?)$/i.test(name)) {
        return name;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate model
// ---------------------------------------------------------------------------

export interface CandidateEvidence {
  /** Normalized claim identifier (upper-cased for deterministic grouping). */
  claimKey: string;
  /** The claim number as found (original casing). */
  claimNumber: string;
  customer?: string;
  property?: string;
  /** Supporting document ids (tenant-scoped by the caller). */
  documentIds: string[];
  /** Supporting archive paths (when the source is an archive). */
  archivePaths: string[];
  /** Human-readable evidence list (paths / titles). */
  evidence: string[];
  /** Deterministic confidence from the evidence weight. */
  confidence: number;
  /** Why Atlas grouped these records into one candidate. */
  basis: string;
}

interface DocumentLike {
  _id: string;
  title: string;
  /** Small content sample (first chunk text) for number extraction. */
  content?: string;
}

/**
 * Cluster tenant documents by claim number. A document only joins a cluster
 * when a deterministic claim number is found in its title (strong) or content
 * (weaker). Ambiguous documents (no number) never become candidates.
 */
export function clusterDocumentsByClaimNumber(
  docs: DocumentLike[],
): CandidateEvidence[] {
  const clusters = new Map<string, CandidateEvidence>();

  for (const doc of docs) {
    const titleNum = extractClaimNumber(doc.title);
    const textNum = titleNum
      ? null
      : extractClaimNumber(doc.content ?? "");
    const num = titleNum ?? textNum;
    if (!num) continue;

    const key = num.toUpperCase();
    let c = clusters.get(key);
    if (!c) {
      c = {
        claimKey: key,
        claimNumber: num,
        documentIds: [],
        archivePaths: [],
        evidence: [],
        confidence: 0,
        basis: "",
      };
      clusters.set(key, c);
    }
    c.documentIds.push(doc._id);
    c.evidence.push(doc.title);
  }

  return [...clusters.values()].map((c) => {
    const count = c.documentIds.length;
    // Title matches are stronger than content-only matches; more records
    // raise confidence, capped — never inflated to certainty.
    const titleMatched = docs.filter(
      (d) => c.documentIds.includes(d._id) && extractClaimNumber(d.title) !== null,
    ).length;
    const base = titleMatched > 0 ? 0.78 : 0.6;
    const confidence = Math.min(0.95, base + (count - 1) * 0.04);
    const samples = c.evidence.slice(0, 4).join(", ");
    const basis = `Claim number “${c.claimNumber}” appears in ${count} document${count === 1 ? "" : "s"} (${samples}${count > 4 ? ", …" : ""}). Atlas treats this as a POTENTIAL claim until a person confirms it.`;
    return { ...c, confidence, basis };
  });
}

/**
 * Build a candidate from archive-derived claim hints (Phase 13 stats).
 * The stats already group files by claim number with sample paths.
 */
export function buildCandidateFromArchive(input: {
  claimNumber: string;
  fileCount: number;
  confidence: number;
  samplePaths: string[];
}): CandidateEvidence {
  const num = input.claimNumber;
  const customer = input.samplePaths.map(deriveCustomerFromPath).find(Boolean) ?? undefined;
  const evidence = input.samplePaths.slice(0, 8);
  const confidence = Math.min(0.95, Math.max(0.35, input.confidence));
  const basis = `Claim number “${num}” was referenced by ${input.fileCount} file${input.fileCount === 1 ? "" : "s"} in an imported company-data archive (e.g. ${evidence.slice(0, 3).join(", ")}). Atlas treats this as a POTENTIAL claim until a person confirms it.`;
  return {
    claimKey: num.toUpperCase(),
    claimNumber: num,
    customer,
    documentIds: [],
    archivePaths: evidence,
    evidence,
    confidence,
    basis,
  };
}

/** Sanitize a candidate into a stable dedupe key (tenant-safe claimKey). */
export function candidateKey(tenantId: string, claimKey: string): string {
  return `${tenantId}:${claimKey}`;
}
