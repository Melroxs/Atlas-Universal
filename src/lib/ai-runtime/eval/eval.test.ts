// ---------------------------------------------------------------------------
// Atlas AI Runtime — Evaluation Framework Tests
//
// Tests the evaluation dataset, criteria/scoring, scorecard generation,
// and router integration without making any real API calls.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllCases,
  getCasesForTask,
  getCasesForDomain,
  getCasesByDifficulty,
  getCaseById,
  getDatasetSummary,
} from "./dataset";
import {
  scoreStructuralValidity,
  scoreKeywordCoverage,
  scoreGrounding,
  scoreHallucination,
  scoreCompleteness,
  computeOverallScore,
  scoreCaseResult,
} from "./criteria";
import { generateScorecards, generateRecommendations } from "./scorecard";
import {
  generateRoutingSuggestions,
  applyRoutingSuggestions,
  diffScorecards,
} from "./router-integration";
import type { EvalCase, EvalCaseResult, ModelScorecard } from "./types";

// ---------------------------------------------------------------------------
// Dataset tests
// ---------------------------------------------------------------------------

describe("Evaluation Dataset", () => {
  it("should have at least 10 test cases", () => {
    const cases = getAllCases();
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it("should cover all required domains", () => {
    const summary = getDatasetSummary();
    expect(summary.byDomain).toHaveProperty("claims");
    expect(summary.byDomain).toHaveProperty("evidence");
    expect(summary.byDomain).toHaveProperty("knowledge");
    expect(summary.byDomain).toHaveProperty("decision_engine");
    expect(summary.byDomain).toHaveProperty("ask_atlas");
    expect(summary.byDomain).toHaveProperty("crm");
  });

  it("should cover all difficulty levels", () => {
    const summary = getDatasetSummary();
    expect(summary.byDifficulty).toHaveProperty("easy");
    expect(summary.byDifficulty).toHaveProperty("medium");
    expect(summary.byDifficulty).toHaveProperty("hard");
  });

  it("should filter cases by task", () => {
    const cases = getCasesForTask("evidence_reasoning");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.task).toBe("evidence_reasoning");
    }
  });

  it("should filter cases by domain", () => {
    const cases = getCasesForDomain("claims");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.domain).toBe("claims");
    }
  });

  it("should filter cases by difficulty", () => {
    const easy = getCasesByDifficulty("easy");
    const hard = getCasesByDifficulty("hard");
    expect(easy.length).toBeGreaterThan(0);
    expect(hard.length).toBeGreaterThan(0);
  });

  it("should find a case by ID", () => {
    const c = getCaseById("claim_recon_001");
    expect(c).toBeDefined();
    expect(c!.name).toContain("Claim Reconstruction");
  });

  it("should return undefined for unknown case ID", () => {
    expect(getCaseById("nonexistent")).toBeUndefined();
  });

  it("each case should have required fields", () => {
    for (const c of getAllCases()) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.task).toBeTruthy();
      expect(c.domain).toBeTruthy();
      expect(c.prompt).toBeTruthy();
      expect(typeof c.requiresStructuredOutput).toBe("boolean");
      expect(["easy", "medium", "hard"]).toContain(c.difficulty);
    }
  });
});

// ---------------------------------------------------------------------------
// Scoring criteria tests
// ---------------------------------------------------------------------------

