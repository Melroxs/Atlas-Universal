// ---------------------------------------------------------------------------
// Everest — Temporal snapshot (client port).
//
// A compact, honest snapshot of "now" in the organization's timezone and
// calendar: business-day / business-hours state, week/month boundaries and
// fiscal quarter. Ported from the Convex everest/calendar engine.
// ---------------------------------------------------------------------------

export interface TemporalConfig {
  timezone: string;
  businessDays?: number[] | null; // 0=Sunday … 6=Saturday
  businessHours?: { start?: string; end?: string } | null;
  holidays?: string[] | null; // "YYYY-MM-DD"
  fiscalYearStart?: string | null; // "MM-DD"
}

export interface TemporalSnapshot {
  now: number;
  timezone: string;
  today: string;
  todayDayOfWeek: number;
  isBusinessDay: boolean;
  isWithinBusinessHours: boolean;
  nextBusinessDay: string;
  startOfBusinessDay: string;
  endOfBusinessDay: string;
  fiscalQuarter: { label: string; start: string; end: string };
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  holidayToday: string | null;
  upcomingHolidays: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

function partsAt(d: Date, tz: string): { h: number; m: number; dow: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const dowMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return { h: hour % 24, m: minute, dow: dowMap[get("weekday")] ?? d.getDay() };
  } catch {
    return { h: d.getHours(), m: d.getMinutes(), dow: d.getDay() };
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function temporalSnapshot(
  now: number,
  cfg: TemporalConfig,
): TemporalSnapshot {
  const tz = cfg.timezone || "UTC";
  const businessDays = cfg.businessDays?.length ? cfg.businessDays : [1, 2, 3, 4, 5];
  const hours = cfg.businessHours ?? { start: "09:00", end: "17:00" };
  const holidays = cfg.holidays ?? [];
  const today = isoDate(new Date(now), tz);
  const { h, m, dow } = partsAt(new Date(now), tz);
  const minutes = h * 60 + m;

  const [hs, ms] = String(hours.start ?? "09:00").split(":").map(Number);
  const [he, me] = String(hours.end ?? "17:00").split(":").map(Number);
  const startMin = (hs || 9) * 60 + (ms || 0);
  const endMin = (he || 17) * 60 + (me || 0);

  const isHoliday = holidays.includes(today);
  const isBusinessDay =
    businessDays.includes(dow) && !isHoliday;
  const isWithinBusinessHours = isBusinessDay && minutes >= startMin && minutes < endMin;

  let next = addDays(today, 1);
  while (true) {
    const d = new Date(`${next}T00:00:00Z`);
    const nDow = (d.getUTCDay() + 0) % 7; // approximation; DST-insensitive
    const dayHoliday = holidays.includes(next);
    if (businessDays.includes(nDow) && !dayHoliday) break;
    next = addDays(next, 1);
  }

  const weekdayStart = new Date(`${today}T00:00:00Z`);
  const dowOffset = (weekdayStart.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = addDays(today, -dowOffset);
  const weekEnd = addDays(weekStart, 6);

  const monthStart = `${today.slice(0, 7)}-01`;
  const lastDay = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const monthEnd = `${lastDay.getUTCFullYear()}-${pad(lastDay.getUTCMonth() + 1)}-${pad(lastDay.getUTCDate())}`;

  // Fiscal quarter from fiscalYearStart ("MM-DD").
  let quarter = 1;
  let qStart = `${today.slice(0, 4)}-01-01`;
  let qEnd = `${today.slice(0, 4)}-03-31`;
  const fys = cfg.fiscalYearStart ?? "01-01";
  const months = [0, 3, 6, 9].map((i) => {
    const d = new Date(`${today.slice(0, 4)}-${fys.slice(0, 2)}-${fys.slice(3, 5)}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d;
  });
  for (let i = 0; i < months.length; i++) {
    const start = months[i];
    const end = i < months.length - 1 ? months[i + 1] : new Date(start);
    if (i === months.length - 1) end.setUTCFullYear(end.getUTCFullYear() + 1, start.getUTCMonth(), 0);
    const s = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
    const e = i < months.length - 1
      ? `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
      : `${end.getUTCFullYear()}-12-31`;
    if (today >= s && today <= e) {
      quarter = i + 1;
      qStart = s;
      qEnd = e;
      break;
    }
  }

  return {
    now,
    timezone: tz,
    today,
    todayDayOfWeek: dow,
    isBusinessDay,
    isWithinBusinessHours,
    nextBusinessDay: next,
    startOfBusinessDay: `${today}T${pad(startMin / 60 | 0)}:${pad(startMin % 60)}`,
    endOfBusinessDay: `${today}T${pad(endMin / 60 | 0)}:${pad(endMin % 60)}`,
    fiscalQuarter: { label: `Q${quarter}`, start: qStart, end: qEnd },
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    holidayToday: isHoliday ? today : null,
    upcomingHolidays: holidays.filter((h) => h >= today).slice(0, 5),
  };
}
