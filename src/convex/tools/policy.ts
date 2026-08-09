// ---------------------------------------------------------------------------
// Risk & Confirmation Engine
//
// Centralized policy — confirmation logic NEVER lives inside UI components or
// individual tools. Extensible by escalation rules (industry/tenant policy can
// add more later); the execution service is the only consumer.
// ---------------------------------------------------------------------------

import type { RiskLevel, ToolDefinition } from "./registry";

export interface RiskEvaluation {
  riskLevel: RiskLevel;
  confirmationRequired: boolean;
  /** Why confirmation is (or isn't) required — surfaced in the UI. */
  policyReason: string;
}

/**
 * Risk escalation rules keyed by tool id. Return a higher risk level than the
 * tool's base level when specific inputs make an operation more consequential.
 * Industry packs can register additional rules later.
 */
const ESCALATION_RULES: Record<string, (input: Record<string, unknown>) => RiskLevel | null> = {
  // Overwriting a file's content is more consequential than renaming it.
  "drive.update_file": (input) => (input.content !== undefined ? "HIGH_WRITE" : null),
};

const CONFIRMATION_DEFAULTS = {
  READ: false,
  LOW_WRITE: false,
  HIGH_WRITE: true,
  IRREVERSIBLE: true,
} as const;

/** Evaluate risk + confirmation need for a tool with given (validated) input. */
export function evaluateRisk(
  tool: ToolDefinition,
  input: Record<string, unknown>,
): RiskEvaluation {
  const rule = ESCALATION_RULES[tool.id];
  const riskLevel = rule?.(input) ?? tool.riskLevel;

  let confirmationRequired: boolean;
  let policyReason: string;
  if (tool.confirmationPolicy === "always") {
    confirmationRequired = true;
    policyReason = "This tool always requires explicit confirmation.";
  } else if (tool.confirmationPolicy === "never") {
    confirmationRequired = false;
    policyReason = "Read-only — no confirmation required.";
  } else {
    confirmationRequired = CONFIRMATION_DEFAULTS[riskLevel];
    policyReason =
      riskLevel === "HIGH_WRITE" || riskLevel === "IRREVERSIBLE"
        ? "This action changes an external system and requires explicit approval."
        : "Low-risk change — executes automatically and is fully audited.";
  }

  return { riskLevel, confirmationRequired, policyReason };
}

// ---------------------------------------------------------------------------
// Descriptive confirmation model (never a vague "are you sure?")
// ---------------------------------------------------------------------------

export interface ConfirmationDetails {
  toolId: string;
  message: string;
  what: string;
  system: string;
  account: string;
  resource: string;
  consequences: string[];
  reversible: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
};

const CONSEQUENCES: Record<string, string[]> = {
  "drive.create_file": [
    "A new file appears in the connected Google Drive account.",
    "The file is visible to anyone with access to that location.",
  ],
  "drive.update_file": [
    "The existing file is modified in the connected Google Drive account.",
    "Previous name/description/content may be lost unless another copy exists.",
  ],
  "drive.move_file": [
    "The file's location changes for everyone who shares the Drive.",
    "Links and references pointing to the old folder may break.",
  ],
  "drive.delete_file": [
    "The file is moved to Google Drive trash and disappears from normal views immediately.",
    "It remains recoverable from trash for ~30 days, then is permanently deleted.",
  ],
};

const REVERSIBLE: Record<string, boolean> = {
  "drive.create_file": true,
  "drive.update_file": false,
  "drive.move_file": true,
  "drive.delete_file": true, // trashed, not permanently deleted
};

/** Build a descriptive, honest confirmation for the actor to review. */
export function buildConfirmation(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  account: string | undefined,
): ConfirmationDetails {
  const system = tool.provider
    ? PROVIDER_LABELS[tool.provider] ?? tool.provider
    : "Atlas workspace";
  const resource = describeResource(tool.id, input);
  const what = `${tool.name}: ${resource}.`;

  return {
    toolId: tool.id,
    message: `Atlas found everything it needs and prepared the requested change. ${what} This modifies ${system} using the connected account${account ? ` (${account})` : ""}. Do you want to proceed?`,
    what,
    system,
    account: account ?? "the connected account",
    resource,
    consequences: CONSEQUENCES[tool.id] ?? [
      "The underlying external system is modified.",
    ],
    reversible: REVERSIBLE[tool.id] ?? true,
  };
}

function describeResource(
  toolId: string,
  input: Record<string, unknown>,
): string {
  const fileId = typeof input.fileId === "string" ? input.fileId : null;
  const name = typeof input.name === "string" ? input.name : null;
  switch (toolId) {
    case "drive.create_file":
      return `create file${name ? ` “${name}”` : ""}${typeof input.parentId === "string" ? ` in folder ${input.parentId}` : " in My Drive"}`;
    case "drive.update_file":
      return `update file${fileId ? ` ${fileId}` : ""}${name ? ` (new name “${name}”)` : ""}${input.content !== undefined ? " and overwrite its content" : ""}`;
    case "drive.move_file":
      return `move file${fileId ? ` ${fileId}` : ""} to folder ${String(input.destinationFolderId ?? "?")}`;
    case "drive.delete_file":
      return `move file${fileId ? ` ${fileId}` : ""} to trash`;
    default:
      return `perform the requested operation`;
  }
}
