import { Conversation, SnoozePreset } from '../../../../shared/src/types';

export type SnoozeOption = { value: string; label: string; sub: string };

/** Presets shown in the snooze menus. */
export const SNOOZE_OPTIONS: SnoozeOption[] = [
  { value: '3h', label: 'Later today', sub: 'In 3 hours' },
  { value: 'tomorrow', label: 'Tomorrow', sub: '9:00 AM' },
  { value: 'next-week', label: 'Next week', sub: 'Mon 9:00 AM' },
  { value: 'next-month', label: 'Next month', sub: '1st, 9:00 AM' },
];

/** Default list, as presets (used when the workspace hasn't customised its snooze options). */
export const DEFAULT_SNOOZE_PRESETS: SnoozePreset[] = [
  { kind: 'hours', amount: 3, label: 'Later today' },
  { kind: 'tomorrow' },
  { kind: 'next-week' },
  { kind: 'next-month' },
];

/** Turn a workspace snooze preset into a menu option. Values: "h:N", "d:N", "tomorrow", "next-week", "next-month". */
export function presetToOption(p: SnoozePreset): SnoozeOption {
  switch (p.kind) {
    case 'hours': {
      const n = p.amount || 1;
      return { value: `h:${n}`, label: p.label || `In ${n} hour${n === 1 ? '' : 's'}`, sub: n < 24 ? `In ${n}h` : `In ${Math.round(n / 24)}d` };
    }
    case 'days': {
      const n = p.amount || 1;
      return { value: `d:${n}`, label: p.label || `In ${n} day${n === 1 ? '' : 's'}`, sub: '9:00 AM' };
    }
    case 'tomorrow': return { value: 'tomorrow', label: p.label || 'Tomorrow', sub: '9:00 AM' };
    case 'next-week': return { value: 'next-week', label: p.label || 'Next week', sub: 'Mon 9:00 AM' };
    default: return { value: 'next-month', label: p.label || 'Next month', sub: '1st, 9:00 AM' };
  }
}

/** Resolve a preset into an absolute ISO timestamp (local time). */
export function computeSnoozeUntil(value: string, from: Date = new Date()): string {
  const d = new Date(from);
  const m = /^(h|d):(\d+)$/.exec(value);
  if (m) {
    const n = parseInt(m[2], 10);
    if (m[1] === 'h') d.setHours(d.getHours() + n);
    else { d.setDate(d.getDate() + n); d.setHours(9, 0, 0, 0); }
    return d.toISOString();
  }
  switch (value) {
    case '3h':
      d.setHours(d.getHours() + 3);
      break;
    case 'tomorrow':
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      break;
    case 'next-week': {
      // next Monday (always at least 1 day ahead)
      const daysUntilMonday = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMonday);
      d.setHours(9, 0, 0, 0);
      break;
    }
    case 'next-month':
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(9, 0, 0, 0);
      break;
    default:
      d.setHours(d.getHours() + 3);
  }
  return d.toISOString();
}

/** A conversation is snoozed while its snoozedUntil is in the future. */
export function isSnoozed(conv: Pick<Conversation, 'snoozedUntil'>, now: number = Date.now()): boolean {
  return !!conv.snoozedUntil && new Date(conv.snoozedUntil).getTime() > now;
}

/** "Today 4:30 PM", "Tomorrow 9:00 AM", "Mon 9:00 AM", "Dec 1, 9:00 AM" */
export function formatSnoozeUntil(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
