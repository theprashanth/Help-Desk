import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, MessagesSquare, Ticket, Upload, Users, X,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { DataImportRecord, DataImportType } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader } from './shared';
import { timeAgo, fullDate } from '../../lib/timeAgo';

type Tab = 'imports' | 'exports';
type Field = { key: string; label: string; hint?: string };
type Preview = { type: DataImportType; headers: string[]; rowCount: number; sample: Record<string, string>[]; mapping: Record<string, string | null>; fields: Field[] };
type Result = { rows: number; created: number; updated: number; skipped: number; errors: { row: number; message: string }[]; conversationsCreated?: number; messagesCreated?: number };

const TYPES: { id: DataImportType; label: string; icon: React.ElementType; what: string; intercom: string }[] = [
  { id: 'people', label: 'People', icon: Users, what: 'Contacts: name, email, phone, user ID, location, tags. Existing people are matched by user ID or email and updated.', intercom: 'Intercom: Contacts › People › Export (CSV)' },
  { id: 'conversations', label: 'Conversations & tickets', icon: Ticket, what: 'One row per conversation or ticket, with its contact, state, assignee, tags and first message.', intercom: 'Intercom: conversations / tickets CSV export' },
  { id: 'messages', label: 'Conversation messages', icon: MessagesSquare, what: 'One row per message (“conversation parts”), attached by conversation ID. Import conversations first.', intercom: 'Intercom: conversation parts from a data export' },
];
const TYPE_LABEL: Record<DataImportType, string> = { people: 'People', conversations: 'Conversations & tickets', messages: 'Messages' };

const EXPORTS: { id: 'people' | 'conversations' | 'messages'; label: string; icon: React.ElementType; what: string }[] = [
  { id: 'people', label: 'People', icon: Users, what: 'Every contact with user ID, email, phone, location, tags, signed-up and last-seen dates.' },
  { id: 'conversations', label: 'Conversations & tickets', icon: Ticket, what: 'One row per conversation or ticket: state, priority, assignee, contact, tags, dates, first and last message.' },
  { id: 'messages', label: 'Messages', icon: MessagesSquare, what: 'One row per message, note and state change, with author and time.' },
];

/** Settings › Data › Imports & exports (CSV), compatible with Intercom's CSV exports. */
const DataSettings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const token = useStore(s => s.token);
  const agent = useStore(s => s.agent);
  const isAdmin = agent?.role === 'admin';
  const [tab, setTab] = useState<Tab>('imports');
  const [history, setHistory] = useState<DataImportRecord[] | null>(null);
  const [wizard, setWizard] = useState(false);

  const loadHistory = () => {
    if (!token || !isAdmin) return;
    fetch(`${BACKEND_URL}/api/data/imports`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  };
  useEffect(loadHistory, [token, isAdmin]);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col ic-panel overflow-hidden">
      <SettingsPageHeader title="Imports & exports" onBack={onBack}>
        {isAdmin && tab === 'imports' && history && history.length > 0 && (
          <button className="ic-btn-primary" onClick={() => setWizard(true)}><Upload className="w-4 h-4" /> Upload CSV</button>
        )}
      </SettingsPageHeader>
      <div className="ic-tabs px-8 shrink-0">
        <button className={`ic-tab ${tab === 'imports' ? 'ic-tab-active' : ''}`} onClick={() => setTab('imports')}>CSV imports</button>
        <button className={`ic-tab ${tab === 'exports' ? 'ic-tab-active' : ''}`} onClick={() => setTab('exports')}>CSV exports</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!isAdmin ? (
          <p className="px-8 py-10 text-[14px] text-muted">Only admins can import or export data.</p>
        ) : tab === 'imports' ? (
          history === null ? (
            <p className="px-8 py-10 text-[14px] text-muted">Loading…</p>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center text-center px-8 py-16">
              <Users className="w-12 h-12 text-muted mb-4" strokeWidth={1.5} />
              <h3 className="text-[19px] font-semibold text-ink">No imports yet</h3>
              <p className="text-[14.5px] text-muted mt-2 max-w-md leading-relaxed">
                Import people, conversations, tickets and their messages from a CSV file, including the CSV files you export from Intercom.
              </p>
              <button className="ic-btn-primary mt-5" onClick={() => setWizard(true)}><Upload className="w-4 h-4" /> Upload CSV</button>
            </div>
          ) : (
            <div className="px-8 py-6">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="text-left text-[12.5px] text-muted border-b border-line">
                    <th className="py-2 pr-4 font-medium">File</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Imported</th>
                    <th className="py-2 pr-4 font-medium text-right">Rows</th>
                    <th className="py-2 pr-4 font-medium text-right">Created</th>
                    <th className="py-2 pr-4 font-medium text-right">Updated</th>
                    <th className="py-2 pr-4 font-medium text-right">Skipped</th>
                    <th className="py-2 font-medium text-right">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className="border-b border-line/70">
                      <td className="py-3 pr-4"><span className="flex items-center gap-2 text-ink"><FileSpreadsheet className="w-4 h-4 text-muted shrink-0" /><span className="truncate max-w-[260px]" title={h.fileName}>{h.fileName}</span></span></td>
                      <td className="py-3 pr-4 text-muted">{TYPE_LABEL[h.type]}</td>
                      <td className="py-3 pr-4 text-muted" title={fullDate(h.at)}>{timeAgo(h.at)}{h.byName ? ` by ${h.byName}` : ''}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{h.rows}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{h.created}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{h.updated}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-muted">{h.skipped}</td>
                      <td className={`py-3 text-right tabular-nums ${h.errors ? 'text-red-600' : 'text-muted'}`}>{h.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <ExportsTab token={token} />
        )}
      </div>

      {wizard && <ImportWizard token={token} onClose={() => setWizard(false)} onDone={loadHistory} />}
    </div>
  );
};

