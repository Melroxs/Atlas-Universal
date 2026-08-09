import { describe, expect, it } from "vitest";
import { resolveEventActionPolicy, type TenantEventPolicy } from "./policy";

const noPolicy = null;

function policy(overrides: Partial<TenantEventPolicy> = {}): TenantEventPolicy {
  return {
    tenantId: "t_1",
    eventType: "drive.file_updated",
    enabled: true,
    autoLowRiskWrite: false,
    ...overrides,
  };
}

describe("autonomous action safety ladder", () => {
  it("READ may execute automatically", () => {
    const d = resolveEventActionPolicy({
      riskLevel: "READ",
      toolId: "drive.get_file_metadata",
      policy: noPolicy,
    });
    expect(d.mode).toBe("auto");
  });

  it("LOW_WRITE requires approval unless the tenant opts in", () => {
    expect(
      resolveEventActionPolicy({ riskLevel: "LOW_WRITE", toolId: "drive.update_file", policy: noPolicy }).mode,
    ).toBe("confirm");
    expect(
      resolveEventActionPolicy({ riskLevel: "LOW_WRITE", toolId: "drive.update_file", policy: policy() }).mode,
    ).toBe("confirm");
  });

  it("LOW_WRITE may run automatically only with an explicit tenant opt-in", () => {
    const d = resolveEventActionPolicy({
      riskLevel: "LOW_WRITE",
      toolId: "drive.update_file",
      policy: policy({ autoLowRiskWrite: true }),
    });
    expect(d.mode).toBe("auto");
    expect(d.fromPolicy).toBe(true);
  });

  it("HIGH_WRITE always requires human approval", () => {
    for (const p of [noPolicy, policy(), policy({ autoLowRiskWrite: true })]) {
      const d = resolveEventActionPolicy({
        riskLevel: "HIGH_WRITE",
        toolId: "drive.move_file",
        policy: p,
      });
      expect(d.mode).toBe("confirm");
    }
  });

  it("IRREVERSIBLE always requires human approval — even with auto-writes on", () => {
    const d = resolveEventActionPolicy({
      riskLevel: "IRREVERSIBLE",
      toolId: "drive.delete_file",
      policy: policy({ autoLowRiskWrite: true }),
    });
    expect(d.mode).toBe("confirm");
  });

  it("a disabled event policy blocks action evaluation entirely", () => {
    const d = resolveEventActionPolicy({
      riskLevel: "READ",
      toolId: "drive.get_file_metadata",
      policy: policy({ enabled: false }),
    });
    expect(d.mode).toBe("blocked");
  });

  it("blocked tools are never executed", () => {
    const d = resolveEventActionPolicy({
      riskLevel: "READ",
      toolId: "drive.get_file_metadata",
      policy: policy({ blockedTools: ["drive.get_file_metadata"] }),
    });
    expect(d.mode).toBe("blocked");
  });

  it("allowed-tool lists restrict which tools may run", () => {
    expect(
      resolveEventActionPolicy({
        riskLevel: "READ",
        toolId: "drive.search_files",
        policy: policy({ allowedTools: ["drive.get_file_metadata"] }),
      }).mode,
    ).toBe("blocked");
    expect(
      resolveEventActionPolicy({
        riskLevel: "READ",
        toolId: "drive.get_file_metadata",
        policy: policy({ allowedTools: ["drive.get_file_metadata"] }),
      }).mode,
    ).toBe("auto");
  });

  it("a trusted connector NEVER bypasses confirmation", () => {
    // Even though the event originated from an authenticated connection,
    // high-risk actions still require a human.
    const d = resolveEventActionPolicy({
      riskLevel: "HIGH_WRITE",
      toolId: "drive.move_file",
      policy: policy({ autoLowRiskWrite: true, allowedTools: ["drive.move_file"] }),
    });
    expect(d.mode).toBe("confirm");
  });
});
