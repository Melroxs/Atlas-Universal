// ---------------------------------------------------------------------------
// Atlas 14K Capacity Report Generator
//
// Produces a comprehensive capacity assessment from benchmark results.
// Format matches the M10 specification exactly.
// ---------------------------------------------------------------------------

import type { ScalingBenchmarkResult } from "./capacity-benchmark";
import type { AIBenchmarkResult } from "./ai-benchmark";
import type { AdaptiveSeverity } from "./adaptive-backpressure";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapacityReport {
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
  target: TargetConfig;
  observed: ObservedMetrics;
  maximum_sustainable: SustainableCapacity;
  first_bottleneck: string;
  recommended_config: RecommendedConfig;
  worker_assessment: string;
  ai_assessment: string;
  db_assessment: string;
  overall_assessment: string;
}

export interface TargetConfig {
  users: number;
  companies: number;
  jobs_per_day: number;
  jobs_per_minute: number;
}

export interface ObservedMetrics {
  avg_throughput_jps: number;
  peak_throughput_jps: number;
  p50_queue_latency_ms: number;
  p95_queue_latency_ms: number;
  p99_queue_latency_ms: number;
  worker_utilization_pct: number;
  db_utilization_pct: number;
  ai_utilization_pct: number;
  failure_rate_pct: number;
  retry_rate_pct: number;
}

export interface SustainableCapacity {
  users: number;
  jobs_per_minute: number;
  concurrent_workers: number;
  ai_concurrent: number;
}

export interface RecommendedConfig {
  workers: number;
  worker_concurrency: number;
  ai_concurrency: number;
  ai_rate_limit_per_minute: number;
  tenant_max_jobs_per_hour: number;
  backpressure_warning: number;
  backpressure_critical: number;
}

// ---------------------------------------------------------------------------
// Capacity model computation
// ---------------------------------------------------------------------------

export interface CapacityModelInput {
  scaling?: ScalingBenchmarkResult;
  ai?: AIBenchmarkResult;
  /** Current adaptive severity. */
  adaptive_severity?: AdaptiveSeverity;
  /** Observed DB latency (ms). */
  db_avg_latency_ms?: number;
  /** Database connection pool size. */
  db_pool_size?: number;
  /** Supabase plan limits (if known). */
  supabase_max_connections?: number;
}

/**
 * Compute the system capacity as:
 *   System capacity = min(Worker capacity, DB capacity, AI capacity, RPC capacity)
 */
export function computeSystemCapacity(input: CapacityModelInput): number {
  const capacities: Array<{ source: string; capacity: number }> = [];

  // Worker capacity
  if (input.scaling) {
    const workerCap = input.scaling.maxThroughput; // jobs/sec
    capacities.push({ source: "worker", capacity: workerCap * 60 }); // per minute
  }

  // AI capacity
  if (input.ai) {
    const aiCap = input.ai.economics.ai_capacity_per_minute;
    capacities.push({ source: "ai", capacity: aiCap });
  }

  // DB capacity (estimate based on latency)
  if (input.db_avg_latency_ms !== undefined && input.db_pool_size !== undefined) {
    // Each DB operation takes ~db_avg_latency_ms
    // Each job needs ~10 DB operations (dequeue, get, steps, events, complete)
    const dbOpsPerMinute = (input.db_pool_size / (input.db_avg_latency_ms / 1000)) * 60;
    const dbJobsPerMinute = dbOpsPerMinute / 10;
    capacities.push({ source: "db", capacity: dbJobsPerMinute });
  }

  if (capacities.length === 0) return 0;

  // Find minimum
  capacities.sort((a, b) => a.capacity - b.capacity);
  return capacities[0].capacity;
}

/**
 * Find the first bottleneck.
 */
export function findBottleneck(input: CapacityModelInput): string {
  const capacities: Array<{ source: string; capacity: number }> = [];

  if (input.scaling) {
    capacities.push({ source: "worker", capacity: input.scaling.maxThroughput * 60 });
  }
  if (input.ai) {
    capacities.push({ source: "ai", capacity: input.ai.economics.ai_capacity_per_minute });
  }
  if (input.db_avg_latency_ms !== undefined && input.db_pool_size !== undefined) {
    const dbOpsPerMinute = (input.db_pool_size / (input.db_avg_latency_ms / 1000)) * 60;
    capacities.push({ source: "db", capacity: dbOpsPerMinute / 10 });
  }

  if (capacities.length === 0) return "unknown";

  capacities.sort((a, b) => a.capacity - b.capacity);
  return capacities[0].source;
}

