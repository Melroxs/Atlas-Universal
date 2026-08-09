// ---------------------------------------------------------------------------
// Drive tool handlers — real handler logic, mocked HTTP transport only.
// Production integration stays real; tests stub `fetch` deterministically.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { HandlerDeps } from "./driveTools";
import { TOOL_HANDLERS } from "./driveTools";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

const fetchMock = vi.fn();

function deps(input: Record<string, unknown>, accessToken = "tok123"): HandlerDeps {
  return {
    tenantId: "ten1" as Id<"tenants">,
    actorId: "user1" as Id<"users">,
    connection: { _id: "conn1" as Id<"connections">, settings: {}, scopes: [] },
    accessToken,
    input: input as Record<string, string | number | boolean>,
  };
}

function lastUrl(callIndex = 0): URL {
  return new URL(fetchMock.mock.calls[callIndex][0] as string);
}

function lastInit(callIndex = 0): RequestInit {
  return fetchMock.mock.calls[callIndex][1] as RequestInit;
}

const rawFile = {
  id: "f1",
  name: "contract.pdf",
  mimeType: "application/pdf",
  size: 2048,
  modifiedTime: "2026-08-01T10:00:00Z",
  parents: ["root"],
  appProperties: { secret: "should be stripped" },
  permissions: ["should be stripped"],
};

describe("drive.search_files", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("builds a scoped, ordered query and returns only picked fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ files: [rawFile] }));
    const res = await TOOL_HANDLERS["drive.search_files"](
      deps({ query: "ABC Restoration", orderBy: "name asc", limit: 20 }),
    );
    const url = lastUrl();
    expect(url.pathname).toBe("/drive/v3/files");
    expect(decodeURIComponent(url.searchParams.get("q")!)).toContain("name contains 'ABC Restoration'");
    expect(url.searchParams.get("pageSize")).toBe("20");
    expect(url.searchParams.get("orderBy")).toBe("name asc");
    expect((res.result.count as number)).toBe(1);
    const file = (res.result.files as Array<Record<string, unknown>>)[0];
    expect(file.id).toBe("f1");
    expect(file).not.toHaveProperty("appProperties");
    expect(file).not.toHaveProperty("permissions");
  });

  it("restricts to a folder and defaults page size when omitted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ files: [] }));
    await TOOL_HANDLERS["drive.search_files"](deps({ query: "x", folderId: "folder9" }));
    const url = lastUrl();
    expect(decodeURIComponent(url.searchParams.get("q")!)).toContain("'folder9' in parents");
    expect(url.searchParams.get("pageSize")).toBe("10");
  });
});

describe("drive.get_file", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("inlines content for small text files", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: "f1", name: "notes.md", mimeType: "text/markdown", size: 50 }),
      )
      .mockResolvedValueOnce(new Response("hello atlas", { status: 200 }));
    const res = await TOOL_HANDLERS["drive.get_file"](deps({ fileId: "f1" }));
    expect(res.result.content).toBe("hello atlas");
    expect(res.result.contentNote).toBeUndefined();
    expect(lastUrl(1).searchParams.get("alt")).toBe("media");
  });

  it("refuses to inline binary or huge files — honest note instead", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "f1", name: "a.pdf", mimeType: "application/pdf", size: 999 }),
    );
    const res = await TOOL_HANDLERS["drive.get_file"](deps({ fileId: "f1" }));
    expect(res.result.content).toBeNull();
    expect(res.result.contentNote).toContain("binary");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("drive.get_file_metadata", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns picked metadata for verification use", async () => {
    fetchMock.mockResolvedValue(jsonResponse(rawFile));
    const res = await TOOL_HANDLERS["drive.get_file_metadata"](deps({ fileId: "f1" }));
    expect(res.result.id).toBe("f1");
    expect(res.result.name).toBe("contract.pdf");
    expect(res.result).not.toHaveProperty("appProperties");
    expect(lastUrl().pathname).toBe("/drive/v3/files/f1");
  });
});

describe("drive.list_files", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns a page with next token and forwards the page token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nextPageToken: "NEXT", files: [rawFile] }));
    const res = await TOOL_HANDLERS["drive.list_files"](
      deps({ pageSize: 100, pageToken: "prev-token" }),
    );
    expect(res.result.count).toBe(1);
    expect(res.result.nextPageToken).toBe("NEXT");
    expect(lastUrl().searchParams.get("pageToken")).toBe("prev-token");
    expect(lastUrl().searchParams.get("pageSize")).toBe("100");
  });
});

describe("drive.create_file", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates metadata, then uploads media, and returns a verifiable expectation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "new1", name: "proposal.md", parents: ["root"] }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const res = await TOOL_HANDLERS["drive.create_file"](
      deps({ name: "proposal.md", parentId: "root", content: "# Draft", mimeType: "text/markdown" }),
    );
    // metadata POST
    const url0 = lastUrl(0);
    expect(url0.pathname).toBe("/drive/v3/files");
    expect(lastInit(0).method).toBe("POST");
    const body = JSON.parse(String(lastInit(0).body)) as Record<string, unknown>;
    expect(body.name).toBe("proposal.md");
    expect(body.parents).toEqual(["root"]);
    // media PATCH
    const url1 = lastUrl(1);
    expect(url1.origin + url1.pathname).toBe(UPLOAD + "/new1");
    expect(url1.searchParams.get("uploadType")).toBe("media");
    expect(lastInit(1).method).toBe("PATCH");
    expect(String(lastInit(1).body)).toBe("# Draft");
    // verification contract
    expect(res.result.id).toBe("new1");
    expect(res.verification).toEqual({
      fileId: "new1",
      expected: { name: "proposal.md", trashed: false },
    });
  });
});

describe("drive.update_file", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("patches metadata and returns expected state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "f1", name: "renamed.pdf" }));
    const res = await TOOL_HANDLERS["drive.update_file"](
      deps({ fileId: "f1", name: "renamed.pdf", description: "v2" }),
    );
    expect(lastInit(0).method).toBe("PATCH");
    const body = JSON.parse(String(lastInit(0).body)) as Record<string, unknown>;
    expect(body.name).toBe("renamed.pdf");
    expect(body.description).toBe("v2");
    expect(res.result).toEqual({ id: "f1", updated: true });
    expect(res.verification).toEqual({
      fileId: "f1",
      expected: { name: "renamed.pdf", description: "v2", trashed: false },
    });
  });
});

describe("drive.move_file", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("removes old parents and adds the destination", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ parents: ["old1", "old2"] }))
      .mockResolvedValueOnce(jsonResponse({ id: "f1", parents: ["dest9"] }));
    const res = await TOOL_HANDLERS["drive.move_file"](
      deps({ fileId: "f1", destinationFolderId: "dest9" }),
    );
    const moveUrl = lastUrl(1);
    expect(moveUrl.searchParams.get("removeParents")).toBe("old1");
    expect(moveUrl.searchParams.get("addParents")).toBe("dest9");
    expect(res.verification).toEqual({ fileId: "f1", expected: { parents: ["dest9"] } });
  });
});

describe("drive.delete_file", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("trashes the file and verifies trashed state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "f1", trashed: true }));
    const res = await TOOL_HANDLERS["drive.delete_file"](deps({ fileId: "f1" }));
    const init = lastInit(0);
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.trashed).toBe(true);
    expect(res.result.trashed).toBe(true);
    expect(res.verification).toEqual({ fileId: "f1", expected: { trashed: true } });
  });
});
