/** Friendly "how long ago" labels for lists. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const ago = (iso?: string) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "a few seconds ago", "5 minutes ago", "yesterday", "2 weeks ago", "last month", "3 months ago", "last year". */
export function timeAgo(iso?: string): string {
  const d = ago(iso);
  if (d === null) return '';
  if (d < 45_000) return 'a few seconds ago';
  if (d < 90_000) return 'a minute ago';
  if (d < HOUR) return `${plural(Math.round(d / MIN), 'minute')} ago`;
  if (d < 90 * MIN) return 'an hour ago';
  if (d < DAY) return `${plural(Math.round(d / HOUR), 'hour')} ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < WEEK) return `${Math.floor(d / DAY)} days ago`;
  if (d < 2 * WEEK) return 'last week';
  if (d < MONTH) return `${Math.floor(d / WEEK)} weeks ago`;
  if (d < 2 * MONTH) return 'last month';
  if (d < YEAR) return `${Math.floor(d / MONTH)} months ago`;
  if (d < 2 * YEAR) return 'last year';
  return `${Math.floor(d / YEAR)} years ago`;
}

/** Compact: "Now", "5m", "3h", "2d", "3w", "4mo", "1y". */
export function shortAgo(iso?: string): string {
  const d = ago(iso);
  if (d === null) return '';
  if (d < MIN) return 'Now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < WEEK) return `${Math.floor(d / DAY)}d`;
  if (d < MONTH) return `${Math.floor(d / WEEK)}w`;
  if (d < YEAR) return `${Math.floor(d / MONTH)}mo`;
  return `${Math.floor(d / YEAR)}y`;
}

/** Full date and time for a tooltip. */
export const fullDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');