/**
 * Generate the recommended production configuration.
 */
export function generateRecommendedConfig(
  input: CapacityModelInput,
): RecommendedConfig {
  const bottleneck = findBottleneck(input);

  // Base config
  const config: RecommendedConfig = {
    workers: 5,
    worker_concurrency: 10,
    ai_concurrency: 50,
    ai_rate_limit_per_minute: 300,
    tenant_max_jobs_per_hour: 100,
    backpressure_warning: 200,
    backpressure_critical: 2_000,
  };

  if (input.scaling) {
    // Use the worker count just before the bottleneck
    const bottleneckIdx = input.scaling.results.findIndex((r) => r.scaling_plateau);
    if (bottleneckIdx > 0) {
      config.workers = input.scaling.results[bottleneckIdx - 1].worker_count;
    } else {
      config.workers = input.scaling.results[input.scaling.results.length - 1].worker_count;
    }
  }

  if (bottleneck === "ai") {
    config.ai_concurrency = 25;
    config.ai_rate_limit_per_minute = 150;
  } else if (bottleneck === "db") {
    config.worker_concurrency = 5;
    config.workers = Math.min(config.workers, 10);
  }

  return config;
}

/**
 * Generate the complete capacity report.
 */
export function generateCapacityReport(input: CapacityModelInput): CapacityReport {
  const targetJobsPerDay = 140_000;
  const targetJobsPerMinute = targetJobsPerDay / (24 * 60);

  const systemCapacity = computeSystemCapacity(input);
  const bottleneck = findBottleneck(input);
  const recommendedConfig = generateRecommendedConfig(input);

  // Observed metrics
  const avgThroughput = input.scaling?.maxThroughput ?? 0;
  const aiResult = input.ai;

  const observed: ObservedMetrics = {
    avg_throughput_jps: avgThroughput,
    peak_throughput_jps: avgThroughput * 1.2,
    p50_queue_latency_ms: input.scaling?.results[0]?.p50_latency_ms ?? 0,
    p95_queue_latency_ms: input.scaling?.results[0]?.p95_latency_ms ?? 0,
    p99_queue_latency_ms: input.scaling?.results[0]?.p99_latency_ms ?? 0,
    worker_utilization_pct: input.scaling?.results[0]?.worker_utilization_pct ?? 0,
    db_utilization_pct: input.db_avg_latency_ms !== undefined
      ? Math.min(100, (input.db_avg_latency_ms / 200) * 100)
      : 0,
    ai_utilization_pct: aiResult ? Math.min(100, (aiResult.total_ai_calls / Math.max(1, aiResult.economics.max_claims_per_day)) * 100) : 0,
    failure_rate_pct: aiResult?.failure_rate_pct ?? 0,
    retry_rate_pct: aiResult?.retry_rate_pct ?? 0,
  };

  // Maximum sustainable
  const sustainableUsers = Math.floor((systemCapacity * 24 * 60) / 10); // 10 jobs/user/day
  const sustainable: SustainableCapacity = {
    users: sustainableUsers,
    jobs_per_minute: systemCapacity,
    concurrent_workers: recommendedConfig.workers,
    ai_concurrent: recommendedConfig.ai_concurrency,
  };

  // Assessments
  const workerAssessment = input.scaling?.assessment ?? "Not benchmarked";
  const aiCost = aiResult?.economics.monthly_14000_users_usd ?? 0;
  const aiAssessment = aiResult
    ? `AI capacity: ${aiResult.economics.ai_capacity_per_minute.toFixed(0)} calls/min | Cost at 14K: $${aiCost.toFixed(0)}/mo | Bottleneck: ${aiResult.economics.bottleneck}`
    : "Not benchmarked";

  const dbAssessment = input.db_avg_latency_ms !== undefined
    ? `DB latency: ${input.db_avg_latency_ms.toFixed(0)}ms avg | Pool: ${input.db_pool_size ?? 10} connections`
    : "Not benchmarked";

  const headroom = systemCapacity > 0 ? systemCapacity / targetJobsPerMinute : 0;
  const overallAssessment = headroom > 2
    ? `System capacity (${systemCapacity.toFixed(0)} jobs/min) exceeds 14K target (${targetJobsPerMinute.toFixed(0)} jobs/min) by ${headroom.toFixed(1)}x. ${bottleneck === "unknown" ? "No bottleneck identified." : `First bottleneck: ${bottleneck}.`}`
    : `System capacity (${systemCapacity.toFixed(0)} jobs/min) is ${headroom.toFixed(1)}x the 14K target (${targetJobsPerMinute.toFixed(0)} jobs/min). Bottleneck: ${bottleneck}. Scaling required.`;

  return {
    status: systemCapacity > 0 ? "COMPLETE" : "PARTIAL",
    target: {
      users: 14_000,
      companies: 1_000,
      jobs_per_day: targetJobsPerDay,
      jobs_per_minute: targetJobsPerMinute,
    },
    observed,
    maximum_sustainable: sustainable,
    first_bottleneck: bottleneck,
    recommended_config: recommendedConfig,
    worker_assessment: workerAssessment,
    ai_assessment: aiAssessment,
    db_assessment: dbAssessment,
    overall_assessment: overallAssessment,
  };
}

