// ---------------------------------------------------------------------------
// Atlas AI Runtime — Usage Tracker
//
// Records every AI call for cost monitoring, performance tracking, and
// observability. Records metadata only — never logs customer prompts
// or response content.
// ---------------------------------------------------------------------------

import type { UsageRecord, ProviderId, AIRuntimeErrorCode } from "./types";

// ---------------------------------------------------------------------------
// Usage tracker
// ---------------------------------------------------------------------------

const _records: UsageRecord[] = [];
const MAX_RECORDS = 10_000;

/**
 * Record an AI call for tracking.
 */
export function recordUsage(record: Omit<UsageRecord, "timestamp">): void {
  _records.push({
    ...record,
    timestamp: new Date().toISOString(),
  });

  // Trim old records if we exceed the limit
  if (_records.length > MAX_RECORDS) {
    _records.splice(0, _records.length - MAX_RECORDS);
  }
}

/**
 * Get all usage records (for observability dashboard).
 */
export function getUsageRecords(): UsageRecord[] {
  return [..._records];
}

/**
 * Get usage summary by provider.
 */
export function getUsageByProvider(): Record<
  ProviderId,
  {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
  }
> {
  const summary: Record<string, {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    totalLatencyMs: number;
  }> = {};

  for (const r of _records) {
    if (!summary[r.provider]) {
      summary[r.provider] = {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalLatencyMs: 0,
      };
    }
    const s = summary[r.provider]!;
    s.totalCalls++;
    if (r.success) s.successfulCalls++;
    else s.failedCalls++;
    s.totalTokens += r.totalTokens;
    s.totalCostUsd += r.estimatedCostUsd;
    s.totalLatencyMs += r.latencyMs;
  }

  const result: Record<string, {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
  }> = {};

  for (const [provider, s] of Object.entries(summary)) {
    result[provider] = {
      totalCalls: s.totalCalls,
      successfulCalls: s.successfulCalls,
      failedCalls: s.failedCalls,
      totalTokens: s.totalTokens,
      totalCostUsd: Math.round(s.totalCostUsd * 1_000_000) / 1_000_000,
      avgLatencyMs: s.totalCalls > 0 ? Math.round(s.totalLatencyMs / s.totalCalls) : 0,
    };
  }

  return result;
}

/**
 * Get error rate by provider.
 */
export function getErrorRateByProvider(): Record<ProviderId, number> {
  const counts: Record<string, { total: number; errors: number }> = {};

  for (const r of _records) {
    if (!counts[r.provider]) counts[r.provider] = { total: 0, errors: 0 };
    counts[r.provider]!.total++;
    if (!r.success) counts[r.provider]!.errors++;
  }

  const result: Record<string, number> = {};
  for (const [provider, c] of Object.entries(counts)) {
    result[provider] = c.total > 0 ? c.errors / c.total : 0;
  }
  return result;
}

/**
 * Get total cost across all providers.
 */
export function getTotalCost(): number {
  return _records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
}

/**
 * Reset usage records (for testing).
 */
export function resetUsageRecords(): void {
  _records.length = 0;
}
