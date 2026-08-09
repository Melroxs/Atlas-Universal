import { describe, expect, it } from "vitest";
import {
  buildDriveKnowledgePlan,
  classifyDriveChange,
  driveChangeToEnvelope,
  formatDriveEventTitle,
  recommendDriveTool,
  type DriveChange,
} from "./drive";
import { getEventDefinition } from "./registry";

const change = (overrides: Partial<DriveChange> = {}): DriveChange => ({
  changeId: "change_1",
  type: "file",
  fileId: "file_1",
  time: "2026-01-01T00:00:00.000Z",
  removed: false,
  file: { id: "file_1", name: "a.pdf", mimeType: "application/pdf", parents: ["root"], trashed: false },
  ...overrides,
});

describe("drive change classification", () => {
  it("classifies a removed file as deleted", () => {
    expect(classifyDriveChange(change({ removed: true, file: null }), { exists: true })).toBe("file_deleted");
    expect(classifyDriveChange(change({ file: { id: "file_1", trashed: true } }), { exists: true })).toBe("file_deleted");
  });

  it("classifies a never-seen file as created", () => {
    expect(classifyDriveChange(change(), { exists: false })).toBe("file_created");
  });

  it("classifies parent changes as moved", () => {
    expect(
      classifyDriveChange(
        change({ file: { id: "file_1", name: "a.pdf", parents: ["folder_b"] } }),
        { exists: true, parents: ["folder_a"] },
      ),
    ).toBe("file_moved");
  });

  it("classifies permission changes", () => {
    expect(
      classifyDriveChange(
        change({ file: { id: "file_1", permissionIds: ["p2"] } }),
        { exists: true, permissionIds: ["p1"] },
      ),
    ).toBe("permission_changed");
  });

  it("classifies plain changes as updated", () => {
    expect(
      classifyDriveChange(
        change({ file: { id: "file_1", name: "a.pdf", parents: ["root"] } }),
        { exists: true, parents: ["root"] },
      ),
    ).toBe("file_updated");
  });
});

describe("drive change → envelope", () => {
  it("builds a normalized envelope with a provider idempotency key", () => {
    const env = driveChangeToEnvelope({
      connectionId: "conn_1",
      tenantId: "tenant_1",
      change: change(),
      kind: "file_created",
      prior: { exists: false },
      def: getEventDefinition("drive.file_created")!,
    });
    expect(env).not.toBeNull();
    expect(env!.eventType).toBe("drive.file_created");
    expect(env!.tenantId).toBe("tenant_1");
    expect(env!.idempotencyKey).toContain("change_1");
    expect(env!.sourceMechanism).toBe("polling");
  });

  it("never includes provider secrets in the payload", () => {
    const raw = change({
      file: {
        id: "file_1",
        name: "a.pdf",
        parents: ["root"],
        // @ts-expect-error — simulate a provider body that echoes credentials
        access_token: "LEAK",
      },
    });
    const env = driveChangeToEnvelope({
      connectionId: "conn_1",
      tenantId: "tenant_1",
      change: raw,
      kind: "file_updated",
      prior: { exists: true, parents: ["root"] },
      def: getEventDefinition("drive.file_updated")!,
    });
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain("LEAK");
    expect(serialized).not.toContain("access_token");
  });

  it("the same change always produces the same envelope id", () => {
    const opts = {
      connectionId: "conn_1",
      tenantId: "tenant_1",
      change: change(),
      kind: "file_updated" as const,
      prior: { exists: true, parents: ["root"] },
      def: getEventDefinition("drive.file_updated")!,
    };
    const a = driveChangeToEnvelope(opts)!;
    const b = driveChangeToEnvelope(opts)!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe("knowledge plans", () => {
  it("a created file is ingested; an updated known file is re-synced", () => {
    expect(buildDriveKnowledgePlan("drive.file_created", false).kind).toBe("sync");
    expect(buildDriveKnowledgePlan("drive.file_updated", true).kind).toBe("resync");
    expect(buildDriveKnowledgePlan("drive.file_updated", false).kind).toBe("sync");
  });

  it("deletion never destroys provenance — it flags the source record", () => {
    const plan = buildDriveKnowledgePlan("drive.file_deleted", true);
    expect(plan.kind).toBe("remove_marker");
    expect(plan.description.toLowerCase()).toContain("retained");
  });

  it("moves and permission changes are metadata-only", () => {
    expect(buildDriveKnowledgePlan("drive.file_moved", true).kind).toBe("metadata");
    expect(buildDriveKnowledgePlan("drive.permission_changed", true).kind).toBe("metadata");
  });
});

describe("recommended verification tool", () => {
  it("recommends a READ verification for created/updated/moved files", () => {
    for (const t of ["drive.file_created", "drive.file_updated", "drive.file_moved"]) {
      const rec = recommendDriveTool(t, { fileId: "file_1" });
      expect(rec?.toolId).toBe("drive.get_file_metadata");
    }
  });

  it("does not recommend actions for deletions or permission changes", () => {
    expect(recommendDriveTool("drive.file_deleted", { fileId: "file_1" })).toBeNull();
    expect(recommendDriveTool("drive.permission_changed", { fileId: "file_1" })).toBeNull();
  });

  it("requires a fileId", () => {
    expect(recommendDriveTool("drive.file_updated", {})).toBeNull();
  });
});

describe("human-readable titles", () => {
  it("formats titles with the file name", () => {
    expect(formatDriveEventTitle("drive.file_created", { name: "q3.pdf" })).toContain("q3.pdf");
    expect(formatDriveEventTitle("drive.file_deleted", { name: "old.pdf" })).toContain("removed");
  });
});
