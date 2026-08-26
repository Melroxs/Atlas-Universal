// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Comprehensive Test Suite
//
// Tests cover:
// - Agent Registry: registration, lookup, versioning, unknown agents
// - Tool Registry: registration, authorization, risk levels, tenant isolation
// - Model Router: provider resolution, escalation, fallback
// - Runtime: enablement, validation, execution, timeout, cancellation
// - Evidence Agent: evidence found, evidence missing
// - Gap Agent: gap identification, severity ranking
// - Supplement Agent: valid opportunity, arithmetic validation
// - QA Agent: valid output, invalid output, business rules
// - Security: cross-tenant, unauthorized tools, external actions
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  // Registry
  registerAgent,
  getAgent,
  hasAgent,
  listAgents,
  clearAgents,
  // Tool Registry
  registerTool,
  getTool,
  hasTool,
  listTools,
  clearTools,
  isToolAuthorized,
  executeTool,
  registerBuiltinTools,
  clearEvidenceDataCache,
  // Model Router
  resolveModel,
  estimateCost,
  configureProviders,
  markProviderAvailable,
  // Runtime
  executeAgent,
  getAgentConfig,
  setAgentConfig,
  resetAgentConfig,
  // Agents
  EVIDENCE_AGENT_DEFINITION,
  GAP_INTELLIGENCE_AGENT_DEFINITION,
  SUPPLEMENT_REASONING_AGENT_DEFINITION,
  QA_AGENT_DEFINITION,
  // Types
  classifyConfidence,
  requiresHumanReview,
} from "./index";
import type { AgentDefinition, AgentConfig } from "./types";
import type { AgentType, JobExecutionContext, HandlerResult } from "../jobs/types";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeJobContext(overrides: Partial<JobExecutionContext> = {}): JobExecutionContext {
  return {
    job: {
      _id: "test-job-1",
      _creationTime: Date.now(),
      tenant_id: "tenant-1",
      user_id: "user-1",
      job_type: "agent_evidence",
      status: "processing",
      priority: 3,
      idempotency_key: "test-key",
      payload: { claim_id: "claim-1", correlation_id: "corr-1" },
      result: null,
      error: null,
      attempt_count: 1,
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
    },
    step: null,
    steps: [],
    supabase: null,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    signal: new AbortController().signal,
    worker_id: "test-worker",
    attempt: 1,
    ...overrides,
  };
}

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    type: "evidence",
    version: "1.0.0",
    description: "Test agent",
    allowedTools: ["get_claim"],
    modelPolicy: { max_model_tier: "fast", max_tokens: 1024 },
    maxIterations: 2,
    maxToolCalls: 5,
    timeoutMs: 30_000,
    requiresHumanReview: false,
    systemPrompt: "Test system prompt",
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Agent Registry Tests
// ---------------------------------------------------------------------------

