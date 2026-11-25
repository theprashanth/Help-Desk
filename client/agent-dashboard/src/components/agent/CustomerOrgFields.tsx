import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Plus, Search, X, ExternalLink } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Company, CustomAttributeDef, Customer } from '../../../../../shared/src/types';
import { API_URL } from '../../lib/config';

const BACKEND_URL = API_URL;
type CompanyRow = Company & { people?: number };
type CompanyDetail = Company & {
  people: { id: string; name: string; email?: string }[];
  conversations: { id: string; ticketNumber: string; status: string; customerName: string; title?: string; snippet?: string; updatedAt: string }[];
  openConversations: number;
};

// Attribute definitions are shared by every sidebar instance (refreshed when Settings changes them)
let defsCache: CustomAttributeDef[] | null = null;
const defsListeners = new Set<(d: CustomAttributeDef[]) => void>();
async function loadDefs(token: string | null, force = false) {
  if (!token) return;
  if (defsCache && !force) { defsListeners.forEach(l => l(defsCache!)); return; }
  const r = await fetch(`${BACKEND_URL}/api/people-attributes`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (r?.ok) { defsCache = await r.json(); defsListeners.forEach(l => l(defsCache!)); }
}
export function refreshAttributeDefs() { loadDefs(useStore.getState().token, true); }

/**
 * Company + custom attributes rows in the conversation sidebar's "User data" section.
 * Saving goes through PUT /api/customers/:id (validated against Settings › People data) and is
 * recorded as an event in the conversation it was changed from.
 */
export const CustomerOrgFields: React.FC<{
  customer: Customer;
  conversationId: string | null;
  readOnly?: boolean;
  onUpdated: (c: Customer) => void;
}> = ({ customer, conversationId, readOnly, onUpdated }) => {
  const token = useStore(s => s.token);
  const [defs, setDefs] = useState<CustomAttributeDef[]>(defsCache || []);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [showCompany, setShowCompany] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    defsListeners.add(setDefs);
    loadDefs(token);
    return () => { defsListeners.delete(setDefs); };
  }, [token]);

  useEffect(() => {
    setCompany(null);
    if (!customer.companyId || !token) return;
    fetch(`${BACKEND_URL}/api/companies/${customer.companyId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setCompany(d)).catch(() => {});
  }, [customer.companyId, token]);

  const save = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, conversationId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Could not save'); return false; }
    onUpdated(data);
    return true;
  };

  const visible = defs.filter(d => !d.archived);
  const attrs = customer.attributes || {};

  return (
    <>
      {/* Company */}
      <div className="ic-detail-row group relative">
        <span className="ic-detail-label">Company</span>
        <div className="flex items-center gap-1 min-w-0">
          {company ? (
            <button onClick={() => setShowCompany(true)} className="ic-detail-value flex items-center gap-2 min-w-0 hover:underline underline-offset-2 text-left" title="Show company">
              <Building2 className="w-4 h-4 text-muted shrink-0" />
              <span className="truncate">{company.name}</span>
            </button>
          ) : (
            <span className="ic-detail-value text-muted">{customer.companyId ? 'Loading…' : '—'}</span>
          )}
          {!readOnly && (
            <button onClick={() => setPicking(true)} className="ic-icon-btn w-7 h-7 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0" title={company ? 'Change company' : 'Add to a company'}>
              {company ? <Search className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Custom attributes */}
      {visible.map(d => (
        <AttributeRow key={d.key} def={d} value={attrs[d.key]} readOnly={readOnly}
          onSave={v => save({ attributes: { [d.key]: v } })} />
      ))}
      {error && <p className="text-[12.5px] text-red-600 dark:text-red-400 py-1">{error}</p>}

      {picking && (
        <CompanyPicker
          current={customer.companyId}
          onClose={() => setPicking(false)}
          onPick={async id => { if (await save({ companyId: id })) setPicking(false); }}
        />
      )}
      {showCompany && company && <CompanyCard id={company.id} onClose={() => setShowCompany(false)} />}
    </>
  );
};

/** One custom attribute: shows the value, click to edit (input / select / toggle by type). */
const AttributeRow: React.FC<{
  def: CustomAttributeDef; value: string | number | boolean | undefined; readOnly?: boolean;
  onSave: (v: string | number | boolean | null) => Promise<boolean>;
}> = ({ def, value, readOnly, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const shown = value === undefined || value === '' ? null
    : def.type === 'boolean' ? (value ? 'Yes' : 'No')
    : def.type === 'date' ? new Date(String(value) + 'T00:00:00').toLocaleDateString()
    : String(value);

  const commit = async () => {
    const v = draft.trim();
    const ok = await onSave(v === '' ? null : def.type === 'number' ? Number(v) : v);
    if (ok) setEditing(false);
  };

  let control: React.ReactNode;
  if (readOnly) control = <span className={`ic-detail-value ${shown ? '' : 'text-muted'}`}>{shown || '—'}</span>;
  else if (def.type === 'boolean') {
    control = (
      <select value={value === undefined ? '' : value ? 'true' : 'false'} onChange={e => onSave(e.target.value === '' ? null : e.target.value === 'true')}
        className="flex-1 min-w-0 bg-transparent cursor-pointer -ml-[7px] px-1 h-7 rounded-lg hover:bg-subtle border-none focus:outline-none text-[13px] text-ink" aria-label={def.label}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  } else if (def.type === 'list') {
    control = (
      <select value={value === undefined ? '' : String(value)} onChange={e => onSave(e.target.value || null)}
        className="flex-1 min-w-0 bg-transparent cursor-pointer -ml-[7px] px-1 h-7 rounded-lg hover:bg-subtle border-none focus:outline-none text-[13px] text-ink" aria-label={def.label}>
        <option value="">—</option>
        {(def.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (editing) {
    control = (
      <input ref={inputRef} type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'} value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
        className="ic-input h-7 flex-1 min-w-0 text-[13px]" aria-label={def.label} />
    );
  } else {
    control = (
      <button onClick={() => { setDraft(value === undefined ? '' : String(value)); setEditing(true); }}
        className={`ic-detail-value text-left -ml-1.5 px-1.5 h-7 rounded-lg hover:bg-subtle flex-1 min-w-0 truncate ${shown ? '' : 'text-muted'}`} title={`Edit ${def.label}`}>
        {shown || 'Add…'}
      </button>
    );
  }
  return (
    <div className="ic-detail-row">
      <span className="ic-detail-label truncate" title={def.label}>{def.label}</span>
      <div className="flex items-center min-w-0">{control}</div>
    </div>
  );
};

/** Search companies, pick one, create one, or remove the person's company. */
const CompanyPicker: React.FC<{ current?: string; onPick: (id: string | null) => void; onClose: () => void }> = ({ current, onPick, onClose }) => {
  const token = useStore(s => s.token);
  const [q, setQ] = useState('');
  const [list, setList] = useState<CompanyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/companies?search=${encodeURIComponent(q.trim())}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : [])).then(d => Array.isArray(d) && setList(d)).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q, token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const create = async () => {
    setError(null);
    const res = await fetch(`${BACKEND_URL}/api/companies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: q.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Could not create the company'); return; }
    onPick(data.id);
  };
  const exact = list.some(c => c.name.toLowerCase() === q.trim().toLowerCase());

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-ink/25 flex items-start justify-center pt-[15vh] p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[440px] max-w-full bg-surface rounded-2xl shadow-pop border border-line overflow-hidden" role="dialog" aria-label="Choose a company">
        <label className="flex items-center gap-3 px-4 h-14 border-b border-line">
          <Search className="w-[18px] h-[18px] text-muted" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search or create a company"
            onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !exact) create(); }}
            className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none" />
        </label>
        <div className="max-h-72 overflow-y-auto p-2">
          {q.trim() && !exact && (
            <button onClick={create} className="w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left text-[14px] text-ink hover:bg-subtle">
              <Plus className="w-4 h-4 text-muted" /> Create “{q.trim()}”
            </button>
          )}
          {list.map(c => (
            <button key={c.id} onClick={() => onPick(c.id)} className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left text-[14px] text-ink hover:bg-subtle ${c.id === current ? 'bg-subtle' : ''}`}>
              <Building2 className="w-4 h-4 text-muted" />
              <span className="flex-1 min-w-0 truncate">{c.name}</span>
              <span className="text-[12.5px] text-muted">{c.people || 0} {c.people === 1 ? 'person' : 'people'}</span>
            </button>
          ))}
          {!list.length && !q.trim() && <p className="px-3 py-6 text-center text-[14px] text-muted">No companies yet. Type a name to create one.</p>}
          {current && (
            <button onClick={() => onPick(null)} className="w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left text-[14px] text-red-600 dark:text-red-400 hover:bg-subtle">
              <X className="w-4 h-4" /> Remove from company
            </button>
          )}
          {error && <p className="px-3 py-2 text-[13px] text-red-600">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/** Company card: details, its people, and every conversation from the company (click to open). */
const CompanyCard: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const token = useStore(s => s.token);
  const setActiveConversationId = useStore(s => s.setActiveConversationId);
  const conversations = useStore(s => s.conversations);
  const [d, setD] = useState<CompanyDetail | null>(null);
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/companies/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(setD).catch(() => {});
  }, [id, token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-ink/25 flex items-start justify-center pt-[10vh] p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[560px] max-w-full max-h-[75vh] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden" role="dialog" aria-label="Company">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
          <Building2 className="w-5 h-5 text-muted" />
          <h3 className="text-[16px] font-semibold text-ink flex-1 min-w-0 truncate">{d?.name || 'Company'}</h3>
          <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>
        {!d ? <p className="p-6 text-[14px] text-muted">Loading…</p> : (
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-3 text-[14px]">
              <div><p className="text-muted text-[12.5px]">People</p><p className="text-ink font-medium">{d.people.length}</p></div>
              <div><p className="text-muted text-[12.5px]">Open conversations</p><p className="text-ink font-medium">{d.openConversations}</p></div>
              <div><p className="text-muted text-[12.5px]">Size</p><p className="text-ink font-medium">{d.size ?? '—'}</p></div>
              {d.website && (
                <a href={d.website} target="_blank" rel="noreferrer" className="col-span-3 text-link inline-flex items-center gap-1.5 hover:underline">
                  {d.website.replace(/^https?:\/\//, '')} <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <div>
              <p className="text-[13px] font-medium text-muted mb-1.5">People</p>
              <div className="flex flex-wrap gap-1.5">
                {d.people.map(p => <span key={p.id} className="ic-badge h-7 px-2.5 text-[13px] text-ink" title={p.email}>{p.name}</span>)}
              </div>
            </div>
            <div>
              <p className="text-[13px] font-medium text-muted mb-1.5">Conversations</p>
              <div className="rounded-xl border border-line divide-y divide-line">
                {d.conversations.length === 0 && <p className="px-3 py-4 text-[14px] text-muted">No conversations yet.</p>}
                {d.conversations.map(c => {
                  const loaded = conversations.some(x => x.id === c.id);
                  return (
                    <button key={c.id} disabled={!loaded} onClick={() => { setActiveConversationId(c.id); onClose(); }}
                      title={loaded ? 'Open conversation' : 'Not in the current inbox view'}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-ink/[0.02] disabled:cursor-default">
                      <span className="text-[12.5px] text-faint tabular-nums w-14 shrink-0">{c.ticketNumber}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] text-ink truncate">{c.customerName}{c.title ? ` · ${c.title}` : ''}</span>
                        <span className="block text-[13px] text-muted truncate">{c.snippet || ''}</span>
                      </span>
                      <span className="text-[12px] text-muted capitalize shrink-0">{c.status === 'open' ? 'In progress' : c.status}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default CustomerOrgFields;
