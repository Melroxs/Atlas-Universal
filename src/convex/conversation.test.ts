// ---------------------------------------------------------------------------
// Phase 10 — Conversational Voice OS · orchestration unit tests.
// Covers intent classification, temporal understanding, selection/confirmation
// resolution, spoken rendering, memory honesty and tenant isolation.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  canAccessSession,
  classifyIntent,
  memoryConflictNote,
  resolveSelection,
  resolveTemporalWindow,
  spokenFor,
  type PendingState,
} from "./conversation";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

describe("classifyIntent", () => {
  it("greeting", () => {
    expect(classifyIntent("Hi Atlas").intent).toBe("greeting");
    expect(classifyIntent("Good morning").intent).toBe("greeting");
  });

  it("confirmation only when something is pending", () => {
    const pending: PendingState = { kind: "confirm_action", title: "Send invoice", plan: null };
    expect(classifyIntent("yes", { pending }).intent).toBe("confirmation");
    expect(classifyIntent("go ahead", { pending }).intent).toBe("confirmation");
    // Without pending, "yes" is not a confirmation — it routes normally.
    expect(classifyIntent("yes").intent).not.toBe("confirmation");
  });

  it("cancellation only when something is pending", () => {
    const pending: PendingState = { kind: "confirm_workflow", workflow: { definitionId: "w", name: "Review" } };
    expect(classifyIntent("no, cancel", { pending }).intent).toBe("cancellation");
    expect(classifyIntent("never mind", { pending }).intent).toBe("cancellation");
    expect(classifyIntent("no").intent).not.toBe("cancellation");
  });

  it("selection while clarifying", () => {
    const pending: PendingState = {
      kind: "clarify_entity",
      question: "why is the project stuck",
      options: [{ id: "a", label: "Johnson on Main" }, { id: "b", label: "Johnson on 5th" }],
    };
    expect(classifyIntent("the second one", { pending }).intent).toBe("selection");
    expect(classifyIntent("option 1", { pending }).intent).toBe("selection");
  });

  it("workflow request", () => {
    expect(classifyIntent("Start the document review workflow").intent).toBe("workflow");
    expect(classifyIntent("Begin the approval process for this file").intent).toBe("workflow");
  });

  it("organizational questions", () => {
    for (const q of [
      "What's going on in the business?",
      "What changed today?",
      "What needs my attention?",
      "What's waiting on me?",
      "What did Atlas do?",
      "What should I worry about?",
      "What happened this week?",
    ]) {
      expect(classifyIntent(q).intent, q).toBe("organizational");
    }
  });

  it("investigative questions", () => {
    expect(classifyIntent("Why hasn't the Johnson project moved forward?").intent).toBe("investigative");
    expect(classifyIntent("What went wrong with that workflow?").intent).toBe("investigative");
    expect(classifyIntent("What's blocking the invoice?").intent).toBe("investigative");
  });

  it("action requests", () => {
    expect(classifyIntent("Send the invoice to the customer").intent).toBe("action");
    expect(classifyIntent("Create a follow-up task").intent).toBe("action");
    expect(classifyIntent("Approve the change request").intent).toBe("action");
  });

  it("regulatory questions route through the existing classifier", () => {
    expect(classifyIntent("What regulation applies here?").intent).toBe("regulatory");
    expect(classifyIntent("Does this work require a permit?").intent).toBe("regulatory");
    expect(classifyIntent("What does the law say about our liability?").intent).toBe("regulatory");
  });

  it("informational fallback", () => {
    expect(classifyIntent("Who are our largest customers?").intent).toBe("informational");
  });

  it("unclear for empty input", () => {
    expect(classifyIntent("").intent).toBe("unclear");
  });
});

