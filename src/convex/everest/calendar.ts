// ---------------------------------------------------------------------------
// Everest — Temporal Intelligence & Business Calendar
//
// Pure, dependency-free timezone + calendar logic. Date math is performed on
// a "wall clock" view of the instant expressed in the configured IANA timezone
// (via Intl), so results are deterministic and unit-testable without a tz
// database library.
// ---------------------------------------------------------------------------

/** Country → IANA timezone mapping with regional overrides for federal
 *  countries. Falls back to UTC when unknown — honestly flagged. */
export const COUNTRY_TIMEZONES: Record<
  string,
  { default: string; regions?: Record<string, string>; cities?: Record<string, string> }
> = {
  "United States": {
    default: "America/New_York",
    regions: {
      "New York": "America/New_York",
      Florida: "America/New_York",
      Georgia: "America/New_York",
      Texas: "America/Chicago",
      Illinois: "America/Chicago",
      Tennessee: "America/Chicago",
      Colorado: "America/Denver",
      Arizona: "America/Phoenix",
      California: "America/Los_Angeles",
      Washington: "America/Los_Angeles",
      Oregon: "America/Los_Angeles",
      Nevada: "America/Los_Angeles",
      Hawaii: "Pacific/Honolulu",
      Alaska: "America/Anchorage",
    },
    cities: {
      "New York": "America/New_York",
      Miami: "America/New_York",
      Atlanta: "America/New_York",
      Chicago: "America/Chicago",
      Dallas: "America/Chicago",
      Houston: "America/Chicago",
      Denver: "America/Denver",
      Phoenix: "America/Phoenix",
      "Los Angeles": "America/Los_Angeles",
      "San Francisco": "America/Los_Angeles",
      Seattle: "America/Los_Angeles",
      Portland: "America/Los_Angeles",
      Honolulu: "Pacific/Honolulu",
      Anchorage: "America/Anchorage",
    },
  },
  Canada: {
    default: "America/Toronto",
    regions: {
      Ontario: "America/Toronto",
      Quebec: "America/Toronto",
      "British Columbia": "America/Vancouver",
      Alberta: "America/Edmonton",
      Manitoba: "America/Winnipeg",
      Saskatchewan: "America/Regina",
      "Nova Scotia": "America/Halifax",
    },
    cities: {
      Toronto: "America/Toronto",
      Ottawa: "America/Toronto",
      Montreal: "America/Toronto",
      Vancouver: "America/Vancouver",
      Calgary: "America/Edmonton",
      Halifax: "America/Halifax",
    },
  },
  "United Kingdom": { default: "Europe/London", cities: { London: "Europe/London" } },
  Ireland: { default: "Europe/Dublin" },
  Australia: {
    default: "Australia/Sydney",
    regions: {
      "New South Wales": "Australia/Sydney",
      Victoria: "Australia/Melbourne",
      Queensland: "Australia/Brisbane",
      "Western Australia": "Australia/Perth",
      "South Australia": "Australia/Adelaide",
      Tasmania: "Australia/Hobart",
    },
    cities: { Sydney: "Australia/Sydney", Melbourne: "Australia/Melbourne", Perth: "Australia/Perth" },
  },
  "New Zealand": { default: "Pacific/Auckland" },
  Germany: { default: "Europe/Berlin", cities: { Berlin: "Europe/Berlin", Munich: "Europe/Berlin" } },
  France: { default: "Europe/Paris", cities: { Paris: "Europe/Paris" } },
  Spain: { default: "Europe/Madrid" },
  Italy: { default: "Europe/Rome" },
  Netherlands: { default: "Europe/Amsterdam" },
  Belgium: { default: "Europe/Brussels" },
  Switzerland: { default: "Europe/Zurich" },
  Sweden: { default: "Europe/Stockholm" },
  Norway: { default: "Europe/Oslo" },
  Denmark: { default: "Europe/Copenhagen" },
  Finland: { default: "Europe/Helsinki" },
  Poland: { default: "Europe/Warsaw" },
  Portugal: { default: "Europe/Lisbon" },
  Austria: { default: "Europe/Vienna" },
  Japan: { default: "Asia/Tokyo", cities: { Tokyo: "Asia/Tokyo" } },
  "South Korea": { default: "Asia/Seoul" },
  China: { default: "Asia/Shanghai", cities: { Shanghai: "Asia/Shanghai", Beijing: "Asia/Shanghai" } },
  India: { default: "Asia/Kolkata", cities: { Mumbai: "Asia/Kolkata", Delhi: "Asia/Kolkata" } },
  Singapore: { default: "Asia/Singapore" },
  "Hong Kong": { default: "Asia/Hong_Kong" },
  Taiwan: { default: "Asia/Taipei" },
  Thailand: { default: "Asia/Bangkok" },
  Vietnam: { default: "Asia/Ho_Chi_Minh" },
  Indonesia: { default: "Asia/Jakarta" },
  Malaysia: { default: "Asia/Kuala_Lumpur" },
  Philippines: { default: "Asia/Manila" },
  "United Arab Emirates": { default: "Asia/Dubai" },
  "Saudi Arabia": { default: "Asia/Riyadh" },
  Israel: { default: "Asia/Jerusalem" },
  Turkey: { default: "Europe/Istanbul" },
  Russia: { default: "Europe/Moscow" },
  Ukraine: { default: "Europe/Kiev" },
  Greece: { default: "Europe/Athens" },
  Romania: { default: "Europe/Bucharest" },
  Hungary: { default: "Europe/Budapest" },
  Czechia: { default: "Europe/Prague" },
  "Czech Republic": { default: "Europe/Prague" },
  Brazil: {
    default: "America/Sao_Paulo",
    regions: {
      "Sao Paulo": "America/Sao_Paulo",
      "Rio de Janeiro": "America/Sao_Paulo",
      Brasilia: "America/Sao_Paulo",
      Amazonas: "America/Manaus",
    },
    cities: { "Sao Paulo": "America/Sao_Paulo", "Rio de Janeiro": "America/Sao_Paulo" },
  },
  Mexico: {
    default: "America/Mexico_City",
    regions: { "Mexico City": "America/Mexico_City", Baja: "America/Tijuana" },
    cities: { "Mexico City": "America/Mexico_City" },
  },
  Argentina: { default: "America/Argentina/Buenos_Aires" },
  Chile: { default: "America/Santiago" },
  Colombia: { default: "America/Bogota" },
  Peru: { default: "America/Lima" },
  Venezuela: { default: "America/Caracas" },
  Ecuador: { default: "America/Guayaquil" },
  "Costa Rica": { default: "America/Costa_Rica" },
  Panama: { default: "America/Panama" },
  "Dominican Republic": { default: "America/Santo_Domingo" },
  "Puerto Rico": { default: "America/Puerto_Rico" },
  Jamaica: { default: "America/Jamaica" },
  "South Africa": { default: "Africa/Johannesburg" },
  Nigeria: { default: "Africa/Lagos" },
  Kenya: { default: "Africa/Nairobi" },
  Egypt: { default: "Africa/Cairo" },
  Morocco: { default: "Africa/Casablanca" },
  "United States of America": {
    default: "America/New_York",
    regions: {
      Florida: "America/New_York",
      Texas: "America/Chicago",
      California: "America/Los_Angeles",
    },
  },
  USA: { default: "America/New_York" },
  "U.S.": { default: "America/New_York" },
};

