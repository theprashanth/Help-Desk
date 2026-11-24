import { useEffect, useMemo, useState } from 'react';
import { Search, AlertCircle, ScrollText, Download } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { AuditEntry } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader } from './shared';

const AREAS: { value: string; label: string }[] = [
  { value: '', label: 'All activity' },
  { value: 'settings', label: 'Settings' },
  { value: 'teammate', label: 'Teammates' },
  { value: 'team', label: 'Teams' },
  { value: 'data', label: 'Data (imports, exports, deletions)' },
  { value: 'security', label: 'Security' },
  { value: 'integration', label: 'Integrations' },
  { value: 'macro', label: 'Macros' },
  { value: 'company', label: 'Companies' },
];

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Settings › Audit log (admins): who changed settings, teammates, teams or data, and when. */
export default function AuditLogSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [area, setArea] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(query), 250); return () => clearTimeout(t); }, [query]);
  useEffect(() => {
    if (!token || me?.role !== 'admin') { setLoading(false); return; }
    setLoading(true);
    const qs = new URLSearchParams({ limit: '500', ...(area ? { area } : {}), ...(debounced.trim() ? { search: debounced.trim() } : {}) });
    fetch(`${BACKEND_URL}/api/audit-log?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load the audit log'); return d; })
      .then(d => { setEntries(d.entries); setTotal(d.total); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, me?.role, area, debounced]);

  // Group by day for reading
  const groups = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const day = new Date(e.createdAt || '').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [entries]);

  const downloadCsv = () => {
    const rows = [['Time', 'Teammate', 'Action', 'Summary', 'Target', 'IP'], ...entries.map(e => [e.createdAt, e.actor?.name || 'System', e.action, e.summary, e.target || '', e.ip || ''])];
    const blob = new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <SettingsPageHeader title="Audit log" onBack={onBack}>
        {entries.length > 0 && <button type="button" onClick={downloadCsv} className="ic-btn-ghost"><Download className="w-4 h-4" /> Download CSV</button>}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="max-w-5xl flex flex-col gap-4">
          {me?.role !== 'admin' ? (
            <div className="ic-card p-10 text-center text-[14px] text-muted">Only admins can see the audit log.</div>
          ) : (
            <>
              <p className="text-[14px] text-muted">Changes to settings, teammates, teams and data, with who made them. Conversation activity is in each conversation's events.</p>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 ic-input h-9 w-72 max-w-full">
                  <Search className="w-4 h-4 text-muted shrink-0" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search activity or teammates" className="flex-1 min-w-0 bg-transparent focus:outline-none" />
                </label>
                <select className="ic-input h-9 w-64" value={area} onChange={e => setArea(e.target.value)} aria-label="Filter by area">
                  {AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                <span className="text-[13px] text-muted ml-auto">{total > entries.length ? `Showing ${entries.length} of ${total}` : `${total} entr${total === 1 ? 'y' : 'ies'}`}</span>
              </div>
              {error && (
                <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}
              {loading ? <p className="text-[14px] text-muted">Loading…</p> : entries.length === 0 ? (
                <div className="ic-card p-10 text-center">
                  <ScrollText className="w-8 h-8 text-muted mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-[14px] text-muted">{query || area ? 'No matching activity.' : 'Nothing recorded yet. Changes to settings, teammates and data will appear here.'}</p>
                </div>
              ) : groups.map(g => (
                <div key={g.day} className="ic-card overflow-hidden">
                  <div className="px-5 h-10 flex items-center bg-sidebar border-b border-line text-[13px] font-medium text-muted">{g.day}</div>
                  {g.items.map(e => (
                    <div key={e.id} className="px-5 py-3 border-b border-line last:border-b-0 flex items-start gap-3">
                      <span className="w-7 h-7 rounded-full bg-subtle text-[11px] font-semibold flex items-center justify-center uppercase shrink-0 mt-0.5">{(e.actor?.name || 'S').charAt(0)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-ink"><span className="font-medium">{e.actor?.name || 'System'}</span> · {e.summary}</p>
                        <p className="text-[12.5px] text-muted mt-0.5">
                          <span className="font-mono">{e.action}</span>{e.ip ? ` · ${e.ip}` : ''}
                        </p>
                      </div>
                      <span className="text-[12.5px] text-faint tabular-nums shrink-0" title={new Date(e.createdAt || '').toLocaleString()}>
                        {new Date(e.createdAt || '').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
