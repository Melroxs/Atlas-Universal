import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  dateKey,
  dayOfWeek,
  endOfBusinessDay,
  fiscalQuarter,
  isBusinessDay,
  isWeekend,
  isWithinBusinessHours,
  nextBusinessDayKey,
  nextBusinessDayStart,
  previousBusinessDayKey,
  relativeTemporalLabel,
  startOfBusinessDay,
  temporalSnapshot,
  tzForLocation,
  weekStartKey,
} from "./calendar";

// 2026-08-03 is a Monday, 2026-08-08 a Saturday, 2026-08-09 a Sunday.
const MON = new Date("2026-08-03T12:00:00Z").getTime();
const SAT = new Date("2026-08-08T12:00:00Z").getTime();
const SUN = new Date("2026-08-09T12:00:00Z").getTime();
const FRI = new Date("2026-08-07T12:00:00Z").getTime();

describe("tzForLocation — location → timezone", () => {
  it("derives the right timezone for known locations", () => {
    expect(tzForLocation("United States", "Florida", "Miami").timezone).toBe("America/New_York");
    expect(tzForLocation("United States", "Texas", "Dallas").timezone).toBe("America/Chicago");
    expect(tzForLocation("United States", "California").timezone).toBe("America/Los_Angeles");
    expect(tzForLocation("Canada", "Ontario").timezone).toBe("America/Toronto");
    expect(tzForLocation("Australia", "Victoria").timezone).toBe("Australia/Melbourne");
    expect(tzForLocation("Germany", undefined, "Berlin").timezone).toBe("Europe/Berlin");
  });

  it("falls back to UTC honestly for unknown or missing locations", () => {
    const r = tzForLocation("Atlantis");
    expect(r.timezone).toBe("UTC");
    expect(r.derived).toBe(false);
    expect(r.note).toContain("Atlantis");
    expect(tzForLocation(undefined, undefined, undefined).note).toContain("No location");
  });
});

describe("business-day math", () => {
  it("identifies business days and weekends", () => {
    expect(isBusinessDay(MON)).toBe(true);
    expect(isBusinessDay(SAT)).toBe(false);
    expect(isBusinessDay(SUN)).toBe(false);
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(MON)).toBe(false);
  });

  it("respects configured holidays", () => {
    const cfg = { timezone: "UTC", holidays: ["2026-08-03"] };
    expect(isBusinessDay(MON, cfg)).toBe(false);
  });

  it("supports non-standard business weeks", () => {
    const cfg = { timezone: "UTC", businessDays: [0] }; // Sunday only
    expect(isBusinessDay(SUN, cfg)).toBe(true);
    expect(isBusinessDay(MON, cfg)).toBe(false);
  });

  it("computes the next/previous business day", () => {
    // Friday 2026-08-07 → Monday 2026-08-10
    expect(nextBusinessDayKey(FRI)).toBe("2026-08-10");
    // Monday → Tuesday
    expect(nextBusinessDayKey(MON)).toBe("2026-08-04");
    // Monday ← Friday 2026-07-31 (skips the weekend)
    expect(previousBusinessDayKey(MON)).toBe("2026-07-31");
  });

  it("skips holidays when walking to the next business day", () => {
    const cfg = { timezone: "UTC", holidays: ["2026-08-10"] };
    expect(nextBusinessDayKey(FRI, cfg)).toBe("2026-08-11");
  });
});

describe("business hours", () => {
  it("detects whether now is within operating hours", () => {
    expect(isWithinBusinessHours(new Date("2026-08-03T10:00:00Z").getTime())).toBe(true);
    expect(isWithinBusinessHours(new Date("2026-08-03T18:00:00Z").getTime())).toBe(false);
    expect(isWithinBusinessHours(new Date("2026-08-08T10:00:00Z").getTime())).toBe(false); // Saturday
  });

  it("computes day boundaries", () => {
    const start = startOfBusinessDay(MON);
    const end = endOfBusinessDay(MON);
    expect(new Date(start).toISOString()).toBe("2026-08-03T09:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-08-03T17:00:00.000Z");
    expect(nextBusinessDayStart(FRI)).toBe(new Date("2026-08-10T09:00:00.000Z").getTime());
  });
});

describe("timezone-aware wall clock", () => {
  it("maps an instant to the correct local date in another timezone", () => {
    // 2026-08-03T00:30:00Z is still Aug 2 in New York (UTC-4 summer).
    const late = new Date("2026-08-03T00:30:00Z").getTime();
    expect(dateKey(late, "America/New_York")).toBe("2026-08-02");
    expect(dateKey(late, "UTC")).toBe("2026-08-03");
  });

  it("computes week starts on Mondays", () => {
    expect(weekStartKey(SUN, "UTC")).toBe("2026-08-03");
    expect(weekStartKey(MON, "UTC")).toBe("2026-08-03");
  });
});

describe("fiscal quarters", () => {
  it("handles calendar-year fiscal years", () => {
    expect(fiscalQuarter("2026-01-15", "01-01").quarter).toBe(1);
    expect(fiscalQuarter("2026-07-15", "01-01").quarter).toBe(3);
    expect(fiscalQuarter("2026-10-05", "01-01").quarter).toBe(4);
  });

  it("handles offset fiscal years", () => {
    expect(fiscalQuarter("2026-08-15", "07-01").quarter).toBe(1);
    expect(fiscalQuarter("2026-04-15", "07-01").quarter).toBe(4);
  });
});

describe("temporal labels & snapshots", () => {
  it("labels dates relative to now", () => {
    expect(relativeTemporalLabel(MON, MON).kind).toBe("today");
    expect(relativeTemporalLabel(MON, new Date("2026-08-04T12:00:00Z")).kind).toBe("yesterday");
    expect(relativeTemporalLabel(MON, new Date("2026-08-02T12:00:00Z")).kind).toBe("tomorrow");
    expect(relativeTemporalLabel(MON, new Date("2026-08-20T12:00:00Z")).kind).toBe("past");
  });

  it("builds a complete temporal snapshot from real timestamps", () => {
    const s = temporalSnapshot(MON, { timezone: "UTC", fiscalYearStart: "01-01" });
    expect(s.timezone).toBe("UTC");
    expect(s.today).toBe("2026-08-03");
    expect(s.isBusinessDay).toBe(true);
    expect(s.nextBusinessDay).toBe("2026-08-04");
    expect(s.fiscalQuarter.quarter).toBe(3);
    expect(s.monthStart).toBe("2026-08-01");
    expect(typeof s.endOfBusinessDay).toBe("number");
  });

  it("key math is stable", () => {
    expect(addDaysToKey("2026-08-03", 0)).toBe("2026-08-03");
    expect(addDaysToKey("2026-02-27", 2)).toBe("2026-03-01");
    expect(dayOfWeek("2026-08-03")).toBe(1); // Monday
  });
});
