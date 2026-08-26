// ---------------------------------------------------------------------------
// Atlas Observability Metrics
//
// In-memory metrics collector for production observability.
// Tracks queue depth, job throughput, worker utilization, AI usage,
// latency percentiles, and tenant-scoped metrics.
//
// This is a pure in-memory collector. For production, metrics should be
// periodically flushed to the database or an external observability system.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  timestamp: string;
  queue: QueueMetrics;
  jobs: JobMetrics;
  workers: WorkerMetrics;
  agents: AgentMetrics;
  ai: AIMetrics;
  reviews: ReviewMetrics;
  tenants: TenantMetrics[];
}

export interface QueueMetrics {
  depth: number;
  pending_count: number;
  processing_count: number;
  awaiting_review_count: number;
  backpressure_level: string;
}

export interface JobMetrics {
  created_total: number;
  completed_total: number;
  failed_total: number;
  retried_total: number;
  cancelled_total: number;
  /** Jobs created in the last minute. */
  created_per_minute: number;
  /** Jobs completed in the last minute. */
  completed_per_minute: number;
  /** Average job duration in ms (rolling). */
  avg_duration_ms: number;
  /** p50/p95/p99 job durations in ms. */
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
}

export interface WorkerMetrics {
  active_workers: number;
  total_active_jobs: number;
  total_processed: number;
  total_failed: number;
  /** Worker utilization = active_jobs / (workers * max_concurrent). */
  utilization_pct: number;
}

export interface AgentMetrics {
  total_agent_runs: number;
  active_agent_runs: number;
  evidence_runs: number;
  gap_runs: number;
  supplement_runs: number;
  qa_runs: number;
  avg_duration_ms: number;
  failure_rate_pct: number;
}

export interface AIMetrics {
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  calls_per_minute: number;
  tokens_per_minute: number;
  cost_per_hour_usd: number;
  avg_latency_ms: number;
  rate_limit_hits: number;
}

export interface ReviewMetrics {
  pending_count: number;
  approved_total: number;
  rejected_total: number;
  needs_changes_total: number;
  avg_review_time_ms: number;
}

export interface TenantMetrics {
  tenant_id: string;
  active_jobs: number;
  jobs_completed_hour: number;
  ai_cost_hour_usd: number;
  ai_calls_hour: number;
}

// ---------------------------------------------------------------------------
// Sliding window for rate calculations
// ---------------------------------------------------------------------------

interface TimestampedValue {
  timestamp: number;
  value: number;
}

function sumInWindow(entries: TimestampedValue[], nowMs: number, windowMs: number): number {
  const cutoff = nowMs - windowMs;
  let sum = 0;
  for (const e of entries) {
    if (e.timestamp >= cutoff) sum += e.value;
  }
  return sum;
}

function countInWindow(entries: TimestampedValue[], nowMs: number, windowMs: number): number {
  const cutoff = nowMs - windowMs;
  let count = 0;
  for (const e of entries) {
    if (e.timestamp >= cutoff) count++;
  }
  return count;
}

function pruneWindow(entries: TimestampedValue[], nowMs: number, windowMs: number): TimestampedValue[] {
  const cutoff = nowMs - windowMs;
  return entries.filter((e) => e.timestamp >= cutoff);
}