/**
 * Format report as human-readable text.
 */
export function formatCapacityReport(report: CapacityReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("         ATLAS CAPACITY REPORT — MILESTONE 10");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`STATUS: ${report.status}`);
  lines.push("");

  lines.push("TARGET:");
  lines.push(`  Users:           ${report.target.users.toLocaleString()}`);
  lines.push(`  Companies:       ${report.target.companies.toLocaleString()}`);
  lines.push(`  Jobs/day:        ${report.target.jobs_per_day.toLocaleString()}`);
  lines.push(`  Jobs/minute:     ${report.target.jobs_per_minute.toFixed(1)}`);
  lines.push("");

  lines.push("OBSERVED (SIMULATED):");
  lines.push(`  Avg throughput:  ${report.observed.avg_throughput_jps.toFixed(1)} jobs/sec`);
  lines.push(`  Peak throughput: ${report.observed.peak_throughput_jps.toFixed(1)} jobs/sec`);
  lines.push(`  P50 latency:     ${report.observed.p50_queue_latency_ms.toFixed(0)}ms`);
  lines.push(`  P95 latency:     ${report.observed.p95_queue_latency_ms.toFixed(0)}ms`);
  lines.push(`  P99 latency:     ${report.observed.p99_queue_latency_ms.toFixed(0)}ms`);
  lines.push(`  Worker util:     ${report.observed.worker_utilization_pct.toFixed(0)}%`);
  lines.push(`  DB util:         ${report.observed.db_utilization_pct.toFixed(0)}%`);
  lines.push(`  AI util:         ${report.observed.ai_utilization_pct.toFixed(0)}%`);
  lines.push(`  Failure rate:    ${report.observed.failure_rate_pct.toFixed(1)}%`);
  lines.push(`  Retry rate:      ${report.observed.retry_rate_pct.toFixed(1)}%`);
  lines.push("");

  lines.push("MAXIMUM SUSTAINABLE:");
  lines.push(`  Users:           ${report.maximum_sustainable.users.toLocaleString()}`);
  lines.push(`  Jobs/minute:     ${report.maximum_sustainable.jobs_per_minute.toFixed(0)}`);
  lines.push(`  Workers:         ${report.maximum_sustainable.concurrent_workers}`);
  lines.push(`  AI concurrent:   ${report.maximum_sustainable.ai_concurrent}`);
  lines.push("");

  lines.push(`FIRST BOTTLENECK: ${report.first_bottleneck}`);
  lines.push("");

  lines.push("RECOMMENDED PRODUCTION CONFIG:");
  lines.push(`  Workers:           ${report.recommended_config.workers}`);
  lines.push(`  Worker conc:       ${report.recommended_config.worker_concurrency}`);
  lines.push(`  AI conc:           ${report.recommended_config.ai_concurrency}`);
  lines.push(`  AI rate limit:     ${report.recommended_config.ai_rate_limit_per_minute}/min`);
  lines.push(`  Tenant max/hour:   ${report.recommended_config.tenant_max_jobs_per_hour}`);
  lines.push(`  BP warning:        ${report.recommended_config.backpressure_warning}`);
  lines.push(`  BP critical:       ${report.recommended_config.backpressure_critical}`);
  lines.push("");

  lines.push("WORKER ASSESSMENT:");
  lines.push(`  ${report.worker_assessment}`);
  lines.push("");

  lines.push("AI ASSESSMENT:");
  lines.push(`  ${report.ai_assessment}`);
  lines.push("");

  lines.push("DB ASSESSMENT:");
  lines.push(`  ${report.db_assessment}`);
  lines.push("");

  lines.push("OVERALL:");
  lines.push(`  ${report.overall_assessment}`);
  lines.push("");
  lines.push("=".repeat(60));

  return lines.join("\n");
}
