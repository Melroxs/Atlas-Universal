// ---------------------------------------------------------------------------
// Everest — Industry Excellence Framework
//
// Measures how deep an industry pack's intelligence actually is across many
// axes. Scores are derived from real registered content — pack items,
// authoritative sources, knowledge entries, value engines, lifecycle items and
// actual source-freshness data. Never inflated; never one misleading number.
// ---------------------------------------------------------------------------

import { coverageState, type CoverageState } from "./coverage";
import { freshnessState, type FreshnessState } from "./ingest";

export interface ExcellenceAxis {
  label: string;
  score: number;
  state: CoverageState;
  basis: string;
}

export interface IndustryExcellence {
  packKey: string;
  name: string;
  axes: ExcellenceAxis[];
  /** Weighted overall, but each axis stays visible. */
  overall: CoverageState;
  hasValueEngine: boolean;
  valueEngineStatus: string | null;
  sourceFreshness: FreshnessState;
  note: string;
}

export interface ExcellenceInput {
  packKey: string;
  name: string;
  packType: string;
  /** itemType of every registered pack item. */
  itemTypes: string[];
  /** Items whose content contains lifecycle stages. */
  lifecycleItemCount: number;
  authorityKnowledgeCount: number;
  sourceCount: number;
  /** Sources mapped to this pack's industry (for jurisdiction/freshness). */
  industrySources: Array<{
    jurisdiction?: string | null;
    lastCheckedAt?: number | null;
    updateFrequency?: string | null;
    status?: string;
  }>;
  hasValueEngine: boolean;
  valueEngineStatus: string | null;
  now: number;
}

const count = (types: string[], match: string[]) =>
  types.filter((t) => match.includes(t)).length;

/** Multi-axis industry depth, measured from real system state. */
export function deriveExcellence(input: ExcellenceInput): IndustryExcellence {
  const ontologyScore = count(input.itemTypes, ["entity_type"]) + count(input.itemTypes, ["terminology"]);
  const terminologyScore = count(input.itemTypes, ["terminology"]);
  const workflowScore = count(input.itemTypes, ["workflow"]);
  const evidenceScore = count(input.itemTypes, ["document_expectation"]);
  const authorityScore =
    count(input.itemTypes, ["regulatory"]) + input.authorityKnowledgeCount;
  const lifecycleScore = input.lifecycleItemCount;
  const economicsScore = count(input.itemTypes, ["benchmark", "kpi"]) + (input.hasValueEngine ? 3 : 0);
  const jurisdictionScore = input.industrySources.filter((s) => s.jurisdiction).length;
  const sourceScore = input.sourceCount;

  // Source freshness: derived from actual check timestamps, not existence.
  const freshSources = input.industrySources.filter(
    (s) => freshnessState(s.lastCheckedAt, s.updateFrequency, input.now, s.status) === "current",
  ).length;
  const freshnessScore = input.industrySources.length
    ? Math.round((freshSources / input.industrySources.length) * 8)
    : 0;
  const freshnessStateOverall =
    input.industrySources.length === 0
      ? "unavailable"
      : freshSources === input.industrySources.length
        ? "current"
        : freshSources === 0
          ? "stale"
          : "recently_checked";

  const axes: ExcellenceAxis[] = [
    { label: "Ontology", score: ontologyScore, state: coverageState(ontologyScore), basis: `${ontologyScore} entity/terminology items` },
    { label: "Terminology", score: terminologyScore, state: coverageState(terminologyScore), basis: `${terminologyScore} terminology items` },
    { label: "Lifecycle", score: lifecycleScore, state: coverageState(lifecycleScore), basis: `${lifecycleScore} lifecycle items` },
    { label: "Authority", score: authorityScore, state: coverageState(authorityScore), basis: `${authorityScore} regulatory items + knowledge entries` },
    { label: "Workflow", score: workflowScore, state: coverageState(workflowScore), basis: `${workflowScore} workflow items` },
    { label: "Evidence", score: evidenceScore, state: coverageState(evidenceScore), basis: `${evidenceScore} document-expectation items` },
    { label: "Economics / value engine", score: economicsScore, state: coverageState(economicsScore), basis: `${economicsScore} benchmark/KPI/value-engine signals` },
    { label: "Jurisdiction", score: jurisdictionScore, state: coverageState(jurisdictionScore), basis: `${jurisdictionScore} sources with jurisdiction` },
    { label: "Source freshness", score: freshnessScore, state: coverageState(freshnessScore), basis: `${freshSources}/${input.industrySources.length} sources current` },
  ];

  const overall = coverageState(axes.reduce((s, a) => s + a.score, 0) / axes.length);
  const isUniversal = input.packType === "core" || input.packType === "benchmark";

  return {
    packKey: input.packKey,
    name: input.name,
    axes,
    overall: isUniversal ? "Foundational" : overall,
    hasValueEngine: input.hasValueEngine,
    valueEngineStatus: input.valueEngineStatus,
    sourceFreshness: freshnessStateOverall,
    note: isUniversal
      ? "Universal pack — provides the cross-industry baseline, not vertical depth."
      : `Measured from ${input.itemTypes.length} registered items, ${input.sourceCount} sources and ${input.authorityKnowledgeCount} authoritative knowledge entries.`,
  };
}

/** Honest freshness label for a whole industry's sources. */
export function industrySourceFreshness(
  sources: Array<{ lastCheckedAt?: number | null; updateFrequency?: string | null; status?: string }>,
  now: number,
): FreshnessState {
  if (sources.length === 0) return "unavailable";
  const states = sources.map((s) =>
    freshnessState(s.lastCheckedAt, s.updateFrequency, now, s.status),
  );
  if (states.every((s) => s === "current")) return "current";
  if (states.some((s) => s === "current")) return "recently_checked";
  return "stale";
}
