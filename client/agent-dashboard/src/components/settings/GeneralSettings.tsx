import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Check, AlertCircle, Copy } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { SnoozePreset } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection, timezoneOptions, tzLabel } from './shared';

type WorkspaceSettings = {
  id: string;
  name: string;
  customerFacingName: string;
  timezone: string | null;
  showAttribution: boolean;
  attributionText: string;
  showStateToCustomer?: boolean;
  csatEnabled?: boolean;
  snoozeOptions: SnoozePreset[];
  replyTimeNotice: boolean;
  appId: string;
};

type Draft = {
  name: string;
  customerFacingName: string;
  timezone: string;
  showAttribution: boolean;
  attributionText: string;
  showStateToCustomer: boolean;
  csatEnabled: boolean;
  snoozeOptions: SnoozePreset[];
};

export const DEFAULT_SNOOZE_OPTIONS: SnoozePreset[] = [
  { kind: 'hours', amount: 3, label: 'Later today' },
  { kind: 'tomorrow' },
  { kind: 'next-week' },
  { kind: 'next-month' },
];
const MAX_SNOOZE_OPTIONS = 10;

const KIND_OPTIONS: { id: SnoozePreset['kind']; label: string }[] = [
  { id: 'hours', label: 'In N hours' },
  { id: 'days', label: 'In N days' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'next-week', label: 'Next week' },
  { id: 'next-month', label: 'Next month' },
];

const needsAmount = (k: SnoozePreset['kind']) => k === 'hours' || k === 'days';

/** Human label for a preset, e.g. "In 3 hours", "Tomorrow". */
export function snoozeLabel(p: SnoozePreset): string {
  if (p.label) return p.label;
  switch (p.kind) {
    case 'hours': return `In ${p.amount} hour${p.amount === 1 ? '' : 's'}`;
    case 'days': return `In ${p.amount} day${p.amount === 1 ? '' : 's'}`;
    case 'tomorrow': return 'Tomorrow';
    case 'next-week': return 'Next week';
    case 'next-month': return 'Next month';
  }
}

const clean = (list: SnoozePreset[]): SnoozePreset[] =>
  list.map(p => ({ kind: p.kind, ...(needsAmount(p.kind) ? { amount: p.amount } : {}), ...(p.label ? { label: p.label } : {}) }));
const sameList = (a: SnoozePreset[], b: SnoozePreset[]) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

const toDraft = (ws: WorkspaceSettings): Draft => ({
  name: ws.name,
  customerFacingName: ws.customerFacingName || '',
  timezone: ws.timezone || '',
  showAttribution: ws.showAttribution,
  attributionText: ws.attributionText || '',
  showStateToCustomer: ws.showStateToCustomer === true,
  csatEnabled: ws.csatEnabled !== false,
  snoozeOptions: ws.snoozeOptions.length ? clean(ws.snoozeOptions) : clean(DEFAULT_SNOOZE_OPTIONS),
});

