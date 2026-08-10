import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  deadlineStatus,
  effectiveDateStatus,
  nextBusinessMorning,
  waitingLabel,
} from "./temporalOps";

// Deterministic calendar: Monday-Friday, 09:00-17:00, America/New_York.
const CFG = {
  timezone: "America/New_York",
  businessDays: [1, 2, 3, 4, 5],
  businessHours: { start: "09:00", end: "17:00" },
  holidays: ["2026-01-01"],
};

const key = (s: string) => Date.parse(`${s}T12:00:00Z`);

describe("business days between", () => {
  it("counts business days across a weekend", () => {
    // Fri 2026-01-02 -> Mon 2026-01-05 = 1 business day.
    expect(businessDaysBetween("2026-01-02", "2026-01-05", CFG)).toBe(1);
    // Fri -> Fri (next week) = 5 business days.
    expect(businessDaysBetween("2026-01-02", "2026-01-09", CFG)).toBe(5);
  });

  it("returns zero for the same day", () => {
    expect(businessDaysBetween("2026-01-02", "2026-01-02", CFG)).toBe(0);
  });

  it("is negative when the target is behind", () => {
    expect(businessDaysBetween("2026-01-05", "2026-01-02", CFG)).toBe(-1);
  });
});

describe("deadline status", () => {
  it("flags overdue deadlines", () => {
    const r = deadlineStatus(key("2026-01-02"), key("2026-01-09"), CFG);
    expect(r.status).toBe("overdue");
    expect(r.label).toContain("overdue");
    expect(r.businessDaysRemaining).toBeLessThan(0);
  });

  it("flags due today", () => {
    const r = deadlineStatus(key("2026-01-02"), key("2026-01-02"), CFG);
    expect(r.status).toBe("due_today");
    expect(r.label).toBe("due today");
  });

  it("flags due soon inside the SLA window in business days", () => {
    const r = deadlineStatus(key("2026-01-05"), key("2026-01-02"), CFG, 3);
    expect(r.status).toBe("due_soon");
    expect(r.businessDaysRemaining).toBe(1);
  });

  it("reports upcoming deadlines beyond the window", () => {
    const r = deadlineStatus(key("2026-02-01"), key("2026-01-02"), CFG, 3);
    expect(r.status).toBe("upcoming");
  });

  it("never mixes the user timezone — uses the configured org timezone", () => {
    const dueAt = Date.UTC(2026, 0, 3, 5, 0, 0); // Jan 3 2026 05:00 UTC = 00:00 ET = Saturday
    const r = deadlineStatus(dueAt, key("2026-01-02"), CFG);
    expect(r.dueKey).toBe("2026-01-03");
    // Zero business days remain before a weekend due date — it has effectively
    // arrived in business-day terms.
    expect(r.status).toBe("due_today");
  });
});

describe("effective dates", () => {
  it("reports not_yet_effective before the effective date", () => {
    const r = effectiveDateStatus(key("2026-03-01"), null, key("2026-01-02"));
    expect(r.status).toBe("not_yet_effective");
    expect(r.label).toContain("2026-03-01");
  });

  it("reports active within the window", () => {
    const r = effectiveDateStatus(key("2026-01-01"), key("2027-01-01"), key("2026-06-01"));
    expect(r.status).toBe("active");
  });

  it("reports expired past the expiration date", () => {
    const r = effectiveDateStatus(null, key("2025-12-01"), key("2026-06-01"));
    expect(r.status).toBe("expired");
  });
});

describe("waiting label", () => {
  it("measures waiting time in business days", () => {
    // Started Thu 2026-01-01, now Mon 2026-01-05 -> 2 business days (Thu, Fri).
    expect(waitingLabel(key("2026-01-01"), key("2026-01-05"), CFG)).toBe("waiting for 2 business days");
    expect(waitingLabel(key("2026-01-05"), key("2026-01-05"), CFG)).toBe("waiting since today");
  });
});

describe("next business morning", () => {
  it("schedules for the next business day outside operating hours", () => {
    const friEvening = key("2026-01-02") + 20 * 3600_000; // Fri evening
    const next = nextBusinessMorning(friEvening, CFG);
    const d = new Date(next);
    expect(d.getUTCDay()).toBe(1); // Monday — never a weekend
    expect(d.getUTCHours()).toBe(9); // start-of-hours (wall-clock convention)
  });

  it("returns today's start when before hours on a business day", () => {
    const tueEarly = key("2026-01-06") - 6 * 3600_000; // Tue before hours
    const next = nextBusinessMorning(tueEarly, CFG);
    expect(new Date(next).getUTCDay()).toBe(2); // Tuesday
    expect(new Date(next).getUTCHours()).toBe(9); // start-of-hours
  });
});
