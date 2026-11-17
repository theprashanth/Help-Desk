import { Conversation } from '../../../../shared/src/types';

export type SnoozeOption = { value: string; label: string; sub: string };

/** Presets shown in the snooze menus. */
export const SNOOZE_OPTIONS: SnoozeOption[] = [
  { value: '3h', label: 'Later today', sub: 'In 3 hours' },
  { value: 'tomorrow', label: 'Tomorrow', sub: '9:00 AM' },
  { value: 'next-week', label: 'Next week', sub: 'Mon 9:00 AM' },
  { value: 'next-month', label: 'Next month', sub: '1st, 9:00 AM' },
];

/** Resolve a preset into an absolute ISO timestamp (local time). */
export function computeSnoozeUntil(value: string, from: Date = new Date()): string {
  const d = new Date(from);
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
