// ---------------------------------------------------------------------------
// Atlas AI Concurrency Limiter
//
// Provider-independent rate limiting for AI agent calls.
// Supports:
// - Max concurrent AI requests (global + per-tenant)
// - Retry with exponential backoff
// - Provider rate-limit response handling
// - Cancellation and timeout
// - Per-tenant and global cost ceilings
// - Token tracking
//
// This is a pure in-memory rate limiter. It does NOT persist state.
// On worker restart, limits reset — which is safe because the durable
// job system will retry failed calls.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIConcurrencyConfig {
  /** Maximum concurrent AI requests across all tenants. */
  global_max_concurrent: number;
  /** Maximum concurrent AI requests per tenant. */
  per_tenant_max_concurrent: number;
  /** Maximum AI requests per minute (global). */
  global_rate_limit_per_minute: number;
  /** Maximum AI requests per minute per tenant. */
  per_tenant_rate_limit_per_minute: number;
  /** Maximum estimated cost per hour (global) in USD. */
  global_cost_limit_per_hour_usd: number;
  /** Maximum estimated cost per hour per tenant in USD. */
  per_tenant_cost_limit_per_hour_usd: number;
  /** Maximum tokens per single AI call. */
  max_tokens_per_call: number;
  /** Retry configuration. */
  max_retries: number;
  /** Base delay for exponential backoff in ms. */
  retry_base_delay_ms: number;
  /** Maximum delay for exponential backoff in ms. */
  retry_max_delay_ms: number;
  /** Timeout per AI call in ms. */
  call_timeout_ms: number;
}

export const DEFAULT_AI_CONFIG: AIConcurrencyConfig = {
  global_max_concurrent: 50,
  per_tenant_max_concurrent: 10,
  global_rate_limit_per_minute: 300,
  per_tenant_rate_limit_per_minute: 30,
  global_cost_limit_per_hour_usd: 100.0,
  per_tenant_cost_limit_per_hour_usd: 10.0,
  max_tokens_per_call: 8_000,
  max_retries: 3,
  retry_base_delay_ms: 1_000,
  retry_max_delay_ms: 30_000,
  call_timeout_ms: 60_000,
};

export interface AICallRequest {
  tenant_id: string;
  agent_type: string;
  model: string;
  estimated_tokens: number;
  estimated_cost_usd: number;
}

export interface AICallResult {
  success: boolean;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number;
  error?: string;
  retry_count: number;
  rate_limited: boolean;
}

export interface AILimiterStats {
  global_active: number;
  global_total_calls: number;
  global_total_tokens: number;
  global_total_cost_usd: number;
  tenant_active: Map<string, number>;
  tenant_total_calls: Map<string, number>;
  tenant_total_tokens: Map<string, number>;
  tenant_total_cost_usd: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Sliding window rate limiter (pure in-memory)
// ---------------------------------------------------------------------------

interface RateWindow {
  timestamps: number[];
}

function countInWindow(window: RateWindow, nowMs: number, windowMs: number): number {
  const cutoff = nowMs - windowMs;
  // Remove old entries
  while (window.timestamps.length > 0 && window.timestamps[0] < cutoff) {
    window.timestamps.shift();
  }
  return window.timestamps.length;
}

function addTimestamp(window: RateWindow, nowMs: number): void {
  window.timestamps.push(nowMs);
}

// ---------------------------------------------------------------------------
// AI Concurrency Limiter
// ---------------------------------------------------------------------------

export class AIConcurrencyLimiter {
  private config: AIConcurrencyConfig;
  private globalActive = 0;
  private tenantActive = new Map<string, number>();
  private globalWindow: RateWindow = { timestamps: [] };
  private tenantWindows = new Map<string, RateWindow>();
  private globalCostWindow: RateWindow = { timestamps: [] };
  private tenantCostWindows = new Map<string, RateWindow>();

  // Aggregate stats
  private totalCalls = 0;
  private totalTokens = 0;
  private totalCostUsd = 0;
  private tenantCalls = new Map<string, number>();
  private tenantTokens = new Map<string, number>();
  private tenantCosts = new Map<string, number>();

  constructor(config: Partial<AIConcurrencyConfig> = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...config };
  }

