// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Telemetry
//
// Records voice session metrics for observability. Records metadata only —
// never logs customer audio content or transcript text.
// ---------------------------------------------------------------------------

import type { VoiceTelemetryRecord, VoiceProviderId } from "./types";

// ---------------------------------------------------------------------------
// Telemetry store
// ---------------------------------------------------------------------------

const _records: VoiceTelemetryRecord[] = [];
const MAX_RECORDS = 5000;

/**
 * Record a voice session for telemetry.
 */
export function recordVoiceSession(record: VoiceTelemetryRecord): void {
  _records.push(record);
  if (_records.length > MAX_RECORDS) {
    _records.splice(0, _records.length - MAX_RECORDS);
  }
}

/**
 * Get all telemetry records (for observability dashboard).
 */
export function getVoiceTelemetryRecords(): VoiceTelemetryRecord[] {
  return [..._records];
}

/**
 * Get telemetry summary by provider.
 */
export function getVoiceTelemetryByProvider(): Record<
  VoiceProviderId,
  {
    totalSessions: number;
    successfulSessions: number;
    failedSessions: number;
    avgDurationMs: number;
    avgFirstResponseLatencyMs: number;
    totalInterruptions: number;
    actionTriggeredCount: number;
    totalEstimatedCostUsd: number;
  }
> {
  const summary: Record<string, {
    totalSessions: number;
    successfulSessions: number;
    failedSessions: number;
    totalDurationMs: number;
    totalFirstResponseLatencyMs: number;
    firstResponseCount: number;
    totalInterruptions: number;
    actionTriggeredCount: number;
    totalEstimatedCostUsd: number;
  }> = {};

  for (const r of _records) {
    if (!summary[r.provider]) {
      summary[r.provider] = {
        totalSessions: 0,
        successfulSessions: 0,
        failedSessions: 0,
        totalDurationMs: 0,
        totalFirstResponseLatencyMs: 0,
        firstResponseCount: 0,
        totalInterruptions: 0,
        actionTriggeredCount: 0,
        totalEstimatedCostUsd: 0,
      };
    }
    const s = summary[r.provider]!;
    s.totalSessions++;
    if (r.success) s.successfulSessions++;
    else s.failedSessions++;
    s.totalDurationMs += r.durationMs;
    if (r.firstResponseLatencyMs > 0) {
      s.totalFirstResponseLatencyMs += r.firstResponseLatencyMs;
      s.firstResponseCount++;
    }
    s.totalInterruptions += r.interruptionCount;
    if (r.actionTriggered) s.actionTriggeredCount++;
    s.totalEstimatedCostUsd += r.estimatedCostUsd ?? 0;
  }

  const result: Record<string, {
    totalSessions: number;
    successfulSessions: number;
    failedSessions: number;
    avgDurationMs: number;
    avgFirstResponseLatencyMs: number;
    totalInterruptions: number;
    actionTriggeredCount: number;
    totalEstimatedCostUsd: number;
  }> = {};

  for (const [provider, s] of Object.entries(summary)) {
    result[provider] = {
      totalSessions: s.totalSessions,
      successfulSessions: s.successfulSessions,
      failedSessions: s.failedSessions,
      avgDurationMs: s.totalSessions > 0 ? Math.round(s.totalDurationMs / s.totalSessions) : 0,
      avgFirstResponseLatencyMs: s.firstResponseCount > 0
        ? Math.round(s.totalFirstResponseLatencyMs / s.firstResponseCount) : 0,
      totalInterruptions: s.totalInterruptions,
      actionTriggeredCount: s.actionTriggeredCount,
      totalEstimatedCostUsd: Math.round(s.totalEstimatedCostUsd * 1_000_000) / 1_000_000,
    };
  }

  return result;
}

/**
 * Get total voice usage cost.
 */
export function getVoiceTotalCost(): number {
  return _records.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0);
}

/**
 * Get voice error rate by provider.
 */
export function getVoiceErrorRateByProvider(): Record<VoiceProviderId, number> {
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
 * Reset telemetry records (for testing).
 */
export function resetVoiceTelemetry(): void {
  _records.length = 0;
}
