// ---------------------------------------------------------------------------
// Atlas AI Workload Benchmark
//
// Simulates the actual Atlas agent sequence per claim:
//   Evidence → Gap Intelligence → Supplement Reasoning → QA
//
// Measures AI calls, tokens, cost, latency, retry%, failure%,
// human-review%, and produces an economics model.
//
// ALL RESULTS ARE SIMULATED — not live AI provider benchmarks.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIAgentProfile {
  agent_type: string;
  avg_tokens_in: number;
  avg_tokens_out: number;
  avg_latency_ms: number;
  cost_per_1k_input_usd: number;
  cost_per_1k_output_usd: number;
  failure_rate: number;
  retry_rate: number;
  review_triggers: number; // fraction of runs that require human review (0-1)
}

export interface AIBenchmarkConfig {
  /** Number of claims to simulate. */
  claimCount: number;
  /** Agent profiles for each step. */
  agents: AIAgentProfile[];
  /** How many times to repeat the full agent sequence per claim. */
  sequencesPerClaim: number;
  /** Latency variance factor (0.5-2.0). */
  latencyVariance: number;
}

export interface AICallRecord {
  claim_id: string;
  agent_type: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
  success: boolean;
  retried: boolean;
  review_triggered: boolean;
}

export interface AIBenchmarkResult {
  total_claims: number;
  total_ai_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  total_duration_ms: number;
  avg_latency_per_call_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  calls_per_claim: number;
  tokens_per_claim: number;
  cost_per_claim_usd: number;
  latency_per_claim_ms: number;
  failure_rate_pct: number;
  retry_rate_pct: number;
  review_rate_pct: number;
  calls_per_minute: number;
  claims_per_minute: number;
  /** Economics model */
  economics: AIEconomicsModel;
  /** Per-agent breakdown */
  agent_breakdown: AgentBreakdown[];
}

export interface AgentBreakdown {
  agent_type: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  avg_latency_ms: number;
  failure_count: number;
  retry_count: number;
  review_count: number;
}

export interface AIEconomicsModel {
  cost_per_claim_usd: number;
  cost_per_claim_with_review_usd: number;
  /** Monthly cost at different scales */
  monthly_100_users_usd: number;
  monthly_1000_users_usd: number;
  monthly_5000_users_usd: number;
  monthly_14000_users_usd: number;
  /** AI calls per minute capacity */
  ai_capacity_per_minute: number;
  /** Max claims per day given AI limits */
  max_claims_per_day: number;
  /** First AI bottleneck */
  bottleneck: string;
}

// ---------------------------------------------------------------------------
// Default agent profiles (simulated, not real provider data)
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_PROFILES: AIAgentProfile[] = [
  {
    agent_type: "evidence",
    avg_tokens_in: 3_000,
    avg_tokens_out: 2_000,
    avg_latency_ms: 2_000,
    cost_per_1k_input_usd: 0.00015, // GPT-4o-mini-like
    cost_per_1k_output_usd: 0.0006,
    failure_rate: 0.02,
    retry_rate: 0.05,
    review_triggers: 0.05,
  },
  {
    agent_type: "gap_intelligence",
    avg_tokens_in: 4_000,
    avg_tokens_out: 1_500,
    avg_latency_ms: 1_500,
    cost_per_1k_input_usd: 0.00015,
    cost_per_1k_output_usd: 0.0006,
    failure_rate: 0.02,
    retry_rate: 0.03,
    review_triggers: 0.10,
  },
  {
    agent_type: "supplement_reasoning",
    avg_tokens_in: 5_000,
    avg_tokens_out: 2_500,
    avg_latency_ms: 3_000,
    cost_per_1k_input_usd: 0.0015, // GPT-4o-like
    cost_per_1k_output_usd: 0.006,
    failure_rate: 0.03,
    retry_rate: 0.05,
    review_triggers: 0.40, // high — this is the main review trigger
  },
  {
    agent_type: "qa",
    avg_tokens_in: 6_000,
    avg_tokens_out: 1_000,
    avg_latency_ms: 1_500,
    cost_per_1k_input_usd: 0.00015,
    cost_per_1k_output_usd: 0.0006,
    failure_rate: 0.01,
    retry_rate: 0.02,
    review_triggers: 0.15,
  },
];

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

