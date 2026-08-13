// ---------------------------------------------------------------------------
// Image ingestion contract: a PNG/JPEG uploaded as an individual file must
// become an evidence document with an honest extraction state — never garbage
// text pretending to be content (Phase 15 §6).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00,
  0x01, 0x5c, 0x9c, 0x6e, 0x67, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

function ok(data: unknown) {
  return { data, error: null };
}

const { rpcCalls, mockRpc, mockStorageDownload, mockClient } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "ingestion_create_document") return ok({ docId: "doc-img-1" });
    if (fn === "ingestion_patch_document") return ok({ ok: true });
    throw new Error(`Unexpected rpc ${fn}`);
  });
  const mockStorageDownload = vi.fn(async () => ({
    data: new Blob([PNG], { type: "image/png" }),
    error: null,
  }));
  const mockClient = {
    rpc: mockRpc,
    storage: { from: () => ({ download: mockStorageDownload }) },
  } as unknown as SupabaseClient;
  return { rpcCalls, mockRpc, mockStorageDownload, mockClient };
});

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
}));

import { processDocumentClient } from "./ingestion";

beforeEach(() => {
  rpcCalls.length = 0;
  mockRpc.mockClear();
  mockStorageDownload.mockClear();
});

function patches() {
  return rpcCalls.filter((c) => c.fn === "ingestion_patch_document").map((c) => c.args);
}

describe("processDocumentClient — image files", () => {
  it("stores the image as evidence with an honest extraction state", async () => {
    const res = await processDocumentClient({
      storagePath: "tenant/photo-1",
      title: "roof_photo.png",
      mimeType: "image/png",
      size: PNG.byteLength,
    });
    expect(res.kind).toBe("image");
    expect(res.chunks).toBe(0);
    expect(res.classification).toBe("Image Evidence");
    expect(res.warnings).toContain("content_extraction_unavailable");

    const finalPatch = patches()[patches().length - 1];
    const body = finalPatch.p_patch as Record<string, unknown>;
    expect(body.status).toBe("ready");
    expect(body.classification).toBe("Image Evidence");
    expect(body.chunkCount).toBe(0);
    expect(String(body.summary)).toContain("OCR is not configured");
    // Never invent text content for pixels (error stays null — no fake text).
    expect(body.error).toBeNull();
    // Canonical RPC argument name (regression guard against p_document_id).
    expect(finalPatch).toHaveProperty("p_documentid");
    expect(finalPatch).not.toHaveProperty("p_document_id");
  });
});
