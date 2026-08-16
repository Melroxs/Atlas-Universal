// ---------------------------------------------------------------------------
// Regression tests for the discovered production failure:
//
//   Cannot read properties of undefined (reading 'length')
//   at ArchiveDetail (Array.map / Array.filter render path)
//
// The crash fired IMMEDIATELY AFTER an archive finished ingesting, when the
// app navigated from the processing screen to ArchiveDetail. archive_get_detail
// returns jsonb where optional collections (archive.warnings, files, docs,
// candidates, archive.stats) can be missing or null — the page rendered
// `archive.warnings.length` on undefined.
//
// These tests pin the normalizeArchiveDetailResponse boundary (used by the
// api.archive.getArchiveDetail transform AND the client processing loop) so
// no collection can ever reach the page as undefined, and replay every
// collection access the ArchiveDetail render path performs to prove the
// exact production crash class cannot reappear.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { normalizeArchiveDetailResponse } from "@/lib/archive/normalize";
import { api } from "@/lib/api";

/**
 * Replay every collection access ArchiveDetail's render path performs against
 * a normalized response. Any undefined collection would throw here exactly the
 * way it did in production (reading 'length' / 'map' / 'filter' / 'slice').
 */
function assertRenderable(normalized: NonNullable<ReturnType<typeof normalizeArchiveDetailResponse>>) {
  const archive = normalized.archive;
  const files = normalized.files;
  const docs = normalized.docs as Record<string, { _id: string; title: string }>;
  const candidates = normalized.candidates as Array<{
    _id: string;
    status: string;
    claimNumber?: string;
    evidence: string[];
    documentIds: string[];
  }>;

  // The exact crash site.
  expect(archive.warnings.length).toBeGreaterThanOrEqual(0);
  void archive.warnings.map((w: string) => String(w));

  // Header reads.
  expect(archive.checksum.slice(0, 16)).toBeTypeOf("string");
  expect(archive.fileCount.toLocaleString()).toBeTypeOf("string");

  // Stats chips + classifications + potential claims.
  const st = archive.stats ?? {};
  for (const key of ["ingested", "failed", "duplicates", "unsupported", "blocked", "tooLarge"]) {
    void (typeof st[key] === "number" ? st[key] : 0);
  }
  const classifications = st.classifications ?? {};
  void Object.entries(classifications);
  const potentialClaims = st.potentialClaims ?? [];
  expect(Array.isArray(potentialClaims)).toBe(true);
  void potentialClaims.map((c: { claimNumber: string }) => c.claimNumber);

  // Candidate rendering.
  expect(Array.isArray(candidates)).toBe(true);
  const pending = candidates.filter((c) => c.status === "pending");
  void pending.map((c) => c.evidence.length + c.documentIds.length);

  // File inventory rendering.
  expect(Array.isArray(files)).toBe(true);
  void files.length.toLocaleString();
  const failedFiles = files.filter((f) => f.ingestStatus === "failed");
  void failedFiles.length;
  void files.map((f) => {
    const doc = f.documentId ? docs[String(f.documentId)] : undefined;
    void doc;
    void f.path;
    void f.classification.replace(/_/g, " ");
    void f.size;
    void f.ingestStatus;
    if (f.error) void f.error.length;
    void (f.claimHints ?? []).length;
  });
}

