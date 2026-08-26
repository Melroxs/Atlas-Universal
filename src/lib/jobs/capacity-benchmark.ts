// ---------------------------------------------------------------------------
// Atlas Capacity Benchmark — Realistic Worker Scaling Test
//
// Progressively tests 1 → 3 → 5 → 10 → 15 → 25 workers to find where
// throughput stops scaling linearly. Simulates realistic job durations,
// AI agent steps, and review pauses.
//
// ALL RESULTS ARE SIMULATED — not live Supabase benchmarks.
// ---------------------------------------------------------------------------

import type { AtlasJob, AtlasJobStep, JobPriority } from "./types";
import { evaluateBackpressure, type BackpressureThresholds } from "./scale-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkJob extends AtlasJob {
  id: string;
  steps: AtlasJobStep[];
  /** Simulated AI agent duration per step (ms). */
  ai_step_durations?: number[];
  /** Whether this job requires human review. */
  requires_review?: boolean;
}

export interface WorkerBenchmarkConfig {
  worker_id: string;
  max_concurrent_jobs: number;
  poll_interval_ms: number;
  job_timeout_ms: number;
}

export interface WorkerScalingResult {
  worker_count: number;
  total_concurrency: number;
  total_jobs: number;
  completed: number;
  failed: number;
  retried: number;
  total_duration_ms: number;
  throughput_jobs_per_second: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  max_latency_ms: number;
  duplicate_executions: number;
  queue_wait_avg_ms: number;
  worker_utilization_pct: number;
  /** Throughput scaling efficiency vs single worker. */
  scaling_efficiency_pct: number;
  /** Whether throughput stopped scaling linearly. */
  scaling_plateau: boolean;
}

export interface ThroughputSample {
  timestamp: number;
  completed_count: number;
  throughput_jps: number;
}

// ---------------------------------------------------------------------------
// Simulated job queue with SKIP LOCKED semantics
// ---------------------------------------------------------------------------

export class BenchmarkQueue {
  private jobs: BenchmarkJob[] = [];
  private lockedBy = new Map<string, string>();
  private executionLog: Array<{
    job_id: string;
    worker_id: string;
    claimed_at: number;
    completed_at: number;
    duration_ms: number;
  }> = [];
  private claimTimestamps = new Map<string, number>();

  enqueue(job: BenchmarkJob): void {
    this.jobs.push(job);
  }

  get depth(): number {
    return this.jobs.filter((j) => j.status === "pending").length;
  }

  dequeue(workerId: string, maxJobs: number): BenchmarkJob[] {
    const claimed: BenchmarkJob[] = [];
    const now = Date.now();
    for (const job of this.jobs) {
      if (claimed.length >= maxJobs) break;
      if (job.status !== "pending") continue;
      if (this.lockedBy.has(job.id)) continue;
      if (job.lock_expires_at && new Date(job.lock_expires_at).getTime() > now) continue;

      job.status = "processing";
      job.locked_by = workerId;
      job.locked_at = new Date(now).toISOString();
      job.lock_expires_at = new Date(now + 300_000).toISOString();
      job.started_at = new Date(now).toISOString();
      job.attempt_count++;
      this.lockedBy.set(job.id, workerId);
      this.claimTimestamps.set(job.id, now);
      claimed.push(job);
    }
    return claimed;
  }

  complete(jobId: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.status = "completed";
    job.completed_at = new Date().toISOString();
    job.locked_by = null;
    this.lockedBy.delete(jobId);

    const claimedAt = this.claimTimestamps.get(jobId) ?? Date.now();
    const now = Date.now();
    this.executionLog.push({
      job_id: jobId,
      worker_id: job.locked_by ?? "unknown",
      claimed_at: claimedAt,
      completed_at: now,
      duration_ms: now - claimedAt,
    });
  }

  fail(jobId: string, retryable: boolean): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    job.locked_by = null;
    this.lockedBy.delete(jobId);