  /**
   * Check whether a request is allowed without actually claiming a slot.
   * Use this for pre-flight checks.
   */
  checkAllowance(request: AICallRequest): { allowed: boolean; reason: string } {
    const now = Date.now();

    // Global concurrency
    if (this.globalActive >= this.config.global_max_concurrent) {
      return { allowed: false, reason: `Global concurrency limit reached (${this.config.global_max_concurrent})` };
    }

    // Per-tenant concurrency
    const tenantActive = this.tenantActive.get(request.tenant_id) ?? 0;
    if (tenantActive >= this.config.per_tenant_max_concurrent) {
      return { allowed: false, reason: `Tenant ${request.tenant_id} concurrency limit reached (${this.config.per_tenant_max_concurrent})` };
    }

    // Global rate limit (per minute)
    const globalRate = countInWindow(this.globalWindow, now, 60_000);
    if (globalRate >= this.config.global_rate_limit_per_minute) {
      return { allowed: false, reason: `Global rate limit reached (${this.config.global_rate_limit_per_minute}/min)` };
    }

    // Per-tenant rate limit
    const tenantWindow = this.tenantWindows.get(request.tenant_id);
    const tenantRate = tenantWindow ? countInWindow(tenantWindow, now, 60_000) : 0;
    if (tenantRate >= this.config.per_tenant_rate_limit_per_minute) {
      return { allowed: false, reason: `Tenant ${request.tenant_id} rate limit reached (${this.config.per_tenant_rate_limit_per_minute}/min)` };
    }

    // Global cost limit (per hour)
    const globalCost = this.sumCostInWindow(this.globalCostWindow, now, 3_600_000);
    if (globalCost >= this.config.global_cost_limit_per_hour_usd) {
      return { allowed: false, reason: `Global cost limit reached ($${this.config.global_cost_limit_per_hour_usd}/hr)` };
    }

    // Per-tenant cost limit
    const tenantCostWindow = this.tenantCostWindows.get(request.tenant_id);
    const tenantCost = tenantCostWindow ? this.sumCostInWindow(tenantCostWindow, now, 3_600_000) : 0;
    if (tenantCost >= this.config.per_tenant_cost_limit_per_hour_usd) {
      return { allowed: false, reason: `Tenant ${request.tenant_id} cost limit reached ($${this.config.per_tenant_cost_limit_per_hour_usd}/hr)` };
    }

    // Token limit
    if (request.estimated_tokens > this.config.max_tokens_per_call) {
      return { allowed: false, reason: `Token limit exceeded (${request.estimated_tokens} > ${this.config.max_tokens_per_call})` };
    }

    return { allowed: true, reason: "Within all limits" };
  }

  /**
   * Claim a concurrency slot. Call this BEFORE making the AI request.
   * Returns true if the slot was claimed, false if denied.
   */
  claimSlot(request: AICallRequest): boolean {
    const check = this.checkAllowance(request);
    if (!check.allowed) return false;

    const now = Date.now();
    this.globalActive++;
    this.tenantActive.set(request.tenant_id, (this.tenantActive.get(request.tenant_id) ?? 0) + 1);
    addTimestamp(this.globalWindow, now);
    let tw = this.tenantWindows.get(request.tenant_id);
    if (!tw) { tw = { timestamps: [] }; this.tenantWindows.set(request.tenant_id, tw); }
    addTimestamp(tw, now);

    return true;
  }

  /**
   * Release a concurrency slot and record the actual usage.
   * Call this AFTER the AI request completes.
   */
  releaseSlot(tenantId: string, tokensUsed: number, costUsd: number): void {
    this.globalActive = Math.max(0, this.globalActive - 1);
    const current = this.tenantActive.get(tenantId) ?? 0;
    this.tenantActive.set(tenantId, Math.max(0, current - 1));

    // Record cost in the sliding window
    const now = Date.now();
    addTimestamp(this.globalCostWindow, now);
    // Store cost alongside timestamp by extending the window
    // (We use a simple approach: append cost as a side-channel)
    this.recordCost(this.globalCostWindow, costUsd);
    let tew = this.tenantCostWindows.get(tenantId);
    if (!tew) { tew = { timestamps: [] }; this.tenantCostWindows.set(tenantId, tew); }
    addTimestamp(tew, now);
    this.recordCost(tew, costUsd);

    // Aggregate stats
    this.totalCalls++;
    this.totalTokens += tokensUsed;
    this.totalCostUsd += costUsd;
    this.tenantCalls.set(tenantId, (this.tenantCalls.get(tenantId) ?? 0) + 1);
    this.tenantTokens.set(tenantId, (this.tenantTokens.get(tenantId) ?? 0) + tokensUsed);
    this.tenantCosts.set(tenantId, (this.tenantCosts.get(tenantId) ?? 0) + costUsd);
  }