describe("resolveTemporalWindow", () => {
  // Monday 2026-08-10 15:30 UTC
  const now = Date.UTC(2026, 7, 10, 15, 30, 0);

  it("today resolves to the org-timezone day", () => {
    const [w] = resolveTemporalWindow("What changed today?", now, "UTC");
    expect(w.label).toBe("today");
    expect(w.from).toBe(Date.UTC(2026, 7, 10, 0, 0, 0));
    expect(w.to - w.from).toBe(DAY - 1);
  });

  it("yesterday resolves to the previous day", () => {
    const [w] = resolveTemporalWindow("What happened yesterday?", now, "UTC");
    expect(w.from).toBe(Date.UTC(2026, 7, 9, 0, 0, 0));
    expect(w.to).toBe(Date.UTC(2026, 7, 9, 23, 59, 59, 999));
  });

  it("this week starts on Monday", () => {
    const [w] = resolveTemporalWindow("This week", now, "UTC");
    expect(w.label).toBe("this week");
    expect(new Date(w.from).getUTCDay()).toBe(1); // Monday
    expect(w.to - w.from + 1).toBe(7 * DAY);
  });

  it("last week precedes this week", () => {
    const [thisWeek] = resolveTemporalWindow("this week", now, "UTC");
    const [lastWeek] = resolveTemporalWindow("last week", now, "UTC");
    expect(lastWeek.to).toBe(thisWeek!.from - 1);
  });

  it("by friday extends to end of Friday", () => {
    const [w] = resolveTemporalWindow("by friday", now, "UTC");
    expect(w.label).toBe("by friday");
    expect(w.from).toBe(now);
    expect(new Date(w.to).getUTCDay()).toBe(5); // Friday
  });

  it("next business day skips the weekend", () => {
    // Saturday 2026-08-15 10:00 UTC
    const saturday = Date.UTC(2026, 7, 15, 10, 0, 0);
    const [w] = resolveTemporalWindow("next business day", saturday, "UTC");
    expect(new Date(w.from).getUTCDay()).toBe(1); // Monday
  });

  it("respects the organization timezone", () => {
    // 2026-08-10 23:30 UTC = 2026-08-10 19:30 New York (EDT) → same day
    const late = Date.UTC(2026, 7, 10, 23, 30, 0);
    const [utc] = resolveTemporalWindow("today", late, "UTC");
    const [ny] = resolveTemporalWindow("today", late, "America/New_York");
    expect(ny.from).toBe(utc.from); // still Monday in NY at 19:30
  });

  it("returns an empty array when no temporal phrase is present", () => {
    expect(resolveTemporalWindow("Who are our customers?", now, "UTC")).toEqual([]);
  });
});

describe("resolveSelection", () => {
  const options = ["Johnson on Main", "Johnson on 5th", "Johnson Holdings"];

  it("ordinals", () => {
    expect(resolveSelection("the second one", options)).toBe(1);
    expect(resolveSelection("the first one", options)).toBe(0);
    expect(resolveSelection("the last one", options)).toBe(2);
  });

  it("option numbers", () => {
    expect(resolveSelection("option 3", options)).toBe(2);
    expect(resolveSelection("pick option 2", options)).toBe(1);
  });

  it("name matching", () => {
    expect(resolveSelection("the Johnson on 5th project", options)).toBe(1);
  });

  it("no match returns -1", () => {
    expect(resolveSelection("the Harborview one", options)).toBe(-1);
  });
});

describe("spokenFor", () => {
  it("strips layer badges and citations", () => {
    expect(spokenFor("ORGANIZATION QUESTION. We have three open items [1] today.")).toBe(
      "We have three open items today.",
    );
  });

  it("keeps the first two sentences", () => {
    const out = spokenFor("First sentence. Second sentence. Third sentence.");
    expect(out).toContain("First sentence.");
    expect(out).toContain("Second sentence.");
    expect(out).not.toContain("Third sentence.");
  });

  it("handles empty input", () => {
    expect(spokenFor("")).toBe("");
  });
});

describe("memoryConflictNote", () => {
  it("flags disputed and contradicted memory", () => {
    const note = memoryConflictNote([{ status: "disputed", origin: "explicit", memoryType: "fact" }]);
    expect(note).toMatch(/disputed/);
  });

  it("flags stale and expired memory", () => {
    const note = memoryConflictNote([{ status: "stale", origin: "observed", memoryType: "operational_state" }]);
    expect(note).toMatch(/outdated|stale/);
  });

  it("flags inferred memory as non-authoritative", () => {
    const note = memoryConflictNote([{ status: "active", origin: "inferred", memoryType: "pattern" }]);
    expect(note).toMatch(/inferred/);
  });

  it("returns undefined when memory is clean", () => {
    expect(
      memoryConflictNote([{ status: "active", origin: "explicit", memoryType: "fact" }]),
    ).toBeUndefined();
  });
});

describe("canAccessSession — tenant isolation", () => {
  const session = { tenantId: "t1" as Id<"tenants">, userId: "u1" as Id<"users"> };

  it("allows the owner", () => {
    expect(canAccessSession(session, "t1" as Id<"tenants">, "u1" as Id<"users">)).toBe(true);
  });

  it("blocks a user from another tenant", () => {
    expect(canAccessSession(session, "t2" as Id<"tenants">, "u1" as Id<"users">)).toBe(false);
  });

  it("blocks another member of the same tenant", () => {
    expect(canAccessSession(session, "t1" as Id<"tenants">, "u2" as Id<"users">)).toBe(false);
  });

  it("blocks missing sessions", () => {
    expect(canAccessSession(null, "t1" as Id<"tenants">, "u1" as Id<"users">)).toBe(false);
    expect(canAccessSession(undefined, "t1" as Id<"tenants">, "u1" as Id<"users">)).toBe(false);
  });
});
