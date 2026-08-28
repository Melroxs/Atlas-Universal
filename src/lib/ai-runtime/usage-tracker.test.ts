// ---------------------------------------------------------------------------
// Atlas AI Runtime — Usage Tracker unit tests
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach } from "vitest";
import {
  recordUsage,
  getUsageRecords,
  getUsageByProvider,
  getErrorRateByProvider,
  getTotalCost,
  resetUsageRecords,
} from "./usage-tracker";

beforeEach(() => {
  resetUsageRecords();
});

// ---------------------------------------------------------------------------
// recordUsage + getUsageRecords
// ---------------------------------------------------------------------------

describe("recordUsage", () => {
  it("records a successful generate call", () => {
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      estimatedCostUsd: 0.0001,
      latencyMs: 450,
      success: true,
    });

    const records = getUsageRecords();
    expect(records).toHaveLength(1);
    expect(records[0].provider).toBe("gemini");
    expect(records[0].model).toBe("gemini-2.5-flash");
    expect(records[0].operation).toBe("generate");
    expect(records[0].totalTokens).toBe(300);
    expect(records[0].success).toBe(true);
    expect(records[0].timestamp).toBeTruthy();
  });

  it("records a failed call with error code", () => {
    recordUsage({
      provider: "nvidia-nim",
      model: "deepseek-ai/deepseek-v4-pro",
      operation: "structured",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 120,
      success: false,
      errorCode: "rate_limited",
    });

    const records = getUsageRecords();
    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
    expect(records[0].errorCode).toBe("rate_limited");
  });

  it("trims records when exceeding max limit", () => {
    // Record 10,001 entries — the oldest should be trimmed
    for (let i = 0; i < 10_001; i++) {
      recordUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        operation: "generate",
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        estimatedCostUsd: 0.000001,
        latencyMs: 100,
        success: true,
        metadata: { index: i },
      });
    }

    const records = getUsageRecords();
    expect(records.length).toBeLessThanOrEqual(10_000);
  });
});

// ---------------------------------------------------------------------------
// getUsageByProvider
// ---------------------------------------------------------------------------

describe("getUsageByProvider", () => {
  it("aggregates usage by provider", () => {
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      estimatedCostUsd: 0.0001,
      latencyMs: 400,
      success: true,
    });
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-pro",
      operation: "generate",
      promptTokens: 200,
      completionTokens: 400,
      totalTokens: 600,
      estimatedCostUsd: 0.0005,
      latencyMs: 800,
      success: true,
    });
    recordUsage({
      provider: "nvidia-nim",
      model: "deepseek-ai/deepseek-v4-pro",
      operation: "generate",
      promptTokens: 50,
      completionTokens: 150,
      totalTokens: 200,
      estimatedCostUsd: 0.0003,
      latencyMs: 300,
      success: true,
    });

    const summary = getUsageByProvider();

    // Gemini
    expect(summary.gemini).toBeDefined();
    expect(summary.gemini.totalCalls).toBe(2);
    expect(summary.gemini.successfulCalls).toBe(2);
    expect(summary.gemini.failedCalls).toBe(0);
    expect(summary.gemini.totalTokens).toBe(900);
    expect(summary.gemini.totalCostUsd).toBeCloseTo(0.0006, 6);
    expect(summary.gemini.avgLatencyMs).toBe(600);

    // NVIDIA
    expect(summary["nvidia-nim"]).toBeDefined();
    expect(summary["nvidia-nim"].totalCalls).toBe(1);
    expect(summary["nvidia-nim"].totalTokens).toBe(200);
  });

  it("handles empty records", () => {
    const summary = getUsageByProvider();
    expect(Object.keys(summary)).toHaveLength(0);
  });

  it("includes failed calls in the total", () => {
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
      success: false,
      errorCode: "rate_limited",
    });
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      estimatedCostUsd: 0.00005,
      latencyMs: 300,
      success: true,
    });

    const summary = getUsageByProvider();
    expect(summary.gemini.totalCalls).toBe(2);
    expect(summary.gemini.successfulCalls).toBe(1);
    expect(summary.gemini.failedCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getErrorRateByProvider
// ---------------------------------------------------------------------------

describe("getErrorRateByProvider", () => {
  it("returns 0 error rate when all calls succeed", () => {
    for (let i = 0; i < 5; i++) {
      recordUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        operation: "generate",
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        estimatedCostUsd: 0.0001,
        latencyMs: 300,
        success: true,
      });
    }

    const rates = getErrorRateByProvider();
    expect(rates.gemini).toBe(0);
  });

  it("computes correct error rate", () => {
    // 3 successes, 1 failure = 0.25 error rate
    for (let i = 0; i < 3; i++) {
      recordUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        operation: "generate",
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        estimatedCostUsd: 0.0001,
        latencyMs: 300,
        success: true,
      });
    }
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
      success: false,
      errorCode: "rate_limited",
    });

    const rates = getErrorRateByProvider();
    expect(rates.gemini).toBe(0.25);
  });

  it("handles empty records", () => {
    const rates = getErrorRateByProvider();
    expect(Object.keys(rates)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getTotalCost
// ---------------------------------------------------------------------------

describe("getTotalCost", () => {
  it("sums cost across all providers", () => {
    recordUsage({
      provider: "gemini",
      model: "gemini-2.5-flash",
      operation: "generate",
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      estimatedCostUsd: 0.0001,
      latencyMs: 300,
      success: true,
    });
    recordUsage({
      provider: "nvidia-nim",
      model: "deepseek-ai/deepseek-v4-pro",
      operation: "generate",
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      estimatedCostUsd: 0.0005,
      latencyMs: 300,
      success: true,
    });

    expect(getTotalCost()).toBeCloseTo(0.0006, 6);
  });

  it("returns 0 with no records", () => {
    expect(getTotalCost()).toBe(0);
  });
});
