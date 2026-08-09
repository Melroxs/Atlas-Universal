"use node";

// ---------------------------------------------------------------------------
// Real Google Drive tool handlers (reference implementation).
//
// Every handler calls the actual Drive REST API. No simulated operations.
// Write handlers return a `verification` step that re-reads the resulting
// state so the execution service can prove the action landed.
// ---------------------------------------------------------------------------

import type { Id } from "../_generated/dataModel";
import { driveFetch, sanitizeDriveError } from "./driveClient";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,description,trashed";

export interface HandlerDeps {
  tenantId: Id<"tenants">;
  actorId: Id<"users">;
  connection: {
    _id: Id<"connections">;
    settings?: Record<string, unknown> | null;
    scopes?: string[];
  };
  accessToken: string;
  input: Record<string, string | number | boolean>;
}

export interface HandlerResult {
  result: Record<string, unknown>;
  /** When present, the execution service re-reads state and compares. */
  verification?: { fileId: string; expected: Record<string, unknown> };
}

export type ToolHandler = (deps: HandlerDeps) => Promise<HandlerResult>;

const TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
]);

/** Escape a value for use inside a Drive `name contains '...'` query. */
function escapeQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function pick(file: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "id",
    "name",
    "mimeType",
    "size",
    "modifiedTime",
    "createdTime",
    "parents",
    "webViewLink",
    "description",
    "trashed",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (file[k] !== undefined) out[k] = file[k];
  }
  return out;
}

