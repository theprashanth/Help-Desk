import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const BACKEND_URL = 'http://localhost:3000';

/** Header row for a settings page (back arrow + 22px title + right-side actions). */
export function SettingsPageHeader({ title, onBack, children }: {
  title: string; onBack: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="ic-panel-header">
      <button type="button" onClick={onBack} className="ic-icon-btn-ghost" title="Back to settings home">
        <ArrowLeft className="w-[18px] h-[18px]" />
      </button>
      <h2 className="ic-title flex-1 min-w-0 truncate">{title}</h2>
      {children}
    </div>
  );
}

/** Intercom-style 2-column settings card: title/description left, controls right. */
export function SettingsFormSection({ title, description, children }: {
  title: string; description?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="ic-card p-8 grid grid-cols-1 gap-6 lg:gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-1.5">
        <h3 className="ic-section-title">{title}</h3>
        {description && <div className="text-[14px] text-muted leading-relaxed">{description}</div>}
      </div>
      <div className="flex flex-col gap-4 min-w-0">{children}</div>
    </div>
  );
}

const PASTELS = [
  'bg-pink-200/80 text-pink-900 dark:bg-pink-400/20 dark:text-pink-200',
  'bg-sky-200/80 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  'bg-teal-200/80 text-teal-900 dark:bg-teal-400/20 dark:text-teal-200',
  'bg-emerald-200/80 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200',
  'bg-violet-200/80 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200',
  'bg-amber-200/80 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
];

export function pastelFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

/** Round avatar: image if provided, else a pastel circle with the initial. Optional online dot. */
export function PersonAvatar({ name, src, size = 32, online }: {
  name: string; src?: string; size?: number; online?: boolean;
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" className="rounded-full object-cover w-full h-full" />
      ) : (
        <span
          className={`ic-avatar w-full h-full ${pastelFor(name || '?')}`}
          style={{ fontSize: Math.max(12, Math.round(size * 0.42)) }}
        >
          {initial}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-surface ${online ? 'bg-emerald-500' : 'bg-faint'}`}
          style={{ width: Math.max(9, size * 0.28), height: Math.max(9, size * 0.28) }}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}

/** "just now", "5m ago", "3h ago", "2d ago", "Mar 4" */
export function relativeTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.round(mo / 12);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

/** Browser-detected IANA timezone (falls back to UTC). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const COMMON_TIMEZONES = [
  'UTC',
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto',
  'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Manila',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu',
];

/** Common zones + the browser zone + any extra (e.g. the currently saved one), de-duplicated. */
export function timezoneOptions(...extra: (string | undefined)[]): string[] {
  const set = new Set<string>(COMMON_TIMEZONES);
  set.add(browserTimeZone());
  extra.forEach(z => z && set.add(z));
  return Array.from(set);
}

/** "GMT+5:30" style offset label for a zone, best effort. */
export function tzLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    return part ? `${tz.replace(/_/g, ' ')} (${part.value})` : tz.replace(/_/g, ' ');
  } catch {
    return tz;
  }
}
