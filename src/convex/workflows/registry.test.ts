import { describe, expect, it } from "vitest";
import {
  getWorkflowDefinition,
  ROADMAP_WORKFLOW_NOTES,
  WORKFLOW_REGISTRY,
} from "./registry";
import { validateWorkflowDefinition } from "./contract";
import { TOOL_BY_ID } from "../tools/registry";
import { EVENT_BY_TYPE } from "../events/registry";

const hasTool = (t: string) => !!TOOL_BY_ID[t];
// Only the real, connected event source is registered — roadmap connectors
// must NOT appear in any workflow's requirements.
const hasConnector = (c: string) => c === "google_drive";

describe("workflow registry completeness", () => {
  it("registers only real, runnable workflows", () => {
    expect(WORKFLOW_REGISTRY.length).toBeGreaterThanOrEqual(2);
  });

  it("every registered workflow passes definition validation", () => {
    for (const def of WORKFLOW_REGISTRY) {
      const r = validateWorkflowDefinition(def, { hasTool, hasConnector });
      expect(r, `${def.id}: ${r.ok ? "" : r.errors.join("; ")}`).toEqual({ ok: true });
    }
  });

  it("every workflow ends with an explicit complete step", () => {
    for (const def of WORKFLOW_REGISTRY) {
      expect(def.steps[def.steps.length - 1].type).toBe("complete");
    }
  });

  it("every workflow has unique step ids", () => {
    for (const def of WORKFLOW_REGISTRY) {
      const ids = def.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every trigger event type is a registered, implemented event", () => {
    for (const def of WORKFLOW_REGISTRY) {
      for (const t of def.trigger.eventTypes) {
        const evt = EVENT_BY_TYPE[t];
        expect(evt, `trigger ${t} not in the event registry`).toBeTruthy();
        expect(evt.implementationStatus).toBe("implemented");
      }
    }
  });

  it("every required tool exists in the tool registry", () => {
    for (const def of WORKFLOW_REGISTRY) {
      for (const t of def.requiredTools) {
        expect(TOOL_BY_ID[t], `${def.id} requires missing tool ${t}`).toBeTruthy();
      }
    }
  });

  it("every required connector is an actually-connected source (no fake automations)", () => {
    for (const def of WORKFLOW_REGISTRY) {
      for (const c of def.requiredConnectors) {
        expect(hasConnector(c), `${def.id} requires unimplemented connector ${c}`).toBe(true);
      }
    }
  });

  it("does not register roadmap automations as real workflows", () => {
    for (const note of ROADMAP_WORKFLOW_NOTES) {
      expect(getWorkflowDefinition(note.id)).toBeUndefined();
    }
    for (const def of WORKFLOW_REGISTRY) {
      expect(def.trigger.connector).toBe("google_drive");
    }
  });
});

describe("real workflow 1 — new document intelligence (read-oriented)", () => {
  const def = getWorkflowDefinition("drive.new_document_intelligence")!;
  it("is READ-risk and needs no approval", () => {
    expect(def.policies.riskLevel).toBe("READ");
    expect(def.policies.requiresApproval).toBe(false);
  });

  it("evaluates importance before acting and notifies", () => {
    const types = def.steps.map((s) => s.type);
    expect(types).toContain("retrieve");
    expect(types).toContain("decision");
    expect(types).toContain("condition");
    expect(types).toContain("action");
    expect(types).toContain("notify");
  });

  it("only uses READ tooling", () => {
    const toolIds = def.steps
      .filter((s) => s.type === "action")
      .map((s) => (s as { toolId: string }).toolId);
    for (const t of toolIds) {
      expect(TOOL_BY_ID[t].riskLevel).toBe("READ");
    }
  });
});

describe("real workflow 2 — reviewed document (closed loop)", () => {
  const def = getWorkflowDefinition("drive.review_updated_document")!;
  it("demonstrates event → decision → approval → action → notification", () => {
    const types = def.steps.map((s) => s.type);
    expect(types).toContain("retrieve");
    expect(types).toContain("decision");
    expect(types).toContain("approval");
    expect(types).toContain("action");
    expect(types).toContain("notify");
    const approvalIdx = types.indexOf("approval");
    const actionIdx = types.indexOf("action");
    expect(actionIdx).toBeGreaterThan(approvalIdx);
  });

  it("requires a manager approval and constrains its tools", () => {
    expect(def.policies.requiresApproval).toBe(true);
    expect(def.approvalRole).toBe("manager");
    const approvalStep = def.steps.find((s) => s.type === "approval");
    expect((approvalStep as { role?: string }).role).toBe("manager");
    expect(def.policies.allowedTools).toContain("drive.update_file");
  });

  it("uses only a reversible, low-risk write", () => {
    const action = def.steps.find((s) => s.type === "action") as { toolId: string };
    expect(action.toolId).toBe("drive.update_file");
    expect(TOOL_BY_ID[action.toolId].riskLevel).toBe("LOW_WRITE");
    expect(TOOL_BY_ID[action.toolId].confirmationPolicy).toBe("on_high_risk");
  });
});