async function uploadMedia(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType: string,
): Promise<void> {
  const up = await fetch(`${DRIVE_UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
    },
    body: content,
  });
  if (!up.ok) {
    throw sanitizeDriveError(up.status, await up.text().catch(() => ""));
  }
}

const handlers: Record<string, ToolHandler> = {
  async "drive.search_files"({ accessToken, input }) {
    const qParts = ["trashed = false"];
    if (typeof input.query === "string" && input.query.trim()) {
      qParts.push(`name contains '${escapeQuery(input.query.trim())}'`);
    }
    if (typeof input.folderId === "string" && input.folderId) {
      qParts.push(`'${escapeQuery(input.folderId)}' in parents`);
    }
    const limit = Math.min(typeof input.limit === "number" ? input.limit : 10, 50);
    const orderBy = typeof input.orderBy === "string" ? input.orderBy : "modifiedTime desc";
    const url =
      `${DRIVE_FILES}?q=${encodeURIComponent(qParts.join(" and "))}` +
      `&pageSize=${limit}&orderBy=${encodeURIComponent(orderBy)}` +
      `&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}`;
    const res = await driveFetch(accessToken, url);
    const data = (await res.json()) as { files?: Array<Record<string, unknown>> };
    const files = (data.files ?? []).map((f) => pick(f));
    return { result: { count: files.length, files, query: input.query, orderBy } };
  },

  async "drive.get_file"({ accessToken, input }) {
    const fileId = String(input.fileId);
    const metaRes = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
    );
    const meta = (await metaRes.json()) as Record<string, unknown>;
    let content: string | null = null;
    const isText = TEXT_MIME.has(String(meta.mimeType ?? ""));
    const size = typeof meta.size === "number" ? meta.size : 0;
    if (isText && size < 2_000_000) {
      const res = await driveFetch(
        accessToken,
        `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`,
      );
      content = (await res.text()).slice(0, 100_000);
    }
    return {
      result: {
        ...pick(meta),
        content,
        contentNote:
          content === null
            ? "binary or too large to inline — use get_file_metadata or ingestion"
            : undefined,
      },
    };
  },

  async "drive.get_file_metadata"({ accessToken, input }) {
    const fileId = String(input.fileId);
    const res = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
    );
    const meta = (await res.json()) as Record<string, unknown>;
    return { result: pick(meta) };
  },

  async "drive.list_files"({ accessToken, input }) {
    const qParts = ["trashed = false"];
    if (typeof input.folderId === "string" && input.folderId) {
      qParts.push(`'${escapeQuery(input.folderId)}' in parents`);
    }
    const pageSize = Math.min(typeof input.pageSize === "number" ? input.pageSize : 50, 100);
    let url =
      `${DRIVE_FILES}?q=${encodeURIComponent(qParts.join(" and "))}` +
      `&pageSize=${pageSize}&orderBy=${encodeURIComponent("modifiedTime desc")}` +
      `&fields=${encodeURIComponent(`nextPageToken,files(${FILE_FIELDS})`)}`;
    if (typeof input.pageToken === "string" && input.pageToken) {
      url += `&pageToken=${encodeURIComponent(input.pageToken)}`;
    }
    const res = await driveFetch(accessToken, url);
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<Record<string, unknown>>;
    };
    return {
      result: {
        nextPageToken: data.nextPageToken ?? null,
        count: (data.files ?? []).length,
        files: (data.files ?? []).map((f) => pick(f)),
      },
    };
  },

  async "drive.create_file"({ accessToken, input }) {
    const body: Record<string, unknown> = {
      name: input.name,
      mimeType: typeof input.mimeType === "string" ? input.mimeType : "text/plain",
    };
    if (typeof input.description === "string") body.description = input.description;
    if (typeof input.parentId === "string" && input.parentId) body.parents = [input.parentId];
    const res = await driveFetch(
      accessToken,
      `${DRIVE_FILES}?fields=${encodeURIComponent("id,name,parents,mimeType")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const created = (await res.json()) as Record<string, unknown>;
    if (typeof input.content === "string" && input.content.length > 0) {
      await uploadMedia(accessToken, String(created.id), input.content, String(body.mimeType));
    }
    return {
      result: { id: created.id, name: created.name, parents: created.parents ?? null },
      verification: {
        fileId: String(created.id),
        expected: { name: String(input.name), trashed: false },
      },
    };
  },

  async "drive.update_file"({ accessToken, input }) {
    const fileId = String(input.fileId);
    const patch: Record<string, unknown> = {};
    if (typeof input.name === "string") patch.name = input.name;
    if (typeof input.description === "string") patch.description = input.description;
    if (Object.keys(patch).length > 0) {
      const res = await driveFetch(
        accessToken,
        `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("id,name,description,modifiedTime")}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      );
      await res.json();
    }
    if (typeof input.content === "string" && input.content.length > 0) {
      await uploadMedia(
        accessToken,
        fileId,
        input.content,
        typeof input.mimeType === "string" ? input.mimeType : "text/plain",
      );
    }
    const expected: Record<string, unknown> = { trashed: false };
    if (typeof input.name === "string") expected.name = input.name;
    if (typeof input.description === "string") expected.description = input.description;
    return { result: { id: fileId, updated: true }, verification: { fileId, expected } };
  },

  async "drive.move_file"({ accessToken, input }) {
    const fileId = String(input.fileId);
    const dest = String(input.destinationFolderId);
    const metaRes = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=parents`,
    );
    const meta = (await metaRes.json()) as { parents?: string[] };
    const params = new URLSearchParams();
    for (const p of meta.parents ?? []) {
      if (p !== dest) params.append("removeParents", p);
    }
    params.append("addParents", dest);
    const res = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?${params.toString()}&fields=id,parents`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    const moved = (await res.json()) as { id?: string; parents?: string[] };
    return {
      result: { id: fileId, parents: moved.parents ?? [] },
      verification: { fileId, expected: { parents: [dest] } },
    };
  },

  async "drive.delete_file"({ accessToken, input }) {
    const fileId = String(input.fileId);
    const res = await driveFetch(
      accessToken,
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=id,name,trashed`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    return {
      result: {
        id: fileId,
        trashed: data.trashed ?? true,
        note: "Moved to trash — recoverable from Google Drive trash for ~30 days.",
      },
      verification: { fileId, expected: { trashed: true } },
    };
  },
};

export const TOOL_HANDLERS: Record<string, ToolHandler> = handlers;
