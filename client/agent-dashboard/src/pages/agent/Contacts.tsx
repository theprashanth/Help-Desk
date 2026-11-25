import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, Ban, Building2, ChevronLeft, ChevronRight, Download, GitMerge, Globe, Mail,
  MessageSquare, Phone, Plus, Search, Ticket, Trash2, Users, Wrench, X,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Company, Customer } from '../../../../../shared/src/types';
import CustomerOrgFields from '../../components/agent/CustomerOrgFields';
import { StatusPill } from '../../components/agent/mergeUi';
import TimeHover from '../../components/ui/TimeHover';
import { shortAgo } from '../../lib/timeAgo';

const BACKEND_URL = 'http://localhost:3000';

/**
 * Contacts: everyone who has written in. Search, filter by tag / company / status, sort by any column,
 * export to CSV, open a contact to see their whole history and edit them, merge two records of the same
 * person, and (admins) delete a contact with all their conversations.
 */

type Row = {
  id: string; name: string; email?: string; phone?: string; externalId?: string;
  companyId?: string; companyName?: string; tags: string[]; country?: string;
  firstSeen?: string; lastSeen?: string; lastContacted?: string;
  conversations: number; openConversations: number; blocked?: boolean;
};
type Sort = 'name' | 'lastSeen' | 'firstSeen' | 'conversations' | 'lastContacted';
type Detail = {
  customer: Customer;
  company: Company | null;
  conversations: { id: string; ticketNumber: string; kind: string; title?: string; status: string; channel?: string; snippet?: string; createdAt: string; updatedAt: string; mergedInto?: boolean; rating?: number }[];
  pageViews: { url: string; at: string }[];
};

const initial = (name?: string) => (name || '?').trim().charAt(0).toUpperCase() || '?';
const num = (t: string) => `#${t.replace(/^#/, '')}`;

function useApi() {
  const token = useStore(s => s.token);
  return useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }, [token]);
}

export const Contacts: React.FC<{ onOpenConversation: (id: string) => void }> = ({ onOpenConversation }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  return openId ? (
    <ContactDetail
      id={openId}
      onBack={() => { setOpenId(null); setReloadKey(k => k + 1); }}
      onOpenContact={setOpenId}
      onOpenConversation={onOpenConversation}
    />
  ) : (
    <ContactList key={reloadKey} onOpen={setOpenId} />
  );
};

// ── List ────────────────────────────────────────────────────────────────────

const COLUMNS: { key: Sort | null; label: string; className: string }[] = [
  { key: 'name', label: 'Name', className: 'min-w-[220px] flex-[2]' },
  { key: null, label: 'Company', className: 'w-[160px] hidden lg:block' },
  { key: null, label: 'Tags', className: 'w-[180px] hidden xl:block' },
  { key: 'conversations', label: 'Conversations', className: 'w-[130px]' },
  { key: 'lastContacted', label: 'Last contacted', className: 'w-[130px] hidden md:block' },
  { key: 'lastSeen', label: 'Last seen', className: 'w-[110px]' },
];

