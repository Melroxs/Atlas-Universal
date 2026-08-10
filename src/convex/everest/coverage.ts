// ---------------------------------------------------------------------------
// Everest — Industry Knowledge Coverage
//
// Coverage is MEASURED from real system state (registered pack items,
// authoritative sources/knowledge by industry) — never fabricated. Scores map
// to explicit states: Foundational, Developing, Deep, Production-ready.
// ---------------------------------------------------------------------------

export type CoverageState = "Foundational" | "Developing" | "Deep" | "Production-ready";

export interface CoverageAxis {
  label: string;
  score: number;
  state: CoverageState;
  basis: string;
}

export interface IndustryCoverage {
  packKey: string;
  name: string;
  implementation: "Foundational" | "Developing" | "Deep" | "Production-ready";
  axes: CoverageAxis[];
  overall: CoverageState;
  note: string;
}

/** Score thresholds → state. Documented and stable so results are explainable. */
export function coverageState(score: number): CoverageState {
  if (score <= 0) return "Foundational";
  if (score < 4) return "Developing";
  if (score < 8) return "Deep";
  return "Production-ready";
}

const stateRank: Record<CoverageState, number> = {
  Foundational: 0,
  Developing: 1,
  Deep: 2,
  "Production-ready": 3,
};

export function rankState(s: CoverageState): number {
  return stateRank[s];
}

export interface CoverageInput {
  packKey: string;
  name: string;
  /** itemType of each registered pack item. */
  itemTypes: string[];
  /** authoritative knowledge rows whose industry matches this pack. */
  authorityKnowledgeCount: number;
  /** authoritative source rows whose industry matches this pack. */
  sourceCount: number;
  /** Whether this is a core/benchmark pack (never claims industry depth). */
  packType: string;
}

/**
 * Derive coverage for one industry pack from actual counts. Scores:
 *  ontology = entity_type + terminology items; workflow = workflow items;
 *  evidence = document_expectation items; authority = regulatory items in
 *  pack + authoritative knowledge; source = authoritative source rows.
 */
export function deriveCoverage(input: CoverageInput): IndustryCoverage {
  const ontologyScore =
    input.itemTypes.filter((t) => t === "entity_type" || t === "terminology").length +
    input.itemTypes.filter((t) => t === "role").length;
  const workflowScore = input.itemTypes.filter((t) => t === "workflow").length;
  const evidenceScore = input.itemTypes.filter((t) => t === "document_expectation").length;
  const authorityScore =
    input.itemTypes.filter((t) => t === "regulatory").length + input.authorityKnowledgeCount;
  const sourceScore = input.sourceCount;
  const benchmarkScore = input.itemTypes.filter((t) => t === "benchmark" || t === "kpi").length;

  const axes: CoverageAxis[] = [
    {
      label: "Ontology",
      score: ontologyScore,
      state: coverageState(ontologyScore),
      basis: `${ontologyScore} entity/terminology/role items`,
    },
    {
      label: "Authority",
      score: authorityScore,
      state: coverageState(authorityScore),
      basis: `${authorityScore} regulatory items + authoritative knowledge entries`,
    },
    {
      label: "Workflow",
      score: workflowScore,
      state: coverageState(workflowScore),
      basis: `${workflowScore} workflow items`,
    },
    {
      label: "Evidence",
      score: evidenceScore,
      state: coverageState(evidenceScore),
      basis: `${evidenceScore} document-expectation items`,
    },
    {
      label: "Source",
      score: sourceScore,
      state: coverageState(sourceScore),
      basis: `${sourceScore} authoritative sources`,
    },
    {
      label: "Benchmarks",
      score: benchmarkScore,
      state: coverageState(benchmarkScore),
      basis: `${benchmarkScore} benchmark/KPI items`,
    },
  ];

  const overallScore = axes.reduce((sum, a) => sum + a.score, 0) / axes.length;
  const overall = coverageState(overallScore);
  const isCoreOrBenchmark = input.packType === "core" || input.packType === "benchmark";

  return {
    packKey: input.packKey,
    name: input.name,
    implementation: isCoreOrBenchmark ? "Foundational" : overall,
    axes,
    overall,
    note: isCoreOrBenchmark
      ? "Universal pack — provides cross-industry baseline, not vertical depth."
      : `Measured from ${input.itemTypes.length} registered items, ${input.sourceCount} sources and ${input.authorityKnowledgeCount} authoritative knowledge entries.`,
  };
}

export const COVERAGE_STATES: CoverageState[] = [
  "Foundational",
  "Developing",
  "Deep",
  "Production-ready",
];
