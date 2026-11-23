import { useEffect, useState } from 'react';
import { Check, AlertCircle, Timer } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { SlaPolicy, TicketPriority } from '../../../../../shared/src/types';
import { PriorityIcon } from '../../lib/priority';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';

const ROWS: { p: TicketPriority; label: string }[] = [
  { p: 'critical', label: 'Urgent' }, { p: 'high', label: 'High' }, { p: 'medium', label: 'Medium' },
  { p: 'low', label: 'Low' }, { p: 'none', label: 'No priority' },
];
type Unit = 'm' | 'h' | 'd';
const UNIT_MIN: Record<Unit, number> = { m: 1, h: 60, d: 1440 };
const split = (mins: number): { n: number; u: Unit } =>
  mins % 1440 === 0 ? { n: mins / 1440, u: 'd' } : mins % 60 === 0 ? { n: mins / 60, u: 'h' } : { n: mins, u: 'm' };

/** One target: a number and a unit (minutes / hours / days), stored as minutes. */
function TargetInput({ value, onChange, disabled, label }: { value: number; onChange: (mins: number) => void; disabled?: boolean; label: string }) {
  const [{ n, u }, setParts] = useState(() => split(value));
  useEffect(() => { setParts(split(value)); }, [value]);
  const commit = (nn: number, uu: Unit) => {
    setParts({ n: nn, u: uu });
    if (Number.isFinite(nn) && nn > 0) onChange(Math.min(43200, Math.round(nn * UNIT_MIN[uu])));
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" min={1} aria-label={`${label} amount`} disabled={disabled}
        className="ic-input h-9 w-16 px-2 tabular-nums" value={Number.isFinite(n) ? n : ''}
        onChange={e => commit(parseFloat(e.target.value), u)}
      />
      <select aria-label={`${label} unit`} disabled={disabled} className="ic-input h-9 w-[104px] px-2" value={u} onChange={e => commit(n, e.target.value as Unit)}>
        <option value="m">minutes</option>
        <option value="h">hours</option>
        <option value="d">days</option>
      </select>
    </div>
  );
}

/**
 * Settings › SLAs: response-time targets per priority. Conversations show a countdown (grey,
 * amber in the last 25%, red once missed), a missed target is recorded in the conversation and
 * the assignee is notified, and the inbox can be sorted by "SLA due".
 */
export default function SlaSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const [draft, setDraft] = useState<SlaPolicy | null>(null);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load SLA settings');
        setDraft(data.sla);
        setOriginal(JSON.stringify(data.sla));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const dirty = !!draft && JSON.stringify(draft) !== original;
  const setTarget = (key: 'firstResponseMinutes' | 'nextResponseMinutes', p: TicketPriority, mins: number) =>
    setDraft(d => (d ? { ...d, [key]: { ...d[key], [p]: mins } } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sla: { enabled: draft.enabled, firstResponseMinutes: draft.firstResponseMinutes, nextResponseMinutes: draft.nextResponseMinutes } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setDraft(data.sla);
      setOriginal(JSON.stringify(data.sla));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="SLAs" onBack={onBack}>
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

      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="flex flex-col gap-4 max-w-5xl">
          {!isAdmin && <p className="ic-help">Only admins can change SLAs. You’re viewing them read-only.</p>}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {loading && <p className="text-[14px] text-muted">Loading…</p>}

          {draft && (
            <>
              <SettingsFormSection
                title="Response-time SLAs"
                description="Set how quickly customers should hear back. Each open conversation shows a countdown; when a target is missed it's noted in the conversation and the assignee is notified."
              >
                <label className={`flex items-center gap-3 ${isAdmin ? 'cursor-pointer' : 'opacity-60'}`}>
                  <button
                    type="button" role="switch" aria-checked={draft.enabled} disabled={!isAdmin}
                    onClick={() => setDraft(d => (d ? { ...d, enabled: !d.enabled } : d))}
                    className={`ic-toggle ${draft.enabled ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}
                  >
                    <span className="ic-toggle-knob" />
                  </button>
                  <span className="text-[14px] text-ink">Track SLAs</span>
                </label>
                <p className="ic-help">
                  {draft.enabled && draft.enabledAt
                    ? `On since ${new Date(draft.enabledAt).toLocaleString()}. Conversations that were already waiting before then aren't measured.`
                    : 'When you turn this on, only customers who start waiting from then on are measured.'}
                </p>
              </SettingsFormSection>

              <SettingsFormSection
                title="Targets by priority"
                description="First response: the first teammate reply in a conversation. Next response: each reply after the customer writes again. The clock pauses while a conversation is snoozed, and stops when it's waiting on the customer, resolved or closed."
              >
                <div className={`rounded-xl border border-line overflow-x-auto ${draft.enabled ? '' : 'opacity-60'}`}>
                  <div className="grid grid-cols-[minmax(96px,1fr)_auto_auto] gap-x-4 items-center px-4 h-10 bg-sidebar border-b border-line text-[13px] font-medium text-muted">
                    <span>Priority</span><span>First response</span><span>Next response</span>
                  </div>
                  {ROWS.map(r => (
                    <div key={r.p} className="grid grid-cols-[minmax(96px,1fr)_auto_auto] gap-x-4 items-center px-4 py-2.5 border-b border-line last:border-b-0">
                      <span className="flex items-center gap-2 text-[14px] text-ink"><PriorityIcon priority={r.p} className="w-4 h-4" />{r.label}</span>
                      <TargetInput label={`${r.label} first response`} disabled={!isAdmin} value={draft.firstResponseMinutes[r.p]} onChange={m => setTarget('firstResponseMinutes', r.p, m)} />
                      <TargetInput label={`${r.label} next response`} disabled={!isAdmin} value={draft.nextResponseMinutes[r.p]} onChange={m => setTarget('nextResponseMinutes', r.p, m)} />
                    </div>
                  ))}
                </div>
                <p className="ic-help flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> Countdowns turn amber in the last 25% of the target and red once it's missed. Sort the inbox by “SLA due” to see what's next.</p>
              </SettingsFormSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