const ContactList: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const api = useApi();
  const token = useStore(s => s.token);
  const tags = useStore(s => s.tags);
  const isLight = useStore(s => s.agent?.role === 'light');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<Sort>('lastSeen');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; pageSize: number; rows: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [merging, setMerging] = useState<Row[] | null>(null);
  const [exporting, setExporting] = useState(false);

  // Search as you type, a beat after the last key
  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => { api('/api/companies').then(setCompanies).catch(() => {}); }, [api]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, dir, page: String(page), pageSize: '50' });
    if (query) p.set('search', query);
    if (tag) p.set('tag', tag);
    if (companyId) p.set('companyId', companyId);
    if (status) p.set('status', status);
    return p;
  }, [query, tag, companyId, status, sort, dir, page]);

  const load = useCallback(() => {
    api(`/api/contacts?${params}`).then(d => { setData(d); setError(null); }).catch(e => setError(e.message));
  }, [api, params]);
  useEffect(() => { load(); }, [load]);

  const sortBy = (k: Sort) => {
    if (sort === k) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(k); setDir(k === 'name' ? 'asc' : 'desc'); }
    setPage(0);
  };
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(-2)));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params); p.delete('page'); p.delete('pageSize');
      const res = await fetch(`${BACKEND_URL}/api/contacts/export.csv?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
    setExporting(false);
  };

  const rows = data?.rows || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(query || tag || companyId || status);

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      <div className="ic-panel-header justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <Users className="w-5 h-5 text-muted shrink-0" />
          <h1 className="ic-title">Contacts</h1>
          {data && <span className="text-[14px] text-muted tabular-nums">{data.total.toLocaleString()}</span>}
        </div>
        <div className="flex items-center gap-2">
          {selected.length === 2 && !isLight && (
            <button className="ic-btn-secondary h-8 text-[13px]" onClick={() => setMerging(rows.filter(r => selected.includes(r.id)).length === 2 ? rows.filter(r => selected.includes(r.id)) : null)}>
              <GitMerge className="w-4 h-4" /> Merge 2 contacts
            </button>
          )}
          {!isLight && (
            <button className="ic-btn-secondary h-8 text-[13px]" onClick={exportCsv} disabled={exporting || !data?.total}>
              <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
        <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface flex-1 min-w-[220px] max-w-[420px]">
          <Search className="w-4 h-4 text-muted shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone, user ID or company" className="flex-1 min-w-0 bg-transparent text-[14px] focus:outline-none placeholder:text-faint" />
          {search && <button onClick={() => setSearch('')} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>}
        </label>
        <select className="ic-select h-9 w-[150px] text-[13px]" value={tag} onChange={e => { setTag(e.target.value); setPage(0); }} aria-label="Tag">
          <option value="">All tags</option>
          {tags.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <select className="ic-select h-9 w-[170px] text-[13px]" value={companyId} onChange={e => { setCompanyId(e.target.value); setPage(0); }} aria-label="Company">
          <option value="">All companies</option>
          <option value="none">No company</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="ic-select h-9 w-[200px] text-[13px]" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} aria-label="Status">
          <option value="">Everyone</option>
          <option value="open">With an open conversation</option>
          <option value="blocked">Blocked</option>
        </select>
        {filtered && (
          <button className="text-[13px] text-muted hover:text-ink" onClick={() => { setSearch(''); setTag(''); setCompanyId(''); setStatus(''); }}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-surface flex items-center gap-4 px-5 h-10 border-b border-line text-[12.5px] font-medium text-muted">
          <span className="w-5 shrink-0" />
          {COLUMNS.map(c => (
            <div key={c.label} className={`${c.className} shrink-0`}>
              {c.key ? (
                <button onClick={() => sortBy(c.key!)} className={`inline-flex items-center gap-1 hover:text-ink ${sort === c.key ? 'text-ink' : ''}`}>
                  {c.label}
                  {sort === c.key && (dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                </button>
              ) : c.label}
            </div>
          ))}
        </div>
        {error && <p className="px-5 py-4 text-[14px] text-red-600">{error}</p>}
        {!data && !error && <p className="px-5 py-10 text-center text-[14px] text-muted">Loading contacts…</p>}
        {data && !rows.length && (
          <p className="px-5 py-14 text-center text-[14px] text-muted">{filtered ? 'No contacts match these filters' : 'No contacts yet. People appear here once they write in.'}</p>
        )}
        {rows.map(r => (
          <div key={r.id} onClick={() => onOpen(r.id)} className="group flex items-center gap-4 px-5 min-h-[56px] py-2 border-b border-line/70 hover:bg-subtle/60 cursor-pointer text-[13.5px]">
            <span className="w-5 shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
              {!isLight && (
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)}
                  className={`w-4 h-4 ${selected.includes(r.id) ? '' : 'opacity-0 group-hover:opacity-100'}`} title="Select to merge" />
              )}
            </span>
            <div className="min-w-[220px] flex-[2] shrink-0 flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200 flex items-center justify-center text-[13px] font-semibold shrink-0">{initial(r.name)}</span>
              <span className="min-w-0 flex flex-col">
                <span className="text-ink font-medium truncate flex items-center gap-1.5">
                  {r.name}{r.blocked && <span className="ic-badge text-[11px] text-red-600">Blocked</span>}
                </span>
                <span className="text-muted truncate text-[12.5px]">{r.email || r.phone || r.externalId || 'No email'}</span>
              </span>
            </div>
            <div className="w-[160px] shrink-0 truncate text-muted hidden lg:block">{r.companyName || '—'}</div>
            <div className="w-[180px] shrink-0 hidden xl:flex gap-1 overflow-hidden">
              {r.tags.slice(0, 2).map(t => <span key={t} className="ic-badge text-[11.5px] truncate max-w-[85px]">{t}</span>)}
              {r.tags.length > 2 && <span className="text-[12px] text-muted">+{r.tags.length - 2}</span>}
              {!r.tags.length && <span className="text-faint">—</span>}
            </div>
            <div className="w-[130px] shrink-0 tabular-nums text-ink">
              {r.conversations}
              {r.openConversations > 0 && <span className="ml-1.5 text-[12px] text-accent">{r.openConversations} open</span>}
            </div>
            <div className="w-[130px] shrink-0 text-muted hidden md:block">{r.lastContacted ? <TimeHover iso={r.lastContacted}>{shortAgo(r.lastContacted)}</TimeHover> : '—'}</div>
            <div className="w-[110px] shrink-0 text-muted">{r.lastSeen ? <TimeHover iso={r.lastSeen}>{shortAgo(r.lastSeen)}</TimeHover> : '—'}</div>
          </div>
        ))}
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between px-5 h-12 border-t border-line text-[13px] text-muted shrink-0">
          <span>{page * data.pageSize + 1}–{Math.min(data.total, (page + 1) * data.pageSize)} of {data.total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button className="ic-icon-btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)} title="Previous"><ChevronLeft className="w-4 h-4" /></button>
            <span className="tabular-nums">{page + 1} / {pages}</span>
            <button className="ic-icon-btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} title="Next"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {merging && (
        <MergeContactsDialog
          a={merging[0]}
          b={merging[1]}
          onClose={() => setMerging(null)}
          onMerged={id => { setMerging(null); setSelected([]); onOpen(id); }}
        />
      )}
    </div>
  );
};

// ── Merge ───────────────────────────────────────────────────────────────────

type MergeSide = { id: string; name: string; email?: string; phone?: string; externalId?: string; conversations?: number };

const Modal: React.FC<{ onClose: () => void; busy?: boolean; width?: number; children: React.ReactNode }> = ({ onClose, busy, width = 520, children }) =>
  createPortal(
    <div className="fixed inset-0 z-[60] bg-ink/25 flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
      <div className="max-w-full bg-surface rounded-2xl shadow-pop border border-line overflow-hidden" style={{ width }}>{children}</div>
    </div>,
    document.body,
  );

/** Pick which record to keep; the other one's conversations move into it. */
const MergeContactsDialog: React.FC<{ a: MergeSide; b: MergeSide; onClose: () => void; onMerged: (primaryId: string) => void }> = ({ a, b, onClose, onMerged }) => {
  const api = useApi();
  const [primary, setPrimary] = useState(() => ((b.conversations || 0) > (a.conversations || 0) ? b.id : a.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = primary === a.id ? a : b;
  const other = primary === a.id ? b : a;

  const merge = async () => {
    setBusy(true); setError(null);
    try {
      await api('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ primaryId: keep.id, secondaryId: other.id }) });
      onMerged(keep.id);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const card = (s: MergeSide) => (
    <button key={s.id} onClick={() => setPrimary(s.id)}
      className={`flex-1 min-w-0 text-left rounded-xl border p-3.5 flex flex-col gap-1 ${primary === s.id ? 'border-ink ring-2 ring-ink/10' : 'border-line hover:border-ink/30'}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-ink truncate">{s.name}</span>
        {primary === s.id && <span className="ic-badge text-[11px]">Keep</span>}
      </span>
      <span className="text-[12.5px] text-muted truncate">{s.email || 'No email'}</span>
      <span className="text-[12.5px] text-muted truncate">{s.phone || 'No phone'}</span>
      {s.externalId && <span className="text-[12.5px] text-muted truncate">ID {s.externalId}</span>}
      {s.conversations !== undefined && <span className="text-[12.5px] text-muted">{s.conversations} conversation{s.conversations === 1 ? '' : 's'}</span>}
    </button>
  );

  return (
    <Modal onClose={onClose} busy={busy} width={560}>
      <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
        <GitMerge className="w-[18px] h-[18px] text-muted" />
        <h3 className="flex-1 text-[16px] font-semibold text-ink">Merge contacts</h3>
        <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-[13.5px] text-muted">Pick the record to keep. Use this when the same person was recorded twice, e.g. once by email and once in the Messenger.</p>
        <div className="flex gap-3">{card(a)}{card(b)}</div>
        <p className="text-[13px] text-muted leading-relaxed">
          {other.name}'s conversations move to {keep.name}. Empty fields are filled from {other.name}; tags, notes and attributes are combined.
          {' '}{other.name}'s record is then removed. This can't be undone.
        </p>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
        <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={merge} className="ic-btn-primary" disabled={busy}>{busy ? 'Merging…' : `Merge into ${keep.name}`}</button>
      </div>
    </Modal>
  );
};

