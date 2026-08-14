// ---------------------------------------------------------------------------
// Regression tests for the reported production defect: archive/document
// processing left records stuck in queued/processing forever.
//
// Covered:
//   1. A file stuck in `processing` (a previous run died mid-flight) is
//      picked up and ingested on the next run.
//   2. A `queued` file without a storage object can never be ingested — it is
//      terminalized to `failed` with an explicit reason.
//   3. A document whose ingestion throws is patched to `failed` (never left
//      `processing`) so retries cannot create duplicate/orphan documents.
//   4. Final archive status is computed from the FRESH persisted snapshot —
//      files that legitimately remain non-terminal produce
//      `completed_with_warnings`, never a silent `completed`.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function ok(data: unknown) {
  return { data, error: null };
}

interface MockFile {
  _id: string;
  path: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  storageId?: string | null;
  ingestStatus: string;
  documentId?: string | null;
  claimHints?: unknown[];
}

const { rpcCalls, mockRpc, mockStorageDownload, mockClient, setFiles, setArchiveStatus } = vi.hoisted(() => {
  const state: { files: MockFile[]; status: string } = {
    files: [],
    status: "inventorying",
  };
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "archive_get_detail") {
      return ok({
        archive: { _id: "archive-1", status: state.status, stats: {} },
        files: state.files.map((f) => ({ ...f })),
        docs: {},
        candidates: [],
      });
    }
    if (fn === "archive_patch") {
      const patch = (args.p_patch ?? {}) as Record<string, unknown>;
      if (typeof patch.status === "string") state.status = patch.status as string;
      return ok({ ok: true });
    }
    if (fn === "archive_patch_file") {
      const id = String(args.p_fileid);
      const patch = (args.p_patch ?? {}) as Record<string, unknown>;
      const f = state.files.find((x) => x._id === id);
      if (f) {
        if (typeof patch.ingestStatus === "string") f.ingestStatus = patch.ingestStatus as string;
        if ("documentId" in patch) f.documentId = (patch.documentId as string | null) ?? null;
        if ("error" in patch) (f as Record<string, unknown>).error = patch.error as string;
      }
      return ok({ ok: true });
    }
    if (fn === "ingestion_create_document") return ok({ docId: `doc-${state.files.length}` });
    if (fn === "ingestion_patch_document") return ok({ ok: true });
    if (fn === "knowledge_list_entities") return ok([]);
    if (fn === "ingestion_insert_chunk") return ok({ ok: true });
    if (fn === "ingestion_insert_assertion") return ok({ ok: true });
    if (fn === "ingestion_insert_relationship") return ok({ ok: true });
    if (fn === "ingestion_insert_entity") return ok({ entityId: "entity-1" });
    if (fn === "ingestion_patch_entity") return ok({ ok: true });
    if (fn === "insurance_upsert_candidates") return ok({ created: 0 });
    throw new Error(`Unexpected rpc ${fn}`);
  });
  const mockStorageDownload = vi.fn(async () => ({
    data: new Blob(["report text about the roof claim"]),
    error: null,
  }));
  const mockClient = {
    rpc: mockRpc,
    storage: { from: () => ({ download: mockStorageDownload }) },
  } as unknown as SupabaseClient;
  return {
    rpcCalls,
    mockRpc,
    mockStorageDownload,
    mockClient,
    setFiles: (f: MockFile[]) => {
      state.files = f;
    },
    setArchiveStatus: (s: string) => {
      state.status = s;
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
}));

vi.mock("@/lib/ingest/parsers", () => ({
  parseFile: vi.fn(async () => ({
    text: "report text about the roof claim",
    mimeType: "application/pdf",
  })),
}));

import { beginProcessingClient } from "./archive";

beforeEach(() => {
  rpcCalls.length = 0;
  mockRpc.mockClear();
  mockStorageDownload.mockClear();
  setArchiveStatus("inventorying");
  setFiles([]);
});

function callsOf(fn: string): Array<Record<string, unknown>> {
  return rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);
}