/** Resolve an IANA timezone for a location. Never throws; unknown locations
 *  fall back to UTC with `derived: false` and an honest note. */
export function tzForLocation(
  country?: string,
  region?: string,
  city?: string,
): { timezone: string; derived: boolean; note?: string } {
  const c = (country ?? "").trim();
  const r = (region ?? "").trim();
  const ct = (city ?? "").trim();
  if (!c) {
    return { timezone: "UTC", derived: false, note: "No location provided." };
  }
  const entry = COUNTRY_TIMEZONES[c];
  if (!entry) {
    return {
      timezone: "UTC",
      derived: false,
      note: `No timezone mapping for "${c}". Configure manually.`,
    };
  }
  if (ct && entry.cities?.[ct]) {
    return { timezone: entry.cities[ct], derived: true };
  }
  if (r && entry.regions?.[r]) {
    return { timezone: entry.regions[r], derived: true };
  }
  return { timezone: entry.default, derived: true };
}

/** Default Mon–Fri business week (1=Monday … 5=Friday). */
export const DEFAULT_BUSINESS_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_BUSINESS_HOURS = { start: "09:00", end: "17:00" };

export interface BusinessCalendarConfig {
  timezone?: string;
  businessDays?: number[];
  businessHours?: { start: string; end: string };
  /** "YYYY-MM-DD" strings. */
  holidays?: string[];
  /** "MM-DD" — start of the fiscal year. */
  fiscalYearStart?: string | null;
}

