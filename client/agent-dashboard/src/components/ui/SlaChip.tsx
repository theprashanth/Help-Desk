import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';

/** One shared ticking clock (every 15s) for every SLA chip on screen. */
const listeners = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    listeners.add(setNow);
    if (!timer) timer = setInterval(() => { const n = Date.now(); listeners.forEach(l => l(n)); }, 15_000);
    return () => {
      listeners.delete(setNow);
      if (!listeners.size && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  return now;
}

const short = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 && h < 10 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export type SlaTone = 'ok' | 'soon' | 'breached';

/** Countdown for the reply the customer is waiting on, or null when there's no clock (or it's paused by a snooze). */
export function slaState(c: Pick<Conversation, 'sla' | 'snoozedUntil' | 'status'>, now: number) {
  const s = c.sla;
  if (!s || c.status !== 'open') return null;
  if (c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now) return null;
  const due = new Date(s.dueAt).getTime();
  const left = due - now;
  const total = s.targetMinutes * 60_000;
  const tone: SlaTone = s.breachedAt || left <= 0 ? 'breached' : left <= total * 0.25 ? 'soon' : 'ok';
  const what = s.kind === 'first' ? 'First response' : 'Next response';
  const label = tone === 'breached' ? `-${short(now - due)}` : short(left);
  const title = tone === 'breached'
    ? `${what} SLA missed ${short(now - due)} ago (due ${new Date(s.dueAt).toLocaleString()})`
    : `${what} due in ${short(left)} (${new Date(s.dueAt).toLocaleString()})`;
  return { tone, label, title, dueAt: due };
}

const TONE: Record<SlaTone, string> = {
  ok: 'bg-ink/[0.06] text-muted',
  soon: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  breached: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200',
};

/** Small countdown pill: grey while there's time, amber in the last 25%, red once missed. */
export const SlaChip: React.FC<{ conv: Pick<Conversation, 'sla' | 'snoozedUntil' | 'status'>; size?: 'sm' | 'md'; className?: string }> = ({ conv, size = 'sm', className = '' }) => {
  const now = useNow();
  const st = slaState(conv, now);
  if (!st) return null;
  return (
    <span
      title={st.title}
      aria-label={st.title}
      className={`inline-flex items-center gap-1 rounded-full font-medium tabular-nums shrink-0 ${size === 'sm' ? 'h-[18px] px-1.5 text-[11px]' : 'h-6 px-2 text-[12.5px]'} ${TONE[st.tone]} ${className}`}
    >
      <Timer className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {st.label}
    </span>
  );
};

export default SlaChip;