/** Find the other record to merge with (from a contact's page). */
const PickContactDialog: React.FC<{ exclude: string; onClose: () => void; onPick: (row: Row) => void }> = ({ exclude, onClose, onPick }) => {
  const api = useApi();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api(`/api/contacts?pageSize=20&sort=lastSeen${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ''}`)
        .then(d => setRows(d.rows.filter((r: Row) => r.id !== exclude))).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, api, exclude]);
  return (
    <Modal onClose={onClose} width={520}>
      <label className="flex items-center gap-3 px-5 h-14 border-b border-line">
        <Search className="w-[18px] h-[18px] text-muted" />
        <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Find the other record of this person…" className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-faint" />
        <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
      </label>
      <div className="max-h-[360px] overflow-y-auto p-2">
        {rows === null && <p className="px-3 py-6 text-center text-[14px] text-muted">Searching…</p>}
        {rows?.length === 0 && <p className="px-3 py-6 text-center text-[14px] text-muted">No other contacts match</p>}
        {rows?.map(r => (
          <button key={r.id} onClick={() => onPick(r)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-subtle text-left">
            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200 flex items-center justify-center text-[13px] font-semibold shrink-0">{initial(r.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-ink truncate">{r.name}</span>
              <span className="block text-[12.5px] text-muted truncate">{r.email || r.phone || r.externalId || r.id}</span>
            </span>
            <span className="text-[12.5px] text-muted shrink-0">{r.conversations} conv.</span>
          </button>
        ))}
      </div>
    </Modal>
  );
};

