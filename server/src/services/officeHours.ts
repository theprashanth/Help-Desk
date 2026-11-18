import { OfficeHours, ReplyTime } from '../../../shared/src/types';

/**
 * Pure helpers for workspace office hours. All evaluation happens in the workspace's
 * IANA timezone via Intl.DateTimeFormat (no external deps).
 */

export const REPLY_TIMES: ReplyTime[] = ['asap', 'minutes', 'hours', 'day'];
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number; month: number; day: number;   // month 1-12
  hour: number; minute: number; second: number;
  weekday: number;                            // 0=Sun..6=Sat
  date: string;                               // YYYY-MM-DD
  time: string;                               // HH:MM
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const minute = Number(parts.minute);
  return {
    year, month, day, hour, minute, second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function tzOffset(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads y-m-d h:mi (handles DST shifts). */
function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let instant = guess - tzOffset(guess, timeZone);
  const second = guess - tzOffset(instant, timeZone);
  if (second !== instant) instant = second;
  return instant;
}

/** Is the team open at `date`? No office hours / no intervals = 24/7; a closure date = closed all day. */
export function isOpenAt(officeHours: OfficeHours | undefined | null, date: Date = new Date()): boolean {
  if (!officeHours) return true;
  const tz = isValidTimeZone(officeHours.timezone) ? officeHours.timezone : 'UTC';
  const p = zonedParts(date, tz);
  if ((officeHours.closures || []).some(c => c.date === p.date)) return false;
  const intervals = officeHours.intervals || [];
  if (intervals.length === 0) return true;
  return intervals.some(iv => iv.days.includes(p.weekday) && iv.start <= p.time && p.time < iv.end);
}

/**
 * The next instant (>= `from`) at which the team is open, or null if nothing within
 * `horizonDays`. Returns `from` itself if already open.
 */
export function nextOpening(officeHours: OfficeHours | undefined | null, from: Date = new Date(), horizonDays = 21): Date | null {
  if (isOpenAt(officeHours, from)) return from;
  if (!officeHours) return from;
  const tz = isValidTimeZone(officeHours.timezone) ? officeHours.timezone : 'UTC';
  const start = zonedParts(from, tz);
  const candidates: number[] = [];
  for (let k = 0; k <= horizonDays; k++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + k));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    // Opening moments are either the start of an interval or a local midnight (end of a closure).
    candidates.push(zonedTimeToUtc(y, m, d, 0, 0, tz));
    for (const iv of officeHours.intervals || []) {
      const [h, mi] = iv.start.split(':').map(Number);
      candidates.push(zonedTimeToUtc(y, m, d, h, mi, tz));
    }
  }
  candidates.sort((a, b) => a - b);
  for (const c of candidates) {
    if (c <= from.getTime()) continue;
    const at = new Date(c);
    if (isOpenAt(officeHours, at)) return at;
  }
  return null;
}

/** Validate + normalise an office hours payload. Returns an error string or the clean value. */
export function validateOfficeHours(input: any): { error: string } | { value: OfficeHours } {
  if (!input || typeof input !== 'object') return { error: 'officeHours must be an object' };
  if (!isValidTimeZone(input.timezone)) return { error: 'officeHours.timezone must be a valid IANA timezone' };
  const rawIntervals = input.intervals ?? [];
  const rawClosures = input.closures ?? [];
  if (!Array.isArray(rawIntervals)) return { error: 'officeHours.intervals must be an array' };
  if (!Array.isArray(rawClosures)) return { error: 'officeHours.closures must be an array' };
  if (rawIntervals.length > 50 || rawClosures.length > 200) return { error: 'Too many intervals or closures' };

  const intervals: OfficeHours['intervals'] = [];
  for (const [i, iv] of rawIntervals.entries()) {
    if (!iv || !Array.isArray(iv.days) || iv.days.length === 0) return { error: `Interval ${i + 1}: choose at least one day` };
    if (!iv.days.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: `Interval ${i + 1}: days must be between 0 (Sun) and 6 (Sat)` };
    if (typeof iv.start !== 'string' || !HHMM.test(iv.start) || typeof iv.end !== 'string' || !HHMM.test(iv.end)) {
      return { error: `Interval ${i + 1}: times must be HH:MM` };
    }
    if (iv.start >= iv.end) return { error: `Interval ${i + 1}: start time must be before end time` };
    intervals.push({ days: Array.from(new Set<number>(iv.days)).sort((a, b) => a - b), start: iv.start, end: iv.end });
  }

  const closures: OfficeHours['closures'] = [];
  for (const [i, c] of rawClosures.entries()) {
    const m = c && typeof c.date === 'string' ? YMD.exec(c.date) : null;
    const dt = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!m || !dt || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) {
      return { error: `Closure ${i + 1}: date must be a valid YYYY-MM-DD` };
    }
    if (c.label !== undefined && c.label !== null && typeof c.label !== 'string') return { error: `Closure ${i + 1}: label must be text` };
    const label = typeof c.label === 'string' ? c.label.trim().slice(0, 80) : '';
    closures.push(label ? { date: c.date, label } : { date: c.date });
  }

  return { value: { timezone: input.timezone, intervals, closures } };
}
