// ---------------------------------------------------------------------------
// Actions page — canonical response contract.
//
// The Actions page renders two server-backed collections:
//   tools   ← tools_list           (query RPC)
//   history ← tools_list_actions   (query RPC)
//
// useQuery semantics: `undefined` while loading, `null` when the RPC failed
// (400/404/500/network), the raw jsonb value otherwise. A 404 (e.g. a function
// that was never deployed) therefore surfaces as `null` — the exact value that
// crashed production with "Cannot read properties of null (reading 'length')"
// when the page treated null as "ready but empty".
//
// This module is the single normalization boundary. resolveActionsViewState
// ALWAYS returns arrays for the rendered collections (null/missing → []), so
// downstream rendering can never call .length/.map/.filter on null, while it
// still distinguishes the four honest states:
//
//   loading   — request in flight (undefined)
//   error     — the RPC failed (null or malformed non-array payload)
//   empty     — the RPC succeeded and returned no rows ([])
//   populated — rows are available
//
// An error is NEVER disguised as an empty success: `rows` degrades to [] so
// the renderer is safe, but `state: "error"` tells the page to render an
// explicit unavailable state with a Retry action.
// ---------------------------------------------------------------------------

/** Loose jsonb row — the RPC payloads are untyped jsonb. */
export type LooseRow = Record<string, any>;

export interface ToolRowShape extends LooseRow {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string | null;
  version: string;
  capabilities: string[];
  riskLevel: string;
  riskLabel: string;
  confirmationRequired: boolean;
  policyReason: string;
  implementationStatus: string;
  minRole: string;
  inputFields: Array<Record<string, any>>;
  requiredScopes: string[];
  documentationUrl: string | null;
  enabled: boolean;
  connected: boolean;
  scopesOk: boolean;
  canRun: boolean;
}

export interface ToolActionHistoryRow extends LooseRow {
  _id: string;
  _creationTime: number;
  toolId: string;
  toolName: string;
  status: string;
  actorName: string;
  confirmedByName?: string | null;
  error?: string | null;
  input?: unknown;
  result?: unknown;
  confirmationRequired?: boolean;
  confirmationMessage?: string | null;
  confirmedAt?: number | null;
  verificationStatus?: string | null;
  verificationResult?: unknown;
  evidence?: unknown;
  requestText?: string | null;
  explanation?: unknown;
  startedAt?: number | null;
  completedAt?: number | null;
}

/** archive_stats — deployed shape is a flat numeric object (probed live). */
export interface ArchiveStatsShape extends LooseRow {
  total: number;
  failed: number;
  completed: number;
  inProgress: number;
  filesIngested: number;
  potentialClaims: number;
  completedWithWarnings: number;
}

export type SourceState = "loading" | "error" | "empty" | "populated";

export interface ActionsSourceView<T> {
  state: SourceState;
  rows: T[];
  /** Present only when state === "error". Never contains secrets. */
  error?: string;
}

export interface ActionsView {
  tools: ActionsSourceView<ToolRowShape>;
  history: ActionsSourceView<ToolActionHistoryRow>;
  filteredHistory: ToolActionHistoryRow[];
  stats: {
    total: number;
    implemented: number;
    enabled: number;
    run: number;
  };
}

function isPlainArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** Coerce any value into an array of rows; null/undefined/objects → []. */
export function toRowArray<T>(raw: unknown): T[] {
  if (!isPlainArray(raw)) return [];
  return raw as T[];
}

function classify(raw: unknown, label: string): { state: SourceState; rows: any[]; error?: string } {
  if (raw === undefined) return { state: "loading", rows: [] };
  if (raw === null) {
    return { state: "error", rows: [], error: `${label} could not be loaded — the request failed.` };
  }
  if (!isPlainArray(raw)) {
    return { state: "error", rows: [], error: `${label} returned an unexpected shape.` };
  }
  return { state: raw.length === 0 ? "empty" : "populated", rows: raw };
}

/**
 * Single normalization point for the Actions page. Given the RAW useQuery
 * results (which may be undefined/null/array/malformed), returns the complete
 * canonical view contract. Never throws; every collection is an array.
 */
export function resolveActionsViewState(
  rawTools: unknown,
  rawHistory: unknown,
  statusFilter = "all",
): ActionsView {
  const tools = classify(rawTools, "Tool registry");
  const history = classify(rawHistory, "Action history");

  const rows = toRowArray<ToolActionHistoryRow>(rawHistory);
  const filteredHistory =
    statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  const toolRows = toRowArray<ToolRowShape>(rawTools);
  const stats = {
    total: toolRows.length,
    implemented: toolRows.filter((t) => t.implementationStatus === "implemented").length,
    enabled: toolRows.filter((t) => t.enabled).length,
    run: rows.length,
  };

  return {
    tools,
    history,
    filteredHistory,
    stats,
  };
}

/**
 * archive_stats contract: the deployed RPC returns a flat object of numbers.
 * A null/failed/partial response normalizes to an honest zero-shape so any
 * consumer can read `.total` / `.filesIngested` / `.potentialClaims` without
 * a null dereference. Failed calls surface as zeros (the caller decides
 * whether to also render an error state; the numbers themselves are never
 * fabricated).
 */
export function normalizeArchiveStats(raw: unknown): ArchiveStatsShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      total: 0,
      failed: 0,
      completed: 0,
      inProgress: 0,
      filesIngested: 0,
      potentialClaims: 0,
      completedWithWarnings: 0,
    };
  }
  const src = raw as Record<string, unknown>;
  const num = (k: string): number =>
    typeof src[k] === "number" && Number.isFinite(src[k] as number) ? (src[k] as number) : 0;
  return {
    total: num("total"),
    failed: num("failed"),
    completed: num("completed"),
    inProgress: num("inProgress"),
    filesIngested: num("filesIngested"),
    potentialClaims: num("potentialClaims"),
    completedWithWarnings: num("completedWithWarnings"),
  };
}
