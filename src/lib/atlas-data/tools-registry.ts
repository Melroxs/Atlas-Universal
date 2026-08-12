// ---------------------------------------------------------------------------
// Atlas Universal — Tool Registry
//
// The universal contract for every executable capability. Tools are explicitly
// registered — a connector's capabilities are NEVER auto-exposed as tools.
//
// This module is PURE (no Convex runtime): it can be imported by queries (to
// render the catalog) and by the node runtime (to execute handlers).
//
// Handlers live in the node-only modules (tools/driveTools.ts). This registry
// only declares WHAT a tool is — never its implementation — so the same
// metadata powers the UI, the planner and the execution service.
// ---------------------------------------------------------------------------

export type RiskLevel = "READ" | "LOW_WRITE" | "HIGH_WRITE" | "IRREVERSIBLE";

export type ConfirmationPolicy = "never" | "on_high_risk" | "always";

export type ToolFieldType = "string" | "number" | "boolean" | "enum";

export interface ToolField {
  key: string;
  type: ToolFieldType;
  required?: boolean;
  description: string;
  /** Values for type "enum". */
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** Rendered as a multi-line input when true. */
  longText?: boolean;
}

export interface ToolInputSchema {
  fields: ToolField[];
}

export interface ToolDefinition {
  /** Stable id: "<provider>.<verb>" e.g. "drive.search_files". */
  id: string;
  name: string;
  description: string;
  category: "search" | "document" | "metadata" | "write" | "admin";
  /** Connector provider this tool operates through; null = no external system. */
  provider: string | null;
  version: string;
  capabilities: string[];
  inputSchema: ToolInputSchema;
  /** Which connector + minimum role may run this tool. */
  authRequirements: { provider: string | null; minRole: "member" | "manager" };
  /** OAuth scopes the connected account must have granted (server-side check). */
  requiredScopes: string[];
  riskLevel: RiskLevel;
  confirmationPolicy: ConfirmationPolicy;
  implementationStatus: "implemented" | "planned";
  documentationUrl?: string;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  // -----------------------------------------------------------------------
  // Google Drive — reference connector. Read tools first.
  // -----------------------------------------------------------------------
  {
    id: "drive.search_files",
    name: "Search Drive files",
    description:
      "Search the connected Google Drive for files by name, optionally scoped to a folder, newest first.",
    category: "search",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["search", "read"],
    inputSchema: {
      fields: [
        {
          key: "query",
          type: "string",
          required: true,
          description: "Name search term (e.g. \"ABC Restoration contract\").",
          minLength: 1,
          maxLength: 200,
        },
        {
          key: "folderId",
          type: "string",
          description: "Restrict the search to a folder (optional).",
          maxLength: 200,
        },
        {
          key: "orderBy",
          type: "enum",
          enum: ["modifiedTime desc", "createdTime desc", "name asc"],
          description: "Sort order for results.",
        },
        {
          key: "limit",
          type: "number",
          min: 1,
          max: 50,
          description: "Maximum number of results (default 10).",
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "member" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "READ",
    confirmationPolicy: "never",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/list",
  },
  {
    id: "drive.get_file",
    name: "Retrieve file content",
    description:
      "Download a file's content from Google Drive. Binary or very large files return metadata instead.",
    category: "document",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["read"],
    inputSchema: {
      fields: [
        {
          key: "fileId",
          type: "string",
          required: true,
          description: "The Drive file id to retrieve.",
          minLength: 1,
          maxLength: 200,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "member" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "READ",
    confirmationPolicy: "never",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/get",
  },
  {
    id: "drive.get_file_metadata",
    name: "Read file metadata",
    description:
      "Read a Drive file's metadata (name, mime type, size, parents, modified time, trashed state). This is the verification primitive for write tools.",
    category: "metadata",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["read"],
    inputSchema: {
      fields: [
        {
          key: "fileId",
          type: "string",
          required: true,
          description: "The Drive file id to inspect.",
          minLength: 1,
          maxLength: 200,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "member" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "READ",
    confirmationPolicy: "never",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/get",
  },
  {
    id: "drive.list_files",
    name: "List Drive files",
    description: "List files in the connected Drive, optionally inside a folder, with paging.",
    category: "search",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["read"],
    inputSchema: {
      fields: [
        {
          key: "folderId",
          type: "string",
          description: "Only list files inside this folder (optional).",
          maxLength: 200,
        },
        {
          key: "pageSize",
          type: "number",
          min: 1,
          max: 100,
          description: "Results per page (default 50).",
        },
        {
          key: "pageToken",
          type: "string",
          description: "Pagination token from a previous listing.",
          maxLength: 500,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "member" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "READ",
    confirmationPolicy: "never",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/list",
  },

  // -----------------------------------------------------------------------
  // Google Drive — write tools. Real API operations, each with a
  // verification step that re-reads the resulting state.
  // -----------------------------------------------------------------------
  {
    id: "drive.create_file",
    name: "Create Drive file",
    description:
      "Create a file in the connected Google Drive (optionally inside a folder) with the given content, then verify it exists with the expected name.",
    category: "write",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["write"],
    inputSchema: {
      fields: [
        {
          key: "name",
          type: "string",
          required: true,
          description: "File name, including extension (e.g. proposal-v2.pdf).",
          minLength: 1,
          maxLength: 200,
        },
        {
          key: "parentId",
          type: "string",
          description: "Folder id to create the file in (optional; defaults to My Drive root).",
          maxLength: 200,
        },
        {
          key: "mimeType",
          type: "enum",
          enum: ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
          description: "MIME type of the created file (default text/plain).",
        },
        {
          key: "content",
          type: "string",
          longText: true,
          description: "Text content to write into the file (optional; creates empty file when omitted).",
          maxLength: 2_000_000,
        },
        {
          key: "description",
          type: "string",
          description: "Optional file description.",
          maxLength: 500,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "manager" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "LOW_WRITE",
    confirmationPolicy: "on_high_risk",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/create",
  },
  {
    id: "drive.update_file",
    name: "Update Drive file",
    description:
      "Update a Drive file's name/description and optionally overwrite its content. Overwriting content escalates to high risk (confirmation required).",
    category: "write",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["write"],
    inputSchema: {
      fields: [
        {
          key: "fileId",
          type: "string",
          required: true,
          description: "The Drive file id to update.",
          minLength: 1,
          maxLength: 200,
        },
        {
          key: "name",
          type: "string",
          description: "New file name.",
          minLength: 1,
          maxLength: 200,
        },
        {
          key: "description",
          type: "string",
          description: "New file description.",
          maxLength: 500,
        },
        {
          key: "content",
          type: "string",
          longText: true,
          description: "New text content (overwrites the file). Escalates to confirmation.",
          maxLength: 2_000_000,
        },
        {
          key: "mimeType",
          type: "enum",
          enum: ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
          description: "MIME type used when overwriting content.",
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "manager" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "LOW_WRITE",
    confirmationPolicy: "on_high_risk",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/update",
  },
  {
    id: "drive.move_file",
    name: "Move Drive file",
    description:
      "Move a Drive file into another folder, then verify the new parent. High-risk: changes where the file lives for everyone.",
    category: "write",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["write"],
    inputSchema: {
      fields: [
        {
          key: "fileId",
          type: "string",
          required: true,
          description: "The Drive file id to move.",
          minLength: 1,
          maxLength: 200,
        },
        {
          key: "destinationFolderId",
          type: "string",
          required: true,
          description: "Destination folder id.",
          minLength: 1,
          maxLength: 200,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "manager" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "HIGH_WRITE",
    confirmationPolicy: "on_high_risk",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/update",
  },
  {
    id: "drive.delete_file",
    name: "Delete (trash) Drive file",
    description:
      "Move a Drive file to trash. Recoverable from Google Drive trash for ~30 days, but it disappears from normal views immediately.",
    category: "write",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["write"],
    inputSchema: {
      fields: [
        {
          key: "fileId",
          type: "string",
          required: true,
          description: "The Drive file id to trash.",
          minLength: 1,
          maxLength: 200,
        },
      ],
    },
    authRequirements: { provider: "google_drive", minRole: "manager" },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    riskLevel: "HIGH_WRITE",
    confirmationPolicy: "always",
    implementationStatus: "implemented",
    documentationUrl: "https://developers.google.com/drive/api/reference/rest/v3/files/update",
  },
];

/** Fast lookup by tool id. */
export const TOOL_BY_ID: Record<string, ToolDefinition> = Object.fromEntries(
  TOOL_REGISTRY.map((t) => [t.id, t]),
);

/** Human-readable labels for the UI. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  READ: "Read",
  LOW_WRITE: "Low-risk write",
  HIGH_WRITE: "High-risk write",
  IRREVERSIBLE: "Irreversible",
};