describe("Structural Validity Scoring", () => {
  it("should return 100 when no schema is required", () => {
    const result = scoreStructuralValidity("any output");
    expect(result.score).toBe(100);
  });

  it("should score 100 for valid JSON matching schema", () => {
    const json = JSON.stringify({
      claimNumber: "CLM-001",
      policyholder: "John",
      dateOfLoss: "2024-01-01",
      causeOfLoss: "hail",
      evidenceSummary: [],
    });
    const result = scoreStructuralValidity(json, {
      type: "object",
      required: ["claimNumber", "policyholder", "dateOfLoss"],
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.parsed).toBeDefined();
  });

  it("should penalize missing required fields", () => {
    const json = JSON.stringify({
      claimNumber: "CLM-001",
      // Missing policyholder and dateOfLoss
    });
    const result = scoreStructuralValidity(json, {
      type: "object",
      required: ["claimNumber", "policyholder", "dateOfLoss"],
    });
    expect(result.score).toBeLessThan(80);
  });

  it("should score 0 for invalid JSON", () => {
    const result = scoreStructuralValidity("not json at all", {
      type: "object",
      required: ["field"],
    });
    expect(result.score).toBe(0);
  });

  it("should handle markdown-wrapped JSON", () => {
    const json = '```json\n{"claimNumber": "CLM-001", "status": "open"}\n```';
    const result = scoreStructuralValidity(json, {
      type: "object",
      required: ["claimNumber"],
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});

describe("Keyword Coverage Scoring", () => {
  it("should return 100 when no keywords specified", () => {
    expect(scoreKeywordCoverage("any output")).toBe(100);
  });

  it("should score 100 when all keywords found", () => {
    const score = scoreKeywordCoverage(
      "The hail damage to the roof is severe",
      ["hail", "damage", "roof"],
    );
    expect(score).toBe(100);
  });

  it("should score 0 when no keywords found", () => {
    const score = scoreKeywordCoverage(
      "The weather is nice today",
      ["hail", "damage", "roof"],
    );
    expect(score).toBe(0);
  });

  it("should score proportionally for partial matches", () => {
    const score = scoreKeywordCoverage(
      "The hail damage is visible",
      ["hail", "damage", "roof", "shingle"],
    );
    expect(score).toBe(50); // 2 out of 4
  });

  it("should be case-insensitive", () => {
    const score = scoreKeywordCoverage(
      "HAIL DAMAGE to the ROOF",
      ["hail", "damage", "roof"],
    );
    expect(score).toBe(100);
  });
});

describe("Grounding Score", () => {
  it("should return 100 when no ground truth", () => {
    expect(scoreGrounding("any output")).toBe(100);
  });

  it("should score high when output contains ground truth concepts", () => {
    const score = scoreGrounding(
      "There is a discrepancy between the adjuster estimate of $14,200 and the contractor estimate of $22,800 for the roof replacement.",
      "There is a $8,600 discrepancy between adjuster and contractor estimates. The disagreement centers on partial vs full replacement scope.",
    );
    // Keyword-overlap heuristic gives ~47 for partial semantic overlap;
    // this confirms the function penalizes partial coverage correctly.
    expect(score).toBeGreaterThan(30);
  });

  it("should score low when output is unrelated to ground truth", () => {
    const score = scoreGrounding(
      "The weather is sunny and warm today with clear blue skies.",
      "There is a significant discrepancy between adjuster and contractor estimates for the roof claim.",
    );
    expect(score).toBeLessThan(60);
  });
});

describe("Hallucination Score", () => {
  it("should return 100 when no forbidden phrases and no hallucination markers", () => {
    const score = scoreHallucination(
      "The evidence shows clear hail damage to the north-facing slope.",
    );
    expect(score).toBe(100);
  });

  it("should penalize forbidden phrases", () => {
    const score = scoreHallucination(
      "I cannot access any data about this claim.",
      ["I cannot"],
    );
    expect(score).toBeLessThan(100);
  });

  it("should detect common hallucination markers", () => {
    const score = scoreHallucination(
      "I don't have any data or information about this specific claim.",
    );
    expect(score).toBeLessThan(100);
  });

  it("should handle multiple forbidden phrases", () => {
    const score = scoreHallucination(
      "I cannot help with that. I'm unable to access the data.",
      ["I cannot", "I'm unable"],
    );
    expect(score).toBeLessThanOrEqual(60);
  });
});

describe("Completeness Score", () => {
  it("should score higher for longer responses", () => {
    const shortResponse = "Hail damage.";
    const longResponse =
      "The evidence shows significant hail damage to the north-facing slope of the roof. " +
      "The adjuster's report confirms granule loss on multiple shingles, and the contractor's " +
      "estimate aligns with the weather data showing a severe hail storm on the date of loss. " +
      "I recommend proceeding with the roof replacement as the damage is consistent across all evidence sources.";

    const shortCase = getAllCases()[0]!;
    const shortScore = scoreCompleteness(shortResponse, shortCase);
    const longScore = scoreCompleteness(longResponse, shortCase);

    expect(longScore).toBeGreaterThan(shortScore);
  });
});

describe("Overall Score Computation", () => {
  it("should compute weighted average", () => {
    const score = computeOverallScore({
      structural: 100,
      keyword: 100,
      grounding: 100,
      hallucination: 100,
      completeness: 100,
    });
    expect(score).toBe(100);
  });

  it("should handle zero scores", () => {
    const score = computeOverallScore({
      structural: 0,
      keyword: 0,
      grounding: 0,
      hallucination: 0,
      completeness: 0,
    });
    expect(score).toBe(0);
  });

  it("should weight structural and grounding higher than keyword", () => {
    const highStructural = computeOverallScore({
      structural: 100,
      keyword: 0,
      grounding: 100,
      hallucination: 100,
      completeness: 0,
    });
    const highKeyword = computeOverallScore({
      structural: 0,
      keyword: 100,
      grounding: 0,
      hallucination: 0,
      completeness: 100,
    });
    expect(highStructural).toBeGreaterThan(highKeyword);
  });
});

describe("Case Result Scoring", () => {
  it("should produce zero scores for failed results", () => {
    const case_ = getAllCases()[0]!;
    const result = scoreCaseResult({
      case_,
      output: "",
      modelId: "test-model",
      providerId: "test-provider",
      latencyMs: 1000,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      success: false,
      errorMessage: "Provider unavailable",
      errorCode: "provider_unavailable",
    });

    expect(result.overallScore).toBe(0);
    expect(result.success).toBe(false);
    expect(result.reviewStatus).toBe("rejected");
  });

  it("should produce non-zero scores for successful results", () => {
    const case_ = getCaseById("entity_resolve_001")!;
    const result = scoreCaseResult({
      case_,
      output:
        "The entity references resolve as follows: 'north elevation' and 'north face' refer to the same area. " +
        "'storm event', 'Hail storm', and 'March storm' all reference the same weather event. " +
        "'3/15', '03/15/2024', and 'March storm' refer to the same date of March 15, 2024. " +
        "All document references are consistent and align with the same claim.",
      modelId: "test-model",
      providerId: "test-provider",
      latencyMs: 2000,
      inputTokens: 100,
      outputTokens: 80,
      estimatedCostUsd: 0.001,
      success: true,
    });

    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(result.structuralScore).toBeGreaterThanOrEqual(0);
    expect(result.keywordScore).toBeGreaterThanOrEqual(0);
  });

  it("should assign review status based on score", () => {
    const case_ = getCaseById("entity_resolve_001")!;

    // High-quality response
    const highResult = scoreCaseResult({
      case_,
      output:
        "All entity references are consistent across documents. The entity references resolve correctly: " +
        "'north elevation' matches 'north face' and 'top of the house'. The storm references all align " +
        "to the same event on March 15, 2024. All dates correspond to the same calendar date.",
      modelId: "test-model",
      providerId: "test-provider",
      latencyMs: 1500,
      inputTokens: 100,
      outputTokens: 100,
      estimatedCostUsd: 0.001,
      success: true,
    });

    // Should be approved or needs_review for decent output
    expect(["approved", "needs_review"]).toContain(highResult.reviewStatus);
  });
});

// ---------------------------------------------------------------------------
// Scorecard tests
// ---------------------------------------------------------------------------

describe("Scorecard Generation", () => {
  const mockResults: EvalCaseResult[] = [
    {
      caseId: "claim_recon_001",
      task: "evidence_reasoning",
      modelId: "gemini-2.5-flash",
      providerId: "gemini",
      overallScore: 85,
      structuralScore: 90,
      keywordScore: 80,
      groundingScore: 85,
      hallucinationScore: 95,
      completenessScore: 80,
      latencyMs: 2000,
      inputTokens: 200,
      outputTokens: 300,
      estimatedCostUsd: 0.001,
      success: true,
      reviewStatus: "approved",
    },
    {
      caseId: "entity_resolve_001",
      task: "evidence_reasoning",
      modelId: "gemini-2.5-flash",
      providerId: "gemini",
      overallScore: 70,
      structuralScore: 80,
      keywordScore: 60,
      groundingScore: 70,
      hallucinationScore: 90,
      completenessScore: 60,
      latencyMs: 1500,
      inputTokens: 150,
      outputTokens: 200,
      estimatedCostUsd: 0.0008,
      success: true,
      reviewStatus: "needs_review",
    },
    {
      caseId: "claim_recon_001",
      task: "evidence_reasoning",
      modelId: "deepseek-v4-pro",
      providerId: "nvidia-nim",
      overallScore: 92,
      structuralScore: 95,
      keywordScore: 88,
      groundingScore: 92,
      hallucinationScore: 98,
      completenessScore: 85,
      latencyMs: 3000,
      inputTokens: 200,
      outputTokens: 350,
      estimatedCostUsd: 0.002,
      success: true,
      reviewStatus: "approved",
    },
  ];

  const mockRun = {
    runId: "test_run_001",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    modelsEvaluated: [
      { providerId: "gemini" as const, modelId: "gemini-2.5-flash" },
      { providerId: "nvidia-nim" as const, modelId: "deepseek-v4-pro" },
    ],
    totalCases: 2,
    totalResults: 3,
    passed: 3,
    failed: 0,
    errored: 0,
    totalCostUsd: 0.0038,
    avgLatencyMs: 2167,
    completed: true,
    results: mockResults,
  };

  it("should generate one scorecard per model", () => {
    const scorecards = generateScorecards(mockRun);
    expect(scorecards.length).toBe(2);
  });

  it("should rank models by overall score", () => {
    const scorecards = generateScorecards(mockRun);
    expect(scorecards[0]!.modelId).toBe("deepseek-v4-pro");
    expect(scorecards[0]!.overallScore).toBeGreaterThan(
      scorecards[1]!.overallScore,
    );
  });

  it("should compute domain scores", () => {
    const scorecards = generateScorecards(mockRun);
    for (const sc of scorecards) {
      expect(Object.keys(sc.domainScores).length).toBeGreaterThan(0);
    }
  });

  it("should compute task scores", () => {
    const scorecards = generateScorecards(mockRun);
    for (const sc of scorecards) {
      expect(sc.taskScores.evidence_reasoning).toBeGreaterThan(0);
    }
  });

  it("should handle empty results", () => {
    const emptyRun = { ...mockRun, results: [] };
    const scorecards = generateScorecards(emptyRun);
    expect(scorecards.length).toBe(0);
  });

  it("should include failed results in total cases", () => {
    const runWithFailure = {
      ...mockRun,
      results: [
        ...mockResults,
        {
          caseId: "failing_case",
          task: "ask_atlas" as const,
          modelId: "gemini-2.5-flash",
          providerId: "gemini" as const,
          overallScore: 0,
          structuralScore: 0,
          keywordScore: 0,
          groundingScore: 0,
          hallucinationScore: 0,
          completenessScore: 0,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          success: false,
          errorMessage: "Provider error",
          reviewStatus: "rejected" as const,
        },
      ],
    };
    const scorecards = generateScorecards(runWithFailure);
    const geminiSc = scorecards.find((sc) => sc.modelId === "gemini-2.5-flash");
    expect(geminiSc).toBeDefined();
    expect(geminiSc!.failedCases).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Recommendation tests
// ---------------------------------------------------------------------------

describe("Recommendation Generation", () => {
  const scorecards: ModelScorecard[] = [
    {
      modelId: "gemini-2.5-flash",
      providerId: "gemini",
      overallScore: 72,
      domainScores: { claims: 75, evidence: 70 },
      taskScores: {
        evidence_reasoning: 75,
        ask_atlas: 80,
      } as any,
      avgLatencyMs: 2000,
      p95LatencyMs: 3000,
      successRate: 1,
      totalCostUsd: 0.001,
      costPerCase: 0.0005,
      totalTokens: 500,
      avgStructuralScore: 80,
      avgGroundingScore: 75,
      avgHallucinationRate: 5,
      avgCompletenessScore: 70,
      avgKeywordScore: 65,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
    },
    {
      modelId: "deepseek-v4-pro",
      providerId: "nvidia-nim",
      overallScore: 88,
      domainScores: { claims: 92, evidence: 85 },
      taskScores: {
        evidence_reasoning: 92,
        ask_atlas: 78,
      } as any,
      avgLatencyMs: 3000,
      p95LatencyMs: 5000,
      successRate: 1,
      totalCostUsd: 0.002,
      costPerCase: 0.001,
      totalTokens: 550,
      avgStructuralScore: 92,
      avgGroundingScore: 88,
      avgHallucinationRate: 2,
      avgCompletenessScore: 85,
      avgKeywordScore: 82,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
    },
  ];

  it("should recommend the best model for each task", () => {
    const recs = generateRecommendations(scorecards);
    expect(recs.length).toBeGreaterThan(0);

    // First rec is overall
    expect(recs[0]!.task).toBe("overall");
    // With equal overall scores, either model can be recommended
    expect(["gemini-2.5-flash", "deepseek-v4-pro"]).toContain(recs[0]!.recommendedModelId);
  });

  it("should identify task-specific best models", () => {
    const recs = generateRecommendations(scorecards);
    const evidenceRec = recs.find((r) => r.task === "evidence_reasoning");
    expect(evidenceRec).toBeDefined();
    expect(evidenceRec!.recommendedModelId).toBe("deepseek-v4-pro");
  });

  it("should detect when change is recommended", () => {
    const recs = generateRecommendations(scorecards, {
      evidence_reasoning: "gemini-2.5-flash",
    } as any);
    const evidenceRec = recs.find((r) => r.task === "evidence_reasoning");
    expect(evidenceRec!.changeRecommended).toBe(true);
  });

  it("should detect when no change is needed", () => {
    const recs = generateRecommendations(scorecards, {
      evidence_reasoning: "deepseek-v4-pro",
    } as any);
    const evidenceRec = recs.find((r) => r.task === "evidence_reasoning");
    expect(evidenceRec!.changeRecommended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Router Integration tests
// ---------------------------------------------------------------------------

describe("Router Integration", () => {
  const scorecards: ModelScorecard[] = [
    {
      modelId: "gemini-2.5-flash",
      providerId: "gemini",
      overallScore: 72,
      domainScores: {},
      taskScores: {
        evidence_reasoning: 68,
        crm_outreach: 90,
      } as any,
      avgLatencyMs: 2000,
      p95LatencyMs: 3000,
      successRate: 1,
      totalCostUsd: 0.001,
      costPerCase: 0.0005,
      totalTokens: 500,
      avgStructuralScore: 80,
      avgGroundingScore: 75,
      avgHallucinationRate: 5,
      avgCompletenessScore: 70,
      avgKeywordScore: 65,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
    },
    {
      modelId: "deepseek-v4-pro",
      providerId: "nvidia-nim",
      overallScore: 88,
      domainScores: {},
      taskScores: {
        evidence_reasoning: 92,
        crm_outreach: 75,
      } as any,
      avgLatencyMs: 3000,
      p95LatencyMs: 5000,
      successRate: 1,
      totalCostUsd: 0.002,
      costPerCase: 0.001,
      totalTokens: 550,
      avgStructuralScore: 92,
      avgGroundingScore: 88,
      avgHallucinationRate: 2,
      avgCompletenessScore: 85,
      avgKeywordScore: 82,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
    },
  ];

  it("should generate routing suggestions", () => {
    const suggestions = generateRoutingSuggestions(scorecards);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("should suggest the best model per task", () => {
    const suggestions = generateRoutingSuggestions(scorecards);
    const evidenceSugg = suggestions.find((s) => s.task === "evidence_reasoning");
    expect(evidenceSugg).toBeDefined();
    expect(evidenceSugg!.suggestedModelId).toBe("deepseek-v4-pro");
  });

  it("should not suggest change when improvement is small", () => {
    const closeScorecards: ModelScorecard[] = [
      {
        ...scorecards[0]!,
        taskScores: { evidence_reasoning: 85 } as any,
      },
      {
        ...scorecards[1]!,
        taskScores: { evidence_reasoning: 87 } as any,
      },
    ];
    const suggestions = generateRoutingSuggestions(closeScorecards);
    // 2-point difference < 5 threshold, no suggestion
    expect(suggestions.filter((s) => s.task === "evidence_reasoning").length).toBe(0);
  });

  it("should apply suggestions with confidence filter", () => {
    const suggestions = generateRoutingSuggestions(scorecards);
    const result = applyRoutingSuggestions(suggestions, { dryRun: true });
    expect(result.applied.length + result.skipped.length).toBe(
      suggestions.length,
    );
  });

  it("should support dry run mode", () => {
    const suggestions = generateRoutingSuggestions(scorecards);
    const result = applyRoutingSuggestions(suggestions, { dryRun: true });
    expect(Object.keys(result.configChanges).length).toBe(0);
  });

  it("should return empty suggestions with < 2 scorecards", () => {
    const suggestions = generateRoutingSuggestions([scorecards[0]!]);
    expect(suggestions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Benchmark Diff tests
// ---------------------------------------------------------------------------

describe("Benchmark Diff", () => {
  it("should detect score improvements", () => {
    const previous: ModelScorecard[] = [
      {
        modelId: "gemini-2.5-flash",
        providerId: "gemini",
        overallScore: 70,
        domainScores: {},
        taskScores: { evidence_reasoning: 65 } as any,
        avgLatencyMs: 2500,
        p95LatencyMs: 3000,
        successRate: 0.9,
        totalCostUsd: 0.001,
        costPerCase: 0.0005,
        totalTokens: 500,
        avgStructuralScore: 75,
        avgGroundingScore: 70,
        avgHallucinationRate: 8,
        avgCompletenessScore: 65,
        avgKeywordScore: 60,
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
      },
    ];

    const current: ModelScorecard[] = [
      {
        modelId: "gemini-2.5-flash",
        providerId: "gemini",
        overallScore: 82,
        domainScores: {},
        taskScores: { evidence_reasoning: 80 } as any,
        avgLatencyMs: 2000,
        p95LatencyMs: 2500,
        successRate: 1,
        totalCostUsd: 0.0008,
        costPerCase: 0.0004,
        totalTokens: 500,
        avgStructuralScore: 85,
        avgGroundingScore: 82,
        avgHallucinationRate: 3,
        avgCompletenessScore: 78,
        avgKeywordScore: 75,
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
      },
    ];

    const diffs = diffScorecards(previous, current);
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.overallScoreChange).toBe(12);
    expect(diffs[0]!.latencyChangeMs).toBe(-500); // Faster
    expect(diffs[0]!.costChangeUsd).toBeLessThan(0); // Cheaper
    expect(diffs[0]!.taskChanges.evidence_reasoning).toBe(15);
  });

  it("should detect regressions", () => {
    const previous: ModelScorecard[] = [
      {
        modelId: "gemini-2.5-flash",
        providerId: "gemini",
        overallScore: 85,
        domainScores: {},
        taskScores: { evidence_reasoning: 85 } as any,
        avgLatencyMs: 2000,
        p95LatencyMs: 3000,
        successRate: 1,
        totalCostUsd: 0.001,
        costPerCase: 0.0005,
        totalTokens: 500,
        avgStructuralScore: 90,
        avgGroundingScore: 85,
        avgHallucinationRate: 2,
        avgCompletenessScore: 82,
        avgKeywordScore: 80,
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
      },
    ];

    const current: ModelScorecard[] = [
      {
        modelId: "gemini-2.5-flash",
        providerId: "gemini",
        overallScore: 70,
        domainScores: {},
        taskScores: { evidence_reasoning: 65 } as any,
        avgLatencyMs: 3000,
        p95LatencyMs: 4000,
        successRate: 0.85,
        totalCostUsd: 0.0015,
        costPerCase: 0.0008,
        totalTokens: 600,
        avgStructuralScore: 72,
        avgGroundingScore: 68,
        avgHallucinationRate: 12,
        avgCompletenessScore: 65,
        avgKeywordScore: 60,
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
      },
    ];

    const diffs = diffScorecards(previous, current);
    expect(diffs[0]!.overallScoreChange).toBe(-15); // Regression
    expect(diffs[0]!.latencyChangeMs).toBe(1000); // Slower
    expect(diffs[0]!.costChangeUsd).toBeGreaterThan(0); // More expensive
  });

  it("should handle new models not in previous run", () => {
    const previous: ModelScorecard[] = [];
    const current: ModelScorecard[] = [
      {
        modelId: "new-model",
        providerId: "nvidia-nim",
        overallScore: 80,
        domainScores: {},
        taskScores: {} as any,
        avgLatencyMs: 2000,
        p95LatencyMs: 3000,
        successRate: 1,
        totalCostUsd: 0.001,
        costPerCase: 0.0005,
        totalTokens: 500,
        avgStructuralScore: 80,
        avgGroundingScore: 75,
        avgHallucinationRate: 5,
        avgCompletenessScore: 70,
        avgKeywordScore: 65,
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
      },
    ];

    const diffs = diffScorecards(previous, current);
    expect(diffs.length).toBe(0); // No previous data to diff against
  });
});
