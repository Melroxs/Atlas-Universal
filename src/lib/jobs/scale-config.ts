// ---------------------------------------------------------------------------
// Atlas Scalability Configuration
//
// Defines backpressure thresholds, tenant quotas, priority bands,
// and configuration for scaling from pilot (100 users) to target (14,000 users).
//
// This module is pure configuration — no database calls, no side effects.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Backpressure thresholds
// ---------------------------------------------------------------------------

export type BackpressureLevel = "normal" | "warning" | "high" | "critical";

export interface BackpressureThresholds {
  /** Queue depth at which we enter WARNING. */
  warning_depth: number;
  /** Queue depth at which we enter HIGH. */
  high_depth: number;
  /** Queue depth at which we enter CRITICAL. */
  critical_depth: number;
  /** Maximum jobs to claim per poll when in WARNING. */
  warning_max_claim: number;
  /** Maximum jobs to claim per poll when in HIGH. */
  high_max_claim: number;
  /** Maximum jobs to claim per poll when in CRITICAL. */
  critical_max_claim: number;
}

export const DEFAULT_BACKPRESSURE: BackpressureThresholds = {
  warning_depth: 100,
  high_depth: 500,
  critical_depth: 2_000,
  warning_max_claim: 3,
  high_max_claim: 1,
  critical_max_claim: 1,
};

/**
 * Determine the current backpressure level given queue depth.
 */
export function getBackpressureLevel(
  queueDepth: number,
  thresholds: BackpressureThresholds = DEFAULT_BACKPRESSURE,
): BackpressureLevel {
  if (queueDepth >= thresholds.critical_depth) return "critical";
  if (queueDepth >= thresholds.high_depth) return "high";
  if (queueDepth >= thresholds.warning_depth) return "warning";
  return "normal";
}

/**
 * Get the maximum number of jobs a worker should claim per poll
 * based on the current backpressure level.
 */
export function getMaxClaimForLevel(
  level: BackpressureLevel,
  thresholds: BackpressureThresholds = DEFAULT_BACKPRESSURE,
  baseConcurrency: number = 5,
): number {
  switch (level) {
    case "critical":
      return Math.min(thresholds.critical_max_claim, baseConcurrency);
    case "high":
      return Math.min(thresholds.high_max_claim, baseConcurrency);
    case "warning":
      return Math.min(thresholds.warning_max_claim, baseConcurrency);
    default:
      return baseConcurrency;
  }
}

// ---------------------------------------------------------------------------
// Priority bands
// ---------------------------------------------------------------------------

export interface PriorityBand {
  name: string;
  priority_min: number;
  priority_max: number;
  max_concurrent: number;
  description: string;
}

export const DEFAULT_PRIORITY_BANDS: PriorityBand[] = [
  {
    name: "critical",
    priority_min: 1,
    priority_max: 1,
    max_concurrent: 10,
    description: "Customer-requested actions, urgent claim work",
  },
  {
    name: "high",
    priority_min: 2,
    priority_max: 2,
    max_concurrent: 20,
    description: "Active claim processing",
  },
  {
    name: "normal",
    priority_min: 3,
    priority_max: 3,
    max_concurrent: 50,
    description: "Normal AI/background processing",
  },
  {
    name: "low",
    priority_min: 4,
    priority_max: 5,
    max_concurrent: 30,
    description: "Analytics, learning, reprocessing",
  },
];

// ---------------------------------------------------------------------------
// Tenant quotas (per-tenant limits)
// ---------------------------------------------------------------------------

export interface TenantQuota {
  /** Maximum concurrent jobs for this tenant. */
  max_concurrent_jobs: number;
  /** Maximum jobs per hour. */
  max_jobs_per_hour: number;
  /** Maximum concurrent AI agent calls. */
  max_concurrent_ai_calls: number;
  /** Maximum AI cost per hour in USD. */
  max_ai_cost_per_hour_usd: number;
  /** Maximum AI cost per day in USD. */
  max_ai_cost_per_day_usd: number;
}

export const DEFAULT_TENANT_QUOTA: TenantQuota = {
  max_concurrent_jobs: 10,
  max_jobs_per_hour: 100,
  max_concurrent_ai_calls: 5,
  max_ai_cost_per_hour_usd: 5.0,
  max_ai_cost_per_day_usd: 50.0,
};

// ---------------------------------------------------------------------------
// Scale profiles
// ---------------------------------------------------------------------------

export interface ScaleProfile {
  name: string;
  expected_users: number;
  expected_companies: number;
  workers: number;
  worker_concurrency: number;
  tenant_quota: TenantQuota;
  backpressure: BackpressureThresholds;
  description: string;
}

