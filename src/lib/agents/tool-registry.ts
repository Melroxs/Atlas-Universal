// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Tool Registry
//
// Central registry for agent tools. Tools are explicitly registered and
// authorized. Agents can only use tools declared in their definition.
// Tools are categorized by risk level and enforce tenant isolation.
// ---------------------------------------------------------------------------

import type {
  ToolDefinition,
  ToolRiskLevel,
} from "./types";
import type { JobExecutionContext, HandlerResult } from "../jobs/types";
import { loadEvidenceData, type EvidenceData } from "../jobs/evidence-data-loader";

// ---------------------------------------------------------------------------
// Tool execution function signature
// ---------------------------------------------------------------------------

export type ToolExecutor = (
  ctx: JobExecutionContext,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Registered tool with its executor
// ---------------------------------------------------------------------------

export interface RegisteredTool extends ToolDefinition {
  execute: ToolExecutor;
}

// ---------------------------------------------------------------------------
// Tool Registry singleton
// ---------------------------------------------------------------------------

const _tools = new Map<string, RegisteredTool>();

export function registerTool(tool: ToolDefinition & { execute: ToolExecutor }): void {
  _tools.set(tool.name, { ...tool });
}

export function registerTools(
  tools: Array<ToolDefinition & { execute: ToolExecutor }>,
): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

export function getTool(name: string): RegisteredTool | undefined {
  return _tools.get(name);
}

export function hasTool(name: string): boolean {
  return _tools.has(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(_tools.values()).map(({ execute: _, ...def }) => def);
}

export function clearTools(): void {
  _tools.clear();
}

// ---------------------------------------------------------------------------
// Tool authorization
// ---------------------------------------------------------------------------

export function isToolAuthorized(
  toolName: string,
  allowedTools: string[],
): boolean {
  return allowedTools.includes(toolName);
}

export function getUnauthorizedTools(
  requestedTools: string[],
  allowedTools: string[],
): string[] {
  return requestedTools.filter((t) => !allowedTools.includes(t));
}

// ---------------------------------------------------------------------------
// Tool execution with authorization + audit
// ---------------------------------------------------------------------------

export async function executeTool(
  ctx: JobExecutionContext,
  toolName: string,
  input: Record<string, unknown>,
  allowedTools: string[],
): Promise<{
  output: Record<string, unknown>;
  success: boolean;
  error?: string;
  duration_ms: number;
}> {
  const start = Date.now();

  // 1. Check tool exists
  const tool = _tools.get(toolName);
  if (!tool) {
    return {
      output: {},
      success: false,
      error: `Tool '${toolName}' not found in registry`,
      duration_ms: Date.now() - start,
    };
  }

  // 2. Check authorization
  if (!isToolAuthorized(toolName, allowedTools)) {
    return {
      output: {},
      success: false,
      error: `Tool '${toolName}' not authorized for this agent`,
      duration_ms: Date.now() - start,
    };
  }

  // 3. Check risk level — block external actions and high-risk writes
  if (tool.risk_level === "external_action") {
    return {
      output: {},
      success: false,
      error: `Tool '${toolName}' is an external action and requires human approval`,
      duration_ms: Date.now() - start,
    };
  }

  if (tool.risk_level === "high_risk_write") {
    return {
      output: {},
      success: false,
      error: `Tool '${toolName}' is a high-risk write and requires human approval`,
      duration_ms: Date.now() - start,
    };
  }

  // 4. Execute with error handling
  try {
    const output = await tool.execute(ctx, input);
    return {
      output,
      success: true,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      output: {},
      success: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
      duration_ms: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in Atlas tools — read-only data access tools
// ---------------------------------------------------------------------------

/** Helper: create a read-only tool definition. */
function readOnlyTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  executor: ToolExecutor,
): ToolDefinition & { execute: ToolExecutor } {
  return {
    name,
    description,
    risk_level: "read",
    readOnly: true,
    input_schema: inputSchema,
    tenant_isolated: true,
    execute: executor,
  };
}

/** Cache for evidence data within a single pipeline execution. */
const _evidenceDataCache = new Map<string, EvidenceData>();

function getEvidenceData(
  ctx: JobExecutionContext,
  tenantId: string,
  claimId: string | null,
): Promise<EvidenceData> {
  const cacheKey = `${tenantId}:${claimId ?? "none"}`;
  const cached = _evidenceDataCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  return loadEvidenceData(tenantId, claimId).then((data) => {
    _evidenceDataCache.set(cacheKey, data);
    return data;
  });
}

export function clearEvidenceDataCache(): void {
  _evidenceDataCache.clear();
}

// ---------------------------------------------------------------------------
// Tool: get_claim — retrieve claim details
// ---------------------------------------------------------------------------

const getClaimTool = readOnlyTool(
  "get_claim",
  "Retrieve claim details for the current pipeline context",
  {
    type: "object",
    properties: {
      claim_id: { type: "string", description: "Claim ID to retrieve" },
    },
  },
  async (ctx, input) => {
    const claimId = (input.claim_id as string) || (ctx.job.payload as Record<string, unknown>)?.claim_id as string;
    if (!claimId) return { claim: null, error: "No claim_id provided" };
    const data = await getEvidenceData(
      ctx,
      ctx.job.tenant_id,
      claimId,
    );
    return {
      claim: data.claimPackage?.claim ?? null,
      claim_snapshot: data.claimSnapshot,
      supplements: data.claimPackage?.supplements ?? [],
      findings: data.claimPackage?.findings ?? [],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_claim_documents — retrieve documents for a claim
// ---------------------------------------------------------------------------

const getClaimDocumentsTool = readOnlyTool(
  "get_claim_documents",
  "Retrieve all evidence documents linked to the current claim",
  {
    type: "object",
    properties: {
      claim_id: { type: "string", description: "Claim ID" },
    },
  },
  async (ctx, input) => {
    const claimId = (input.claim_id as string) || (ctx.job.payload as Record<string, unknown>)?.claim_id as string;
    const data = await getEvidenceData(
      ctx,
      ctx.job.tenant_id,
      claimId ?? null,
    );
    return {
      documents: data.claimPackage?.evidenceDocs ?? [],
      tenant_documents: data.documents,
      document_count:
        (data.claimPackage?.evidenceDocs?.length ?? 0) +
        data.documents.length,
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_evidence — retrieve evidence graph data
// ---------------------------------------------------------------------------

const getEvidenceTool = readOnlyTool(
  "get_evidence",
  "Retrieve evidence data including findings, completeness, and reconciliation",
  {
    type: "object",
    properties: {
      claim_id: { type: "string", description: "Claim ID" },
    },
  },
  async (ctx, input) => {
    const claimId = (input.claim_id as string) || (ctx.job.payload as Record<string, unknown>)?.claim_id as string;
    const data = await getEvidenceData(
      ctx,
      ctx.job.tenant_id,
      claimId ?? null,
    );
    return {
      claim_snapshot: data.claimSnapshot,
      findings: data.claimPackage?.findings ?? [],
      documents: data.claimPackage?.evidenceDocs ?? [],
      evidence_summary: data.claimSnapshot?.evidenceSummary ?? [],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: calculate_financial_difference — deterministic arithmetic
// ---------------------------------------------------------------------------

const calculateFinancialTool = readOnlyTool(
  "calculate_financial_difference",
  "Calculate financial differences between amounts. Always use this for arithmetic — never let the model estimate dollar amounts.",
  {
    type: "object",
    properties: {
      amounts: {
        type: "array",
        items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } } },
        description: "Array of labeled amounts to compare",
      },
    },
    required: ["amounts"],
  },
  async (_ctx, input) => {
    const amounts = (input.amounts as Array<{ label: string; value: number }>) ?? [];
    if (amounts.length === 0) return { differences: [], total: 0 };

    const max = amounts.reduce((a, b) => (a.value > b.value ? a : b), amounts[0]);
    const min = amounts.reduce((a, b) => (a.value < b.value ? a : b), amounts[0]);
    const total = amounts.reduce((sum, a) => sum + a.value, 0);
    const difference = max.value - min.value;

    return {
      max: { label: max.label, value: max.value },
      min: { label: min.label, value: min.value },
      difference,
      difference_formatted: `$${difference.toLocaleString()}`,
      total,
      total_formatted: `$${total.toLocaleString()}`,
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_completeness — claim completeness analysis
// ---------------------------------------------------------------------------

const getCompletenessTool = readOnlyTool(
  "get_completeness",
  "Get the completeness analysis for a claim — what evidence categories exist, what's missing",
  {
    type: "object",
    properties: {
      claim_id: { type: "string", description: "Claim ID" },
    },
  },
  async (ctx, input) => {
    const claimId = (input.claim_id as string) || (ctx.job.payload as Record<string, unknown>)?.claim_id as string;
    const data = await getEvidenceData(
      ctx,
      ctx.job.tenant_id,
      claimId ?? null,
    );
    if (!data.claimSnapshot) {
      return { completeness: null, error: "No claim data available" };
    }
    const { analyzeClaimCompleteness } = await import("@/lib/insurance/logic");
    const completeness = analyzeClaimCompleteness(data.claimSnapshot);
    return { completeness };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_reconciliation — claim financial reconciliation
// ---------------------------------------------------------------------------

const getReconciliationTool = readOnlyTool(
  "get_reconciliation",
  "Get financial reconciliation for a claim — paid, outstanding, discrepancies",
  {
    type: "object",
    properties: {
      claim_id: { type: "string", description: "Claim ID" },
    },
  },
  async (ctx, input) => {
    const claimId = (input.claim_id as string) || (ctx.job.payload as Record<string, unknown>)?.claim_id as string;
    const data = await getEvidenceData(
      ctx,
      ctx.job.tenant_id,
      claimId ?? null,
    );
    if (!data.claimSnapshot) {
      return { reconciliation: null, error: "No claim data available" };
    }
    const { reconcileClaim } = await import("@/lib/insurance/logic");
    const reconciliation = reconcileClaim(
      data.claimSnapshot,
      data.claimPackage?.supplements ?? [],
    );
    return { reconciliation };
  },
);

// ---------------------------------------------------------------------------
// Register all built-in tools
// ---------------------------------------------------------------------------

export function registerBuiltinTools(): void {
  registerTools([
    getClaimTool,
    getClaimDocumentsTool,
    getEvidenceTool,
    calculateFinancialTool,
    getCompletenessTool,
    getReconciliationTool,
  ]);
}
