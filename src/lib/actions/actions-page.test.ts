// ---------------------------------------------------------------------------
// Actions page contract — regression suite.
//
// Reproduces the exact production failure mode:
//   tools_list → 404 (function absent from the deployed schema)
//   → useQuery catch sets the result to null
//   → the old page rendered `tools.length` → "Cannot read properties of
//     null (reading 'length')" → React unmounts the whole app.
//
// resolveActionsViewState is the single normalization boundary: it ALWAYS
// returns arrays for rendered collections, and it distinguishes the four
// honest states (loading / error / empty / populated). A failed backend call
// is never disguised as an empty success, and no input shape can crash it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  normalizeArchiveStats,
  resolveActionsViewState,
  toRowArray,
  type ToolActionHistoryRow,
  type ToolRowShape,
} from "./normalize";

function tool(overrides: Partial<ToolRowShape> = {}): ToolRowShape {
  return {
    id: "google-drive-list",
    name: "List Drive files",
    description: "Lists files in Google Drive.",
    category: "connector",
    provider: "google_drive",
    version: "1.0.0",
    capabilities: ["read"],
    riskLevel: "low",
    riskLabel: "Low risk",
    confirmationRequired: false,
    policyReason: "Read-only.",
    implementationStatus: "implemented",
    minRole: "member",
    inputFields: [],
    requiredScopes: ["drive.readonly"],
    documentationUrl: null,
    enabled: true,
    connected: true,
    scopesOk: true,
    canRun: true,
    ...overrides,
  };
}

function historyRow(overrides: Partial<ToolActionHistoryRow> = {}): ToolActionHistoryRow {
  return {
    _id: "h1",
    _creationTime: 1_700_000_000_000,
    toolId: "google-drive-list",
    toolName: "List Drive files",
    status: "succeeded",
    actorName: "Ada",
    input: {},
    result: {},
    ...overrides,
  };
}

describe("toRowArray — collections can never be null", () => {
  it("coerces null, undefined, objects and scalars to []", () => {
    expect(toRowArray(null)).toEqual([]);
    expect(toRowArray(undefined)).toEqual([]);
    expect(toRowArray({ a: 1 })).toEqual([]);
    expect(toRowArray(42)).toEqual([]);
    expect(toRowArray("x")).toEqual([]);
    expect(toRowArray([{ _id: "1" }])).toHaveLength(1);
  });
});