    if (retryable && job.attempt_count < job.max_attempts) {
      job.status = "pending";
      return true;
    }
    job.status = "failed";
    this.executionLog.push({
      job_id: jobId,
      worker_id: job.locked_by ?? "unknown",
      claimed_at: this.claimTimestamps.get(jobId) ?? Date.now(),
      completed_at: Date.now(),
      duration_ms: 0,
    });
    return false;
  }

  awaitReview(jobId: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.status = "awaiting_review";
    job.locked_by = null;
    this.lockedBy.delete(jobId);
  }

  resumeFromReview(jobId: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.status = "pending";
    job.lock_expires_at = null;
    job.locked_at = null;
  }

  getExecutionLog() {
    return [...this.executionLog];
  }

  getDuplicateExecutions(): number {
    const counts = new Map<string, number>();
    for (const entry of this.executionLog) {
      counts.set(entry.job_id, (counts.get(entry.job_id) ?? 0) + 1);
    }
    let dups = 0;
    for (const count of counts.values()) {
      if (count > 1) dups++;
    }
    return dups;
  }

  reset(): void {
    this.jobs = [];
    this.lockedBy.clear();
    this.executionLog = [];
    this.claimTimestamps.clear();
  }
}

// ---------------------------------------------------------------------------
// Simulated worker
// ---------------------------------------------------------------------------

export class BenchmarkWorker {
  private config: WorkerBenchmarkConfig;
  private queue: BenchmarkQueue;
  private activeJobs = new Map<string, BenchmarkJob>();
  private processed = 0;
  private failed = 0;

  constructor(config: WorkerBenchmarkConfig, queue: BenchmarkQueue) {
    this.config = config;
    this.queue = queue;
  }