// ── Exports ──────────────────────────────────────────────────────────────────

const RANGES = [
  { id: 'all', label: 'All time' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom' },
];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function ExportsTab({ token }: { token: string | null }) {
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(ymd(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const download = async (type: string) => {
    if (!token) return;
    setBusy(type); setMsg(null);
    const q = new URLSearchParams();
    if (range === 'custom') { q.set('from', from); q.set('to', to); }
    else if (range !== 'all') { q.set('from', ymd(new Date(Date.now() - Number(range) * 864e5))); q.set('to', ymd(new Date())); }
    try {
      const res = await fetch(`${BACKEND_URL}/api/data/exports/${type}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${type}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: `Downloaded ${name} (${res.headers.get('X-Row-Count') || '?'} rows)` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-6 flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[14px] text-muted mr-1">Date range</span>
        {RANGES.map(r => (
          <button key={r.id} onClick={() => setRange(r.id)}
            className={`h-8 px-3 rounded-full border text-[13px] ${range === r.id ? 'bg-ink text-surface border-ink' : 'border-line text-ink hover:bg-subtle'}`}>{r.label}</button>
        ))}
        {range === 'custom' && (
          <span className="flex items-center gap-2 ml-1">
            <input type="date" className="ic-input h-8 w-auto text-[13px]" value={from} max={to} onChange={e => setFrom(e.target.value)} />
            <span className="text-muted">to</span>
            <input type="date" className="ic-input h-8 w-auto text-[13px]" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted -mt-2">Conversations and messages use the date they were created; people use the date they were first seen. Column names match Intercom’s exports, and these files can be imported back.</p>
      {msg && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] ${msg.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
        </div>
      )}
      {EXPORTS.map(e => (
        <div key={e.id} className="ic-card p-5 flex items-center gap-4">
          <span className="w-10 h-10 rounded-xl bg-subtle flex items-center justify-center shrink-0"><e.icon className="w-5 h-5 text-ink" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-ink">{e.label}</p>
            <p className="text-[13.5px] text-muted leading-relaxed">{e.what}</p>
          </div>
          <button className="ic-btn-ghost border border-line shrink-0" disabled={!!busy} onClick={() => download(e.id)}>
            {busy === e.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export CSV
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Import wizard: type → file → columns → result ───────────────────────────

function ImportWizard({ token, onClose, onDone }: { token: string | null; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'type' | 'file' | 'map' | 'result'>('type');
  const [type, setType] = useState<DataImportType>('people');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const pick = async (f: File | undefined) => {
    if (!f || !token) return;
    setError(null);
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) { setError('Choose a .csv file'); return; }
    if (f.size > 25 * 1024 * 1024) { setError('Files can be up to 25 MB; split larger exports into several files'); return; }
    setBusy(true);
    try {
      const text = await f.text();
      setFile({ name: f.name, text });
      const res = await fetch(`${BACKEND_URL}/api/data/imports/preview?type=${type}`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${token}` }, body: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Couldn’t read the file');
      setPreview(data);
      setMapping(data.mapping);
      setStep('map');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!file || !token || !preview) return;
    setBusy(true); setError(null);
    try {
      const q = new URLSearchParams({ type, fileName: file.name, mapping: JSON.stringify(mapping) });
      const res = await fetch(`${BACKEND_URL}/api/data/imports?${q}`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${token}` }, body: file.text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The import failed');
      setResult(data);
      setStep('result');
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const errorReport = () => {
    if (!result?.errors.length) return;
    const csv = 'Row,Problem\r\n' + result.errors.map(e => `${e.row},"${e.message.replace(/"/g, '""')}"`).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `import-errors-${file?.name || 'file'}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const sample = preview?.sample[0] || {};
  const typeInfo = TYPES.find(t => t.id === type)!;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-ink/25 flex items-center justify-center p-4 animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-[760px] max-w-full max-h-[90vh] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden" role="dialog" aria-label="Import CSV">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
          {(step === 'file' || step === 'map') && (
            <button className="ic-icon-btn-ghost" disabled={busy} onClick={() => { setError(null); setStep(step === 'map' ? 'file' : 'type'); }} title="Back"><ArrowLeft className="w-[18px] h-[18px]" /></button>
          )}
          <h3 className="flex-1 text-[16px] font-semibold text-ink">
            {step === 'type' ? 'What are you importing?' : step === 'file' ? `Upload ${typeInfo.label.toLowerCase()}` : step === 'map' ? 'Match your columns' : 'Import finished'}
          </h3>
          <button className="ic-icon-btn-ghost" disabled={busy} onClick={onClose} title="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-[14px]"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>
          )}

          {step === 'type' && (
            <div className="flex flex-col gap-2.5">
              {TYPES.map(t => (
                <button key={t.id} onClick={() => { setType(t.id); setStep('file'); }}
                  className="w-full flex items-start gap-4 p-4 rounded-xl border border-line hover:bg-subtle text-left">
                  <span className="w-10 h-10 rounded-xl bg-subtle flex items-center justify-center shrink-0"><t.icon className="w-5 h-5 text-ink" /></span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-ink">{t.label}</span>
                    <span className="block text-[13.5px] text-muted leading-relaxed mt-0.5">{t.what}</span>
                    <span className="block text-[12.5px] text-faint mt-1">{t.intercom}</span>
                  </span>
                </button>
              ))}
              <p className="text-[12.5px] text-muted mt-2">Importing a full Intercom history? Import <b>People</b> first, then <b>Conversations & tickets</b>, then <b>Conversation messages</b>, so everything links up. Re-importing the same file skips rows that were already imported.</p>
            </div>
          )}

          {step === 'file' && (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
              className={`flex flex-col items-center justify-center text-center gap-3 py-14 rounded-2xl border-2 border-dashed ${drag ? 'border-ink/50 bg-subtle' : 'border-line'}`}
            >
              {busy ? <Loader2 className="w-8 h-8 animate-spin text-muted" /> : <FileSpreadsheet className="w-10 h-10 text-muted" strokeWidth={1.5} />}
              <p className="text-[15px] text-ink font-medium">{busy ? 'Reading the file…' : 'Drop a CSV file here'}</p>
              <p className="text-[13px] text-muted max-w-sm">{typeInfo.what}</p>
              <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <button className="ic-btn-primary mt-1" disabled={busy} onClick={() => inputRef.current?.click()}><Upload className="w-4 h-4" /> Choose file</button>
              <p className="text-[12px] text-faint">Up to 25 MB and 100,000 rows. The first line must be the column names.</p>
            </div>
          )}

          {step === 'map' && preview && (
            <div className="flex flex-col gap-3">
              <p className="text-[13.5px] text-muted">
                <b className="text-ink">{file?.name}</b> · {preview.rowCount.toLocaleString()} {preview.rowCount === 1 ? 'row' : 'rows'} · {preview.headers.length} columns. We matched {mappedCount} columns automatically; check them and change any that are wrong.
              </p>
              <div className="rounded-xl border border-line overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 px-4 py-2 bg-subtle text-[12.5px] font-medium text-muted">
                  <span>Field here</span><span>Column in your file</span><span>First row</span>
                </div>
                {preview.fields.map(f => (
                  <div key={f.key} className="grid grid-cols-[1fr_1fr_1fr] gap-3 px-4 py-2.5 border-t border-line items-center">
                    <span className="min-w-0">
                      <span className="block text-[14px] text-ink">{f.label}</span>
                      {f.hint && <span className="block text-[12px] text-faint leading-snug">{f.hint}</span>}
                    </span>
                    <select className="ic-input h-9 text-[13.5px]" value={mapping[f.key] || ''}
                      onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || null }))}>
                      <option value="">Don’t import</option>
                      {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className="text-[13px] text-muted truncate" title={mapping[f.key] ? sample[mapping[f.key]!] : ''}>
                      {mapping[f.key] ? (sample[mapping[f.key]!] || <span className="text-faint">(empty)</span>) : <span className="text-faint">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                <p className="text-[15px] text-ink">
                  {TYPE_LABEL[type]} from <b>{file?.name}</b>: {result.rows.toLocaleString()} rows processed.
                </p>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  ['Created', result.created, 'text-emerald-700 dark:text-emerald-300'],
                  ['Updated', result.updated, 'text-ink'],
                  ['Skipped', result.skipped, 'text-muted'],
                  ['Errors', result.errors.length, result.errors.length ? 'text-red-600' : 'text-muted'],
                ].map(([label, n, cls]) => (
                  <div key={label as string} className="ic-card p-4">
                    <p className="text-[12.5px] text-muted">{label}</p>
                    <p className={`text-[24px] font-semibold tabular-nums ${cls}`}>{(n as number).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              {type === 'messages' && !!result.conversationsCreated && (
                <p className="text-[13px] text-muted">{result.conversationsCreated} conversation{result.conversationsCreated === 1 ? ' wasn’t' : 's weren’t'} in your inbox yet, so {result.conversationsCreated === 1 ? 'it was' : 'they were'} created for these messages.</p>
              )}
              {result.skipped > 0 && <p className="text-[13px] text-muted">Skipped rows were already imported{type === 'messages' ? ' or have no text (assignments, state changes)' : ''}.</p>}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-red-200 dark:border-red-500/30 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-red-50 dark:bg-red-500/10 text-[13px] text-red-700 dark:text-red-300">
                    <span>Rows that weren’t imported</span>
                    <button className="ic-link text-[13px]" onClick={errorReport}>Download error report</button>
                  </div>
                  {result.errors.slice(0, 20).map(e => (
                    <div key={e.row} className="px-4 py-2 border-t border-red-100 dark:border-red-500/20 text-[13px] text-ink">Row {e.row}: {e.message}</div>
                  ))}
                  {result.errors.length > 20 && <div className="px-4 py-2 border-t border-red-100 text-[13px] text-muted">…and {result.errors.length - 20} more in the report</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {(step === 'map' || step === 'result') && (
          <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-line shrink-0">
            {step === 'map' ? (
              <>
                <button className="ic-btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
                <button className="ic-btn-primary" disabled={busy || !mappedCount} onClick={runImport}>
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : `Import ${preview?.rowCount.toLocaleString()} ${preview?.rowCount === 1 ? 'row' : 'rows'}`}
                </button>
              </>
            ) : (
              <>
                <button className="ic-btn-ghost" onClick={() => { setResult(null); setPreview(null); setFile(null); setStep('type'); }}>Import another file</button>
                <button className="ic-btn-primary" onClick={onClose}>Done</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default DataSettings;
