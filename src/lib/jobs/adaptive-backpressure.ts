// ---------------------------------------------------------------------------
// Atlas Adaptive Backpressure
//
// Responds to OBSERVED capacity rather than only static queue depth.
// Monitors:
//   - DB latency (RPC round-trip)
//   - AI latency (agent call duration)
//   - Queue depth
//   - Worker utilization
//   - Error rates
//
// Adjusts:
//   - Worker concurrency
//   - AI concurrency
//   - Priority deferral
//   - Claim rate
//
// This is a pure in-memory adaptive controller. It does NOT persist state.
// ---------------------------------------------------------------------------

import { type BackpressureLevel } from "./scale-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptiveConfig {
  /** Sliding window for latency measurements (ms). */
  latency_window_ms: number;
  /** DB latency thresholds (ms). */
  db_latency: {
    normal_ms: number;
    degraded_ms: number;
    critical_ms: number;
  };
  /** AI latency thresholds (ms). */
  ai_latency: {
    normal_ms: number;
    degraded_ms: number;
    critical_ms: number;
  };
  /** Error rate thresholds (0-1). */
  error_rate: {
    warning: number;
    critical: number;
  };
  /** Queue depth thresholds. */
  queue_depth: {
    warning: number;
    high: number;
    critical: number;
  };
  /** Worker utilization thresholds (%). */
  worker_util: {
    high: number;
    critical: number;
  };
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  latency_window_ms: 60_000,
  db_latency: { normal_ms: 50, degraded_ms: 200, critical_ms: 1_000 },
  ai_latency: { normal_ms: 2_000, degraded_ms: 5_000, critical_ms: 15_000 },
  error_rate: { warning: 0.05, critical: 0.15 },
  queue_depth: { warning: 100, high: 500, critical: 2_000 },
  worker_util: { high: 80, critical: 95 },
};

export interface SystemObservation {
  queue_depth: number;
  db_latency_ms: number;
  ai_latency_ms: number;
  error_rate: number;
  worker_utilization_pct: number;
  active_workers: number;
  active_ai_calls: number;
}

export type AdaptiveSeverity = "normal" | "degraded" | "critical";