// ---------------------------------------------------------------------------
// Percentile calculation
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  // Counters
  private jobsCreated = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private jobsRetried = 0;
  private jobsCancelled = 0;

  // Sliding windows (1-minute)
  private jobCreatedWindow: TimestampedValue[] = [];
  private jobCompletedWindow: TimestampedValue[] = [];
  private jobDurationWindow: TimestampedValue[] = [];

  // AI metrics
  private aiCalls = 0;
  private aiTokens = 0;
  private aiCostUsd = 0;
  private aiCallWindow: TimestampedValue[] = [];
  private aiTokenWindow: TimestampedValue[] = [];
  private aiCostWindow: TimestampedValue[] = [];
  private aiLatencyWindow: TimestampedValue[] = [];
  private aiRateLimitHits = 0;

  // Agent runs
  private agentRuns = 0;
  private agentFailures = 0;
  private agentRunsByType = new Map<string, number>();
  private agentDurationWindow: TimestampedValue[] = [];

  // Review metrics
  private reviewsApproved = 0;
  private reviewsRejected = 0;
  private reviewsNeedsChanges = 0;
  private reviewTimeWindow: TimestampedValue[] = [];

  // Worker metrics
  private totalProcessed = 0;
  private totalFailed = 0;

  // Tenant-scoped
  private tenantJobs = new Map<string, { completed_hour: number; ai_cost_hour: number; ai_calls_hour: number }>();

  // Queue state (set externally)
  private queueDepth = 0;
  private pendingCount = 0;
  private processingCount = 0;
  private awaitingReviewCount = 0;
  private backpressureLevel = "normal";

  // Worker state (set externally)
  private activeWorkers = 0;
  private activeJobs = 0;
  private maxConcurrentPerWorker = 5;

  // -------------------------------------------------------------------------
  // Event recording
  // -------------------------------------------------------------------------

  recordJobCreated(tenantId: string): void {
    this.jobsCreated++;
    const now = Date.now();
    this.jobCreatedWindow.push({ timestamp: now, value: 1 });
  }

  recordJobCompleted(durationMs: number, tenantId: string): void {
    this.jobsCompleted++;
    const now = Date.now();
    this.jobCompletedWindow.push({ timestamp: now, value: 1 });
    this.jobDurationWindow.push({ timestamp: now, value: durationMs });
    this.totalProcessed++;

    // Tenant tracking
    let tenant = this.tenantJobs.get(tenantId);
    if (!tenant) { tenant = { completed_hour: 0, ai_cost_hour: 0, ai_calls_hour: 0 }; this.tenantJobs.set(tenantId, tenant); }
    tenant.completed_hour++;
  }

  recordJobFailed(tenantId: string): void {
    this.jobsFailed++;
    this.totalFailed++;
  }

  recordJobRetried(): void {
    this.jobsRetried++;
  }

  recordJobCancelled(): void {
    this.jobsCancelled++;
  }

  recordAICall(tenantId: string, tokens: number, costUsd: number, latencyMs: number): void {
    const now = Date.now();
    this.aiCalls++;
    this.aiTokens += tokens;
    this.aiCostUsd += costUsd;
    this.aiCallWindow.push({ timestamp: now, value: 1 });
    this.aiTokenWindow.push({ timestamp: now, value: tokens });
    this.aiCostWindow.push({ timestamp: now, value: costUsd });
    this.aiLatencyWindow.push({ timestamp: now, value: latencyMs });

    let tenant = this.tenantJobs.get(tenantId);
    if (!tenant) { tenant = { completed_hour: 0, ai_cost_hour: 0, ai_calls_hour: 0 }; this.tenantJobs.set(tenantId, tenant); }
    tenant.ai_cost_hour += costUsd;
    tenant.ai_calls_hour++;
  }

  recordAIRateLimitHit(): void {
    this.aiRateLimitHits++;
  }

  recordAgentRun(agentType: string, durationMs: number, success: boolean): void {
    const now = Date.now();
    this.agentRuns++;
    this.agentRunsByType.set(agentType, (this.agentRunsByType.get(agentType) ?? 0) + 1);
    this.agentDurationWindow.push({ timestamp: now, value: durationMs });
    if (!success) this.agentFailures++;
  }

  recordReviewApproved(durationMs: number): void {
    this.reviewsApproved++;
    this.reviewTimeWindow.push({ timestamp: Date.now(), value: durationMs });
  }

  recordReviewRejected(): void {
    this.reviewsRejected++;
  }

  recordReviewNeedsChanges(): void {
    this.reviewsNeedsChanges++;
  }

  // -------------------------------------------------------------------------
  // State setters (called by worker/orchestrator)
  // -------------------------------------------------------------------------

  setQueueState(depth: number, pending: number, processing: number, awaitingReview: number, backpressure: string): void {
    this.queueDepth = depth;
    this.pendingCount = pending;
    this.processingCount = processing;
    this.awaitingReviewCount = awaitingReview;
    this.backpressureLevel = backpressure;
  }

  setWorkerState(activeWorkers: number, activeJobs: number, maxConcurrent: number): void {
    this.activeWorkers = activeWorkers;
    this.activeJobs = activeJobs;
    this.maxConcurrentPerWorker = maxConcurrent;
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  getSnapshot(): MetricsSnapshot {
    const now = Date.now();

    // Prune old windows
    this.jobCreatedWindow = pruneWindow(this.jobCreatedWindow, now, 60_000);
    this.jobCompletedWindow = pruneWindow(this.jobCompletedWindow, now, 60_000);
    this.jobDurationWindow = pruneWindow(this.jobDurationWindow, now, 3_600_000);
    this.aiCallWindow = pruneWindow(this.aiCallWindow, now, 60_000);
    this.aiTokenWindow = pruneWindow(this.aiTokenWindow, now, 60_000);
    this.aiCostWindow = pruneWindow(this.aiCostWindow, now, 3_600_000);
    this.aiLatencyWindow = pruneWindow(this.aiLatencyWindow, now, 60_000);
    this.agentDurationWindow = pruneWindow(this.agentDurationWindow, now, 3_600_000);
    this.reviewTimeWindow = pruneWindow(this.reviewTimeWindow, now, 3_600_000);

    // Duration percentiles
    const durations = this.jobDurationWindow.map((e) => e.value).sort((a, b) => a - b);
    const agentDurations = this.agentDurationWindow.map((e) => e.value).sort((a, b) => a - b);
    const aiLatencies = this.aiLatencyWindow.map((e) => e.value).sort((a, b) => a - b);
    const reviewTimes = this.reviewTimeWindow.map((e) => e.value).sort((a, b) => a - b);

    const totalCapacity = this.activeWorkers * this.maxConcurrentPerWorker;
    const utilization = totalCapacity > 0 ? (this.activeJobs / totalCapacity) * 100 : 0;

    // Tenant metrics
    const tenantMetrics: TenantMetrics[] = [];
    for (const [tid, data] of this.tenantJobs) {
      tenantMetrics.push({
        tenant_id: tid,
        active_jobs: 0, // Would need separate tracking
        jobs_completed_hour: data.completed_hour,
        ai_cost_hour_usd: data.ai_cost_hour,
        ai_calls_hour: data.ai_calls_hour,
      });
    }

    return {
      timestamp: new Date().toISOString(),
      queue: {
        depth: this.queueDepth,
        pending_count: this.pendingCount,
        processing_count: this.processingCount,
        awaiting_review_count: this.awaitingReviewCount,
        backpressure_level: this.backpressureLevel,
      },
      jobs: {
        created_total: this.jobsCreated,
        completed_total: this.jobsCompleted,
        failed_total: this.jobsFailed,
        retried_total: this.jobsRetried,
        cancelled_total: this.jobsCancelled,
        created_per_minute: countInWindow(this.jobCreatedWindow, now, 60_000),
        completed_per_minute: countInWindow(this.jobCompletedWindow, now, 60_000),
        avg_duration_ms: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        p50_duration_ms: percentile(durations, 50),
        p95_duration_ms: percentile(durations, 95),
        p99_duration_ms: percentile(durations, 99),
      },
      workers: {
        active_workers: this.activeWorkers,
        total_active_jobs: this.activeJobs,
        total_processed: this.totalProcessed,
        total_failed: this.totalFailed,
        utilization_pct: Math.min(100, utilization),
      },
      agents: {
        total_agent_runs: this.agentRuns,
        active_agent_runs: 0,
        evidence_runs: this.agentRunsByType.get("evidence") ?? 0,
        gap_runs: this.agentRunsByType.get("gap_intelligence") ?? 0,
        supplement_runs: this.agentRunsByType.get("supplement_reasoning") ?? 0,
        qa_runs: this.agentRunsByType.get("qa") ?? 0,
        avg_duration_ms: agentDurations.length > 0 ? agentDurations.reduce((a, b) => a + b, 0) / agentDurations.length : 0,
        failure_rate_pct: this.agentRuns > 0 ? (this.agentFailures / this.agentRuns) * 100 : 0,
      },
      ai: {
        total_calls: this.aiCalls,
        total_tokens: this.aiTokens,
        total_cost_usd: this.aiCostUsd,
        calls_per_minute: countInWindow(this.aiCallWindow, now, 60_000),
        tokens_per_minute: sumInWindow(this.aiTokenWindow, now, 60_000),
        cost_per_hour_usd: sumInWindow(this.aiCostWindow, now, 3_600_000),
        avg_latency_ms: aiLatencies.length > 0 ? aiLatencies.reduce((a, b) => a + b, 0) / aiLatencies.length : 0,
        rate_limit_hits: this.aiRateLimitHits,
      },
      reviews: {
        pending_count: this.awaitingReviewCount,
        approved_total: this.reviewsApproved,
        rejected_total: this.reviewsRejected,
        needs_changes_total: this.reviewsNeedsChanges,
        avg_review_time_ms: reviewTimes.length > 0 ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length : 0,
      },
      tenants: tenantMetrics,
    };
  }

  /**
   * Reset all metrics (for testing).
   */
  reset(): void {
    this.jobsCreated = 0;
    this.jobsCompleted = 0;
    this.jobsFailed = 0;
    this.jobsRetried = 0;
    this.jobsCancelled = 0;
    this.jobCreatedWindow = [];
    this.jobCompletedWindow = [];
    this.jobDurationWindow = [];
    this.aiCalls = 0;
    this.aiTokens = 0;
    this.aiCostUsd = 0;
    this.aiCallWindow = [];
    this.aiTokenWindow = [];
    this.aiCostWindow = [];
    this.aiLatencyWindow = [];
    this.aiRateLimitHits = 0;
    this.agentRuns = 0;
    this.agentFailures = 0;
    this.agentRunsByType.clear();
    this.agentDurationWindow = [];
    this.reviewsApproved = 0;
    this.reviewsRejected = 0;
    this.reviewsNeedsChanges = 0;
    this.reviewTimeWindow = [];
    this.totalProcessed = 0;
    this.totalFailed = 0;
    this.tenantJobs.clear();
  }
}
