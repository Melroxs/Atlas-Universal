// ---------------------------------------------------------------------------
// Atlas AI Runtime — Evaluation Dataset
//
// Synthetic, deterministic benchmark fixtures for evaluating models on
// Atlas-specific workloads. NO real customer data is used.
// All fixtures are representative of actual insurance restoration workflows.
// ---------------------------------------------------------------------------

import type { EvalCase } from "./types";

// ---------------------------------------------------------------------------
// Claims domain
// ---------------------------------------------------------------------------

const CLAIMS_CASES: EvalCase[] = [
  {
    id: "claim_recon_001",
    name: "Claim Reconstruction — Basic Roofing Claim",
    task: "evidence_reasoning",
    domain: "claims",
    prompt: `Given the following insurance claim data, reconstruct the claim details:

Claim Number: CLM-2024-0892
Policyholder: John Smith
Property: 142 Oak Street, Dallas, TX 75201
Date of Loss: 2024-03-15
Cause of Loss: Hail damage
Reported Damage: Roof damage, gutter damage, window screen damage

Evidence documents:
1. Adjuster report (2024-03-20): "Visible hail damage to north-facing slope. 3 tab shingles show granule loss. Gutter denting on east side."
2. Contractor estimate (2024-03-25): "Full roof replacement needed. 28 squares. Wind and hail damage confirmed."
3. Weather report (2024-03-15): "Severe hail storm, golf ball sized hail reported in Dallas County."

Reconstruct the claim into a structured JSON object with fields:
- claimNumber, policyholder, property, dateOfLoss, causeOfLoss
- reportedDamage (array of strings)
- evidenceSummary (array of objects with source, finding, confidence)
- estimatedValue (string with range)
- status (string)
- flags (array of any concerns or gaps)`,
    expectedSchema: {
      type: "object",
      required: [
        "claimNumber",
        "policyholder",
        "dateOfLoss",
        "causeOfLoss",
        "evidenceSummary",
      ],
    },
    expectedKeywords: [
      "hail damage",
      "roof",
      "granule loss",
      "CLM-2024-0892",
    ],
    forbiddenPhrases: ["I cannot", "I'm unable", "As an AI"],
    groundTruth:
      "Roofing hail claim with adjuster and contractor evidence alignment. Evidence shows consistent hail damage narrative across documents.",
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "medium",
  },
  {
    id: "claim_recon_002",
    name: "Claim Reconstruction — Conflicting Evidence",
    task: "evidence_reasoning",
    domain: "claims",
    prompt: `Analyze this claim with conflicting evidence:

Claim Number: CLM-2024-1247
Cause: Wind damage to roof
Date of Loss: 2024-05-22

Evidence:
1. Homeowner statement: "Large tree branch fell on roof during storm. Multiple holes visible."
2. Adjuster report: "No visible impact damage found. Normal wear and tear observed on shingles. Minor curling on south slope."
3. Contractor photos: Show what appears to be impact marks on north-facing slope.
4. Weather data: "Severe thunderstorm warning for area on 2024-05-22. Winds up to 60mph."

Identify contradictions and provide a structured analysis.`,
    expectedKeywords: [
      "contradict",
      "conflicting",
      "adjuster",
      "discrepancy",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "hard",
  },
  {
    id: "supplement_gen_001",
    name: "Supplement Generation — Missing Items",
    task: "supplement_reasoning",
    domain: "claims",
    prompt: `Generate a supplement for this insurance claim. The original estimate is missing several items:

Claim: CLM-2024-0556
Original estimate: $12,500 (only covered roof replacement)
Property: 2-story residential, 2,400 sq ft

Contractor findings not in original estimate:
1. Drip edge replacement needed (not included)
2. Ice and water shield on eaves (required by code in this region)
3. Ridge vent replacement (damaged in storm)
4. Pipe boot flashing replacement (3 units)
5. Satellite dish removal and reinstallation
6. Debris cleanup and dumpster rental
7. Permit fees

Generate a structured supplement request with line items, justification for each, and estimated cost impact.`,
    expectedKeywords: [
      "drip edge",
      "ice and water shield",
      "ridge vent",
      "flashing",
      "supplement",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "medium",
  },
];

// ---------------------------------------------------------------------------
// Evidence domain
// ---------------------------------------------------------------------------

const EVIDENCE_CASES: EvalCase[] = [
  {
    id: "evidence_gap_001",
    name: "Evidence Gap Detection — Incomplete Documentation",
    task: "gap_intelligence",
    domain: "evidence",
    prompt: `Review this claim's evidence collection and identify gaps:

Claim Type: Water damage (burst pipe)
Property: Multi-family unit, Unit 4B

Available evidence:
1. Initial damage photos (5 photos, interior only)
2. Plumbing repair invoice
3. Water mitigation report
4. Homeowner statement

Identify what evidence is MISSING that would be needed for a complete claim package. Consider:
- Documentation that supports or contradicts the cause
- Required regulatory/inspection documents
- Cost validation documents
- Timeline documentation`,
    expectedKeywords: [
      "missing",
      "gap",
      "inspection",
      "documentation",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "medium",
  },
  {
    id: "entity_resolve_001",
    name: "Entity Resolution — Document References",
    task: "evidence_reasoning",
    domain: "evidence",
    prompt: `Resolve entity references across these documents from the same claim:

Document 1 (Adjuster Report): "Damage to north elevation consistent with storm event on 3/15"
Document 2 (Contractor Estimate): "Replace shingles on north face, 18 squares"
Document 3 (Weather Report): "Hail storm 03/15/2024, North Texas"
Document 4 (Homeowner Email): "The damage from the March storm on the top of the house"

Map the entity references:
- "north elevation" / "north face" / "top of the house" — are these the same area?
- "storm event" / "Hail storm" / "March storm" — are these the same event?
- "3/15" / "03/15/2024" / "March storm" — same date?

Provide a structured entity resolution map.`,
    expectedKeywords: [
      "resolve",
      "reference",
      "consistent",
      "same",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "easy",
  },
];

// ---------------------------------------------------------------------------
// Knowledge domain
// ---------------------------------------------------------------------------

const KNOWLEDGE_CASES: EvalCase[] = [
  {
    id: "knowledge_term_001",
    name: "Industry Terminology — Roofing Terms",
    task: "qa_reasoning",
    domain: "knowledge",
    prompt: `Explain the following roofing/insurance terms in plain language for a homeowner:

1. "Granule loss" — what it means and why it matters for claims
2. "Drip edge" — what it is and whether it's typically covered
3. "Ice and water shield" — purpose and code requirements
4. "Wind lift" vs "hail impact" — how adjusters distinguish them
5. "Depreciation" in the context of Actual Cash Value vs Replacement Cost

Keep explanations concise (2-3 sentences each) and accurate.`,
    expectedKeywords: [
      "granule",
      "shingle",
      "depreciation",
      "replacement cost",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: false,
    maxLatencyMs: 10_000,
    difficulty: "easy",
  },
  {
    id: "workflow_reason_001",
    name: "Workflow Reasoning — Claim Processing Steps",
    task: "qa_reasoning",
    domain: "knowledge",
    prompt: `A restoration contractor asks: "What should I do after completing repairs but before submitting the final invoice to the insurance company?"

List the recommended steps in order, covering:
- Documentation requirements
- Quality verification
- Compliance considerations
- Communication with the insurance carrier

Format as a numbered checklist.`,
    expectedKeywords: [
      "photos",
      "documentation",
      "inspection",
      "invoice",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: false,
    maxLatencyMs: 10_000,
    difficulty: "medium",
  },
];

// ---------------------------------------------------------------------------
// Decision Engine domain
// ---------------------------------------------------------------------------

const DECISION_CASES: EvalCase[] = [
  {
    id: "decision_recomm_001",
    name: "Recommendation Reasoning — Claim Prioritization",
    task: "evidence_reasoning",
    domain: "decision_engine",
    prompt: `Based on this portfolio of open claims, recommend which ones should be prioritized for immediate attention:

Claim A: CLM-001 — Roof hail damage, 60 days open, adjuster disputed, $15K estimate, storm season approaching
Claim B: CLM-002 — Water damage, 30 days open, all evidence collected, $8K estimate, awaiting carrier decision
Claim C: CLM-003 — Fire damage, 120 days open, complex, $85K estimate, multiple parties involved
Claim D: CLM-004 — Wind damage, 15 days open, supplemental needed, $5K estimate
Claim E: CLM-005 — Hail damage, 90 days open, missing evidence, $22K estimate

Recommend a prioritized action plan with reasoning for each claim.`,
    expectedKeywords: [
      "prioritize",
      "CLM-001",
      "approaching",
      "evidence",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 15_000,
    difficulty: "hard",
  },
];

// ---------------------------------------------------------------------------
// Ask Atlas domain
// ---------------------------------------------------------------------------

const ASK_ATLAS_CASES: EvalCase[] = [
  {
    id: "ask_atlas_001",
    name: "Grounded QA — Evidence-Based Answer",
    task: "ask_atlas",
    domain: "ask_atlas",
    prompt: `Based on the evidence provided, answer this question:

Question: "What is the total estimated cost for the roof replacement on claim CLM-2024-0892, and does the contractor estimate align with the adjuster's assessment?"

Available context:
- Adjuster estimate: $14,200 (partial roof replacement, north slope only)
- Contractor estimate: $22,800 (full roof replacement)
- Weather report confirms hail event
- Adjuster noted "normal wear" on south slope

Provide a direct answer grounded in the evidence, noting any discrepancies.`,
    expectedKeywords: [
      "$14,200",
      "$22,800",
      "discrepan",
      "adjuster",
    ],
    forbiddenPhrases: [
      "I don't have",
      "I cannot access",
      "no data",
    ],
    groundTruth: "There is a $8,600 discrepancy between adjuster and contractor estimates. The disagreement centers on partial vs full replacement scope.",
    requiresStructuredOutput: true,
    maxLatencyMs: 10_000,
    difficulty: "medium",
  },
  {
    id: "ask_atlas_002",
    name: "Grounded QA — Contradiction Detection",
    task: "ask_atlas",
    domain: "ask_atlas",
    prompt: `Review these conflicting statements and determine which is more credible:

Statement 1 (Contractor): "The entire roof needs replacement. Hail damage is visible on all slopes."
Statement 2 (Adjuster): "Damage is limited to north-facing slope. South and west slopes show normal aging, not storm damage."

Evidence available:
- Contractor photos: 12 photos, mostly from north angle
- Adjuster photos: 24 photos, all four compass directions
- Weather data: Storm came from northwest

Which assessment is better supported by the evidence?`,
    expectedKeywords: [
      "adjuster",
      "evidence",
      "photos",
      "supported",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 10_000,
    difficulty: "hard",
  },
];

// ---------------------------------------------------------------------------
// CRM domain
// ---------------------------------------------------------------------------

const CRM_CASES: EvalCase[] = [
  {
    id: "crm_outreach_001",
    name: "CRM Outreach — Post-Storm Follow-up",
    task: "crm_outreach",
    domain: "crm",
    prompt: `Write a personalized follow-up email for a homeowner after a storm damage consultation.

Context:
- Homeowner: Sarah Johnson
- Property: 4521 Maple Drive, Fort Worth, TX
- Damage type: Hail damage to roof and siding
- Consultation date: Last Tuesday
- Key finding: Multiple areas of damage, full inspection recommended
- Tone: Professional but warm, not pushy

Include a clear next step/call to action.`,
    expectedKeywords: [
      "Sarah",
      "inspection",
      "follow",
      "Fort Worth",
    ],
    forbiddenPhrases: [
      "act now",
      "limited time",
      "don't miss",
    ],
    requiresStructuredOutput: false,
    maxLatencyMs: 10_000,
    difficulty: "easy",
  },
  {
    id: "crm_classify_001",
    name: "Lead Classification — Priority Scoring",
    task: "crm_outreach",
    domain: "crm",
    prompt: `Classify these incoming leads by priority (high/medium/low) and recommend follow-up timing:

Lead 1: "My roof was damaged in last week's hail storm. Insurance already came out but I think they missed some damage."
Lead 2: "Just curious about getting my roof checked. No known damage."
Lead 3: "Our commercial building had a fire. Multiple units affected. Need urgent assessment. Have insurance info ready."
Lead 4: "We had a small leak last month. Not sure if it's related to the storm."

For each lead, provide:
- Priority level
- Reasoning
- Recommended follow-up timeline
- Key talking points`,
    expectedKeywords: [
      "priority",
      "Lead 3",
      "high",
      "urgent",
    ],
    forbiddenPhrases: [],
    requiresStructuredOutput: true,
    maxLatencyMs: 10_000,
    difficulty: "medium",
  },
];

// ---------------------------------------------------------------------------
// Embedding domain (lightweight, just verifies capability)
// ---------------------------------------------------------------------------

const EMBEDDING_CASES: EvalCase[] = [
  {
    id: "embed_similarity_001",
    name: "Embedding Similarity — Semantic Match",
    task: "embedding",
    domain: "embedding",
    prompt: "Compare the semantic similarity of these insurance-related sentences:\n1. 'The roof has hail damage'\n2. 'Storm damage to shingles'\n3. 'The kitchen needs new cabinets'",
    expectedKeywords: ["similar", "semantic", "hail", "storm"],
    forbiddenPhrases: [],
    requiresStructuredOutput: false,
    difficulty: "easy",
  },
];

// ---------------------------------------------------------------------------
// All cases
// ---------------------------------------------------------------------------

export const EVAL_DATASET: EvalCase[] = [
  ...CLAIMS_CASES,
  ...EVIDENCE_CASES,
  ...KNOWLEDGE_CASES,
  ...DECISION_CASES,
  ...ASK_ATLAS_CASES,
  ...CRM_CASES,
  ...EMBEDDING_CASES,
];

// ---------------------------------------------------------------------------
// Dataset API
// ---------------------------------------------------------------------------

/**
 * Get all evaluation cases.
 */
export function getAllCases(): EvalCase[] {
  return [...EVAL_DATASET];
}

/**
 * Get cases for a specific task.
 */
export function getCasesForTask(task: string): EvalCase[] {
  return EVAL_DATASET.filter((c) => c.task === task);
}

/**
 * Get cases for a specific domain.
 */
export function getCasesForDomain(domain: string): EvalCase[] {
  return EVAL_DATASET.filter((c) => c.domain === domain);
}

/**
 * Get cases by difficulty.
 */
export function getCasesByDifficulty(
  difficulty: "easy" | "medium" | "hard",
): EvalCase[] {
  return EVAL_DATASET.filter((c) => c.difficulty === difficulty);
}

/**
 * Get a specific case by ID.
 */
export function getCaseById(id: string): EvalCase | undefined {
  return EVAL_DATASET.find((c) => c.id === id);
}

/**
 * Get dataset summary statistics.
 */
export function getDatasetSummary(): {
  totalCases: number;
  byTask: Record<string, number>;
  byDomain: Record<string, number>;
  byDifficulty: Record<string, number>;
} {
  const byTask: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};

  for (const c of EVAL_DATASET) {
    byTask[c.task] = (byTask[c.task] ?? 0) + 1;
    byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    byDifficulty[c.difficulty] = (byDifficulty[c.difficulty] ?? 0) + 1;
  }

  return {
    totalCases: EVAL_DATASET.length,
    byTask,
    byDomain,
    byDifficulty,
  };
}
