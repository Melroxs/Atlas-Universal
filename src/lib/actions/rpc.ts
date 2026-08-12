// ---------------------------------------------------------------------------
// Shared client-side Supabase RPC caller.
//
// PostgREST resolves RPC arguments by exact name against the schema cache,
// where Postgres stores unquoted identifiers folded to lowercase. A migration
// declares `p_archiveId`; the schema cache therefore holds `p_archiveid`, and
// PostgREST will NOT match `p_archive_id` (underscore) or `p_archiveId`
// (mixed case) — it returns PGRST202 ("Could not find the function
// public.archive_get_detail(p_archive_id) in the schema cache").
//
// Every client action that calls Postgres RPCs directly (archive processing,
// document ingestion, detectors, insurance demo) must route through rpcCall()
// so the arguments are always sent as `p_` + lowercased key, matching the
// folded schema cache. This mirrors the registry's toRpcArgs() in
// src/hooks/use-supabase.ts.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Normalize RPC args for PostgREST: add the `p_` prefix when missing and fold
 * keys to lowercase. Nested values (jsonb payloads) are left untouched.
 */
export function normalizeRpcArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.startsWith("p_") ? k : `p_${k}`;
    out[key.toLowerCase()] = v;
  }
  return out;
}

/** Call a Postgres RPC with normalized arguments; throw on error. */
export async function rpcCall(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, normalizeRpcArgs(args));
  if (error) throw error;
  return data;
}