describe("resolveActionsViewState — the production crash is impossible", () => {
  it("1. normal populated response → populated tools + history, correct stats", () => {
    const view = resolveActionsViewState(
      [tool(), tool({ id: "x", implementationStatus: "documented", enabled: false })],
      [historyRow()],
    );
    expect(view.tools.state).toBe("populated");
    expect(view.tools.rows).toHaveLength(2);
    expect(view.history.state).toBe("populated");
    expect(view.history.rows).toHaveLength(1);
    expect(view.stats).toEqual({ total: 2, implemented: 1, enabled: 1, run: 1 });
  });

  it("2. empty response → empty state, not error", () => {
    const view = resolveActionsViewState([], []);
    expect(view.tools.state).toBe("empty");
    expect(view.history.state).toBe("empty");
    expect(view.tools.rows).toEqual([]);
    expect(view.history.rows).toEqual([]);
    expect(view.stats).toEqual({ total: 0, implemented: 0, enabled: 0, run: 0 });
  });

  it("3. null response (RPC 404/500 → useQuery null) → error state, arrays stay safe", () => {
    const view = resolveActionsViewState(null, null);
    expect(view.tools.state).toBe("error");
    expect(view.history.state).toBe("error");
    expect(view.tools.error).toBeTruthy();
    expect(view.history.error).toBeTruthy();
    // The renderer can call .length/.map/.filter on these without throwing.
    expect(view.tools.rows.length).toBe(0);
    expect(view.history.rows.length).toBe(0);
    expect(view.filteredHistory.map((r) => r._id)).toEqual([]);
    expect(view.stats.run).toBe(0);
  });

  it("4. missing collections (undefined while loading) → loading state", () => {
    const view = resolveActionsViewState(undefined, undefined);
    expect(view.tools.state).toBe("loading");
    expect(view.history.state).toBe("loading");
    expect(view.tools.rows).toEqual([]);
  });

  it("5. archive_stats failure → honest zero-shape, no crash, no fabricated counts", () => {
    const zero = normalizeArchiveStats(null);
    expect(zero).toEqual({
      total: 0,
      failed: 0,
      completed: 0,
      inProgress: 0,
      filesIngested: 0,
      potentialClaims: 0,
      completedWithWarnings: 0,
    });
  });

  it("5b. archive_stats valid payload keeps real numbers", () => {
    const stats = normalizeArchiveStats({
      total: 3,
      failed: 1,
      completed: 2,
      inProgress: 0,
      filesIngested: 120,
      potentialClaims: 4,
      completedWithWarnings: 1,
    });
    expect(stats.total).toBe(3);
    expect(stats.filesIngested).toBe(120);
    expect(stats.potentialClaims).toBe(4);
    expect(stats.completedWithWarnings).toBe(1);
  });

  it("6. tools_list 404 + archive_stats failure → Actions still resolves (no throw)", () => {
    // Exact production inputs: tools_list absent (null), history fine, stats failed.
    const view = resolveActionsViewState(null, [historyRow()]);
    expect(view.tools.state).toBe("error");
    expect(view.history.state).toBe("populated");
    expect(view.history.rows).toHaveLength(1);
    expect(() => normalizeArchiveStats(null)).not.toThrow();
    // Renderer-safe: every array access below must not throw.
    expect(() => {
      const n = view.tools.rows.length + view.history.rows.length + view.filteredHistory.length;
      view.tools.rows.map((t) => t.id);
      view.filteredHistory.filter((r) => r.status === "succeeded");
      return n;
    }).not.toThrow();
  });

  it("7. partial backend failure → failed source is error, healthy source still renders", () => {
    const view = resolveActionsViewState(null, [historyRow()]);
    expect(view.tools.state).toBe("error");
    expect(view.history.state).toBe("populated");
    expect(view.history.rows.length).toBe(1);
    expect(view.stats.run).toBe(1);
  });

  it("8. all backend calls failing → both sources error, page contract intact", () => {
    const view = resolveActionsViewState(null, null);
    expect(view.tools.state).toBe("error");
    expect(view.history.state).toBe("error");
    expect(view.stats).toEqual({ total: 0, implemented: 0, enabled: 0, run: 0 });
    expect(view.filteredHistory).toEqual([]);
  });

  it("9. retry after failure → refetch (undefined) shows loading, success recovers", () => {
    // While the retried request is in flight the hook keeps the previous
    // result; a fresh mount yields undefined → loading, then the array.
    const during = resolveActionsViewState(undefined, undefined);
    expect(during.tools.state).toBe("loading");
    const after = resolveActionsViewState([tool()], [historyRow()]);
    expect(after.tools.state).toBe("populated");
    expect(after.tools.rows).toHaveLength(1);
  });

  it("10. populated tools with empty history", () => {
    const view = resolveActionsViewState([tool()], []);
    expect(view.tools.state).toBe("populated");
    expect(view.history.state).toBe("empty");
  });

  it("11. empty tools with populated history", () => {
    const view = resolveActionsViewState([], [historyRow()]);
    expect(view.tools.state).toBe("empty");
    expect(view.history.state).toBe("populated");
    expect(view.stats.run).toBe(1);
  });

  it("12. malformed backend response (object instead of array) → error, no crash", () => {
    const view = resolveActionsViewState({ rows: [tool()] }, { data: [historyRow()] });
    expect(view.tools.state).toBe("error");
    expect(view.history.state).toBe("error");
    expect(view.tools.rows).toEqual([]);
    expect(view.history.rows).toEqual([]);
  });

  it("13-15. no .length/.map/.filter crash for any input shape", () => {
    const inputs: Array<[unknown, unknown]> = [
      [null, null],
      [undefined, undefined],
      [{}, {}],
      [42, "x"],
      [null, []],
      [[], null],
      [tool(), null],
      [null, historyRow()],
      ["bad", [historyRow()]],
      [new Array(3).fill(tool()), new Array(2).fill(historyRow())],
    ];
    for (const [t, h] of inputs) {
      const view = resolveActionsViewState(t, h);
      expect(() => {
        // every array operation the page performs on the resolved contract
        const a = view.tools.rows.length;
        const b = view.history.rows.length;
        const c = view.filteredHistory.length;
        const d = view.stats.total + view.stats.implemented + view.stats.enabled + view.stats.run;
        view.tools.rows.map((r) => r.id);
        view.history.rows.map((r) => r._id);
        view.filteredHistory.filter((r) => r.status);
        view.tools.rows.filter((r) => r.enabled);
        return [a, b, c, d];
      }).not.toThrow();
    }
  });

  it("history status filter runs against normalized rows and never sees null", () => {
    const rows = [
      historyRow({ status: "succeeded" }),
      historyRow({ _id: "h2", status: "awaiting_confirmation" }),
    ];
    const view = resolveActionsViewState(null, rows, "awaiting_confirmation");
    expect(view.filteredHistory.map((r) => r._id)).toEqual(["h2"]);
    const all = resolveActionsViewState(null, rows, "all");
    expect(all.filteredHistory).toHaveLength(2);
  });

  it("stats counts only derive from real rows — never fabricated", () => {
    const view = resolveActionsViewState(null, null);
    expect(view.stats.total).toBe(0);
    expect(view.stats.implemented).toBe(0);
    expect(view.stats.enabled).toBe(0);
    expect(view.stats.run).toBe(0);
  });
});
