import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Check, AlertCircle, Clock } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { OfficeHours, ReplyTime } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection, timezoneOptions, tzLabel, browserTimeZone } from './shared';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PRESETS: { id: string; label: string; days: number[] }[] = [
  { id: 'weekdays', label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { id: 'weekends', label: 'Weekends', days: [0, 6] },
  { id: 'everyday', label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  ...[1, 2, 3, 4, 5, 6, 0].map(d => ({ id: `day-${d}`, label: DAY_NAMES[d], days: [d] })),
];

export const REPLY_TIME_OPTIONS: { id: ReplyTime; label: string }[] = [
  { id: 'asap', label: 'We’ll reply as soon as we can' },
  { id: 'minutes', label: 'We usually reply in a few minutes' },
  { id: 'hours', label: 'We usually reply in a few hours' },
  { id: 'day', label: 'We usually reply in a day' },
];

const sameDays = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
const presetFor = (days: number[]) => PRESETS.find(p => sameDays(p.days, days))?.id || 'custom';

type Draft = { officeHours: OfficeHours; replyTime: ReplyTime; replyTimeNotice: boolean };

const emptyDraft = (): Draft => ({
  officeHours: { timezone: browserTimeZone(), intervals: [], closures: [] },
  replyTime: 'minutes',
  replyTimeNotice: true,
});

function describeNext(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function OfficeHoursSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [original, setOriginal] = useState<string>(JSON.stringify(emptyDraft()));
  const [status, setStatus] = useState<{ isOpenNow: boolean; nextOpenAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/workspace/office-hours`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(data => {
        const next: Draft = {
          officeHours: data.officeHours
            ? { timezone: data.officeHours.timezone, intervals: data.officeHours.intervals || [], closures: data.officeHours.closures || [] }
            : emptyDraft().officeHours,
          replyTime: data.replyTime || 'minutes',
          replyTimeNotice: data.replyTimeNotice !== false,
        };
        setDraft(next);
        setOriginal(JSON.stringify(next));
        setStatus({ isOpenNow: data.isOpenNow, nextOpenAt: data.nextOpenAt });
      })
      .catch(() => setError('Could not load office hours'))
      .finally(() => setLoading(false));
  }, [token]);

  const dirty = JSON.stringify(draft) !== original;
  const oh = draft.officeHours;
  const tzOptions = useMemo(() => timezoneOptions(oh.timezone), [oh.timezone]);

  const setOh = (patch: Partial<OfficeHours>) => setDraft(d => ({ ...d, officeHours: { ...d.officeHours, ...patch } }));
  const updateInterval = (i: number, patch: Partial<OfficeHours['intervals'][number]>) =>
    setOh({ intervals: oh.intervals.map((iv, idx) => (idx === i ? { ...iv, ...patch } : iv)) });
  const updateClosure = (i: number, patch: Partial<OfficeHours['closures'][number]>) =>
    setOh({ closures: oh.closures.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });

  const validate = (): string | null => {
    for (const [i, iv] of oh.intervals.entries()) {
      if (!iv.days.length) return `Row ${i + 1}: choose the days`;
      if (!iv.start || !iv.end) return `Row ${i + 1}: set a start and end time`;
      if (iv.start >= iv.end) return `Row ${i + 1}: the start time must be before the end time`;
    }
    for (const [i, c] of oh.closures.entries()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return `Holiday ${i + 1}: pick a date`;
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      const body: Draft = {
        replyTime: draft.replyTime,
        replyTimeNotice: draft.replyTimeNotice,
        officeHours: {
          ...oh,
          closures: oh.closures.map(c => (c.label?.trim() ? { date: c.date, label: c.label.trim() } : { date: c.date })),
        },
      };
      const res = await fetch(`${BACKEND_URL}/api/workspace/office-hours`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save office hours');
      const next: Draft = { officeHours: data.officeHours, replyTime: data.replyTime, replyTimeNotice: data.replyTimeNotice !== false };
      setDraft(next);
      setOriginal(JSON.stringify(next));
      setStatus({ isOpenNow: data.isOpenNow, nextOpenAt: data.nextOpenAt });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const ro = !isAdmin;

  return (
    <>
      <SettingsPageHeader title="Office hours" onBack={onBack}>
        {savedFlash && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
        {isAdmin && (
          <button type="button" onClick={save} disabled={!dirty || saving || loading} className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </SettingsPageHeader>

      <div className="ic-tabs pt-4 px-8 shrink-0">
        <button type="button" className="ic-tab ic-tab-active">General</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="flex flex-col gap-4 max-w-5xl">
          {ro && (
            <p className="ic-help">Only admins can change office hours. You’re viewing them read-only.</p>
          )}
          {status && !loading && (
            <div className="flex items-center gap-2 text-[14px] text-muted">
              <span className={`w-2 h-2 rounded-full ${status.isOpenNow ? 'bg-emerald-500' : 'bg-faint'}`} />
              {status.isOpenNow
                ? 'Your team is currently within office hours.'
                : `Your team is currently away${status.nextOpenAt ? ` — back ${describeNext(status.nextOpenAt)}` : ''}.`}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <SettingsFormSection
            title="Default office hours"
            description={
              <>
                These apply to all conversations in your workspace. If a customer starts a conversation outside these hours,
                they’ll see when you’ll be back in the Messenger, so they know when to expect a reply.
              </>
            }
          >
            {loading ? <p className="text-[14px] text-muted">Loading…</p> : (
              <>
                <div className="text-[14px] text-ink leading-relaxed">
                  Hours are based on your workspace’s timezone{' '}
                  <select
                    className="ic-select inline-block w-auto h-8 text-[13px] align-middle my-1"
                    value={oh.timezone}
                    onChange={e => setOh({ timezone: e.target.value })}
                    disabled={ro}
                    aria-label="Workspace timezone"
                  >
                    {tzOptions.map(z => <option key={z} value={z}>{tzLabel(z)}</option>)}
                  </select>
                  . If not specified, availability defaults to 24/7 (always-on).
                </div>

                {oh.intervals.length === 0 && (
                  <div className="flex items-center gap-2 text-[14px] text-muted bg-subtle rounded-lg px-3 py-2.5">
                    <Clock className="w-4 h-4" /> Always on — no office hours set.
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {oh.intervals.map((iv, i) => {
                    const preset = presetFor(iv.days);
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select
                          className="ic-select h-9 w-[150px]"
                          value={preset}
                          disabled={ro}
                          onChange={e => {
                            const p = PRESETS.find(x => x.id === e.target.value);
                            if (p) updateInterval(i, { days: p.days });
                          }}
                          aria-label="Days"
                        >
                          {preset === 'custom' && <option value="custom">{iv.days.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}</option>}
                          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <input type="time" className="ic-input h-9 w-[130px]" value={iv.start} disabled={ro}
                          onChange={e => updateInterval(i, { start: e.target.value })} aria-label="Start time" />
                        <span className="text-muted text-[14px]">to</span>
                        <input type="time" className="ic-input h-9 w-[130px]" value={iv.end} disabled={ro}
                          onChange={e => updateInterval(i, { end: e.target.value })} aria-label="End time" />
                        {!ro && (
                          <button type="button" className="ic-icon-btn-ghost" title="Remove hours"
                            onClick={() => setOh({ intervals: oh.intervals.filter((_, idx) => idx !== i) })}>
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!ro && (
                  <button type="button" className="ic-add-link text-[14px] self-start"
                    onClick={() => setOh({ intervals: [...oh.intervals, { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }] })}>
                    <Plus className="w-4 h-4" /> Add hours
                  </button>
                )}

                <div className="border-t border-line pt-5 mt-1 flex flex-col gap-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">Holidays & Closures</p>
                    <p className="ic-help">You’ll be shown as away for the whole day on these dates.</p>
                  </div>
                  {oh.closures.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input type="date" className="ic-input h-9 w-[170px]" value={c.date} disabled={ro}
                        onChange={e => updateClosure(i, { date: e.target.value })} aria-label="Closure date" />
                      <input className="ic-input h-9 flex-1 min-w-[160px]" value={c.label || ''} disabled={ro} maxLength={80}
                        placeholder="Label (optional), e.g. Diwali" onChange={e => updateClosure(i, { label: e.target.value })} />
                      {!ro && (
                        <button type="button" className="ic-icon-btn-ghost" title="Remove"
                          onClick={() => setOh({ closures: oh.closures.filter((_, idx) => idx !== i) })}>
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {oh.closures.length === 0 && ro && <p className="text-[14px] text-faint">No holidays or closures.</p>}
                  {!ro && (
                    <button type="button" className="ic-add-link text-[14px] self-start"
                      onClick={() => setOh({ closures: [...oh.closures, { date: new Date().toISOString().slice(0, 10), label: '' }] })}>
                      <Plus className="w-4 h-4" /> Add holiday or closure
                    </button>
                  )}
                </div>
              </>
            )}
          </SettingsFormSection>

          <SettingsFormSection
            title="Reply times"
            description="Let customers know how quickly your team usually replies. It’s shown in the Messenger header while you’re within office hours."
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[14px] text-ink">The team usually replies:</span>
              <select
                className="ic-select h-9 w-auto rounded-full pr-9"
                value={draft.replyTime}
                disabled={ro || loading}
                onChange={e => setDraft(d => ({ ...d, replyTime: e.target.value as ReplyTime }))}
                aria-label="Reply time"
              >
                {REPLY_TIME_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="border-t border-line pt-4 flex flex-col gap-1.5">
              <label className={`flex items-center gap-3 ${ro || loading ? 'opacity-60' : 'cursor-pointer'}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.replyTimeNotice}
                  disabled={ro || loading}
                  onClick={() => setDraft(d => ({ ...d, replyTimeNotice: !d.replyTimeNotice }))}
                  className={`ic-toggle ${draft.replyTimeNotice ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}
                >
                  <span className="ic-toggle-knob" />
                </button>
                <span className="text-[14px] text-ink">Tell customers your reply time when they start a conversation</span>
              </label>
              <p className="ic-help pl-14">
                Customers get an automatic message after their first message, e.g. ‘We usually reply in a few minutes’,
                or when you’ll be back if you’re outside office hours.
              </p>
            </div>
          </SettingsFormSection>
        </div>
      </div>
    </>
  );
}
