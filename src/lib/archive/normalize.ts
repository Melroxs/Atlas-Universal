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
// Rule: NO archive-detail collection may ever be undefined at the boundary.
// Missing/null collections become [] / {} — never fabricated records. A null
// response (archive not found / RPC failure) stays null so the page can show
// an explicit error state instead of a blank or a fake empty archive.
// ---------------------------------------------------------------------------

export interface NormalizedArchiveFile {
  _id?: string;
  path?: string;
  filename?: string;
  mimeType?: string | null;
  size?: number;
  storageId?: string | null;
  ingestStatus?: string;
  documentId?: string | null;
  error?: string | null;
  blockReason?: string | null;
  isDuplicate?: boolean;
  duplicateOfPath?: string | null;
  isSuperseded?: boolean;
  supersedesPath?: string | null;
  versionGroup?: string | null;
  classification?: string;
  classificationConfidence?: number;
  claimHints?: Array<{ claimNumber: string; confidence?: number }> | null;
  [k: string]: unknown;
}

export interface NormalizedArchiveDetail {
  /** Null when the RPC returns null (not found / failure) — never normalized. */
  archive: Record<string, any> & {
    status?: string;
    warnings: string[];
    stats: Record<string, any>;
    checksum?: string;
    fileCount?: number;
    progress?: number;
  };
  files: NormalizedArchiveFile[];
  docs: Record<string, any>;
  candidates: Array<Record<string, any>>;
}

function asArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

/**
 * Normalize an archive_get_detail jsonb payload. Returns null for nullish
 * input so the query layer's null semantics (not found / failure) are
 * preserved; every collection field on a non-null result is guaranteed to be
 * an array (files/candidates/warnings) or object (docs/stats).
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
    warnings: asArray(archive.warnings).map((w) => String(w ?? "")),
    stats: {
      ...stats,
      // The page renders `(stats.potentialClaims ?? []).map(...)` and
      // `Object.entries(stats.classifications)`, so these must be array/object
      // — never a scalar count or null (coerce honestly to empty).
      potentialClaims: asArray(stats.potentialClaims),
      classifications: asObject(stats.classifications),
    },
    checksum: typeof archive.checksum === "string" ? archive.checksum : "",
    fileCount: typeof archive.fileCount === "number" ? archive.fileCount : 0,
    progress: typeof archive.progress === "number" ? archive.progress : 0,
  };

  const files = asArray(detail.files).map((f) => {
    const row = asObject(f);
    return {
      ...row,
      claimHints: asArray(row.claimHints),
    };
  });

  return {
    archive: normalizedArchive,
    files,
    docs: asObject(detail.docs),
    candidates: asArray(detail.candidates),
  };
}