export function normalizeCalendarConfig(cfg?: BusinessCalendarConfig | null) {
  return {
    timezone: cfg?.timezone ?? "UTC",
    businessDays: cfg?.businessDays?.length ? cfg.businessDays : DEFAULT_BUSINESS_DAYS,
    businessHours: cfg?.businessHours ?? DEFAULT_BUSINESS_HOURS,
    holidays: cfg?.holidays ?? [],
    fiscalYearStart: cfg?.fiscalYearStart ?? null,
  };
}

// --- wall-clock helpers -----------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function wallParts(time: number | Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(time));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** The instant expressed as a UTC-normalized date representing the wall clock
 *  in the given timezone (safe for date math). */
export function zonedDate(time: number | Date, timezone: string): Date {
  const { year, month, day, hour, minute, second } = wallParts(time, timezone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

export function zonedNow(timezone: string): Date {
  return zonedDate(Date.now(), timezone);
}

/** Local "YYYY-MM-DD" key of an instant in a timezone. */
export function dateKey(time: number | Date, timezone: string): string {
  const d = zonedDate(time, timezone);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Start of the local day (00:00 wall clock) in the timezone. */
export function dayStart(time: number | Date, timezone: string): number {
  const d = zonedDate(time, timezone);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Add days to a dateKey ("YYYY-MM-DD"), returning a new dateKey. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function dayOfWeek(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBusinessDay(time: number | Date, cfg?: BusinessCalendarConfig | null): boolean {
  const c = normalizeCalendarConfig(cfg);
  const key = dateKey(time, c.timezone);
  if (c.holidays.includes(key)) return false;
  return c.businessDays.includes(dayOfWeek(key));
}

export function isWeekend(time: number | Date, cfg?: BusinessCalendarConfig | null): boolean {
  const c = normalizeCalendarConfig(cfg);
  return !c.businessDays.includes(dayOfWeek(dateKey(time, c.timezone)));
}

/** Next business day (strictly after `from`), as a dateKey. */
export function nextBusinessDayKey(
  from: number | Date,
  cfg?: BusinessCalendarConfig | null,
): string {
  const c = normalizeCalendarConfig(cfg);
  let key = addDaysToKey(dateKey(from, c.timezone), 1);
  while (c.holidays.includes(key) || !c.businessDays.includes(dayOfWeek(key))) {
    key = addDaysToKey(key, 1);
  }
  return key;
}

/** Previous business day (strictly before `from`). */
export function previousBusinessDayKey(
  from: number | Date,
  cfg?: BusinessCalendarConfig | null,
): string {
  const c = normalizeCalendarConfig(cfg);
  let key = addDaysToKey(dateKey(from, c.timezone), -1);
  while (c.holidays.includes(key) || !c.businessDays.includes(dayOfWeek(key))) {
    key = addDaysToKey(key, -1);
  }
  return key;
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Wall-clock minutes (0-1439) of an instant in the timezone. */
export function minutesInDay(time: number | Date, timezone: string): number {
  const d = zonedDate(time, timezone);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isWithinBusinessHours(
  time: number | Date,
  cfg?: BusinessCalendarConfig | null,
): boolean {
  const c = normalizeCalendarConfig(cfg);
  if (!isBusinessDay(time, c)) return false;
  const m = minutesInDay(time, c.timezone);
  return m >= minutesOfDay(c.businessHours.start) && m < minutesOfDay(c.businessHours.end);
}

/** Timestamp of the business day's start, in ms. */
export function startOfBusinessDay(
  time: number | Date,
  cfg?: BusinessCalendarConfig | null,
): number {
  const c = normalizeCalendarConfig(cfg);
  const day = dateKey(time, c.timezone);
  const [h, m] = c.businessHours.start.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0);
}

/** Timestamp of the business day's end, in ms. */
export function endOfBusinessDay(
  time: number | Date,
  cfg?: BusinessCalendarConfig | null,
): number {
  const c = normalizeCalendarConfig(cfg);
  const day = dateKey(time, c.timezone);
  const [h, m] = c.businessHours.end.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0);
}

/** Start of the next business day (e.g. to schedule a reminder). */
export function nextBusinessDayStart(
  time: number | Date,
  cfg?: BusinessCalendarConfig | null,
): number {
  const c = normalizeCalendarConfig(cfg);
  const next = nextBusinessDayKey(time, c);
  const [h, m] = c.businessHours.start.split(":").map(Number);
  const [y, mo, d] = next.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0);
}

/** Format an instant in the timezone (e.g. "2026-08-09 14:30"). */
export function formatInTz(
  time: number | Date,
  timezone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(time);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...opts,
  }).format(d);
}

/** Week start (Monday) dateKey of the instant's local week. */
export function weekStartKey(time: number | Date, timezone: string): string {
  const key = dateKey(time, timezone);
  const dow = dayOfWeek(key); // 0=Sun … 6=Sat → shift to Monday=0
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDaysToKey(key, shift);
}

/** First/last dateKey of the local month. */
export function monthBounds(time: number | Date, timezone: string): { start: string; end: string } {
  const d = zonedDate(time, timezone);
  const start = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { start, end: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(lastDay)}` };
}

/** Fiscal quarter for a "YYYY-MM-DD" key given a "MM-DD" fiscal year start. */
export function fiscalQuarter(
  key: string,
  fiscalYearStart?: string | null,
): { quarter: number; label: string } {
  const [y, m, d] = key.split("-").map(Number);
  const fys = fiscalYearStart ?? "01-01";
  const [fysM, fysD] = fys.split("-").map(Number);
  const monthIndex = m - 1 + (fysD > d && m === fysM ? 0 : 0); // day precision not needed below
  let offset = (monthIndex - (fysM - 1) + 12) % 12;
  if (fysD > d && m === fysM) offset = 0;
  const quarter = Math.floor(offset / 3) + 1;
  const fiscalYear = monthIndex < fysM - 1 ? y : y; // simplified: calendar-year label
  void y;
  return { quarter, label: `FY${fiscalYear} Q${quarter}` };
}

/** Human temporal label for an instant relative to now ("today", "yesterday",
 *  "tomorrow", "in N days", "N days ago", "overdue"). */
export function relativeTemporalLabel(
  time: number | Date,
  now: number | Date,
  cfg?: BusinessCalendarConfig | null,
): { label: string; kind: "today" | "yesterday" | "tomorrow" | "upcoming" | "past" | "overdue" } {
  const c = normalizeCalendarConfig(cfg);
  const tKey = dateKey(time, c.timezone);
  const nKey = dateKey(now, c.timezone);
  const diff = Math.round(
    (Date.parse(`${tKey}T00:00:00Z`) - Date.parse(`${nKey}T00:00:00Z`)) / 86400000,
  );
  if (diff === 0) return { label: "today", kind: "today" };
  if (diff === -1) return { label: "yesterday", kind: "yesterday" };
  if (diff === 1) return { label: "tomorrow", kind: "tomorrow" };
  if (diff < 0) return { label: `${-diff} days ago`, kind: "past" };
  if (diff <= 7) return { label: `in ${diff} days`, kind: "upcoming" };
  return { label: `in ${diff} days`, kind: "upcoming" };
}

/** Is the instant overdue relative to now (i.e. in the past)? */
export function isOverdue(time: number | Date, now: number | Date): boolean {
  return new Date(time).getTime() < new Date(now).getTime();
}

/** Complete temporal snapshot for a tenant calendar — everything time-aware
 *  queries need, computed from actual timestamps + configured timezone. */
export function temporalSnapshot(
  now: number | Date,
  cfg?: BusinessCalendarConfig | null,
): {
  timezone: string;
  now: number;
  dateKey: string;
  today: string;
  yesterday: string;
  tomorrow: string;
  isBusinessDay: boolean;
  isWithinBusinessHours: boolean;
  nextBusinessDay: string;
  nextBusinessDayStart: number;
  endOfBusinessDay: number;
  startOfBusinessDay: number;
  weekStart: string;
  monthStart: string;
  monthEnd: string;
  fiscalQuarter: { quarter: number; label: string };
} {
  const c = normalizeCalendarConfig(cfg);
  const t = new Date(now).getTime();
  const key = dateKey(t, c.timezone);
  return {
    timezone: c.timezone,
    now: t,
    dateKey: key,
    today: key,
    yesterday: addDaysToKey(key, -1),
    tomorrow: addDaysToKey(key, 1),
    isBusinessDay: isBusinessDay(t, c),
    isWithinBusinessHours: isWithinBusinessHours(t, c),
    nextBusinessDay: nextBusinessDayKey(t, c),
    nextBusinessDayStart: nextBusinessDayStart(t, c),
    endOfBusinessDay: endOfBusinessDay(t, c),
    startOfBusinessDay: startOfBusinessDay(t, c),
    weekStart: weekStartKey(t, c.timezone),
    monthStart: monthBounds(t, c.timezone).start,
    monthEnd: monthBounds(t, c.timezone).end,
    fiscalQuarter: fiscalQuarter(key, c.fiscalYearStart ?? null),
  };
}
