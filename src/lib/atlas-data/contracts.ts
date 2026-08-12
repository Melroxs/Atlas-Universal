// Shared contract types for the static registries (events, workflows).

export interface EventPayloadField {
  key: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface EventDefinition {
  id: string;
  type: string;
  provider: string;
  connector: string;
  description: string;
  version: string;
  source: string;
  payloadSchema?: { fields: EventPayloadField[] };
  requiredScopes?: string[];
  implementationStatus: string;
  sourceMechanism: "polling" | "webhook" | "manual";
  deduplicationStrategy?: string;
  handlerId?: string | null;
  documentationUrl?: string;
}

export type WorkflowStepType =
  | "retrieve"
  | "decision"
  | "condition"
  | "action"
  | "approval"
  | "wait"
  | "notify"
  | "update"
  | "complete";

export type ApprovalRole = "member" | "manager" | "owner";

export interface BaseStep {
  id: string;
  type: WorkflowStepType;
  storeKey?: string;
  source?: string;
  defaultNext?: string;
  rules?: Array<Record<string, unknown>>;
  condition?: Record<string, unknown>;
  then?: string;
  else?: string;
  toolId?: string;
  args?: Array<Record<string, unknown>>;
  requestedRole?: ApprovalRole;
  role?: string;
  expiresInMs?: number;
  severity?: string;
  title?: string;
  description?: string;
  fields?: Array<{ key: string; from?: string; path?: string; value?: unknown }>;
  consequences?: string | string[];
  reversibility?: string;
  expiresAfterMs?: number;
}

export interface WorkflowTrigger {
  eventTypes: string[];
  connector: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  industry: string;
  status: string;
  trigger: WorkflowTrigger;
  steps: BaseStep[];
  policies: {
    riskLevel: string;
    confirmation?: string;
    maxActions?: number;
    description?: string;
    requiresApproval?: boolean;
    allowedTools?: string[];
  };
  requiredConnectors?: string[];
  requiredTools?: string[];
  timeoutMs?: number;
  retryPolicy?: { maxAttempts?: number; baseMs?: number };
  createdBy?: string;
  updatedAt?: string;
  approvalRole?: string;
}
