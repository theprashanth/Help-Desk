import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle, Check, Archive, ArchiveRestore } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { CustomAttributeDef } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';
import { refreshAttributeDefs } from '../agent/CustomerOrgFields';

const TYPES: { value: CustomAttributeDef['type']; label: string }[] = [
  { value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'boolean', label: 'True / false' },
  { value: 'date', label: 'Date' }, { value: 'list', label: 'List' },
];
const keyFrom = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

type Row = CustomAttributeDef & { optionsText?: string; isNew?: boolean };

/**
 * Settings › People data: custom attributes on people (e.g. Plan, Seats, VIP). Defined once here,
 * filled in per person from the conversation sidebar. Archiving hides a field but keeps its values.
 */
export default function PeopleDataSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const [rows, setRows] = useState<Row[]>([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fromDefs = (defs: CustomAttributeDef[]): Row[] => defs.map(d => ({ ...d, optionsText: (d.options || []).join(', ') }));
  const toDefs = (rs: Row[]): CustomAttributeDef[] => rs.map(r => ({
    key: r.key, label: r.label.trim(), type: r.type,
    ...(r.type === 'list' ? { options: (r.optionsText || '').split(',').map(o => o.trim()).filter(Boolean) } : {}),
    ...(r.archived ? { archived: true } : {}),
  }));

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/people-attributes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((d: CustomAttributeDef[]) => { setRows(fromDefs(d)); setOriginal(JSON.stringify(d)); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const dirty = JSON.stringify(toDefs(rows)) !== original;
  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, ...patch };
    if (r.isNew && patch.label !== undefined) next.key = keyFrom(patch.label); // keys are fixed once saved
    return next;
  }));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/people-attributes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ attributes: toDefs(rows) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setRows(fromDefs(data)); setOriginal(JSON.stringify(data));
      refreshAttributeDefs();
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <SettingsPageHeader title="People data" onBack={onBack}>
        {saved && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> Saved</span>}
        {isAdmin && <button type="button" onClick={save} disabled={!dirty || saving} className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none">{saving ? 'Saving…' : 'Save'}</button>}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="max-w-5xl flex flex-col gap-4">
          {!isAdmin && <p className="ic-help">Only admins can change people data. You’re viewing it read-only.</p>}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {loading ? <p className="text-[14px] text-muted">Loading…</p> : (
            <SettingsFormSection
              title="Custom attributes"
              description="Extra fields on people, like their plan or number of seats. Teammates fill them in from the conversation sidebar. Archive a field to hide it without losing its values."
            >
              <div className="flex flex-col gap-2">
                {rows.length === 0 && <p className="text-[14px] text-muted">No custom attributes yet.</p>}
                {rows.map((r, i) => (
                  <div key={i} className={`rounded-xl border border-line p-3 flex flex-col gap-2 ${r.archived ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <input className="ic-input h-9 flex-1 min-w-0" placeholder="Label, e.g. Plan" value={r.label} maxLength={60} disabled={!isAdmin}
                        onChange={e => update(i, { label: e.target.value })} aria-label="Attribute label" />
                      <select className="ic-input h-9 w-36" value={r.type} disabled={!isAdmin || !r.isNew} onChange={e => update(i, { type: e.target.value as Row['type'] })} aria-label="Attribute type">
                        {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {isAdmin && (r.isNew
                        ? <button type="button" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} title="Remove" className="ic-icon-btn-ghost"><Trash2 className="w-4 h-4" /></button>
                        : <button type="button" onClick={() => update(i, { archived: !r.archived })} title={r.archived ? 'Restore' : 'Archive'} className="ic-icon-btn-ghost">
                            {r.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                          </button>)}
                    </div>
                    {r.type === 'list' && (
                      <input className="ic-input h-9" placeholder="Choices, separated by commas (e.g. Free, Pro, Enterprise)" value={r.optionsText || ''} disabled={!isAdmin}
                        onChange={e => update(i, { optionsText: e.target.value })} aria-label="List choices" />
                    )}
                    <p className="text-[12px] text-faint font-mono">{r.key || 'key'}{r.archived ? ' · archived' : ''}</p>
                  </div>
                ))}
                {isAdmin && (
                  <button type="button" onClick={() => setRows(rs => [...rs, { key: '', label: '', type: 'text', isNew: true }])} className="ic-btn-ghost self-start">
                    <Plus className="w-4 h-4" /> Add attribute
                  </button>
                )}
              </div>
            </SettingsFormSection>
          )}
        </div>
      </div>
    </>
  );
}