describe("archive stuck-state recovery", () => {
  it("recovers a file stuck in `processing` from an interrupted run", async () => {
    setFiles([
      {
        _id: "file-1",
        path: "Claims/Claim-1/invoice.pdf",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: "tenant/file-1",
        ingestStatus: "processing",
        documentId: null,
        claimHints: [],
      },
    ]);
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    const patches = callsOf("archive_patch_file");
    expect(patches[0].p_patch).toMatchObject({ ingestStatus: "ingested" });
    expect(res.ingested).toBe(1);
    expect(res.failed).toBe(0);
  });

  it("terminalizes a queued file without a storage object as failed with a reason", async () => {
    setFiles([
      {
        _id: "file-1",
        path: "Claims/Claim-1/invoice.pdf",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: "tenant/file-1",
        ingestStatus: "queued",
        documentId: null,
        claimHints: [],
      },
      {
        _id: "file-2",
        path: "Missing/never-uploaded.pdf",
        filename: "never-uploaded.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: null,
        ingestStatus: "queued",
        documentId: null,
        claimHints: [],
      },
    ]);
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    const patches = callsOf("archive_patch_file");
    const missingPatch = patches.find(
      (p) => String(p.p_patch.ingestStatus) === "failed" && p.p_patch.errorStage === "upload",
    );
    expect(missingPatch).toBeTruthy();
    expect(String(missingPatch.p_patch.error)).toMatch(/missing from storage/);
    // The archive must NOT silently report success for a file it could not ingest.
    expect(res.failed).toBe(1);
    expect(res.ingested).toBe(1);
    const finalPatch = callsOf("archive_patch").at(-1);
    expect((finalPatch?.p_patch as Record<string, unknown>).status).toBe("completed_with_warnings");
  });

  it("never leaves a created document stuck in `processing` when ingestion throws", async () => {
    setFiles([
      {
        _id: "file-1",
        path: "Broken/corrupt.pdf",
        filename: "corrupt.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: "tenant/file-1",
        ingestStatus: "queued",
        documentId: null,
        claimHints: [],
      },
    ]);
    // The parse step throws — the document was already created as `processing`.
    const parsers = await import("@/lib/ingest/parsers");
    (parsers.parseFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Couldn't read text from this PDF"),
    );
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    const docPatches = callsOf("ingestion_patch_document");
    // The created document is terminalized with the real reason. errorStage is
    // NOT sent (the deployed ingestion_patch_document builds its UPDATE from
    // patch keys — an unknown column would throw and be swallowed, re-creating
    // the stuck-`processing` bug this block exists to prevent).
    expect(docPatches).toHaveLength(1);
    expect(docPatches[0].p_patch).toEqual({ status: "failed", error: expect.stringMatching(/Couldn't read text/) });
    expect(docPatches[0].p_patch).not.toHaveProperty("errorStage");
    // The FILE is marked failed too — no queued/processing remnants.
    const filePatch = callsOf("archive_patch_file")[0];
    expect(filePatch.p_patch).toMatchObject({ ingestStatus: "failed" });
    expect(res.failed).toBe(1);
  });

  it("does not re-process an archive that already reached a terminal state", async () => {
    setArchiveStatus("completed");
    setFiles([
      {
        _id: "file-1",
        path: "already/done.pdf",
        filename: "done.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: "tenant/file-1",
        ingestStatus: "ingested",
        documentId: "doc-9",
        claimHints: [],
      },
    ]);
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    expect(callsOf("archive_patch")).toHaveLength(0); // never flips back to processing
    expect(res).toMatchObject({ ok: true, ingested: 0, failed: 0 });
  });

  it("marks files already linked to a document as ingested (idempotent resume)", async () => {
    setFiles([
      {
        _id: "file-1",
        path: "done/invoice.pdf",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: 500,
        storageId: "tenant/file-1",
        ingestStatus: "queued",
        documentId: "doc-5",
        claimHints: [],
      },
    ]);
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    const filePatch = callsOf("archive_patch_file")[0];
    expect(filePatch.p_patch).toMatchObject({ ingestStatus: "ingested", documentId: "doc-5" });
    expect(res.ingested).toBe(1);
    expect(res.failed).toBe(0);
  });
});
