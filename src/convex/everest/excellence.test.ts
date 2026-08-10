import { describe, expect, it } from "vitest";
import { deriveExcellence, industrySourceFreshness } from "./excellence";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function input(overrides: Record<string, unknown> = {}) {
  return {
    packKey: "insurance-restoration",
    name: "Insurance Restoration",
    packType: "vertical",
    itemTypes: [
      "entity_type",
      "entity_type",
      "terminology",
      "terminology",
      "workflow",
      "document_expectation",
      "document_expectation",
      "regulatory",
    ],
    lifecycleItemCount: 1,
    authorityKnowledgeCount: 4,
    sourceCount: 3,
    industrySources: [
      { jurisdiction: "US", lastCheckedAt: Date.now(), updateFrequency: "daily" },
      { jurisdiction: "US", lastCheckedAt: Date.now(), updateFrequency: "daily" },
      { jurisdiction: "US", lastCheckedAt: Date.now() - 40 * DAY, updateFrequency: "daily" },
    ],
    hasValueEngine: true,
    valueEngineStatus: "implemented",
    now: Date.now(),
    ...overrides,
  } as Parameters<typeof deriveExcellence>[0];
}

describe("industry excellence framework", () => {
  it("measures multiple axes and reports each state, not one number", () => {
    const e = deriveExcellence(input());
    expect(e.axes.length).toBeGreaterThanOrEqual(8);
    const labels = e.axes.map((a) => a.label);
    expect(labels).toContain("Ontology");
    expect(labels).toContain("Terminology");
    expect(labels).toContain("Authority");
    expect(labels).toContain("Workflow");
    expect(labels).toContain("Evidence");
    expect(labels).toContain("Lifecycle");
    expect(labels).toContain("Jurisdiction");
    expect(labels).toContain("Source freshness");
  });

  it("derives axis scores from real registered counts", () => {
    const e = deriveExcellence(input());
    const ontology = e.axes.find((a) => a.label === "Ontology");
    expect(ontology?.score).toBe(4); // 2 entity_type + 2 terminology
    const workflow = e.axes.find((a) => a.label === "Workflow");
    expect(workflow?.score).toBe(1);
    const authority = e.axes.find((a) => a.label === "Authority");
    expect(authority?.score).toBe(5); // 1 regulatory + 4 knowledge entries
  });

  it("source freshness is derived from real check timestamps", () => {
    const fresh = input();
    const stale = input({
      industrySources: [
        { jurisdiction: "US", lastCheckedAt: Date.now() - 40 * DAY, updateFrequency: "daily" },
      ],
    });
    expect(deriveExcellence(fresh).sourceFreshness).toBe("recently_checked");
    expect(deriveExcellence(stale).sourceFreshness).toBe("stale");
    expect(deriveExcellence(input({ industrySources: [] })).sourceFreshness).toBe("unavailable");
  });

  it("credits an implemented value engine in the economics axis", () => {
    const withEngine = deriveExcellence(input({ hasValueEngine: true }));
    const withoutEngine = deriveExcellence(input({ hasValueEngine: false, valueEngineStatus: null }));
    const a = withEngine.axes.find((x) => x.label === "Economics / value engine");
    const b = withoutEngine.axes.find((x) => x.label === "Economics / value engine");
    expect((a?.score ?? 0)).toBeGreaterThan(b?.score ?? 0);
  });

  it("universal packs are reported as Foundational, never inflated", () => {
    const e = deriveExcellence(input({ packType: "core" }));
    expect(e.overall).toBe("Foundational");
    expect(e.note).toContain("Universal pack");
  });

  it("never inflates coverage beyond what the content supports", () => {
    const empty = deriveExcellence(input({ itemTypes: [], lifecycleItemCount: 0, authorityKnowledgeCount: 0, sourceCount: 0, industrySources: [], hasValueEngine: false, valueEngineStatus: null }));
    for (const a of empty.axes) {
      expect(["Foundational", "Developing", "Deep", "Production-ready"]).toContain(a.state);
    }
    expect(empty.overall).toBe("Foundational");
  });
});

describe("industry source freshness", () => {
  it("is unavailable with no sources", () => {
    expect(industrySourceFreshness([], Date.now())).toBe("unavailable");
  });

  it("is current only when every source is current", () => {
    const now = Date.now();
    expect(
      industrySourceFreshness(
        [
          { lastCheckedAt: now, updateFrequency: "daily" },
          { lastCheckedAt: now, updateFrequency: "daily" },
        ],
        now,
      ),
    ).toBe("current");
    expect(
      industrySourceFreshness(
        [
          { lastCheckedAt: now, updateFrequency: "daily" },
          { lastCheckedAt: now - 40 * DAY, updateFrequency: "daily" },
        ],
        now,
      ),
    ).toBe("recently_checked");
    expect(
      industrySourceFreshness([{ lastCheckedAt: now - 40 * DAY, updateFrequency: "daily" }], now),
    ).toBe("stale");
  });
});
