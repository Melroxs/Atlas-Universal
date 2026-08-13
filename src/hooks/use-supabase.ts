// ---------------------------------------------------------------------------
// Supabase data hooks — drop-in replacements for convex/react's
// useQuery / useMutation / useAction.
//
//   useQuery(fn, args?)        → Postgres RPC (or client impl); undefined while
//                                loading, null when the RPC returns null.
//   useMutation(fn)            → (args) => Promise<T> via Postgres RPC.
//   useAction(fn)              → (args) => Promise<T> via Supabase Edge Function
//                                or a registered client-side implementation.
//
// RPC results are `jsonb` from Postgres, so the default result type is `any`
// (mirrors the old Convex codegen where every call was fully typed). Pass an
// explicit generic when you want a checked shape.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import type { ApiFn } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * RPC parameter mapping. Migrations declare parameters as `p_` + camelCase
 * (e.g. `p_archiveId`), but Postgres folds unquoted identifiers to lowercase
 * (`p_archiveid`), which is what PostgREST matches against. Pages call with
 * plain camelCase keys (`archiveId`), so the data layer sends
 * `p_` + lowercased key (`p_archiveid`).
 */
function toRpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.startsWith("p_") ? k : `p_${k}`;
    out[key.toLowerCase()] = v;
  }
  return out;
}

export interface QueryOptions {
  /** Skip fetching entirely (e.g. before auth is ready). Default: false. */
  enabled?: boolean;
}

/**
 * Query args: a record of RPC parameters, or `"skip"` (Convex-compatible
 * sentinel that keeps the query in its loading state without firing).
 */
export type QueryArgs = Record<string, unknown> | "skip" | undefined;

/** Read-only hook mirroring convex/react's useQuery signature. */
export function useQuery<TResult = any>(
  fn: ApiFn<TResult>,
  args?: QueryArgs,
  options?: QueryOptions,
): TResult | undefined {
  const [result, setResult] = useState<TResult | undefined>(undefined);
  const argsKey = JSON.stringify(args ?? {});
  const enabled = options?.enabled ?? true;
  const clientImpl = fn.clientImpl;

  useEffect(() => {
    if (!enabled || args === "skip") {
      setResult(undefined);
      return;
    }
    let cancelled = false;
    const cleanArgs = (args ?? {}) as Record<string, unknown>;

    if (fn.kind === "client" && clientImpl) {
      let value: unknown;
      try {
        value = clientImpl(cleanArgs);
      } catch (error) {
        console.error(`[atlas] ${fn.name} failed:`, error);
        return;
      }
      if (value && typeof (value as Promise<unknown>).then === "function") {
        (value as Promise<unknown>)
          .then((res) => {
            if (!cancelled) setResult(res as TResult);
          })
          .catch((error) => {
            console.error(`[atlas] ${fn.name} failed:`, error);
            if (!cancelled) setResult(null as TResult);
          });
      } else if (!cancelled) {
        setResult(value as TResult);
      }
      return () => {
        cancelled = true;
      };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setResult(undefined);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc(fn.name, toRpcArgs(cleanArgs));
        if (cancelled) return;
        if (error) throw error;
        const raw = (data ?? null) as unknown;
        setResult((fn.transform ? fn.transform(raw) : raw) as TResult);
      } catch (error) {
        console.error(`[atlas] ${fn.name} failed:`, error);
        if (!cancelled) setResult(null as TResult);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fn.name, fn.kind, clientImpl, fn.transform, argsKey, enabled]);

  return result;
}

/** Write hook — returns a stable async function that runs a Postgres RPC. */
export function useMutation<TArgs = Record<string, unknown>, TResult = any>(
  fn: ApiFn<TResult>,
) {
  return useCallback(
    async (args?: TArgs): Promise<TResult> => {
      if (fn.kind === "client" && fn.clientImpl) {
        return (await fn.clientImpl((args ?? {}) as Record<string, unknown>)) as TResult;
      }
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error } = await supabase.rpc(
        fn.name,
        toRpcArgs((args ?? {}) as Record<string, unknown>),
      );
      if (error) throw error;
      return data as TResult;
    },
    [fn.name],
  );
}

/** Action hook — runs a Supabase Edge Function or a client-side impl. */
export function useAction<TArgs = Record<string, unknown>, TResult = any>(
  fn: ApiFn<TResult>,
) {
  return useCallback(
    async (args?: TArgs): Promise<TResult> => {
      if (fn.kind === "client" && fn.clientImpl) {
        return (await fn.clientImpl((args ?? {}) as Record<string, unknown>)) as TResult;
      }
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error } = await supabase.functions.invoke(fn.name, {
        body: (args ?? {}) as Record<string, unknown>,
      });
      if (error) throw error;
      const payload = data as {
        data?: unknown;
        error?: string;
        ok?: boolean;
      } | null;
      if (payload && typeof payload === "object" && payload.error) {
        throw new Error(payload.error);
      }
      if (payload && typeof payload === "object" && "data" in payload) {
        return payload.data as TResult;
      }
      return payload as TResult;
    },
    [fn.name, fn.clientImpl],
  );
}

/** Latest-value ref so stable callbacks can read fresh state (convex parity). */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