export function runAIBenchmark(config: AIBenchmarkConfig): AIBenchmarkResult {
  const records: AICallRecord[] = [];
  const totalDurationMs = config.claimCount * config.agents.reduce((s, a) => s + a.avg_latency_ms, 0);

  let claimIdx = 0;
  for (let c = 0; c < config.claimCount; c++) {
    const claimId = `claim-${c}`;
    for (let seq = 0; seq < config.sequencesPerClaim; seq++) {
      for (const agent of config.agents) {
        // Vary tokens
        const tokensIn = Math.round(agent.avg_tokens_in * (0.7 + Math.random() * 0.6));
        const tokensOut = Math.round(agent.avg_tokens_out * (0.7 + Math.random() * 0.6));

        // Vary latency
        const latencyFactor = 0.5 + Math.random() * config.latencyVariance;
        const latencyMs = Math.round(agent.avg_latency_ms * latencyFactor);

        // Cost
        const costUsd = (tokensIn / 1000) * agent.cost_per_1k_input_usd
          + (tokensOut / 1000) * agent.cost_per_1k_output_usd;

        // Failure / retry
        const failed = Math.random() < agent.failure_rate;
        const retried = !failed && Math.random() < agent.retry_rate;
        const review = !failed && Math.random() < agent.review_triggers;

        records.push({
          claim_id: claimId,
          agent_type: agent.agent_type,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          latency_ms: latencyMs,
          cost_usd: costUsd,
          success: !failed,
          retried,
          review_triggered: review,
        });

        claimIdx++;
      }
    }
  }

  // Aggregate
  const totalTokensIn = records.reduce((s, r) => s + r.tokens_in, 0);
  const totalTokensOut = records.reduce((s, r) => s + r.tokens_out, 0);
  const totalCost = records.reduce((s, r) => s + r.cost_usd, 0);
  const latencies = records.map((r) => r.latency_ms).sort((a, b) => a - b);
  const failures = records.filter((r) => !r.success).length;
  const retries = records.filter((r) => r.retried).length;
  const reviews = records.filter((r) => r.review_triggered).length;

  // Per-agent breakdown
  const agentMap = new Map<string, AgentBreakdown>();
  for (const r of records) {
    let bd = agentMap.get(r.agent_type);
    if (!bd) {
      bd = {
        agent_type: r.agent_type,
        calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        avg_latency_ms: 0,
        failure_count: 0,
        retry_count: 0,
        review_count: 0,
      };
      agentMap.set(r.agent_type, bd);
    }
    bd.calls++;
    bd.tokens_in += r.tokens_in;
    bd.tokens_out += r.tokens_out;
    bd.cost_usd += r.cost_usd;
    bd.avg_latency_ms += r.latency_ms;
    if (!r.success) bd.failure_count++;
    if (r.retried) bd.retry_count++;
    if (r.review_triggered) bd.review_count++;
  }

  const agentBreakdown: AgentBreakdown[] = [];
  for (const bd of agentMap.values()) {
    bd.avg_latency_ms = bd.calls > 0 ? bd.avg_latency_ms / bd.calls : 0;
    agentBreakdown.push(bd);
  }

  // Per-claim metrics
  const callsPerClaim = config.claimCount > 0 ? records.length / config.claimCount : 0;
  const tokensPerClaim = config.claimCount > 0 ? (totalTokensIn + totalTokensOut) / config.claimCount : 0;
  const costPerClaim = config.claimCount > 0 ? totalCost / config.claimCount : 0;
  const latencyPerClaim = config.claimCount > 0 ? totalDurationMs / config.claimCount : 0;

  // Economics
  const avgJobsPerUserPerDay = 10;
  const economics = computeEconomics(costPerClaim, latencyPerClaim, callsPerClaim);

  return {
    total_claims: config.claimCount,
    total_ai_calls: records.length,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    total_cost_usd: totalCost,
    total_duration_ms: totalDurationMs,
    avg_latency_per_call_ms: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    p99_latency_ms: percentile(latencies, 99),
    calls_per_claim: callsPerClaim,
    tokens_per_claim: Math.round(tokensPerClaim),
    cost_per_claim_usd: costPerClaim,
    latency_per_claim_ms: latencyPerClaim,
    failure_rate_pct: records.length > 0 ? (failures / records.length) * 100 : 0,
    retry_rate_pct: records.length > 0 ? (retries / records.length) * 100 : 0,
    review_rate_pct: records.length > 0 ? (reviews / records.length) * 100 : 0,
    calls_per_minute: totalDurationMs > 0 ? (records.length / totalDurationMs) * 60_000 : 0,
    claims_per_minute: totalDurationMs > 0 ? (config.claimCount / totalDurationMs) * 60_000 : 0,
    economics,
    agent_breakdown: agentBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Economics model
// ---------------------------------------------------------------------------

function computeEconomics(
  costPerClaim: number,
  latencyPerClaimMs: number,
  callsPerClaim: number,
): AIEconomicsModel {
  const jobsPerUserPerDay = 10;

  // Monthly costs (30 days)
  const monthly100 = 100 * jobsPerUserPerDay * 30 * costPerClaim;
  const monthly1000 = 1_000 * jobsPerUserPerDay * 30 * costPerClaim;
  const monthly5000 = 5_000 * jobsPerUserPerDay * 30 * costPerClaim;
  const monthly14000 = 14_000 * jobsPerUserPerDay * 30 * costPerClaim;

  // AI capacity: based on per-call latency
  // One "slot" can handle 1 claim every latencyPerClaimMs
  // With 50 concurrent AI slots:
  const concurrentSlots = 50;
  const aiCapacityPerMinute = concurrentSlots * (60_000 / Math.max(1, latencyPerClaimMs));
  const maxClaimsPerDay = aiCapacityPerMinute * 60 * 24;

  // Bottleneck detection
  let bottleneck = "none";
  if (maxClaimsPerDay < 140_000) bottleneck = "ai_concurrency";
  if (monthly14000 > 5000) bottleneck = "ai_cost";

  return {
    cost_per_claim_usd: costPerClaim,
    cost_per_claim_with_review_usd: costPerClaim * 1.15, // reviews add ~15% overhead
    monthly_100_users_usd: monthly100,
    monthly_1000_users_usd: monthly1000,
    monthly_5000_users_usd: monthly5000,
    monthly_14000_users_usd: monthly14000,
    ai_capacity_per_minute: aiCapacityPerMinute,
    max_claims_per_day: maxClaimsPerDay,
    bottleneck,
  };
}