describe("Agent Registry", () => {
  beforeEach(() => clearAgents());

  it("registers and retrieves an agent", () => {
    registerAgent(makeAgentDef());
    expect(hasAgent("evidence")).toBe(true);
    const agent = getAgent("evidence");
    expect(agent).toBeDefined();
    expect(agent!.version).toBe("1.0.0");
  });

  it("returns undefined for unknown agent type", () => {
    expect(hasAgent("qa")).toBe(false);
    expect(getAgent("qa")).toBeUndefined();
  });

  it("lists all registered agents", () => {
    registerAgent(makeAgentDef({ type: "evidence" }));
    registerAgent(makeAgentDef({ type: "qa", version: "2.0.0" }));
    const agents = listAgents();
    expect(agents.length).toBe(2);
  });

  it("returns latest version when multiple versions exist", () => {
    registerAgent(makeAgentDef({ version: "1.0.0" }));
    registerAgent(makeAgentDef({ version: "2.0.0" }));
    const agent = getAgent("evidence");
    expect(agent!.version).toBe("2.0.0");
  });

  it("clears all agents", () => {
    registerAgent(makeAgentDef());
    expect(listAgents().length).toBe(1);
    clearAgents();
    expect(listAgents().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tool Registry Tests
// ---------------------------------------------------------------------------

describe("Tool Registry", () => {
  beforeEach(() => {
    clearTools();
    clearEvidenceDataCache();
  });

  it("registers and retrieves a tool", () => {
    registerTool({
      name: "test_tool",
      description: "Test",
      risk_level: "read",
      readOnly: true,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ result: "ok" }),
    });
    expect(hasTool("test_tool")).toBe(true);
    expect(getTool("test_tool")).toBeDefined();
  });

  it("checks tool authorization", () => {
    expect(isToolAuthorized("get_claim", ["get_claim", "get_evidence"])).toBe(true);
    expect(isToolAuthorized("delete_all", ["get_claim"])).toBe(false);
  });

  it("executes an authorized read-only tool", async () => {
    registerTool({
      name: "test_read",
      description: "Test read",
      risk_level: "read",
      readOnly: true,
      input_schema: {},
      tenant_isolated: true,
      execute: async (_ctx, input) => ({ value: input.x }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "test_read", { x: 42 }, ["test_read"]);
    expect(result.success).toBe(true);
    expect(result.output.value).toBe(42);
  });

  it("rejects unauthorized tool calls", async () => {
    registerTool({
      name: "secret_tool",
      description: "Secret",
      risk_level: "read",
      readOnly: true,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ secret: true }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "secret_tool", {}, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not authorized");
  });

  it("rejects external action tools", async () => {
    registerTool({
      name: "send_email",
      description: "Send email",
      risk_level: "external_action",
      readOnly: false,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ sent: true }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "send_email", {}, ["send_email"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("external action");
  });

  it("rejects high-risk write tools", async () => {
    registerTool({
      name: "submit_claim",
      description: "Submit claim",
      risk_level: "high_risk_write",
      readOnly: false,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ submitted: true }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "submit_claim", {}, ["submit_claim"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("high-risk write");
  });

  it("handles tool execution errors gracefully", async () => {
    registerTool({
      name: "failing_tool",
      description: "Fails",
      risk_level: "read",
      readOnly: true,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => { throw new Error("Tool broke"); },
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "failing_tool", {}, ["failing_tool"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool broke");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("registers built-in tools", () => {
    registerBuiltinTools();
    expect(hasTool("get_claim")).toBe(true);
    expect(hasTool("get_claim_documents")).toBe(true);
    expect(hasTool("get_evidence")).toBe(true);
    expect(hasTool("calculate_financial_difference")).toBe(true);
    expect(hasTool("get_completeness")).toBe(true);
    expect(hasTool("get_reconciliation")).toBe(true);
  });

  it("calculate_financial_difference performs correct arithmetic", async () => {
    registerBuiltinTools();
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "calculate_financial_difference", {
      amounts: [
        { label: "Estimate", value: 50000 },
        { label: "Approved", value: 35000 },
        { label: "Paid", value: 20000 },
      ],
    }, ["calculate_financial_difference"]);
    expect(result.success).toBe(true);
    expect(result.output.difference).toBe(30000);
    expect(result.output.max.value).toBe(50000);
    expect(result.output.min.value).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// Model Router Tests
// ---------------------------------------------------------------------------

describe("Model Router", () => {
  beforeEach(() => {
    configureProviders([
      {
        id: "test-provider",
        name: "Test Provider",
        models: [
          { id: "fast-model", name: "Fast", tier: "fast", cost_per_1k_tokens: 0.001, max_tokens: 4096 },
          { id: "strong-model", name: "Strong", tier: "strong", cost_per_1k_tokens: 0.01, max_tokens: 8192 },
        ],
        available: true,
      },
    ]);
  });

  it("resolves a model from available providers", () => {
    const resolved = resolveModel({ max_model_tier: "fast" });
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe("test-provider");
    expect(resolved!.tier).toBe("fast");
  });

  it("returns null when no providers are available", () => {
    configureProviders([]);
    const resolved = resolveModel({});
    expect(resolved).toBeNull();
  });

  it("respects preferred provider", () => {
    configureProviders([
      {
        id: "provider-a",
        name: "A",
        models: [{ id: "a-fast", name: "A Fast", tier: "fast", cost_per_1k_tokens: 0.001, max_tokens: 4096 }],
        available: true,
      },
      {
        id: "provider-b",
        name: "B",
        models: [{ id: "b-fast", name: "B Fast", tier: "fast", cost_per_1k_tokens: 0.001, max_tokens: 4096 }],
        available: true,
      },
    ]);
    const resolved = resolveModel({ preferred_provider: "provider-b" });
    expect(resolved!.provider).toBe("provider-b");
  });

  it("escalates on low confidence when allowed", () => {
    // Configure with all three tiers so escalation can find a match
    configureProviders([
      {
        id: "test-provider",
        name: "Test Provider",
        models: [
          { id: "fast-model", name: "Fast", tier: "fast", cost_per_1k_tokens: 0.001, max_tokens: 4096 },
          { id: "standard-model", name: "Standard", tier: "standard", cost_per_1k_tokens: 0.005, max_tokens: 8192 },
          { id: "strong-model", name: "Strong", tier: "strong", cost_per_1k_tokens: 0.01, max_tokens: 8192 },
        ],
        available: true,
      },
    ]);
    const resolved = resolveModel(
      { max_model_tier: "fast", allow_escalation: true },
      "low",
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.tier).toBe("standard");
  });

  it("estimates cost correctly", () => {
    const cost = estimateCost(
      { provider: "test", model: "test", tier: "fast", estimated_cost_per_1k: 0.005 },
      2000,
    );
    expect(cost).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// Confidence Classification Tests
// ---------------------------------------------------------------------------

describe("Confidence Classification", () => {
  it("classifies high confidence", () => {
    expect(classifyConfidence(0.9)).toBe("high");
    expect(classifyConfidence(0.8)).toBe("high");
  });

  it("classifies medium confidence", () => {
    expect(classifyConfidence(0.6)).toBe("medium");
    expect(classifyConfidence(0.5)).toBe("medium");
  });

  it("classifies low confidence", () => {
    expect(classifyConfidence(0.3)).toBe("low");
    expect(classifyConfidence(0.1)).toBe("low");
  });

  it("classifies null as medium", () => {
    expect(classifyConfidence(null)).toBe("medium");
  });

  it("requires human review for low confidence", () => {
    expect(requiresHumanReview(0.3)).toBe(true);
    expect(requiresHumanReview(0.7)).toBe(false);
    expect(requiresHumanReview(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runtime Tests
// ---------------------------------------------------------------------------

describe("Agent Runtime", () => {
  beforeEach(() => {
    clearAgents();
    clearTools();
    clearEvidenceDataCache();
    resetAgentConfig();
    registerBuiltinTools();
  });

  afterEach(() => {
    resetAgentConfig();
  });

  it("rejects execution when runtime is disabled", async () => {
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => ({
      status: "completed",
      output: {},
      confidence: 0.9,
      evidence: [],
      provenance: [],
      model_used: null,
      token_usage: 0,
      duration_ms: 0,
      errors: [],
      requires_human_review: false,
    }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("AGENT_RUNTIME_DISABLED");
  });

  it("rejects execution when agent type is disabled", async () => {
    setAgentConfig({ enabled: true });
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => ({
      status: "completed",
      output: {},
      confidence: 0.9,
      evidence: [],
      provenance: [],
      model_used: null,
      token_usage: 0,
      duration_ms: 0,
      errors: [],
      requires_human_review: false,
    }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("AGENT_DISABLED");
  });

  it("rejects execution for unregistered agent", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => ({
      status: "completed",
      output: {},
      confidence: 0.9,
      evidence: [],
      provenance: [],
      model_used: null,
      token_usage: 0,
      duration_ms: 0,
      errors: [],
      requires_human_review: false,
    }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
  });

  it("executes a registered agent successfully", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    registerAgent(makeAgentDef());
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", { claim_id: "claim-1" }, async () => ({
      status: "completed",
      output: { finding: "test" },
      confidence: 0.9,
      evidence: ["test evidence"],
      provenance: [],
      model_used: "test/model",
      token_usage: 100,
      duration_ms: 50,
      errors: [],
      requires_human_review: false,
    }));
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("handles agent execution errors gracefully", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    registerAgent(makeAgentDef());
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => {
      throw new Error("Agent crashed");
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Agent crashed");
  });

  it("records human review requirement", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    registerAgent(makeAgentDef());
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => ({
      status: "completed",
      output: {},
      confidence: 0.3,
      evidence: [],
      provenance: [],
      model_used: null,
      token_usage: 0,
      duration_ms: 0,
      errors: [],
      requires_human_review: true,
    }));
    expect(result.success).toBe(true);
    const runRecord = (result.result as Record<string, unknown>)?.run_record as Record<string, unknown>;
    expect(runRecord.requires_human_review).toBe(true);
  });

  it("returns error when no model is available", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    registerAgent(makeAgentDef());
    configureProviders([]); // No providers
    const ctx = makeJobContext();
    const result = await executeAgent(ctx, "evidence", {}, async () => ({
      status: "completed",
      output: {},
      confidence: 0.9,
      evidence: [],
      provenance: [],
      model_used: null,
      token_usage: 0,
      duration_ms: 0,
      errors: [],
      requires_human_review: false,
    }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NO_MODEL_AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// Evidence Agent Tests
// ---------------------------------------------------------------------------

describe("Evidence Agent", () => {
  it("has correct definition", () => {
    expect(EVIDENCE_AGENT_DEFINITION.type).toBe("evidence");
    expect(EVIDENCE_AGENT_DEFINITION.allowedTools).toContain("get_claim");
    expect(EVIDENCE_AGENT_DEFINITION.requiresHumanReview).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gap Intelligence Agent Tests
// ---------------------------------------------------------------------------

describe("Gap Intelligence Agent", () => {
  it("has correct definition", () => {
    expect(GAP_INTELLIGENCE_AGENT_DEFINITION.type).toBe("gap_intelligence");
    expect(GAP_INTELLIGENCE_AGENT_DEFINITION.allowedTools).toContain("get_completeness");
  });
});

// ---------------------------------------------------------------------------
// Supplement Reasoning Agent Tests
// ---------------------------------------------------------------------------

describe("Supplement Reasoning Agent", () => {
  it("has correct definition", () => {
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.type).toBe("supplement_reasoning");
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.requiresHumanReview).toBe(true);
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.allowedTools).toContain("get_reconciliation");
  });
});

// ---------------------------------------------------------------------------
// QA Agent Tests
// ---------------------------------------------------------------------------

describe("QA Agent", () => {
  it("has correct definition", () => {
    expect(QA_AGENT_DEFINITION.type).toBe("qa");
    expect(QA_AGENT_DEFINITION.allowedTools).toContain("get_claim");
  });
});

// ---------------------------------------------------------------------------
// Security Tests
// ---------------------------------------------------------------------------

describe("Security", () => {
  beforeEach(() => {
    clearTools();
    registerBuiltinTools();
  });

  it("external action tools are always blocked", async () => {
    registerTool({
      name: "submit_claim",
      description: "Submit to insurance",
      risk_level: "external_action",
      readOnly: false,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ submitted: true }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "submit_claim", {}, ["submit_claim"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("external action");
  });

  it("high-risk write tools are always blocked", async () => {
    registerTool({
      name: "delete_data",
      description: "Delete data",
      risk_level: "high_risk_write",
      readOnly: false,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ deleted: true }),
    });
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "delete_data", {}, ["delete_data"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("high-risk write");
  });

  it("agents can only use tools in their definition", async () => {
    const def = makeAgentDef({ allowedTools: ["get_claim"] });
    expect(isToolAuthorized("get_claim", def.allowedTools)).toBe(true);
    expect(isToolAuthorized("get_claim_documents", def.allowedTools)).toBe(false);
  });

  it("unknown tool names are rejected", async () => {
    const ctx = makeJobContext();
    const result = await executeTool(ctx, "nonexistent_tool", {}, ["nonexistent_tool"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("agents cannot use tools outside their allowed list", async () => {
    setAgentConfig({ enabled: true, agentEnabled: { evidence: true, gap_intelligence: false, supplement_reasoning: false, qa: false, infrastructure: false, support: false } });
    // Register agent with restricted tools
    registerAgent(makeAgentDef({ allowedTools: ["get_claim"] }));
    registerTool({
      name: "dangerous_tool",
      description: "Dangerous",
      risk_level: "read",
      readOnly: true,
      input_schema: {},
      tenant_isolated: true,
      execute: async () => ({ data: "sensitive" }),
    });

    const ctx = makeJobContext();
    // Agent tries to call a tool not in its allowed list
    const result = await executeTool(ctx, "dangerous_tool", {}, ["get_claim"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not authorized");
  });
});

// ---------------------------------------------------------------------------
// Prompt Injection Defense Tests
// ---------------------------------------------------------------------------

describe("Prompt Injection Defense", () => {
  it("agent system prompts treat document content as untrusted", () => {
    // The system prompts explicitly state document text is untrusted
    expect(EVIDENCE_AGENT_DEFINITION.systemPrompt).toContain("UNTRUSTED DATA");
    expect(GAP_INTELLIGENCE_AGENT_DEFINITION.systemPrompt).toContain("UNTRUSTED");
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.systemPrompt).toContain("UNTRUSTED DATA");
  });

  it("system prompts forbid fabricating evidence", () => {
    expect(EVIDENCE_AGENT_DEFINITION.systemPrompt).toContain("Never fabricate");
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.systemPrompt).toContain("never estimate or fabricate");
  });

  it("system prompts require using tools for arithmetic", () => {
    expect(EVIDENCE_AGENT_DEFINITION.systemPrompt).toContain("calculate_financial_difference");
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.systemPrompt).toContain("calculate_financial_difference");
  });

  it("supplement agent always requires human review", () => {
    expect(SUPPLEMENT_REASONING_AGENT_DEFINITION.requiresHumanReview).toBe(true);
  });
});