  /**
   * Calculate retry delay with exponential backoff and jitter.
   */
  getRetryDelay(attemptNumber: number): number {
    const base = this.config.retry_base_delay_ms * Math.pow(2, attemptNumber);
    const capped = Math.min(base, this.config.retry_max_delay_ms);
    // Add ±20% jitter
    const jitter = capped * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, capped + jitter);
  }

  /**
   * Whether a retry should be attempted.
   */
  shouldRetry(attemptNumber: number, isRateLimited: boolean): boolean {
    // Rate-limited responses get extra retries with backoff
    if (isRateLimited && attemptNumber < this.config.max_retries + 2) return true;
    return attemptNumber < this.config.max_retries;
  }

  /**
   * Get current stats snapshot.
   */
  getStats(): {
    global_active: number;
    global_total_calls: number;
    global_total_tokens: number;
    global_total_cost_usd: number;
    tenant_stats: Array<{
      tenant_id: string;
      active: number;
      calls: number;
      tokens: number;
      cost_usd: number;
    }>;
  } {
    const tenantStats: Array<{
      tenant_id: string;
      active: number;
      calls: number;
      tokens: number;
      cost_usd: number;
    }> = [];

    const allTenantIds = new Set([
      ...this.tenantActive.keys(),
      ...this.tenantCalls.keys(),
    ]);

    for (const tid of allTenantIds) {
      tenantStats.push({
        tenant_id: tid,
        active: this.tenantActive.get(tid) ?? 0,
        calls: this.tenantCalls.get(tid) ?? 0,
        tokens: this.tenantTokens.get(tid) ?? 0,
        cost_usd: this.tenantCosts.get(tid) ?? 0,
      });
    }

    return {
      global_active: this.globalActive,
      global_total_calls: this.totalCalls,
      global_total_tokens: this.totalTokens,
      global_total_cost_usd: this.totalCostUsd,
      tenant_stats: tenantStats,
    };
  }

  /**
   * Reset all state (for testing).
   */
  reset(): void {
    this.globalActive = 0;
    this.tenantActive.clear();
    this.globalWindow = { timestamps: [] };
    this.tenantWindows.clear();
    this.globalCostWindow = { timestamps: [] };
    this.tenantCostWindows.clear();
    this.totalCalls = 0;
    this.totalTokens = 0;
    this.totalCostUsd = 0;
    this.tenantCalls.clear();
    this.tenantTokens.clear();
    this.tenantCosts.clear();
  }

  // -------------------------------------------------------------------------
  // Internal: cost tracking in sliding windows
  // -------------------------------------------------------------------------

  private costData = new WeakMap<RateWindow, number[]>();

  private recordCost(window: RateWindow, cost: number): void {
    let costs = this.costData.get(window);
    if (!costs) { costs = []; this.costData.set(window, costs); }
    costs.push(cost);
  }

  private sumCostInWindow(window: RateWindow, nowMs: number, windowMs: number): number {
    const cutoff = nowMs - windowMs;
    const costs = this.costData.get(window) ?? [];
    // Align cost removal with timestamp removal
    let sum = 0;
    const validTimestamps: number[] = [];
    const validCosts: number[] = [];
    for (let i = 0; i < window.timestamps.length; i++) {
      if (window.timestamps[i] >= cutoff) {
        validTimestamps.push(window.timestamps[i]);
        validCosts.push(costs[i] ?? 0);
      }
    }
    window.timestamps = validTimestamps;
    this.costData.set(window, validCosts);
    for (const c of validCosts) sum += c;
    return sum;
  }
}
