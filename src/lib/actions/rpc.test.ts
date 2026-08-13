import { describe, expect, it } from "vitest";
import { normalizeRpcArgs } from "./rpc";

describe("normalizeRpcArgs — the archive contract", () => {
  it("prefixes p_ and lowercases camelCase keys so PostgREST resolves them", () => {
    expect(normalizeRpcArgs({ archiveId: "abc", patch: { status: "ok" } })).toEqual({
      p_archiveid: "abc",
      p_patch: { status: "ok" },
    });
  });

  it("folds mixed-case prefixed keys to the schema-cache spelling", () => {
    // DB declares p_claimId / p_mimeType → schema cache holds p_claimid /
    // p_mimetype. PostgREST matches exactly, so mixed-case fails (PGRST202).
    expect(
      normalizeRpcArgs({ p_mimeType: "application/pdf", p_claimNumber: "CL-1" }),
    ).toEqual({
      p_mimetype: "application/pdf",
      p_claimnumber: "CL-1",
    });
  });

  it("leaves nested jsonb payloads untouched", () => {
    expect(
      normalizeRpcArgs({ patch: { stats: { ingested: 2 }, status: "completed" } }),
    ).toEqual({ p_patch: { stats: { ingested: 2 }, status: "completed" } });
  });

  it("guards the exact production regression: p_archive_id is NOT p_archiveid", () => {
    // The deployed failure: call sites sent `p_archive_id`, but the function
    // parameter folds to `p_archiveid`. Underscores are never introduced.
    expect(normalizeRpcArgs({ p_archive_id: "x" })).toEqual({ p_archive_id: "x" });
    expect(normalizeRpcArgs({ p_archive_id: "x" })).not.toEqual({
      p_archiveid: "x",
    });
  });

  it("normalizes the file/document/entity contract keys used by ingestion", () => {
    expect(normalizeRpcArgs({ fileId: "f", documentId: "d", entityId: "e" })).toEqual({
      p_fileid: "f",
      p_documentid: "d",
      p_entityid: "e",
    });
  });
});
