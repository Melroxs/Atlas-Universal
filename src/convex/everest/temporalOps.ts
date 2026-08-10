// ---------------------------------------------------------------------------
// Everest — Temporal Operationalization
//
// Deadline, SLA and effective-date awareness built on the business calendar.
// Uses the organization timezone by default; user timezone is never silently
// mixed in. Every result derives from actual timestamps + configured calendar.
// ---------------------------------------------------------------------------

import {
  dateKey,
  isBusinessDay,
  nextBusinessDayKey,
  type BusinessCalendarConfig,
} from "./calendar";

export type DeadlineStatus = "overdue" | "due_today" | "due_soon" | "upcoming";

export interface DeadlineInfo {
  status: DeadlineStatus;
  businessDaysRemaining: number | null;
  label: string;
  dueKey: string;
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Business days between two dateKeys (positive = toKey is ahead). */
export function businessDaysBetween(
  fromKey: string,
  toKey: string,
  cfg?: BusinessCalendarConfig | null,
): number {
  if (fromKey === toKey) return 0;
  const dir = fromKey < toKey ? 1 : -1;
  let days = 0;
  let cur = fromKey;
  let guard = 0;
  while (cur !== toKey && guard < 400) {
    cur = addDays(cur, dir);
    if (isBusinessDay(Date.parse(`${cur}T12:00:00Z`), cfg)) days += dir;
    guard++;
  }
  return days;
}

/** Deadline status for a due instant, expressed in business days against the
 *  organization calendar. Never mixes in the user timezone. */
export function deadlineStatus(
  dueAt: number,
  now: number,
  cfg?: BusinessCalendarConfig | null,
  dueSoonBusinessDays = 3,
): DeadlineInfo {
  const tz = cfg?.timezone ?? "UTC";
  const dueKey = dateKey(dueAt, tz);
  const nowKey = dateKey(now, tz);
  const bd = businessDaysBetween(nowKey, dueKey, cfg);
  if (bd < 0) {
    return {
      status: "overdue",
      businessDaysRemaining: bd,
      label: bd === -1 ? "overdue by 1 business day" : `overdue by ${-bd} business days`,
      dueKey,
    };
  }
  if (bd === 0) {
    return { status: "due_today", businessDaysRemaining: 0, label: "due today", dueKey };
  }
  if (bd <= dueSoonBusinessDays) {
    return {
      status: "due_soon",
      businessDaysRemaining: bd,
      label: `due in ${bd} business day${bd === 1 ? "" : "s"}`,
      dueKey,
    };
  }
  return {
    status: "upcoming",
    businessDaysRemaining: bd,
    label: `due in ${bd} business days`,
    dueKey,
  };
}

export type EffectiveStatus = "not_yet_effective" | "active" | "expired";

/** Effective-date awareness for a requirement. */
export function effectiveDateStatus(
  effectiveAt: number | null | undefined,
  expiresAt: number | null | undefined,
  now: number,
): { status: EffectiveStatus; label: string } {
  if (effectiveAt && now < effectiveAt) {
    return {
      status: "not_yet_effective",
      label: `becomes effective ${new Date(effectiveAt).toISOString().slice(0, 10)}`,
    };
  }
  if (expiresAt && now > expiresAt) {
    return {
      status: "expired",
      label: `expired ${new Date(expiresAt).toISOString().slice(0, 10)}`,
    };
  }
  return { status: "active", label: "currently effective" };
}

/** Human phrasing for an approval/action that has been waiting: measured in
 *  the organization's business days. */
export function waitingLabel(
  startedAt: number,
  now: number,
  cfg?: BusinessCalendarConfig | null,
): string {
  const tz = cfg?.timezone ?? "UTC";
  const startKey = dateKey(startedAt, tz);
  const nowKey = dateKey(now, tz);
  const bd = businessDaysBetween(startKey, nowKey, cfg);
  if (bd <= 0) return "waiting since today";
  if (bd === 1) return "waiting for 1 business day";
  return `waiting for ${bd} business days`;
}

/** Start of the next business morning (today if before hours, else next
 *  business day) — for scheduling reminders outside operating hours. */
export function nextBusinessMorning(
  at: number,
  cfg?: BusinessCalendarConfig | null,
): number {
  const key = dateKey(at, cfg?.timezone ?? "UTC");
  const [y, m, d] = key.split("-").map(Number);
  const [h, mi] = (cfg?.businessHours?.start ?? "09:00").split(":").map(Number);
  const todayStart = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  if (at <= todayStart) return todayStart;
  if (isBusinessDay(at, cfg)) return todayStart + (24 * 3600_000); // past today's start → next morning
  return nextBusinessMorningSafe(at, cfg);
}

function nextBusinessMorningSafe(at: number, cfg?: BusinessCalendarConfig | null): number {
  const next = nextBusinessDayKey(at, cfg);
  const [y, m, d] = next.split("-").map(Number);
  const [h, mi] = (cfg?.businessHours?.start ?? "09:00").split(":").map(Number);
  return Date.UTC(y, m - 1, d, h || 0, mi || 0);
}