export const SCALE_PROFILES: Record<string, ScaleProfile> = {
  pilot: {
    name: "pilot",
    expected_users: 100,
    expected_companies: 10,
    workers: 1,
    worker_concurrency: 5,
    tenant_quota: {
      max_concurrent_jobs: 5,
      max_jobs_per_hour: 50,
      max_concurrent_ai_calls: 3,
      max_ai_cost_per_hour_usd: 2.0,
      max_ai_cost_per_day_usd: 20.0,
    },
    backpressure: { ...DEFAULT_BACKPRESSURE },
    description: "100 users, 10 companies, low concurrency",
  },
  early_production: {
    name: "early_production",
    expected_users: 1_000,
    expected_companies: 100,
    workers: 3,
    worker_concurrency: 10,
    tenant_quota: {
      max_concurrent_jobs: 10,
      max_jobs_per_hour: 100,
      max_concurrent_ai_calls: 5,
      max_ai_cost_per_hour_usd: 5.0,
      max_ai_cost_per_day_usd: 50.0,
    },
    backpressure: { ...DEFAULT_BACKPRESSURE },
    description: "1,000 users, 100 companies, moderate concurrency",
  },
  growth: {
    name: "growth",
    expected_users: 5_000,
    expected_companies: 500,
    workers: 10,
    worker_concurrency: 15,
    tenant_quota: {
      max_concurrent_jobs: 15,
      max_jobs_per_hour: 200,
      max_concurrent_ai_calls: 8,
      max_ai_cost_per_hour_usd: 10.0,
      max_ai_cost_per_day_usd: 100.0,
    },
    backpressure: {
      warning_depth: 200,
      high_depth: 1_000,
      critical_depth: 5_000,
      warning_max_claim: 5,
      high_max_claim: 3,
      critical_max_claim: 1,
    },
    description: "5,000 users, 500 companies, high concurrency",
  },
  target: {
    name: "target",
    expected_users: 14_000,
    expected_companies: 1_000,
    workers: 25,
    worker_concurrency: 20,
    tenant_quota: {
      max_concurrent_jobs: 20,
      max_jobs_per_hour: 300,
      max_concurrent_ai_calls: 10,
      max_ai_cost_per_hour_usd: 15.0,
      max_ai_cost_per_day_usd: 150.0,
    },
    backpressure: {
      warning_depth: 500,
      high_depth: 2_000,
      critical_depth: 10_000,
      warning_max_claim: 10,
      high_max_claim: 5,
      critical_max_claim: 2,
    },
    description: "14,000 users, 1,000+ companies, high concurrency",
  },
};

// ---------------------------------------------------------------------------
// Backpressure evaluation (pure function)
// ---------------------------------------------------------------------------

/**
 * Given current system state, determine whether a worker should reduce
 * its claiming rate and whether low-priority jobs should be deferred.
 */
export interface BackpressureDecision {
  level: BackpressureLevel;
  maxClaim: number;
  deferLowPriority: boolean;
  deferNormalPriority: boolean;
  reason: string;
}

export function evaluateBackpressure(
  queueDepth: number,
  activeWorkers: number,
  baseConcurrency: number,
  thresholds: BackpressureThresholds = DEFAULT_BACKPRESSURE,
): BackpressureDecision {
  const level = getBackpressureLevel(queueDepth, thresholds);
  const maxClaim = getMaxClaimForLevel(level, thresholds, baseConcurrency);

  return {
    level,
    maxClaim,
    deferLowPriority: level === "high" || level === "critical",
    deferNormalPriority: level === "critical",
    reason: `Queue depth ${queueDepth} → ${level} (thresholds: warn=${thresholds.warning_depth}, high=${thresholds.high_depth}, crit=${thresholds.critical_depth})`,
  };
}

// ---------------------------------------------------------------------------
// Tenant quota checking (pure function)
// ---------------------------------------------------------------------------

export interface QuotaCheckResult {
  allowed: boolean;
  reason: string;
  remaining_concurrent: number;
  remaining_hourly: number;
}

/**
 * Check whether a tenant is within their quota limits.
 * This is a pure function — callers must provide the current usage state.
 */
export function checkTenantQuota(
  tenantId: string,
  quota: TenantQuota,
  currentConcurrentJobs: number,
  jobsCompletedThisHour: number,
): QuotaCheckResult {
  const remainingConcurrent = quota.max_concurrent_jobs - currentConcurrentJobs;
  const remainingHourly = quota.max_jobs_per_hour - jobsCompletedThisHour;

  if (remainingConcurrent <= 0) {
    return {
      allowed: false,
      reason: `Tenant ${tenantId} hit concurrent job limit (${quota.max_concurrent_jobs})`,
      remaining_concurrent: remainingConcurrent,
      remaining_hourly: remainingHourly,
    };
  }

  if (remainingHourly <= 0) {
    return {
      allowed: false,
      reason: `Tenant ${tenantId} hit hourly job limit (${quota.max_jobs_per_hour})`,
      remaining_concurrent: remainingConcurrent,
      remaining_hourly: remainingHourly,
    };
  }

  return {
    allowed: true,
    reason: `Within quota`,
    remaining_concurrent: remainingConcurrent,
    remaining_hourly: remainingHourly,
  };
}