// ── One contact ─────────────────────────────────────────────────────────────

const ContactDetail: React.FC<{
  id: string;
  onBack: () => void;
  onOpenContact: (id: string) => void;
  onOpenConversation: (id: string) => void;
}> = ({ id, onBack, onOpenContact, onOpenConversation }) => {
  const api = useApi();
  const me = useStore(s => s.agent);
  const isLight = me?.role === 'light';
  const isAdmin = me?.role === 'admin';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [mergeWith, setMergeWith] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api(`/api/contacts/${id}`).then(d => { setDetail(d); setError(null); }).catch(e => setError(e.message));
  }, [api, id]);
  useEffect(() => { setDetail(null); load(); }, [load]);

  const save = async (patch: Partial<Customer>) => {
    try {
      const customer = await api(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
      setDetail(d => (d ? { ...d, customer } : d));
    } catch (e: any) { setError(e.message); }
  };

  if (error && !detail) return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      <div className="ic-panel-header"><button onClick={onBack} className="ic-icon-btn-ghost"><ArrowLeft className="w-5 h-5" /></button><h1 className="ic-title">Contact</h1></div>
      <p className="p-8 text-[14px] text-muted">{error}</p>
    </div>
  );
  if (!detail) return <div className="ic-panel flex-1 min-w-0 h-full flex items-center justify-center text-[14px] text-muted">Loading contact…</div>;

  const c = detail.customer;
  const open = detail.conversations.filter(x => x.status === 'open' || x.status === 'waiting').length;

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      <div className="ic-panel-header justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <button onClick={onBack} className="ic-icon-btn-ghost shrink-0" title="Back to contacts"><ArrowLeft className="w-5 h-5" /></button>
          <span className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200 flex items-center justify-center text-[15px] font-semibold shrink-0">{initial(c.name)}</span>
          <h1 className="ic-title">{c.name}</h1>
          {c.blocked && <span className="ic-badge text-red-600">Blocked</span>}
        </div>
        {!isLight && (
          <div className="flex items-center gap-2">
            <button className="ic-btn-secondary h-8 text-[13px]" onClick={() => setPicking(true)}><GitMerge className="w-4 h-4" /> Merge…</button>
            <button className="ic-btn-secondary h-8 text-[13px]" onClick={() => save({ blocked: !c.blocked })}>
              <Ban className="w-4 h-4" /> {c.blocked ? 'Unblock' : 'Block'}
            </button>
            {isAdmin && (
              <button className="ic-btn-secondary h-8 text-[13px] text-red-600" onClick={() => setDeleting(true)}><Trash2 className="w-4 h-4" /> Delete</button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1100px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
          {/* Profile */}
          <div className="flex flex-col gap-4">
            <section className="ic-card p-4 flex flex-col gap-1">
              <h2 className="text-[14px] font-semibold text-ink mb-1">Profile</h2>
              <EditableRow icon={<Users className="w-4 h-4" />} label="Name" value={c.name} readOnly={isLight} onSave={v => v.trim() && save({ name: v.trim() })} />
              <EditableRow icon={<Mail className="w-4 h-4" />} label="Email" value={c.email || ''} readOnly={isLight} onSave={v => save({ email: v.trim() })} />
              <EditableRow icon={<Phone className="w-4 h-4" />} label="Phone" value={c.phone || ''} readOnly={isLight} onSave={v => save({ phone: v.trim() })} />
              <InfoRow label="User ID" value={c.id} />
              {c.externalId && <InfoRow label="External ID" value={c.externalId} />}
              {c.session?.country && <InfoRow label="Country" value={c.session.country} />}
              {(c.session?.browser || c.session?.os) && <InfoRow label="Device" value={[c.session.browser, c.session.os].filter(Boolean).join(' · ')} />}
              <InfoRow label="First seen" value={c.session?.firstSeen ? new Date(c.session.firstSeen).toLocaleString() : '—'} />
              <InfoRow label="Last seen" value={c.session?.lastSeen ? new Date(c.session.lastSeen).toLocaleString() : '—'} />
            </section>

            <section className="ic-card p-4">
              <h2 className="text-[14px] font-semibold text-ink mb-2 flex items-center gap-2"><Building2 className="w-4 h-4 text-muted" /> Company and attributes</h2>
              <CustomerOrgFields customer={c} conversationId={null} readOnly={isLight} onUpdated={customer => setDetail(d => (d ? { ...d, customer } : d))} />
            </section>

            <section className="ic-card p-4">
              <h2 className="text-[14px] font-semibold text-ink mb-2">Tags</h2>
              <div className="flex flex-wrap gap-1.5">
                {(c.tags || []).map(t => (
                  <span key={t} className="ic-badge text-[12px] inline-flex items-center gap-1">
                    {t}
                    {!isLight && <button onClick={() => save({ tags: c.tags.filter(x => x !== t) })} className="text-muted hover:text-ink" title="Remove tag"><X className="w-3 h-3" /></button>}
                  </span>
                ))}
                {!c.tags?.length && <span className="text-[13px] text-faint">No tags</span>}
                {!isLight && <TagAdder existing={c.tags || []} onAdd={t => save({ tags: [...(c.tags || []), t] })} />}
              </div>
            </section>

            <section className="ic-card p-4 flex flex-col gap-2">
              <h2 className="text-[14px] font-semibold text-ink">Notes</h2>
              {(c.notes || []).length === 0 && <p className="text-[13px] text-faint">No notes yet</p>}
              {(c.notes || []).map((n, i) => (
                <p key={i} className="text-[13px] text-ink bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2 whitespace-pre-wrap">{n}</p>
              ))}
              {!isLight && (
                <div className="flex gap-2">
                  <input value={note} onChange={e => setNote(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { save({ notes: [...(c.notes || []), note.trim()] }); setNote(''); } }}
                    placeholder="Add a note about this person" className="ic-input h-9 text-[13px]" />
                  <button className="ic-btn-secondary h-9" disabled={!note.trim()} onClick={() => { save({ notes: [...(c.notes || []), note.trim()] }); setNote(''); }}>Add</button>
                </div>
              )}
            </section>
          </div>

          {/* History */}
          <div className="flex flex-col gap-4 min-w-0">
            <section className="ic-card p-4">
              <h2 className="text-[14px] font-semibold text-ink mb-2">
                Conversations <span className="text-muted font-normal">{detail.conversations.length}{open ? ` · ${open} open` : ''}</span>
              </h2>
              {!detail.conversations.length && <p className="text-[13px] text-faint py-2">No conversations yet</p>}
              <div className="flex flex-col">
                {detail.conversations.map(x => {
                  const Icon = x.kind === 'ticket' ? Ticket : x.kind === 'issue' ? Wrench : x.channel === 'email' ? Mail : MessageSquare;
                  return (
                    <button key={x.id} onClick={() => onOpenConversation(x.id)}
                      className="-mx-2 px-2 py-2.5 rounded-lg hover:bg-subtle flex items-center gap-3 text-left text-[13.5px] min-w-0">
                      <Icon className="w-4 h-4 text-muted shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-muted shrink-0">{num(x.ticketNumber)}</span>
                          <span className="text-ink truncate">{x.title || x.snippet || 'No messages'}</span>
                        </span>
                        {x.title && x.snippet && <span className="block text-[12.5px] text-muted truncate">{x.snippet}</span>}
                      </span>
                      {x.rating && <span className="text-[12px] text-muted shrink-0">{x.rating}/5</span>}
                      <StatusPill status={x.mergedInto ? 'merged' : x.status} className="shrink-0" />
                      <TimeHover iso={x.updatedAt} className="text-[12.5px] text-muted shrink-0 w-10 text-right">{shortAgo(x.updatedAt)}</TimeHover>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="ic-card p-4">
              <h2 className="text-[14px] font-semibold text-ink mb-2">Pages they wrote from</h2>
              {!detail.pageViews.length && <p className="text-[13px] text-faint py-1">None recorded</p>}
              {detail.pageViews.map(p => (
                <div key={p.url} className="flex items-center gap-2 py-1.5 text-[13px] min-w-0">
                  <Globe className="w-3.5 h-3.5 text-muted shrink-0" />
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-ink hover:underline truncate flex-1 min-w-0">{p.url}</a>
                  <TimeHover iso={p.at} className="text-[12.5px] text-muted shrink-0">{shortAgo(p.at)}</TimeHover>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>

      {picking && (
        <PickContactDialog exclude={c.id} onClose={() => setPicking(false)} onPick={r => { setPicking(false); setMergeWith(r); }} />
      )}
      {mergeWith && (
        <MergeContactsDialog
          a={{ id: c.id, name: c.name, email: c.email, phone: c.phone, externalId: c.externalId, conversations: detail.conversations.length }}
          b={mergeWith}
          onClose={() => setMergeWith(null)}
          onMerged={pid => { setMergeWith(null); if (pid === c.id) load(); else onOpenContact(pid); }}
        />
      )}
      {deleting && (
        <DeleteContactDialog name={c.name} conversations={detail.conversations.length} id={c.id} onClose={() => setDeleting(false)} onDeleted={onBack} />
      )}
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center gap-3 min-h-[30px] text-[13px]">
    <span className="w-[92px] shrink-0 text-muted">{label}</span>
    <span className="flex-1 min-w-0 truncate text-ink" title={value}>{value}</span>
  </div>
);

/** A profile value that turns into an input on click; Enter or leaving the field saves. */
const EditableRow: React.FC<{ icon: React.ReactNode; label: string; value: string; readOnly?: boolean; onSave: (v: string) => void }> = ({ label, value, readOnly, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const done = () => { setEditing(false); if (v !== value) onSave(v); };
  return (
    <div className="flex items-center gap-3 min-h-[30px] text-[13px]">
      <span className="w-[92px] shrink-0 text-muted">{label}</span>
      {editing ? (
        <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={done}
          onKeyDown={e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { setV(value); setEditing(false); } }}
          className="flex-1 min-w-0 h-7 -ml-[7px] px-1.5 rounded-md border border-line bg-surface text-[13px] focus:outline-none focus:border-ink/40" />
      ) : (
        <button disabled={readOnly} onClick={() => setEditing(true)} className="flex-1 min-w-0 text-left truncate h-7 -ml-[7px] px-1.5 rounded-md hover:bg-subtle disabled:hover:bg-transparent">
          {value || <span className="text-faint">—</span>}
        </button>
      )}
    </div>
  );
};

const TagAdder: React.FC<{ existing: string[]; onAdd: (tag: string) => void }> = ({ existing, onAdd }) => {
  const tags = useStore(s => s.tags);
  const [open, setOpen] = useState(false);
  const options = tags.map(t => t.name).filter(n => !existing.includes(n));
  if (!options.length) return null;
  return open ? (
    <select autoFocus className="ic-select h-6 w-[140px] text-[12px] py-0" defaultValue="" onBlur={() => setOpen(false)}
      onChange={e => { if (e.target.value) onAdd(e.target.value); setOpen(false); }}>
      <option value="" disabled>Add tag…</option>
      {options.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  ) : (
    <button onClick={() => setOpen(true)} className="ic-badge text-[12px] inline-flex items-center gap-1 text-muted hover:text-ink"><Plus className="w-3 h-3" /> Tag</button>
  );
};

/** Admins: delete the person and every conversation they had. Asks for the name to be typed first. */
const DeleteContactDialog: React.FC<{ id: string; name: string; conversations: number; onClose: () => void; onDeleted: () => void }> = ({ id, name, conversations, onClose, onDeleted }) => {
  const api = useApi();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = typed.trim().toLowerCase() === name.trim().toLowerCase();
  const del = async () => {
    setBusy(true); setError(null);
    try { await api(`/api/contacts/${id}`, { method: 'DELETE' }); onDeleted(); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} busy={busy} width={480}>
      <div className="px-5 pt-5 pb-4 flex flex-col gap-3">
        <h3 className="text-[16px] font-semibold text-ink">Delete {name}?</h3>
        <p className="text-[13.5px] text-muted leading-relaxed">
          This permanently deletes the contact{conversations ? <> and their <span className="text-ink font-medium">{conversations} conversation{conversations === 1 ? '' : 's'}</span>, with every message</> : ''}.
          It can't be undone, and it's recorded in the audit log.
        </p>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          <span>Type <span className="text-ink font-medium">{name}</span> to confirm</span>
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} className="ic-input" />
        </label>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
        <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={del} disabled={!ok || busy} className="ic-btn-primary bg-red-600 hover:bg-red-700 border-red-600">{busy ? 'Deleting…' : 'Delete permanently'}</button>
      </div>
    </Modal>
  );
};

export default Contacts;
