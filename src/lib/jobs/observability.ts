// ---------------------------------------------------------------------------
// Atlas Enhanced Observability
//
// Production-grade metrics with tenant + correlation context.
// Every metric includes enough context to answer:
//   "Why is Company X slow?"
//
// Metrics follow a namespaced convention:
//   atlas.{domain}.{metric}
//
// This is a pure in-memory collector. For production, metrics should be
// flushed to Supabase, an external observability system, or structured logs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Metric names
// ---------------------------------------------------------------------------

export const ATLAS_METRICS = {
  // Job lifecycle
  JOBS_CREATED: "atlas.jobs.created",
  JOBS_COMPLETED: "atlas.jobs.completed",
  JOBS_FAILED: "atlas.jobs.failed",
  JOBS_AWAITING_REVIEW: "atlas.jobs.awaiting_review",
  JOBS_RETRIED: "atlas.jobs.retried",
  JOBS_CANCELLED: "atlas.jobs.cancelled",

  // Queue
  QUEUE_DEPTH: "atlas.queue.depth",
  QUEUE_WAIT_MS: "atlas.queue.wait_ms",

  // Worker
  WORKER_ACTIVE: "atlas.worker.active",
  WORKER_UTILIZATION: "atlas.worker.utilization",
  WORKER_POLL_CYCLES: "atlas.worker.poll_cycles",

  // AI
  AI_REQUESTS: "atlas.ai.requests",
  AI_TOKENS: "atlas.ai.tokens",
  AI_COST: "atlas.ai.cost",
  AI_LATENCY: "atlas.ai.latency",
  AI_RATE_LIMITS: "atlas.ai.rate_limits",

  // Agents
  AGENT_RUNS: "atlas.agent.runs",
  AGENT_LATENCY: "atlas.agent.latency",
  AGENT_FAILURES: "atlas.agent.failures",

  // Reviews
  REVIEWS_CREATED: "atlas.reviews.created",
  REVIEWS_APPROVED: "atlas.reviews.approved",
  REVIEWS_REJECTED: "atlas.reviews.rejected",
  REVIEWS_LATENCY: "atlas.reviews.latency",

  // Tenant-scoped
  TENANT_JOBS: "atlas.tenant.jobs",
  TENANT_AI_USAGE: "atlas.tenant.ai_usage",
  TENANT_COST: "atlas.tenant.cost",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricPoint {
  metric: string;
  value: number;
  timestamp: string;
  /** Tenant context — null for global metrics. */
  tenant_id: string | null;
  /** Correlation context — links related metrics in a pipeline. */
  correlation_id: string | null;
  /** Additional labels. */
  labels?: Record<string, string>;
}

export interface TenantContext {
  tenant_id: string;
  company_name?: string;
  tier?: string;
}

export interface PipelineContext {
  correlation_id: string;
  claim_id: string;
  job_id: string;
  step_id?: string;
  agent_run_id?: string;
}

export interface ObservabilitySnapshot {
  timestamp: string;
  /** All recorded metric points (recent window). */
  points: MetricPoint[];
  /** Aggregated tenant summary. */
  tenant_summaries: TenantSummary[];
  /** Global aggregates. */
  global: GlobalSummary;
}

export interface TenantSummary {
  tenant_id: string;
  jobs_created: number;
  jobs_completed: number;
  jobs_failed: number;
  ai_calls: number;
  ai_tokens: number;
  ai_cost_usd: number;
  avg_job_latency_ms: number;
  reviews_pending: number;
}

export interface GlobalSummary {
  total_jobs: number;
  total_ai_calls: number;
  total_ai_cost_usd: number;
  total_tokens: number;
  avg_latency_ms: number;
  queue_depth: number;
  worker_utilization_pct: number;
}

// ---------------------------------------------------------------------------
// Enhanced Observability Collector
// ---------------------------------------------------------------------------

export class ObservabilityCollector {
  private points: MetricPoint[] = [];
  private tenantData = new Map<string, TenantSummary>();
  private windowMs: number;

  constructor(windowMs: number = 3_600_000) {
    this.windowMs = windowMs;
  }

  // -------------------------------------------------------------------------
  // Recording with context
  // -------------------------------------------------------------------------

  record(metric: string, value: number, context?: {
    tenant_id?: string;
    correlation_id?: string;
    labels?: Record<string, string>;
  }): void {
    const point: MetricPoint = {
      metric,
      value,
      timestamp: new Date().toISOString(),
      tenant_id: context?.tenant_id ?? null,
      correlation_id: context?.correlation_id ?? null,
      labels: context?.labels,
    };
    this.points.push(point);
    this.prune();

    // Update tenant summary
    if (context?.tenant_id) {
      this.updateTenantSummary(context.tenant_id, metric, value);
    }
  }

  // Convenience: record with pipeline context
  recordPipeline(
    metric: string,
    value: number,
    tenantId: string,
    pipeline: PipelineContext,
  ): void {
    this.record(metric, value, {
      tenant_id: tenantId,
      correlation_id: pipeline.correlation_id,
      labels: {
        claim_id: pipeline.claim_id,
        job_id: pipeline.job_id,
        ...(pipeline.step_id ? { step_id: pipeline.step_id } : {}),
        ...(pipeline.agent_run_id ? { agent_run_id: pipeline.agent_run_id } : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Event recording helpers
  // -------------------------------------------------------------------------

  recordJobCreated(tenantId: string, correlationId?: string): void {
    this.record(ATLAS_METRICS.JOBS_CREATED, 1, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordJobCompleted(tenantId: string, durationMs: number, correlationId?: string): void {
    this.record(ATLAS_METRICS.JOBS_COMPLETED, 1, { tenant_id: tenantId, correlation_id: correlationId });
    this.record(ATLAS_METRICS.QUEUE_WAIT_MS, durationMs, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordJobFailed(tenantId: string, correlationId?: string): void {
    this.record(ATLAS_METRICS.JOBS_FAILED, 1, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordAICall(tenantId: string, tokens: number, costUsd: number, latencyMs: number, correlationId?: string): void {
    this.record(ATLAS_METRICS.AI_REQUESTS, 1, { tenant_id: tenantId, correlation_id: correlationId });
    this.record(ATLAS_METRICS.AI_TOKENS, tokens, { tenant_id: tenantId, correlation_id: correlationId });
    this.record(ATLAS_METRICS.AI_COST, costUsd, { tenant_id: tenantId, correlation_id: correlationId });
    this.record(ATLAS_METRICS.AI_LATENCY, latencyMs, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordReviewCreated(tenantId: string, correlationId?: string): void {
    this.record(ATLAS_METRICS.REVIEWS_CREATED, 1, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordReviewApproved(tenantId: string, correlationId?: string): void {
    this.record(ATLAS_METRICS.REVIEWS_APPROVED, 1, { tenant_id: tenantId, correlation_id: correlationId });
  }

  recordWorkerUtilization(utilization: number, workerId?: string): void {
    this.record(ATLAS_METRICS.WORKER_UTILIZATION, utilization, {
      labels: workerId ? { worker_id: workerId } : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Find all metrics for a specific tenant.
   * This enables answering "Why is Company X slow?"
   */
  queryTenant(tenantId: string): MetricPoint[] {
    return this.points.filter((p) => p.tenant_id === tenantId);
  }

  /**
   * Find all metrics for a specific correlation (pipeline trace).
   * This enables full pipeline traceability.
   */
  queryCorrelation(correlationId: string): MetricPoint[] {
    return this.points.filter((p) => p.correlation_id === correlationId);
  }

  /**
   * Find all metrics matching a name pattern.
   */
  queryMetric(metricPattern: string): MetricPoint[] {
    return this.points.filter((p) => p.metric.includes(metricPattern));
  }

  /**
   * Get the "Why is Company X slow?" diagnostic.
   */
  diagnoseTenant(tenantId: string): TenantDiagnosis {
    const tenantPoints = this.queryTenant(tenantId);
    const jobCreated = tenantPoints.filter((p) => p.metric === ATLAS_METRICS.JOBS_CREATED).length;
    const jobCompleted = tenantPoints.filter((p) => p.metric === ATLAS_METRICS.JOBS_COMPLETED).length;
    const jobFailed = tenantPoints.filter((p) => p.metric === ATLAS_METRICS.JOBS_FAILED).length;

    const aiLatencies = tenantPoints
      .filter((p) => p.metric === ATLAS_METRICS.AI_LATENCY)
      .map((p) => p.value);
    const avgAILatency = aiLatencies.length > 0
      ? aiLatencies.reduce((a, b) => a + b, 0) / aiLatencies.length
      : 0;

    const aiCosts = tenantPoints.filter((p) => p.metric === ATLAS_METRICS.AI_COST);
    const totalAICost = aiCosts.reduce((s, p) => s + p.value, 0);

    const failureRate = jobCreated > 0 ? jobFailed / jobCreated : 0;
    const pending = jobCreated - jobCompleted - jobFailed;

    const issues: string[] = [];
    if (failureRate > 0.1) issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
    if (avgAILatency > 5000) issues.push(`Slow AI responses: ${avgAILatency.toFixed(0)}ms avg`);
    if (pending > 100) issues.push(`Backlog: ${pending} jobs pending`);
    if (totalAICost > 50) issues.push(`High AI spend: $${totalAICost.toFixed(2)}`);

    return {
      tenant_id: tenantId,
      jobs_created: jobCreated,
      jobs_completed: jobCompleted,
      jobs_failed: jobFailed,
      jobs_pending: pending,
      failure_rate: failureRate,
      avg_ai_latency_ms: avgAILatency,
      ai_cost_usd: totalAICost,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  getSnapshot(): ObservabilitySnapshot {
    this.prune();

    // Tenant summaries
    const tenantSummaries: TenantSummary[] = [];
    for (const [tid, summary] of this.tenantData) {
      tenantSummaries.push({ ...summary });
    }

    // Global summary
    const totalJobs = this.points.filter((p) => p.metric === ATLAS_METRICS.JOBS_CREATED).length;
    const totalAICalls = this.points.filter((p) => p.metric === ATLAS_METRICS.AI_REQUESTS).length;
    const totalAICost = this.points
      .filter((p) => p.metric === ATLAS_METRICS.AI_COST)
      .reduce((s, p) => s + p.value, 0);
    const totalTokens = this.points
      .filter((p) => p.metric === ATLAS_METRICS.AI_TOKENS)
      .reduce((s, p) => s + p.value, 0);
    const latencies = this.points
      .filter((p) => p.metric === ATLAS_METRICS.QUEUE_WAIT_MS)
      .map((p) => p.value);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    return {
      timestamp: new Date().toISOString(),
      points: [...this.points],
      tenant_summaries: tenantSummaries,
      global: {
        total_jobs: totalJobs,
        total_ai_calls: totalAICalls,
        total_ai_cost_usd: totalAICost,
        total_tokens: totalTokens,
        avg_latency_ms: avgLatency,
        queue_depth: 0,
        worker_utilization_pct: 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private updateTenantSummary(tenantId: string, metric: string, value: number): void {
    let summary = this.tenantData.get(tenantId);
    if (!summary) {
      summary = {
        tenant_id: tenantId,
        jobs_created: 0,
        jobs_completed: 0,
        jobs_failed: 0,
        ai_calls: 0,
        ai_tokens: 0,
        ai_cost_usd: 0,
        avg_job_latency_ms: 0,
        reviews_pending: 0,
      };
      this.tenantData.set(tenantId, summary);
    }

    switch (metric) {
      case ATLAS_METRICS.JOBS_CREATED: summary.jobs_created++; break;
      case ATLAS_METRICS.JOBS_COMPLETED: summary.jobs_completed++; break;
      case ATLAS_METRICS.JOBS_FAILED: summary.jobs_failed++; break;
      case ATLAS_METRICS.AI_REQUESTS: summary.ai_calls++; break;
      case ATLAS_METRICS.AI_TOKENS: summary.ai_tokens += value; break;
      case ATLAS_METRICS.AI_COST: summary.ai_cost_usd += value; break;
      case ATLAS_METRICS.QUEUE_WAIT_MS:
        summary.avg_job_latency_ms = summary.jobs_completed > 0
          ? (summary.avg_job_latency_ms * (summary.jobs_completed - 1) + value) / summary.jobs_completed
          : value;
        break;
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.points = this.points.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
  }

  reset(): void {
    this.points = [];
    this.tenantData.clear();
  }
}

// ---------------------------------------------------------------------------
// Tenant diagnosis
// ---------------------------------------------------------------------------

export interface TenantDiagnosis {
  tenant_id: string;
  jobs_created: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_pending: number;
  failure_rate: number;
  avg_ai_latency_ms: number;
  ai_cost_usd: number;
  issues: string[];
}