export interface AdaptiveDecision {
  /** Overall severity. */
  severity: AdaptiveSeverity;
  /** Worker concurrency multiplier (0-1). Reduce when degraded. */
  worker_concurrency_factor: number;
  /** AI concurrency factor (0-1). Reduce when AI is slow. */
  ai_concurrency_factor: number;
  /** Max jobs to claim per poll. */
  max_claim: number;
  /** Whether to defer low-priority jobs. */
  defer_low_priority: boolean;
  /** Whether to defer normal-priority jobs. */
  defer_normal_priority: boolean;
  /** Whether to pause new job creation for non-critical tenants. */
  throttle_new_jobs: boolean;
  /** Human-readable reason. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Latency tracker (sliding window)
// ---------------------------------------------------------------------------

interface LatencyEntry {
  timestamp: number;
  value: number;
}

function sumInWindow(entries: LatencyEntry[], nowMs: number, windowMs: number): number {
  const cutoff = nowMs - windowMs;
  let sum = 0;
  let count = 0;
  for (const e of entries) {
    if (e.timestamp >= cutoff) { sum += e.value; count++; }
  }
  return count > 0 ? sum / count : 0;
}

function pruneWindow(entries: LatencyEntry[], nowMs: number, windowMs: number): LatencyEntry[] {
  const cutoff = nowMs - windowMs;
  return entries.filter((e) => e.timestamp >= cutoff);
}

function errorRateInWindow(
  successes: LatencyEntry[],
  failures: LatencyEntry[],
  nowMs: number,
  windowMs: number,
): number {
  const cutoff = nowMs - windowMs;
  let s = 0;
  let f = 0;
  for (const e of successes) { if (e.timestamp >= cutoff) s++; }
  for (const e of failures) { if (e.timestamp >= cutoff) f++; }
  const total = s + f;
  return total > 0 ? f / total : 0;
}

// ---------------------------------------------------------------------------
// Adaptive Backpressure Controller
// ---------------------------------------------------------------------------

export class AdaptiveBackpressureController {
  private config: AdaptiveConfig;
  private dbLatencies: LatencyEntry[] = [];
  private aiLatencies: LatencyEntry[] = [];
  private successEvents: LatencyEntry[] = [];
  private failureEvents: LatencyEntry[] = [];

  constructor(config: Partial<AdaptiveConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  recordDBLatency(ms: number): void {
    this.dbLatencies.push({ timestamp: Date.now(), value: ms });
  }

  recordAILatency(ms: number): void {
    this.aiLatencies.push({ timestamp: Date.now(), value: ms });
  }

  recordSuccess(): void {
    this.successEvents.push({ timestamp: Date.now(), value: 1 });
  }

  recordFailure(): void {
    this.failureEvents.push({ timestamp: Date.now(), value: 1 });
  }

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  evaluate(observation: SystemObservation): AdaptiveDecision {
    const now = Date.now();
    const window = this.config.latency_window_ms;

    // Prune old data
    this.dbLatencies = pruneWindow(this.dbLatencies, now, window);
    this.aiLatencies = pruneWindow(this.aiLatencies, now, window);
    this.successEvents = pruneWindow(this.successEvents, now, window);
    this.failureEvents = pruneWindow(this.failureEvents, now, window);

    // Compute rolling averages
    const avgDBLatency = observation.db_latency_ms || sumInWindow(this.dbLatencies, now, window);
    const avgAILatency = observation.ai_latency_ms || sumInWindow(this.aiLatencies, now, window);
    const errRate = observation.error_rate || errorRateInWindow(this.successEvents, this.failureEvents, now, window);

    const reasons: string[] = [];
    let maxSeverity: AdaptiveSeverity = "normal";

    // DB latency assessment
    if (avgDBLatency > this.config.db_latency.critical_ms) {
      maxSeverity = "critical";
      reasons.push(`DB latency critical: ${avgDBLatency.toFixed(0)}ms`);
    } else if (avgDBLatency > this.config.db_latency.degraded_ms) {
      maxSeverity = "degraded";
      reasons.push(`DB latency degraded: ${avgDBLatency.toFixed(0)}ms`);
    }

    // AI latency assessment
    if (avgAILatency > this.config.ai_latency.critical_ms) {
      maxSeverity = "critical";
      reasons.push(`AI latency critical: ${avgAILatency.toFixed(0)}ms`);
    } else if (avgAILatency > this.config.ai_latency.degraded_ms) {
      maxSeverity = "degraded";
      reasons.push(`AI latency degraded: ${avgAILatency.toFixed(0)}ms`);
    }

    // Error rate assessment
    if (errRate > this.config.error_rate.critical) {
      maxSeverity = "critical";
      reasons.push(`Error rate critical: ${(errRate * 100).toFixed(1)}%`);
    } else if (errRate > this.config.error_rate.warning) {
      maxSeverity = "degraded";
      reasons.push(`Error rate elevated: ${(errRate * 100).toFixed(1)}%`);
    }

    // Queue depth assessment
    if (observation.queue_depth > this.config.queue_depth.critical) {
      maxSeverity = "critical";
      reasons.push(`Queue critical: ${observation.queue_depth}`);
    } else if (observation.queue_depth > this.config.queue_depth.high) {
      maxSeverity = "degraded";
      reasons.push(`Queue high: ${observation.queue_depth}`);
    } else if (observation.queue_depth > this.config.queue_depth.warning) {
      if (maxSeverity === "normal") reasons.push(`Queue elevated: ${observation.queue_depth}`);
    }

    // Worker utilization assessment
    if (observation.worker_utilization_pct > this.config.worker_util.critical) {
      maxSeverity = "critical";
      reasons.push(`Worker utilization critical: ${observation.worker_utilization_pct.toFixed(0)}%`);
    } else if (observation.worker_utilization_pct > this.config.worker_util.high) {
      maxSeverity = "degraded";
      reasons.push(`Worker utilization high: ${observation.worker_utilization_pct.toFixed(0)}%`);
    }

    if (reasons.length === 0) reasons.push("All systems nominal");

    // Build decision
    return this.buildDecision(maxSeverity, reasons);
  }

  private buildDecision(severity: AdaptiveSeverity, reasons: string[]): AdaptiveDecision {
    switch (severity) {
      case "critical":
        return {
          severity: "critical",
          worker_concurrency_factor: 0.3,
          ai_concurrency_factor: 0.3,
          max_claim: 1,
          defer_low_priority: true,
          defer_normal_priority: true,
          throttle_new_jobs: true,
          reasons,
        };
      case "degraded":
        return {
          severity: "degraded",
          worker_concurrency_factor: 0.6,
          ai_concurrency_factor: 0.6,
          max_claim: 3,
          defer_low_priority: true,
          defer_normal_priority: false,
          throttle_new_jobs: false,
          reasons,
        };
      default:
        return {
          severity: "normal",
          worker_concurrency_factor: 1.0,
          ai_concurrency_factor: 1.0,
          max_claim: 10,
          defer_low_priority: false,
          defer_normal_priority: false,
          throttle_new_jobs: false,
          reasons,
        };
    }
  }

  /**
   * Apply the decision to derive effective concurrency values.
   */
  applyDecision(
    baseWorkerConcurrency: number,
    baseAIConcurrency: number,
    decision: AdaptiveDecision,
  ): { effectiveWorkerConcurrency: number; effectiveAIConcurrency: number; maxClaim: number } {
    return {
      effectiveWorkerConcurrency: Math.max(1, Math.round(baseWorkerConcurrency * decision.worker_concurrency_factor)),
      effectiveAIConcurrency: Math.max(1, Math.round(baseAIConcurrency * decision.ai_concurrency_factor)),
      maxClaim: decision.max_claim,
    };
  }

  /**
   * Reset all recorded data (for testing).
   */
  reset(): void {
    this.dbLatencies = [];
    this.aiLatencies = [];
    this.successEvents = [];
    this.failureEvents = [];
  }
}