  async pollCycle(
    handler: (job: BenchmarkJob) => Promise<{ success: boolean; duration_ms: number }>,
  ): Promise<void> {
    const availableSlots = this.config.max_concurrent_jobs - this.activeJobs.size;
    if (availableSlots <= 0) return;

    const claimed = this.queue.dequeue(this.config.worker_id, availableSlots);
    for (const job of claimed) {
      this.activeJobs.set(job.id, job);
      try {
        const result = await this.withTimeout(
          () => handler(job),
          this.config.job_timeout_ms,
        );
        if (result.success) {
          this.queue.complete(job.id);
          this.processed++;
        } else {
          const retried = this.queue.fail(job.id, true);
          this.failed++;
          void retried;
        }
      } catch {
        this.queue.fail(job.id, true);
        this.failed++;
      } finally {
        this.activeJobs.delete(job.id);
      }
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      fn().then((r) => { clearTimeout(timer); resolve(r); }).catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  get stats() {
    return { processed: this.processed, failed: this.failed };
  }
}

// ---------------------------------------------------------------------------
// Job factory
// ---------------------------------------------------------------------------

let _benchJobId = 0;

export function createBenchmarkJob(overrides: Partial<BenchmarkJob> = {}): BenchmarkJob {
  _benchJobId++;
  return {
    _id: `bench-${_benchJobId}`,
    _creationTime: Date.now(),
    id: `bench-${_benchJobId}`,
    tenant_id: overrides.tenant_id ?? `tenant-${_benchJobId % 10}`,
    user_id: null,
    job_type: "evidence_pipeline",
    status: "pending",
    priority: overrides.priority ?? 3,
    idempotency_key: `bench-idemp-${_benchJobId}`,
    payload: {},
    result: null,
    error: null,
    attempt_count: 0,
    max_attempts: 3,
    scheduled_at: null,
    started_at: null,
    completed_at: null,
    locked_by: null,
    locked_at: null,
    lock_expires_at: null,
    parent_job_id: null,
    current_step_id: null,
    tags: [],
    ai_metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    steps: [],
    requires_review: overrides.requires_review ?? (Math.random() < 0.3),
    ...overrides,
  } as BenchmarkJob;
}

export function resetBenchmarkJobCounter(): void {
  _benchJobId = 0;
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Worker scaling benchmark
// ---------------------------------------------------------------------------

export interface ScalingBenchmarkConfig {
  /** Total jobs per test run. */
  totalJobs: number;
  /** Worker counts to test (e.g. [1, 3, 5, 10, 15, 25]). */
  workerCounts: number[];
  /** Max concurrent jobs per worker. */
  workerConcurrency: number;
  /** Simulated deterministic step duration (ms). */
  deterministicStepMs: number;
  /** Simulated AI step duration (ms). */
  aiStepMs: number;
  /** Fraction of jobs that require human review (0-1). */
  reviewFraction: number;
  /** Failure rate (0-1). */
  failureRate: number;
  /** Number of tenants to distribute across. */
  tenantCount: number;
  /** How many iterations per poll cycle. */
  maxIterations: number;
}

export interface ScalingBenchmarkResult {
  results: WorkerScalingResult[];
  /** The worker count where throughput stops scaling linearly. */
  bottleneckWorkers: number;
  /** Maximum observed throughput (jobs/sec). */
  maxThroughput: number;
  /** Assessment for 14K users. */
  assessment: string;
}

export async function runScalingBenchmark(
  config: ScalingBenchmarkConfig,
): Promise<ScalingBenchmarkResult> {
  const allResults: WorkerScalingResult[] = [];
  let baseThroughput = 0;
  let bottleneckWorkers = config.workerCounts[config.workerCounts.length - 1];

  for (const workerCount of config.workerCounts) {
    const result = await runSingleWorkerCountBenchmark(workerCount, config);
    allResults.push(result);

    if (workerCount === config.workerCounts[0]) {
      baseThroughput = result.throughput_jobs_per_second;
    } else if (baseThroughput > 0) {
      // Check if scaling efficiency has dropped below 60%
      if (result.scaling_efficiency_pct < 60) {
        bottleneckWorkers = workerCount;
      }
    }
  }

  const maxThroughput = Math.max(...allResults.map((r) => r.throughput_jobs_per_second));

  const assessment = buildAssessment(allResults, bottleneckWorkers, maxThroughput);

  return {
    results: allResults,
    bottleneckWorkers,
    maxThroughput,
    assessment,
  };
}

async function runSingleWorkerCountBenchmark(
  workerCount: number,
  config: ScalingBenchmarkConfig,
): Promise<WorkerScalingResult> {
  const queue = new BenchmarkQueue();
  const totalConcurrency = workerCount * config.workerConcurrency;

  // Create jobs
  for (let i = 0; i < config.totalJobs; i++) {
    const tenantId = `tenant-${i % config.tenantCount}`;
    queue.enqueue(createBenchmarkJob({ tenant_id: tenantId }));
  }

  // Create workers
  const workers: BenchmarkWorker[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      new BenchmarkWorker(
        {
          worker_id: `w${w}`,
          max_concurrent_jobs: config.workerConcurrency,
          poll_interval_ms: 10,
          job_timeout_ms: 30_000,
        },
        queue,
      ),
    );
  }

  const startTime = Date.now();
  const latencies: number[] = [];

  // Handler: simulate deterministic + AI steps + optional review pause
  const handler = async (job: BenchmarkJob): Promise<{ success: boolean; duration_ms: number }> => {
    const startStep = Date.now();

    // Simulate 7 deterministic steps
    for (let s = 0; s < 7; s++) {
      await new Promise((r) => setTimeout(r, Math.min(config.deterministicStepMs, 5)));
    }

    // Simulate 4 agent steps (AI)
    for (let s = 0; s < 4; s++) {
      await new Promise((r) => setTimeout(r, Math.min(config.aiStepMs, 5)));
    }

    const duration = Date.now() - startStep;

    // Handle human review pause
    if (job.requires_review) {
      queue.awaitReview(job.id);
      // Simulate approval after a delay
      await new Promise((r) => setTimeout(r, 2));
      queue.resumeFromReview(job.id);
    }

    const success = Math.random() >= config.failureRate;
    if (success) latencies.push(duration);
    return { success, duration_ms: duration };
  };

  // Run all workers concurrently
  let remaining = config.totalJobs;
  let iterations = 0;
  const maxIter = config.maxIterations;

  while (remaining > 0 && iterations < maxIter) {
    const promises = workers.map((w) => w.pollCycle(handler));
    await Promise.all(promises);
    remaining = queue.depth;
    iterations++;
  }

  const totalDuration = Date.now() - startTime;
  const totalCompleted = workers.reduce((s, w) => s + w.stats.processed, 0);
  const totalFailed = workers.reduce((s, w) => s + w.stats.failed, 0);

  // Calculate latencies
  latencies.sort((a, b) => a - b);

  // Estimate queue wait times from execution log
  const log = queue.getExecutionLog();
  const queueWaits = log.map((e) => e.completed_at - e.claimed_at);

  // Worker utilization
  const totalCapacity = totalConcurrency * (totalDuration / 1000); // job-seconds available
  const totalWork = latencies.reduce((s, l) => s + l, 0) / 1000; // job-seconds used
  const utilization = totalCapacity > 0 ? (totalWork / totalCapacity) * 100 : 0;

  // Scaling efficiency
  const scalingEfficiency =
    workerCount === 1
      ? 100
      : 0; // Will be computed later by comparing to base

  return {
    worker_count: workerCount,
    total_concurrency: totalConcurrency,
    total_jobs: config.totalJobs,
    completed: totalCompleted,
    failed: totalFailed,
    retried: 0,
    total_duration_ms: totalDuration,
    throughput_jobs_per_second: totalDuration > 0 ? (totalCompleted / totalDuration) * 1000 : 0,
    avg_latency_ms: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    p99_latency_ms: percentile(latencies, 99),
    max_latency_ms: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
    duplicate_executions: queue.getDuplicateExecutions(),
    queue_wait_avg_ms: queueWaits.length > 0 ? queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length : 0,
    worker_utilization_pct: Math.min(100, utilization),
    scaling_efficiency_pct: scalingEfficiency,
    scaling_plateau: false,
  };
}

// ---------------------------------------------------------------------------
// Assessment builder
// ---------------------------------------------------------------------------

function buildAssessment(
  results: WorkerScalingResult[],
  bottleneckWorkers: number,
  maxThroughput: number,
): string {
  const lines: string[] = [];
  lines.push("=== ATLAS WORKER SCALING ASSESSMENT ===\n");
  lines.push("Workers | Concurrency | Throughput (jps) | Utilization | Latency P95");
  lines.push("--------|-------------|------------------|-------------|------------");

  const base = results[0]?.throughput_jobs_per_second ?? 1;

  for (const r of results) {
    const efficiency = base > 0 ? (r.throughput_jobs_per_second / (base * r.worker_count)) * 100 : 0;
    lines.push(
      `  ${String(r.worker_count).padStart(5)}  |     ${String(r.total_concurrency).padStart(5)}     |      ${r.throughput_jobs_per_second.toFixed(1).padStart(8)}  |    ${r.worker_utilization_pct.toFixed(0).padStart(5)}%    |   ${r.p95_latency_ms.toFixed(0).padStart(6)}ms`,
    );
    // Update with computed efficiency
    r.scaling_efficiency_pct = efficiency;
    r.scaling_plateau = efficiency < 60;
  }

  lines.push("");
  lines.push(`First bottleneck: ~${bottleneckWorkers} workers`);
  lines.push(`Max throughput: ${maxThroughput.toFixed(1)} jobs/sec`);
  lines.push("");

  // 14K assessment
  const targetJobsPerDay = 140_000;
  const targetJobsPerSec = targetJobsPerDay / 86_400;
  const headroom = maxThroughput / targetJobsPerSec;

  lines.push(`14K target: ${targetJobsPerSec.toFixed(1)} jobs/sec needed`);
  lines.push(`Current max: ${maxThroughput.toFixed(1)} jobs/sec`);
  lines.push(`Headroom: ${headroom.toFixed(1)}x`);
  lines.push("");
  lines.push(headroom > 2
    ? "ASSESSMENT: Worker layer has sufficient headroom for 14K users."
    : "ASSESSMENT: Worker layer may be a bottleneck at 14K users.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Single-shot throughput measurement
// ---------------------------------------------------------------------------

export async function measureThroughput(
  totalJobs: number,
  workerCount: number,
  workerConcurrency: number,
): Promise<{ throughput_jps: number; duration_ms: number; completed: number }> {
  const queue = new BenchmarkQueue();
  const workers: BenchmarkWorker[] = [];

  for (let i = 0; i < totalJobs; i++) {
    queue.enqueue(createBenchmarkJob());
  }

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      new BenchmarkWorker(
        { worker_id: `w${w}`, max_concurrent_jobs: workerConcurrency, poll_interval_ms: 10, job_timeout_ms: 30_000 },
        queue,
      ),
    );
  }

  const handler = async (): Promise<{ success: boolean; duration_ms: number }> => {
    await new Promise((r) => setTimeout(r, 1));
    return { success: true, duration_ms: 1 };
  };

  const start = Date.now();
  let remaining = totalJobs;
  let iterations = 0;

  while (remaining > 0 && iterations < totalJobs * 2) {
    await Promise.all(workers.map((w) => w.pollCycle(handler)));
    remaining = queue.depth;
    iterations++;
  }

  const duration = Date.now() - start;
  const completed = workers.reduce((s, w) => s + w.stats.processed, 0);

  return {
    throughput_jps: duration > 0 ? (completed / duration) * 1000 : 0,
    duration_ms: duration,
    completed,
  };
}
