// ---------------------------------------------------------------------------
// Registry completeness — the universal tool contract must be self-consistent.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { RISK_LABELS, TOOL_BY_ID, TOOL_REGISTRY } from "./registry";

const RISK_LEVELS = ["READ", "LOW_WRITE", "HIGH_WRITE", "IRREVERSIBLE"] as const;
const CONFIRMATION_POLICIES = ["never", "on_high_risk", "always"] as const;
const IMPLEMENTATION_STATUSES = ["implemented", "planned"] as const;
const FIELD_TYPES = ["string", "number", "boolean", "enum"] as const;
const CATEGORIES = ["search", "document", "metadata", "write", "admin"] as const;

describe("tool registry", () => {
  it("has a non-empty catalog with globally unique tool ids", () => {
    expect(TOOL_REGISTRY.length).toBeGreaterThan(0);
    const ids = TOOL_REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the '<provider>.<verb>' id convention", () => {
    for (const t of TOOL_REGISTRY) {
      expect(t.id, t.id).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
    }
  });

  it("only uses declared enums for risk, confirmation, implementation and category", () => {
    for (const t of TOOL_REGISTRY) {
      expect(RISK_LEVELS, t.id).toContain(t.riskLevel);
      expect(CONFIRMATION_POLICIES, t.id).toContain(t.confirmationPolicy);
      expect(IMPLEMENTATION_STATUSES, t.id).toContain(t.implementationStatus);
      expect(CATEGORIES, t.id).toContain(t.category);
    }
  });

  it("declares the required scopes for every provider-backed tool", () => {
    for (const t of TOOL_REGISTRY) {
      if (t.authRequirements.provider) {
        expect(t.requiredScopes.length, t.id).toBeGreaterThan(0);
        expect(t.authRequirements.minRole, t.id).toMatch(/^(member|manager)$/);
      } else {
        expect(t.requiredScopes.length, t.id).toBe(0);
      }
    }
  });

  it("defines schema fields with unique keys and valid types", () => {
    for (const t of TOOL_REGISTRY) {
      const keys = t.inputSchema.fields.map((f) => f.key);
      expect(new Set(keys).size, t.id).toBe(keys.length);
      for (const f of t.inputSchema.fields) {
        expect(FIELD_TYPES, `${t.id}.${f.key}`).toContain(f.type);
        expect(f.description.length, `${t.id}.${f.key}`).toBeGreaterThan(0);
        if (f.type === "enum") {
          expect(f.enum?.length ?? 0, `${t.id}.${f.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("builds TOOL_BY_ID from the same catalog (no orphans)", () => {
    expect(Object.keys(TOOL_BY_ID).length).toBe(TOOL_REGISTRY.length);
    for (const t of TOOL_REGISTRY) {
      expect(TOOL_BY_ID[t.id]).toBe(t);
    }
  });

  it("labels every risk level for the UI", () => {
    for (const level of RISK_LEVELS) {
      expect(RISK_LABELS[level], level).toBeTruthy();
    }
  });

  it("only marks truly implemented tools as implemented", () => {
    for (const t of TOOL_REGISTRY) {
      if (t.implementationStatus === "implemented") {
        expect(t.id.startsWith("drive."), t.id).toBe(true);
      }
    }
  });
});
