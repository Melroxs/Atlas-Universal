// ---------------------------------------------------------------------------
// Archive detail response normalization — the authoritative boundary between
// the archive_get_detail RPC and every consumer (ArchiveDetail page, client
// processing loop).
//
// Production defect this exists for: after an archive finishes ingestion the
// page navigated to ArchiveDetail and crashed with
//
//   Cannot read properties of undefined (reading 'length')
//
// because archive_get_detail returns jsonb where optional collections can be
// missing/null (archive.warnings, files, docs, candidates, archive.stats…).
// The page rendered `archive.warnings.length` on undefined.
//
// SECOND defect class (still live in production, THIS normalizer's real job):
// the RPC returns raw table rows where individual COLUMNS are nullable or
// simply don't exist on the table the page assumes they do. Concretely:
//
//   - claimCandidates has NO `documentIds` column (it has filePaths) and its
//     `evidence` column is nullable → the page's
//     `c.evidence.length + c.documentIds.length` threw
//     "Cannot read properties of undefined (reading 'length')" inside an
//     Array.map callback for any archive with a claim candidate.
//   - archiveFiles.classification is nullable → `f.classification.replace()`
//     threw inside the file-inventory map.
//   - archive.status / fileType are nullable in legacy rows → titleCase() /
//     .toUpperCase() threw on the header.
//
// Rule: NO archive-detail value consumed by the render path may ever be
// undefined/null at the boundary. Missing/null collections become [] / {},
// missing/null scalars get honest defaults ("" / 0 / null / false), and every
// file/candidate row is normalized field-by-field. Nothing is fabricated — an
// empty classification stays empty, a missing claim stays missing.
//
// A null RESPONSE (archive not found / RPC failure) stays null so the page can
// show an explicit error state instead of a blank or a fake empty archive.
// ---------------------------------------------------------------------------

export interface NormalizedArchiveFile {
  _id: string;
  path: string;
  filename: string;
  mimeType: string | null;
  size: number;
  storageId: string | null;
  ingestStatus: string;
  documentId: string | null;
  error: string | null;
  blockReason: string | null;
  isDuplicate: boolean;
  duplicateOfPath: string | null;
  isSuperseded: boolean;
  supersedesPath: string | null;
  versionGroup: string | null;
  classification: string;
  classificationConfidence: number;
  claimHints: Array<{ claimNumber: string; confidence?: number }>;
  [k: string]: unknown;
}

export interface NormalizedArchiveCandidate {
  _id: string;
  claimNumber: string | null;
  customer: string | null;
  property: string | null;
  confidence: number;
  status: string;
  basis: string;
  evidence: string[];
  documentIds: string[];
  fileCount: number;
  filePaths: string[];
  [k: string]: unknown;
}

export interface NormalizedArchiveDetail {
  /** Null when the RPC returns null (not found / failure) — never normalized. */
  archive: Record<string, any> & {
    status: string;
    filename: string;
    fileType: string;
    compressedSize: number;
    extractedSize: number;
    fileCount: number;
    checksum: string;
    progress: number;
    rawRetained: boolean;
    createdAt: number;
    completedAt: number | null;
    failureReason: string | null;
    warnings: string[];
    stats: Record<string, any>;
  };
  files: NormalizedArchiveFile[];
  docs: Record<string, { _id: string; title: string; classification: string; status: string }>;
  candidates: NormalizedArchiveCandidate[];
}

function asArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Normalize one archiveFiles row — every field the page renders has a default. */
function normalizeFileRow(raw: unknown): NormalizedArchiveFile {
  const row = asObject(raw);
  return {
    ...row,
    _id: str(row._id),
    path: str(row.path),
    filename: str(row.filename),
    mimeType: strOrNull(row.mimeType),
    size: num(row.size),
    storageId: strOrNull(row.storageId),
    ingestStatus: str(row.ingestStatus),
    documentId: strOrNull(row.documentId),
    error: strOrNull(row.error),
    blockReason: strOrNull(row.blockReason),
    isDuplicate: bool(row.isDuplicate),
    duplicateOfPath: strOrNull(row.duplicateOfPath),
    isSuperseded: bool(row.isSuperseded),
    supersedesPath: strOrNull(row.supersedesPath),
    versionGroup: strOrNull(row.versionGroup),
    classification: str(row.classification),
    classificationConfidence: num(row.classificationConfidence),
    // The page renders `(f.claimHints ?? []).map(...)` — guarantee the array.
    claimHints: asArray(row.claimHints).map((h) => {
      const hint = asObject(h);
      return {
        ...hint,
        claimNumber: str(hint.claimNumber),
        confidence: typeof hint.confidence === "number" ? hint.confidence : undefined,
      };
    }),
  };
}

/**
 * Normalize one claimCandidates row. The deployed table has NO `documentIds`
 * column and its `evidence` column is nullable — the page renders
 * `c.evidence.length + c.documentIds.length`, so both MUST be arrays at the
 * boundary (this was the live production crash: undefined.length inside an
 * Array.map callback).
 */
function normalizeCandidateRow(raw: unknown): NormalizedArchiveCandidate {
  const row = asObject(raw);
  return {
    ...row,
    _id: str(row._id),
    claimNumber: strOrNull(row.claimNumber),
    customer: strOrNull(row.customer),
    property: strOrNull(row.property),
    confidence: num(row.confidence),
    status: str(row.status),
    basis: str(row.basis) || str(row.claimKey),
    evidence: asArray(row.evidence).map((e) => (typeof e === "string" ? e : String(e ?? ""))),
    documentIds: asArray(row.documentIds).map((d) =>
      typeof d === "string" ? d : String(d ?? ""),
    ),
    fileCount: num(row.fileCount),
    filePaths: asArray(row.filePaths).map((p) => (typeof p === "string" ? p : String(p ?? ""))),
  };
}

/**
 * Normalize an archive_get_detail jsonb payload. Returns null for nullish
 * input so the query layer's null semantics (not found / failure) are
 * preserved. On a non-null result EVERY value the page renders is guaranteed:
 * collections are arrays, objects are objects, scalars have honest defaults,
 * and each file/candidate row is normalized field-by-field.
 */
export function normalizeArchiveDetailResponse(
  raw: unknown,
): NormalizedArchiveDetail | null {
  if (raw === null || raw === undefined) return null;
  const detail = asObject(raw);

  const archive = asObject(detail.archive);
  const stats = asObject(archive.stats);
  const normalizedArchive = {
    ...archive,
    status: str(archive.status),
    filename: str(archive.filename),
    fileType: str(archive.fileType),
    compressedSize: num(archive.compressedSize),
    extractedSize: num(archive.extractedSize),
    fileCount: num(archive.fileCount),
    checksum: str(archive.checksum),
    progress: num(archive.progress),
    rawRetained: bool(archive.rawRetained),
    createdAt: num(archive.createdAt),
    completedAt: typeof archive.completedAt === "number" ? archive.completedAt : null,
    failureReason: strOrNull(archive.failureReason),
    warnings: asArray(archive.warnings).map((w) => String(w ?? "")),
    stats: {
      ...stats,
      // The page renders `(stats.potentialClaims ?? []).map(...)` and
      // `Object.entries(stats.classifications)` — never a scalar count or null.
      potentialClaims: asArray(stats.potentialClaims),
      classifications: asObject(stats.classifications),
    },
  };

  const files = asArray(detail.files).map(normalizeFileRow);

  const docs = asObject(detail.docs);
  const normalizedDocs: Record<
    string,
    { _id: string; title: string; classification: string; status: string }
  > = {};
  for (const [key, value] of Object.entries(docs)) {
    const d = asObject(value);
    normalizedDocs[key] = {
      _id: str(d._id),
      title: str(d.title),
      classification: str(d.classification),
      status: str(d.status),
    };
  }

  return {
    archive: normalizedArchive,
    files,
    docs: normalizedDocs,
    candidates: asArray(detail.candidates).map(normalizeCandidateRow),
  };
}