describe("normalizeArchiveDetailResponse — ArchiveDetail crash contract", () => {
  it("normalizes a normal completed archive (113 files / 105 documents shape)", () => {
    const files = Array.from({ length: 113 }, (_, i) => ({
      _id: `file-${i}`,
      path: `Claims/Claim-100${i % 10}/invoice-${i}.pdf`,
      filename: `invoice-${i}.pdf`,
      mimeType: "application/pdf",
      size: 1000 + i,
      storageId: `folder/file-${i}`,
      ingestStatus: i < 105 ? "ingested" : "unsupported",
      documentId: i < 105 ? `doc-${i}` : null,
      classification: "Invoice",
      classificationConfidence: 0.9,
      claimHints: [{ claimNumber: `100${i % 10}`, confidence: 0.8 }],
    }));
    const docs: Record<string, unknown> = {};
    for (let i = 0; i < 105; i++) {
      docs[`doc-${i}`] = { _id: `doc-${i}`, title: `invoice-${i}.pdf`, classification: "Invoice", status: "ready" };
    }
    const raw = {
      archive: {
        _id: "archive-1",
        status: "completed",
        filename: "npp-demo.zip",
        fileType: "zip",
        compressedSize: 12_000_000,
        extractedSize: 90_000_000,
        fileCount: 113,
        checksum: "abc123",
        createdAt: 1_700_000_000_000,
        completedAt: 1_700_000_000_500,
        rawRetained: true,
        progress: 1,
        warnings: [],
        // The client processing loop writes the COUNT here; the page renders
        // an ARRAY. The normalizer must coerce the scalar to [] (honest empty)
        // so the page's `.map` never hits a number.
        stats: {
          ingested: 105,
          failed: 0,
          total: 113,
          potentialClaims: 3,
          classifications: { invoice: 90, estimate: 15 },
        },
      },
      files,
      docs,
      candidates: [
        { _id: "cand-1", claimNumber: "1001", status: "pending", confidence: 0.9, basis: "filename", evidence: ["doc-1"], documentIds: ["doc-1"] },
      ],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.archive.status).toBe("completed");
    expect(norm.files).toHaveLength(113);
    expect(norm.archive.stats.ingested).toBe(105);
    expect(norm.candidates).toHaveLength(1);
    // Scalar potentialClaims count is coerced to [] — never a number the page
    // would `.map()`.
    expect(norm.archive.stats.potentialClaims).toEqual([]);
    expect(norm.archive.stats.classifications).toEqual({ invoice: 90, estimate: 15 });
    assertRenderable(norm);
  });

  it("survives MISSING array fields — the exact production crash class", () => {
    // The deployed RPC response shape that caused the crash: archive row only,
    // no warnings, no files, no docs, no candidates.
    const raw = { archive: { _id: "archive-1", status: "completed" } };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    // NO collection may be undefined; defaults are [] / {}.
    expect(norm.archive.warnings).toEqual([]);
    expect(norm.files).toEqual([]);
    expect(norm.docs).toEqual({});
    expect(norm.candidates).toEqual([]);
    expect(norm.archive.stats).toEqual({ classifications: {}, potentialClaims: [] });
    expect(norm.archive.checksum).toBe("");
    // The exact production crash expression must not throw.
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("survives NULL array fields (null collections from the RPC)", () => {
    const raw = {
      archive: {
        _id: "archive-1",
        status: "completed_with_warnings",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 0,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: null,
        stats: null,
      },
      files: null,
      docs: null,
      candidates: null,
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.archive.warnings).toEqual([]);
    expect(norm.files).toEqual([]);
    expect(norm.docs).toEqual({});
    expect(norm.candidates).toEqual([]);
    expect(norm.archive.stats).toEqual({ classifications: {}, potentialClaims: [] });
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("handles an empty archive (zero files) without confusing it with loading", () => {
    const raw = {
      archive: {
        _id: "archive-1",
        status: "completed",
        filename: "empty.zip",
        fileType: "zip",
        compressedSize: 0,
        extractedSize: 0,
        fileCount: 0,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        stats: { ingested: 0, failed: 0, total: 0 },
      },
      files: [],
      docs: {},
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.files).toHaveLength(0);
    // Loaded-but-empty: the page renders the "No files were recorded" state,
    // never a crash and never a spinner.
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("preserves completed_with_warnings + per-file failures", () => {
    const raw = {
      archive: {
        _id: "archive-1",
        status: "completed_with_warnings",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 2,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: ["2 files failed to ingest.", "1 file was unsupported."],
        failureReason: "2 files failed to ingest.",
        stats: { ingested: 3, failed: 2, total: 5, unsupported: 1 },
      },
      files: [
        { _id: "f1", path: "a.pdf", filename: "a.pdf", ingestStatus: "ingested", documentId: "d1", classification: "Invoice", size: 1 },
        { _id: "f2", path: "b.pdf", filename: "b.pdf", ingestStatus: "failed", error: "no text layer", storageId: "b", classification: "Other", size: 1 },
      ],
      docs: { d1: { _id: "d1", title: "a.pdf", classification: "Invoice", status: "ready" } },
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.archive.status).toBe("completed_with_warnings");
    expect(norm.archive.warnings).toHaveLength(2);
    expect(norm.files.filter((f) => f.ingestStatus === "failed")).toHaveLength(1);
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("preserves a fully failed archive (terminal failed state)", () => {
    const raw = {
      archive: {
        _id: "archive-1",
        status: "failed",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 2,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        failureReason: "2 files failed to ingest.",
        stats: { ingested: 0, failed: 2, total: 2 },
      },
      files: [
        { _id: "f1", path: "a.pdf", filename: "a.pdf", ingestStatus: "failed", error: "no text layer", storageId: null, classification: "Other", size: 1 },
        { _id: "f2", path: "b.pdf", filename: "b.pdf", ingestStatus: "failed", error: "missing from storage", storageId: null, classification: "Other", size: 1 },
      ],
      docs: {},
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.archive.status).toBe("failed");
    expect(norm.archive.failureReason).toContain("2 files failed");
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("returns null for a null response (RPC failure / not found) — page shows the error state", () => {
    // archive_get_detail genuinely failing (or an archive outside the tenant)
    // returns null; the boundary must keep null so the page can render the
    // explicit "Unable to load archive details" + Retry state.
    expect(normalizeArchiveDetailResponse(null)).toBeNull();
    expect(normalizeArchiveDetailResponse(undefined)).toBeNull();
  });

  it("renders the shape right after ingestion completes (the navigation transition)", () => {
    // beginProcessing patches the archive to its terminal state and the page
    // mounts immediately after. This is the exact production window: fresh
    // terminal status + full file states, but optional collections can still
    // arrive sparse (e.g. warnings omitted, candidates absent pre-upsert).
    const raw = {
      archive: {
        _id: "archive-1",
        status: "completed",
        filename: "npp.zip",
        fileType: "zip",
        compressedSize: 8_000_000,
        extractedSize: 61_000_000,
        fileCount: 113,
        checksum: "deadbeef",
        createdAt: 1_700_000_000_000,
        completedAt: 1_700_000_000_500,
        rawRetained: false,
        progress: 1,
        stats: { ingested: 105, failed: 0, total: 113, potentialClaims: 2, completedAt: 1_700_000_000_500 },
      },
      files: Array.from({ length: 113 }, (_, i) => ({
        _id: `file-${i}`,
        path: `F/${i}.pdf`,
        filename: `${i}.pdf`,
        mimeType: "application/pdf",
        size: 500,
        storageId: `f/${i}`,
        ingestStatus: "ingested",
        documentId: `doc-${i}`,
        classification: "Invoice",
        classificationConfidence: 0.9,
        claimHints: [{ claimNumber: "1001", confidence: 0.8 }],
      })),
      // docs omitted — the RPC may not include it on this snapshot
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.files).toHaveLength(113);
    expect(() => assertRenderable(norm)).not.toThrow();
  });
});

describe("per-row crash class — nullable/missing COLUMNS (the live production bug)", () => {
  it("candidate rows WITHOUT documentIds (deployed claimCandidates has no such column) + NULL evidence", () => {
    // The deployed claimCandidates table has filePaths + nullable evidence but
    // NO documentIds column. The page renders `c.evidence.length +
    // c.documentIds.length` inside pendingCandidates.map() — this is the
    // exact live crash (`Cannot read properties of undefined (reading
    // 'length')` in an Array.map callback). The normalizer must synthesize
    // BOTH as arrays at the boundary.
    const raw = {
      archive: {
        _id: "a1",
        status: "completed",
        filename: "npp.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 1,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        stats: { ingested: 1, failed: 0, total: 1 },
      },
      files: [],
      docs: {},
      candidates: [
        {
          _id: "cand-1",
          claimNumber: "GAP-26-51847",
          customer: "NPP Roofing & Restoration",
          status: "pending",
          confidence: 0.91,
          basis: "folder context",
          evidence: null, // nullable column, null in the raw row
          filePaths: ["Claims/GAP-26-51847/a.pdf"],
          // documentIds: ABSENT — the column does not exist on the table
        },
      ],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    expect(norm.candidates).toHaveLength(1);
    const c = norm.candidates[0];
    expect(c.evidence).toEqual([]);
    expect(c.documentIds).toEqual([]);
    // The exact render expression the page runs:
    expect(() => c.evidence.length + c.documentIds.length).not.toThrow();
    expect(c.evidence.length + c.documentIds.length).toBe(0);
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("file rows with NULL classification (nullable column) — .replace() must not throw", () => {
    const raw = {
      archive: {
        _id: "a1",
        status: "completed",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 1,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        stats: { ingested: 1, failed: 0, total: 1 },
      },
      files: [
        {
          _id: "f1",
          path: "a.pdf",
          filename: "a.pdf",
          ingestStatus: "ingested",
          documentId: "d1",
          classification: null, // nullable column
          classificationConfidence: null,
          size: 1,
          claimHints: null,
        },
      ],
      docs: { d1: { _id: "d1", title: "a.pdf" } },
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    const f = norm.files[0];
    expect(() => f.classification.replace(/_/g, " ")).not.toThrow();
    expect(f.classification).toBe("");
    expect(f.classificationConfidence).toBe(0);
    expect(f.claimHints).toEqual([]);
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("archive row with NULL status / fileType / checksum / missing stats — header .toUpperCase()/.replace()/slice() must not throw", () => {
    const raw = {
      archive: {
        _id: "a1",
        status: null, // nullable in legacy rows
        filename: "x.zip",
        fileType: null,
        compressedSize: null,
        extractedSize: null,
        fileCount: null,
        checksum: null,
        createdAt: null,
        rawRetained: null,
        progress: null,
        completedAt: null,
        failureReason: null,
        warnings: null,
        // stats: entirely absent
      },
      files: null,
      docs: null,
      candidates: null,
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    // The page's header expressions:
    expect(() => norm.archive.fileType.toUpperCase()).not.toThrow();
    expect(() => norm.archive.status && norm.archive.status.replace(/ /g, "_")).not.toThrow();
    expect(() => norm.archive.checksum.slice(0, 16)).not.toThrow();
    expect(() => norm.archive.fileCount.toLocaleString()).not.toThrow();
    expect(() => norm.archive.filename).not.toThrow();
    expect(() => norm.archive.progress).not.toThrow();
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("stats.potentialClaims null / scalar, classifications null — page .map()/.entries() must not throw", () => {
    const raw = {
      archive: {
        _id: "a1",
        status: "completed",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 0,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        stats: { ingested: 1, failed: 0, total: 1, potentialClaims: null, classifications: null },
      },
      files: [],
      docs: {},
      candidates: [],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    const st = norm.archive.stats;
    expect(Array.isArray(st.potentialClaims)).toBe(true);
    expect(st.classifications).toEqual({});
    expect(() => st.potentialClaims.map((c: { claimNumber: string }) => c.claimNumber)).not.toThrow();
    expect(() => Object.entries(st.classifications)).not.toThrow();
    expect(() => assertRenderable(norm)).not.toThrow();
  });

  it("candidate rows with scalar evidence / documentIds (jsonb mis-shaped) coerce to arrays", () => {
    const raw = {
      archive: {
        _id: "a1",
        status: "completed",
        filename: "x.zip",
        fileType: "zip",
        compressedSize: 1,
        extractedSize: 1,
        fileCount: 0,
        checksum: "abc",
        createdAt: 1,
        rawRetained: false,
        progress: 1,
        warnings: [],
        stats: { ingested: 0, failed: 0, total: 0 },
      },
      files: [],
      docs: {},
      candidates: [
        { _id: "c1", status: "pending", claimNumber: "X1", evidence: "doc-1", documentIds: "doc-2" },
      ],
    };
    const n = normalizeArchiveDetailResponse(raw);
    expect(n).not.toBeNull();
    const norm = n!;
    const c = norm.candidates[0];
    expect(Array.isArray(c.evidence)).toBe(true);
    expect(Array.isArray(c.documentIds)).toBe(true);
    expect(() => c.evidence.length + c.documentIds.length).not.toThrow();
  });
});

describe("api.archive.getArchiveDetail transform (registry boundary)", () => {
  it("applies normalizeArchiveDetailResponse to raw RPC results", () => {
    const transform = api.archive.getArchiveDetail.transform;
    expect(typeof transform).toBe("function");
    // Raw RPC payload with the crash-triggering shape: no warnings collection.
    const out = transform!({ archive: { _id: "a1", status: "completed" } }) as {
      archive: { warnings?: unknown };
    };
    expect(out.archive.warnings).toEqual([]);
    // Null passes through for the page's error state.
    expect(transform!(null)).toBeNull();
  });
});