function ToggleRow({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`ic-toggle ${checked ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}
      >
        <span className="ic-toggle-knob" />
      </button>
      <span className="text-[14px] text-ink">{label}</span>
    </label>
  );
}

export default function GeneralSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const setWorkspaceName = useStore(s => s.setWorkspaceName);
  const isAdmin = me?.role === 'admin';
  const ro = !isAdmin;

  const [ws, setWs] = useState<WorkspaceSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/workspace`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load workspace settings');
        return data as WorkspaceSettings;
      })
      .then(data => {
        setWs(data);
        const d = toDraft(data);
        setDraft(d);
        setOriginal(JSON.stringify(d));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const tzOptions = useMemo(() => timezoneOptions(draft?.timezone || undefined), [draft?.timezone]);
  const dirty = !!draft && JSON.stringify(draft) !== original;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const updateOption = (i: number, patch: Partial<SnoozePreset>) => {
    if (!draft) return;
    set('snoozeOptions', draft.snoozeOptions.map((p, idx) => {
      if (idx !== i) return p;
      const next: SnoozePreset = { ...p, ...patch };
      // A custom label no longer fits once the timing changes.
      if (patch.kind !== undefined || patch.amount !== undefined) delete next.label;
      if (needsAmount(next.kind) && !next.amount) next.amount = next.kind === 'hours' ? 3 : 2;
      if (!needsAmount(next.kind)) delete next.amount;
      return next;
    }));
  };

  const validate = (d: Draft): string | null => {
    if (!d.name.trim()) return 'Workspace name is required';
    if (d.name.trim().length > 80) return 'Workspace name must be 80 characters or fewer';
    if (d.customerFacingName.trim().length > 80) return 'Customer-facing name must be 80 characters or fewer';
    for (const [i, p] of d.snoozeOptions.entries()) {
      if (needsAmount(p.kind) && (!Number.isInteger(p.amount) || (p.amount as number) < 1 || (p.amount as number) > 365)) {
        return `Snooze option ${i + 1}: enter a whole number between 1 and 365`;
      }
    }
    return null;
  };

  const save = async () => {
    if (!draft || !ws) return;
    const v = validate(draft);
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      const prev: Draft = JSON.parse(original);
      const body: Record<string, unknown> = {};
      if (draft.name.trim() !== prev.name) body.name = draft.name.trim();
      if (draft.customerFacingName.trim() !== prev.customerFacingName) body.customerFacingName = draft.customerFacingName.trim();
      if (draft.timezone && draft.timezone !== prev.timezone) body.timezone = draft.timezone;
      if (draft.showAttribution !== prev.showAttribution) body.showAttribution = draft.showAttribution;
      if (draft.attributionText.trim() !== prev.attributionText) body.attributionText = draft.attributionText.trim();
      if (draft.showStateToCustomer !== prev.showStateToCustomer) body.showStateToCustomer = draft.showStateToCustomer;
      if (draft.csatEnabled !== prev.csatEnabled) body.csatEnabled = draft.csatEnabled;
      if (!sameList(draft.snoozeOptions, prev.snoozeOptions)) {
        body.snoozeOptions = sameList(draft.snoozeOptions, DEFAULT_SNOOZE_OPTIONS) ? [] : clean(draft.snoozeOptions);
      }
      const res = await fetch(`${BACKEND_URL}/api/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save workspace settings');
      setWs(data);
      setWorkspaceName(data.name); // browser tab title follows the organisation name
      const d = toDraft(data);
      setDraft(d);
      setOriginal(JSON.stringify(d));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyAppId = () => {
    if (!ws) return;
    navigator.clipboard?.writeText(ws.appId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <>
      <SettingsPageHeader title="General" onBack={onBack}>
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
          {ro && <p className="ic-help">Only admins can change workspace settings. You’re viewing them read-only.</p>}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {loading && <p className="text-[14px] text-muted">Loading…</p>}

          {draft && ws && (
            <>
              <SettingsFormSection
                title="Workspace name & time zone"
                description="Your workspace name is shown to your teammates. The time zone is used for office hours and reports."
              >
                <div>
                  <label className="ic-label" htmlFor="ws-name">Name</label>
                  <input id="ws-name" className="ic-input" value={draft.name} maxLength={80} disabled={ro}
                    onChange={e => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="ic-label" htmlFor="ws-cfn">Customer-facing name</label>
                  <input id="ws-cfn" className="ic-input" value={draft.customerFacingName} maxLength={80} disabled={ro}
                    placeholder="Same as workspace name" onChange={e => set('customerFacingName', e.target.value)} />
                  <p className="ic-help mt-1.5">Shown to your customers in the Messenger. Defaults to your workspace name if blank.</p>
                </div>
                <div>
                  <label className="ic-label" htmlFor="ws-appid">App ID</label>
                  <div className="flex items-stretch">
                    <input id="ws-appid" className="ic-input rounded-r-none bg-subtle text-muted font-mono text-[13px]" value={ws.appId} readOnly />
                    <button type="button" onClick={copyAppId}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3.5 border border-l-0 border-line rounded-r-lg text-[13px] font-medium text-ink hover:bg-subtle transition-colors">
                      {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="ic-label" htmlFor="ws-tz">Time zone</label>
                  <select id="ws-tz" className="ic-select" value={draft.timezone} disabled={ro}
                    onChange={e => set('timezone', e.target.value)}>
                    {!draft.timezone && <option value="" disabled>Select a time zone</option>}
                    {tzOptions.map(z => <option key={z} value={z}>{tzLabel(z)}</option>)}
                  </select>
                  <p className="ic-help mt-1.5">Office hours use this time zone.</p>
                </div>
              </SettingsFormSection>

              <SettingsFormSection
                title="Conversation events for customers"
                description="Let customers see in the Messenger when their ticket's state changes."
              >
                <ToggleRow checked={draft.showStateToCustomer} disabled={ro} onChange={v => set('showStateToCustomer', v)}
                  label="Show ticket state changes to the customer" />
                <p className="ic-help mt-1.5">
                  Adds a small line to the customer’s chat: “Ticket in progress”, “Waiting on you”, “Ticket resolved” or “Conversation closed”. Notes and other team events stay private.
                </p>
              </SettingsFormSection>

              <SettingsFormSection
                title="Customer satisfaction (CSAT)"
                description="Ask customers to rate the help they got when a conversation is resolved."
              >
                <ToggleRow checked={draft.csatEnabled} disabled={ro} onChange={v => set('csatEnabled', v)}
                  label="Ask for a rating when a conversation is resolved" />
                <p className="ic-help mt-1.5">
                  The Messenger shows a 1–5 rating with an optional comment. Ratings appear in the conversation and in Analytics as your CSAT score (share of 4 and 5 ratings).
                </p>
              </SettingsFormSection>

              <SettingsFormSection
                title="Chai Samosa attribution"
                description="Let your customers know your Messenger is powered by Chai Samosa."
              >
                <ToggleRow checked={draft.showAttribution} disabled={ro} onChange={v => set('showAttribution', v)}
                  label="Show an attribution line at the bottom of the Messenger" />
                {draft.showAttribution && (
                  <div className="mt-4">
                    <label className="ic-label">Attribution text</label>
                    <input
                      className="ic-input"
                      value={draft.attributionText}
                      maxLength={60}
                      disabled={ro}
                      onChange={e => set('attributionText', e.target.value)}
                      placeholder="Powered by Chai Samosa"
                    />
                    <p className="ic-help mt-1.5">
                      Shown to customers at the bottom of the Messenger. Leave blank for “Powered by Chai Samosa”. {60 - draft.attributionText.length} characters left.
                    </p>
                  </div>
                )}
              </SettingsFormSection>

              <SettingsFormSection
                title="Snooze options"
                description="Choose the options teammates see when they snooze a conversation."
              >
                <div className="flex flex-col gap-2">
                  {draft.snoozeOptions.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select className="ic-select h-9 w-[150px] shrink-0" value={p.kind} disabled={ro} aria-label="Snooze option"
                        onChange={e => updateOption(i, { kind: e.target.value as SnoozePreset['kind'] })}>
                        {KIND_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {needsAmount(p.kind) && (
                        <input type="number" min={1} max={365} step={1} className="ic-input h-9 w-[76px] shrink-0" disabled={ro}
                          aria-label={p.kind === 'hours' ? 'Hours' : 'Days'}
                          value={Number.isFinite(p.amount) ? p.amount : ''}
                          onChange={e => updateOption(i, { amount: e.target.value === '' ? (NaN as any) : Math.floor(Number(e.target.value)) })} />
                      )}
                      <span className="flex-1 min-w-0 flex items-center gap-2 text-[13px] text-muted">
                        {i === 0 && <span className="ic-badge shrink-0">Quick snooze</span>}
                        <span className="truncate">
                          {p.label ? <>Shown as “{p.label}”</> : (needsAmount(p.kind) && Number.isFinite(p.amount) ? snoozeLabel(p) : '')}
                        </span>
                      </span>
                      {!ro && (
                        <button type="button" className="ic-icon-btn-ghost shrink-0" title="Remove option" disabled={draft.snoozeOptions.length <= 1}
                          onClick={() => set('snoozeOptions', draft.snoozeOptions.filter((_, idx) => idx !== i))}>
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="ic-help">The first option is used for quick snooze.</p>
                {!ro && (
                  <div className="flex items-center gap-4">
                    {draft.snoozeOptions.length < MAX_SNOOZE_OPTIONS ? (
                      <button type="button" className="ic-add-link text-[14px]"
                        onClick={() => set('snoozeOptions', [...draft.snoozeOptions, { kind: 'hours', amount: 1 }])}>
                        <Plus className="w-4 h-4" /> New option
                      </button>
                    ) : (
                      <span className="ic-help">You can add up to {MAX_SNOOZE_OPTIONS} options.</span>
                    )}
                    {!sameList(draft.snoozeOptions, DEFAULT_SNOOZE_OPTIONS) && (
                      <button type="button" className="ic-link text-[14px]"
                        onClick={() => set('snoozeOptions', clean(DEFAULT_SNOOZE_OPTIONS))}>
                        Reset to default
                      </button>
                    )}
                  </div>
                )}
              </SettingsFormSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
