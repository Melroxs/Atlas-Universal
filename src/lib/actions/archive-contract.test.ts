// ---------------------------------------------------------------------------
// Regression tests for the discovered production failure:
//
//   "Could not find the function public.archive_get_detail(p_archive_id) in
//    the schema cache"
//
// The deployed database always had archive_get_detail(p_archiveid) — the
// client processing layer sent `p_archive_id` (and `p_file_id`,
// `p_document_id`, `p_entity_id`, mixed-case keys), which PostgREST resolves
// exactly and therefore rejects. These tests assert the actual RPC argument
// names the client actions send, so a regression re-surfaces immediately.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// supabase-js rpc() returns { data, error } — the mock mirrors that shape.
function ok(data: unknown) {
  return { data, error: null };
}

const { rpcCalls, mockRpc, mockStorageDownload, mockClient } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "archive_get_detail") {
      return ok({
        archive: { _id: "archive-1", status: "uploaded" },
        files: [
          {
            _id: "file-1",
            path: "Claims/Claim-12345/invoice.pdf",
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            size: 1000,
            storageId: "folder/file-1",
            ingestStatus: "queued",
            documentId: null,
            claimHints: [{ claimNumber: "12345", confidence: 0.8, reasons: ["Filename contains a claim number"] }],
          },
        ],
        docs: {
          "doc-1": { _id: "doc-1", title: "Claim-12345 invoice.pdf", classification: "Invoice", status: "ready" },
        },
        candidates: [],
      });
    }
    if (fn === "archive_patch") return ok({ ok: true });
    if (fn === "archive_patch_file") return ok({ ok: true });
    if (fn === "insurance_upsert_candidates") return ok({ created: 1 });
    if (fn === "ingestion_create_document") return ok({ docId: "doc-1" });
    if (fn === "ingestion_patch_document") return ok({ ok: true });
    if (fn === "knowledge_list_entities") return ok([]);
    if (fn === "ingestion_insert_chunk") return ok({ ok: true });
    if (fn === "ingestion_insert_assertion") return ok({ ok: true });
    if (fn === "ingestion_insert_relationship") return ok({ ok: true });
    if (fn === "ingestion_insert_entity") return ok({ entityId: "entity-1" });
    if (fn === "ingestion_patch_entity") return ok({ ok: true });
    throw new Error(`Unexpected rpc ${fn}`);
  });
  const mockStorageDownload = vi.fn(async () => ({
    data: new Blob(["just some plain text without entities"]),
    error: null,
  }));
  const mockClient = {
    rpc: mockRpc,
    storage: {
      from: () => ({ download: mockStorageDownload }),
    },
  } as unknown as SupabaseClient;
  return { rpcCalls, mockRpc, mockStorageDownload, mockClient };
});

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
}));

vi.mock("@/lib/ingest/parsers", () => ({
  parseFile: vi.fn(async () => ({ text: "just some plain text without entities", mimeType: "text/plain" })),
}));

import { beginProcessingClient } from "./archive";
import { processDocumentClient } from "./ingestion";

beforeEach(() => {
  rpcCalls.length = 0;
  mockRpc.mockClear();
  mockStorageDownload.mockClear();
});

function callsOf(fn: string): Array<Record<string, unknown>> {
  return rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);
}

describe("beginProcessingClient — archive RPC contract", () => {
  it("calls archive_get_detail with p_archiveid (not p_archive_id)", async () => {
    await beginProcessingClient({ archiveId: "archive-1" });
    const detail = callsOf("archive_get_detail");
    // Initial load + fresh reconcile snapshot + final status snapshot.
    expect(detail.length).toBeGreaterThanOrEqual(1);
    for (const args of detail) {
      expect(args).toEqual({ p_archiveid: "archive-1" });
      // The exact production regression must never reappear.
      expect(args).not.toHaveProperty("p_archive_id");
    }
  });

  it("calls archive_patch with p_archiveid + p_patch", async () => {
    await beginProcessingClient({ archiveId: "archive-1" });
    const patches = callsOf("archive_patch");
    expect(patches.length).toBeGreaterThanOrEqual(1);
    for (const p of patches) {
      expect(Object.keys(p).sort()).toEqual(["p_archiveid", "p_patch"]);
    }
  });

  it("persists POTENTIAL claim candidates via insurance_upsert_candidates", async () => {
    const res = await beginProcessingClient({ archiveId: "archive-1" });
    expect(res.candidates).toBe(1);
    const upserts = callsOf("insurance_upsert_candidates");
    expect(upserts).toHaveLength(1);
    const payload = upserts[0].p_candidates as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0].claimKey).toBe("12345");
    expect(payload[0].archiveId).toBe("archive-1");
    expect(Array.isArray(payload[0].evidence)).toBe(true);
  });
});

describe("processDocumentClient — ingestion RPC contract", () => {
  it("patches the document with p_documentid (not p_document_id)", async () => {
    await processDocumentClient({
      storagePath: "folder/file-1",
      title: "note.txt",
      mimeType: "text/plain",
      size: 10,
    });
    const patches = callsOf("ingestion_patch_document");
    expect(patches.length).toBeGreaterThanOrEqual(1);
    const finalPatch = patches[patches.length - 1];
    expect(Object.keys(finalPatch).sort()).toEqual(["p_documentid", "p_patch"]);
    expect(finalPatch).not.toHaveProperty("p_document_id");
  });
});
