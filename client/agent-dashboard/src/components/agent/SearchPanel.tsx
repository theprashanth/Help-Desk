import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, PanelLeft, X, Check, ChevronDown, MessageSquare, Ticket, Wrench, User, UserCheck,
  Tag as TagIcon, CalendarDays, CircleDot, Type, Layers, Lock
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, Conversation } from '../../../../../shared/src/types';
import { PRIORITY_OPTIONS, PriorityIcon } from '../../lib/priority';
import ChatWindow from './ChatWindow';
import CustomerProfilePanel from './CustomerProfilePanel';
import { MergedConversationPanel } from './MergedConversationPanel';

const BACKEND_URL = 'http://localhost:3000';

type Match = { field: string; label: string; snippet: string; messageId?: string; at?: string };
type Result = { conversation: Conversation; matches: Match[]; score: number };
type Started = 'any' | 'today' | '7d' | '30d' | '90d' | 'custom';
type Chip = 'type' | 'assignee' | 'tag' | 'user' | 'started' | 'status' | 'priority' | 'title' | 'sort';

const TYPE_OPTIONS = [
  { value: 'conversation', label: 'Conversation' },
  { value: 'ticket', label: 'Customer ticket' },
  { value: 'issue', label: 'Tracker issue' },
];
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' }, { value: 'waiting', label: 'Waiting on customer' }, { value: 'snoozed', label: 'Snoozed' },
  { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived' },
];
const STARTED_OPTIONS: { value: Started; label: string }[] = [
  { value: 'any', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: 'custom', label: 'Custom range' },
];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest activity' }, { value: 'oldest', label: 'Oldest activity' }, { value: 'relevance', label: 'Relevance' },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wrap matched terms in <mark>. */
const highlight = (text: string, terms: string[]): React.ReactNode => {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? <mark key={i} className="bg-amber-100 text-ink rounded px-0.5 dark:bg-amber-500/30">{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>);
};

const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 10080) return `${Math.round(m / 1440)}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const STATUS_LABEL: Record<string, string> = { open: 'Open', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed', archived: 'Archived', merged: 'Merged' };

interface Props { agents: Agent[] }

/** Inbox > Search: search every conversation, ticket, note, customer and tag, with filters. */
export const SearchPanel: React.FC<Props> = ({ agents }) => {
  const token = useStore((s) => s.token);
  const me = useStore((s) => s.agent);
  const tags = useStore((s) => s.tags);
  const setTags = useStore((s) => s.setTags);
  const setConversations = useStore((s) => s.setConversations);
  const setCurrentQueue = useStore((s) => s.setCurrentQueue);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const setActiveConversationId = useStore((s) => s.setActiveConversationId);
  const viewingMergedConversationId = useStore((s) => s.viewingMergedConversationId);
  const inboxNavOpen = useStore((s) => s.inboxNavOpen);
  const setInboxNavOpen = useStore((s) => s.setInboxNavOpen);

  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [assignee, setAssignee] = useState('');
  const [tag, setTag] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [started, setStarted] = useState<Started>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [sort, setSort] = useState('newest');
  const [openChip, setOpenChip] = useState<Chip | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<{ id: string; name: string; email?: string }[]>([]);

  const [results, setResults] = useState<Result[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Search mode: live updates refresh results in place instead of following an inbox view
  useEffect(() => {
    setCurrentQueue('search');
    setActiveConversationId(null);
    inputRef.current?.focus();
  }, [setCurrentQueue, setActiveConversationId]);

  useEffect(() => {
    if (!token || tags.length) return;
    fetch(`${BACKEND_URL}/api/tags`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : [])).then(setTags).catch(() => {});
  }, [token, tags.length, setTags]);

  const hasFilters = types.length > 0 || !!assignee || !!tag || !!customer || started !== 'any' || statuses.length > 0 || priorities.length > 0 || !!title.trim();
  const isEmpty = !q.trim() && !hasFilters;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (types.length) p.set('type', types.join(','));
    if (assignee) p.set('assignee', assignee);
    if (tag) p.set('tag', tag);
    if (customer) p.set('customerId', customer.id);
    if (statuses.length) p.set('status', statuses.join(','));
    if (priorities.length) p.set('priority', priorities.join(','));
    if (title.trim()) p.set('title', title.trim());
    if (started !== 'any') {
      const now = new Date();
      if (started === 'custom') {
        if (from) p.set('startedFrom', new Date(from + 'T00:00:00').toISOString());
        if (to) p.set('startedTo', new Date(to + 'T23:59:59').toISOString());
      } else {
        const d = new Date(now);
        if (started === 'today') d.setHours(0, 0, 0, 0);
        else d.setDate(d.getDate() - parseInt(started, 10));
        p.set('startedFrom', d.toISOString());
      }
    }
    p.set('sort', sort);
    return p.toString();
  }, [q, types, assignee, tag, customer, statuses, priorities, title, started, from, to, sort]);

  // Debounced search
  useEffect(() => {
    if (!token) return;
    if (isEmpty) { setResults([]); setTotal(0); setTerms([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/search?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : { results: [], total: 0, terms: [] }))
        .then(data => {
          setResults(data.results || []);
          setTotal(data.total || 0);
          setTerms(data.terms || []);
          // ChatWindow / details read conversations from the store
          setConversations((data.results || []).map((r: Result) => r.conversation));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [params, isEmpty, token, setConversations]);

  // Customer picker for the User chip
  useEffect(() => {
    if (openChip !== 'user' || !token) return;
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/customers?search=${encodeURIComponent(userQuery)}&limit=8`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : [])).then(setUserResults).catch(() => setUserResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [openChip, userQuery, token]);

  const openResult = (id: string) => { setSelectedId(id); setActiveConversationId(id); };
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const clearAll = () => {
    setTypes([]); setAssignee(''); setTag(''); setCustomer(null); setStarted('any'); setFrom(''); setTo('');
    setStatuses([]); setPriorities([]); setTitle('');
  };

  // Chip summary text when a filter is set
  const summary: Record<Exclude<Chip, 'sort'>, string> = {
    type: types.map(t => TYPE_OPTIONS.find(o => o.value === t)?.label).join(', '),
    assignee: assignee === 'unassigned' ? 'Unassigned' : agents.find(a => a.id === assignee)?.name || '',
    tag,
    user: customer?.name || '',
    started: started === 'any' ? '' : started === 'custom' ? [from, to].filter(Boolean).join(' → ') || 'Custom' : STARTED_OPTIONS.find(o => o.value === started)!.label,
    status: statuses.map(s => STATUS_OPTIONS.find(o => o.value === s)?.label).join(', '),
    priority: priorities.map(p => PRIORITY_OPTIONS.find(o => o.value === p)?.label).join(', '),
    title,
  };
  const clearChip: Record<Exclude<Chip, 'sort'>, () => void> = {
    type: () => setTypes([]), assignee: () => setAssignee(''), tag: () => setTag(''), user: () => setCustomer(null),
    started: () => { setStarted('any'); setFrom(''); setTo(''); }, status: () => setStatuses([]),
    priority: () => setPriorities([]), title: () => setTitle(''),
  };

  const checkRow = (checked: boolean, label: React.ReactNode, onClick: () => void, icon?: React.ReactNode) => (
    <button onClick={onClick} className="ic-menu-item">
      {icon && <span className="w-4 flex justify-center">{icon}</span>}
      <span className="flex-1 truncate text-left">{label}</span>
      {checked && <Check className="w-4 h-4 text-accent" />}
    </button>
  );

  // Popover body for a chip (render helper, not a component)
  const chipMenu = (chip: Chip): React.ReactNode => {
    switch (chip) {
      case 'type': return TYPE_OPTIONS.map(o => <React.Fragment key={o.value}>{checkRow(types.includes(o.value), o.label, () => toggle(types, o.value, setTypes),
        o.value === 'issue' ? <Wrench className="w-4 h-4 text-muted" /> : o.value === 'ticket' ? <Ticket className="w-4 h-4 text-muted" /> : <MessageSquare className="w-4 h-4 text-muted" />)}</React.Fragment>);
      case 'assignee': return (
        <div className="max-h-72 overflow-y-auto">
          {checkRow(assignee === 'unassigned', 'Unassigned', () => { setAssignee(assignee === 'unassigned' ? '' : 'unassigned'); setOpenChip(null); }, <User className="w-4 h-4 text-muted" />)}
          {agents.map(a => <React.Fragment key={a.id}>{checkRow(assignee === a.id, a.id === me?.id ? `${a.name} (you)` : a.name, () => { setAssignee(assignee === a.id ? '' : a.id); setOpenChip(null); },
            a.avatar ? <img src={a.avatar} alt="" className="w-4 h-4 rounded-full object-cover" /> : <span className="w-4 h-4 rounded-full bg-subtle text-[9px] font-semibold flex items-center justify-center">{a.name.charAt(0)}</span>)}</React.Fragment>)}
        </div>
      );
      case 'tag': return (
        <div className="max-h-72 overflow-y-auto">
          {tags.length === 0 && <div className="px-3.5 py-2 text-[13px] text-muted">No tags yet</div>}
          {tags.map(t => <React.Fragment key={t.id}>{checkRow(tag === t.name, t.name, () => { setTag(tag === t.name ? '' : t.name); setOpenChip(null); },
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />)}</React.Fragment>)}
        </div>
      );
      case 'user': return (
        <>
          <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
            <Search className="w-4 h-4 text-faint" />
            <input autoFocus value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Name, email or user ID..." className="flex-1 min-w-0 bg-transparent text-[14px] focus:outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {userResults.length === 0 && <div className="px-3.5 py-2 text-[13px] text-muted">No matching customers</div>}
            {userResults.map(u => (
              <button key={u.id} onClick={() => { setCustomer({ id: u.id, name: u.name }); setOpenChip(null); }} className="ic-menu-item h-auto py-2">
                <User className="w-4 h-4 text-muted shrink-0" />
                <span className="flex flex-col min-w-0 text-left"><span className="truncate">{u.name}</span><span className="text-[12px] text-faint truncate">{u.email || u.id}</span></span>
              </button>
            ))}
          </div>
        </>
      );
      case 'started': return (
        <>
          {STARTED_OPTIONS.map(o => <React.Fragment key={o.value}>{checkRow(started === o.value, o.label, () => { setStarted(o.value); if (o.value !== 'custom') setOpenChip(null); })}</React.Fragment>)}
          {started === 'custom' && (
            <div className="flex items-center gap-2 px-3.5 py-2 border-t border-line mt-1">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ic-input h-8 text-[13px] px-2" />
              <span className="text-muted text-[13px]">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ic-input h-8 text-[13px] px-2" />
            </div>
          )}
        </>
      );
      case 'status': return STATUS_OPTIONS.map(o => <React.Fragment key={o.value}>{checkRow(statuses.includes(o.value), o.label, () => toggle(statuses, o.value, setStatuses))}</React.Fragment>);
      case 'priority': return PRIORITY_OPTIONS.map(o => <React.Fragment key={o.value}>{checkRow(priorities.includes(o.value), o.label, () => toggle(priorities, o.value, setPriorities), <PriorityIcon priority={o.value} />)}</React.Fragment>);
      case 'title': return (
        <div className="p-3">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenChip(null); }}
            placeholder="Title contains..." className="ic-input h-9" />
        </div>
      );
      case 'sort': return SORT_OPTIONS.map(o => <React.Fragment key={o.value}>{checkRow(sort === o.value, o.label, () => { setSort(o.value); setOpenChip(null); })}</React.Fragment>);
    }
  };

  const CHIPS: { key: Exclude<Chip, 'sort'>; label: string; icon: React.ReactNode }[] = [
    { key: 'type', label: 'Type', icon: <Layers className="w-3.5 h-3.5" /> },
    { key: 'assignee', label: 'Assigned to', icon: <UserCheck className="w-3.5 h-3.5" /> },
    { key: 'tag', label: 'Tag', icon: <TagIcon className="w-3.5 h-3.5" /> },
    { key: 'user', label: 'User', icon: <User className="w-3.5 h-3.5" /> },
    { key: 'started', label: 'Started', icon: <CalendarDays className="w-3.5 h-3.5" /> },
    { key: 'status', label: 'Status', icon: <CircleDot className="w-3.5 h-3.5" /> },
    { key: 'priority', label: 'Priority', icon: <PriorityIcon priority="medium" className="w-3.5 h-3.5" /> },
    { key: 'title', label: 'Title', icon: <Type className="w-3.5 h-3.5" /> },
  ];

  const showSplit = !!selectedId && !!activeConversationId;

  return (
    <>
      <div className={`ic-panel-side h-full flex flex-col relative min-w-0 ${showSplit ? 'w-[380px] 2xl:w-[420px] shrink-0' : 'flex-1'}`}>
        {openChip && <div className="fixed inset-0 z-20" onClick={() => setOpenChip(null)} />}

        {/* Search box */}
        <div className="flex items-center gap-2 px-4 h-16 shrink-0 border-b border-line">
          <button onClick={() => setInboxNavOpen(!inboxNavOpen)} className="ic-icon-btn-ghost -ml-1 shrink-0" title={inboxNavOpen ? 'Hide inbox navigation' : 'Show inbox navigation'}>
            <PanelLeft className="w-[18px] h-[18px]" />
          </button>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) openResult(results[0].conversation.id); if (e.key === 'Escape') setQ(''); }}
              placeholder="Search"
              className="w-full h-10 pl-10 pr-9 rounded-full border border-line bg-surface text-[15px] text-ink placeholder:text-faint focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/[0.06]"
            />
            {q && (
              <button onClick={() => { setQ(''); inputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-subtle flex items-center justify-center" title="Clear">
                <X className="w-3.5 h-3.5 text-muted" />
              </button>
            )}
          </div>
        </div>

        {/* Filter chips + sort */}
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-1.5 shrink-0 relative z-30">
          {CHIPS.map(c => {
            const value = summary[c.key];
            return (
              <div key={c.key} className="relative">
                <button
                  onClick={() => setOpenChip(openChip === c.key ? null : c.key)}
                  className={`inline-flex items-center gap-1.5 h-8 pl-2.5 ${value ? 'pr-1.5 bg-ink/[0.06] border-ink/15' : 'pr-2.5 bg-surface'} rounded-full border border-line text-[13px] font-medium text-ink hover:bg-subtle max-w-[220px]`}
                >
                  <span className="text-muted">{c.icon}</span>
                  <span className="truncate">{value ? `${c.label}: ${value}` : c.label}</span>
                  {value && (
                    <span onClick={(e) => { e.stopPropagation(); clearChip[c.key](); }} className="w-5 h-5 rounded-full hover:bg-ink/10 flex items-center justify-center" title={`Clear ${c.label}`}>
                      <X className="w-3 h-3" />
                    </span>
                  )}
                </button>
                {openChip === c.key && (
                  <div className="ic-menu absolute left-0 top-full mt-1.5 w-64 animate-fade-in py-1 overflow-hidden">{chipMenu(c.key)}</div>
                )}
              </div>
            );
          })}
          {hasFilters && <button onClick={clearAll} className="ic-link text-[13px] font-medium px-1">Clear filters</button>}
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setOpenChip(openChip === 'sort' ? null : 'sort')} className="inline-flex items-center gap-1 h-8 px-2 text-[14px] font-semibold text-ink hover:bg-subtle rounded-full">
              {SORT_OPTIONS.find(o => o.value === sort)?.label} <ChevronDown className="w-4 h-4" />
            </button>
            {openChip === 'sort' && <div className="ic-menu absolute right-0 top-full mt-1.5 w-52 animate-fade-in py-1">{chipMenu('sort')}</div>}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {isEmpty ? (
            <div className="ic-empty h-full px-8">
              <Search className="w-10 h-10 text-muted" strokeWidth={1.5} />
              <span className="ic-empty-title">Search conversations or tickets</span>
              <span className="text-[14px] max-w-md">
                Type a keyword, email, name, tag or a ticket number — messages, internal notes, ticket titles and customers are all searched.
                Tip: use "double quotes" to only match an exact phrase.
              </span>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 text-[13px] text-muted">
                {loading ? 'Searching…' : `${total} result${total === 1 ? '' : 's'}${total > results.length ? ` · showing ${results.length}` : ''}`}
              </div>
              {!loading && results.length === 0 && (
                <div className="ic-empty py-16">
                  <span className="text-[15px] font-semibold text-ink/80">No results</span>
                  <span className="text-[13px]">Try different words or remove a filter.</span>
                </div>
              )}
              {results.map(({ conversation: c, matches }) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    data-search-result
                    onClick={() => openResult(c.id)}
                    className={`w-full text-left rounded-xl px-3 py-3 mb-0.5 flex gap-3 transition-colors ${active ? 'bg-surface shadow-card' : 'hover:bg-ink/[0.03]'}`}
                  >
                    <div className="ic-avatar w-8 h-8 bg-subtle text-ink/80 text-[13px] uppercase shrink-0">
                      {c.kind === 'issue' ? <Wrench className="w-4 h-4" /> : c.kind === 'ticket' ? <Ticket className="w-4 h-4" /> : (c.customer.name.charAt(0) || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[15px] font-medium text-ink truncate">{highlight(c.kind === 'issue' ? (c.title || c.ticketNumber) : c.customer.name, terms)}</span>
                        <span className="text-[12px] text-faint shrink-0">{highlight(c.ticketNumber, terms)}</span>
                        <span className="ml-auto text-[13px] text-faint shrink-0">{timeAgo(c.updatedAt || c.createdAt)}</span>
                      </div>
                      {c.title && c.kind !== 'issue' && <div className="text-[14px] text-ink/80 truncate">{highlight(c.title, terms)}</div>}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="ic-badge">{STATUS_LABEL[c.status] || c.status}</span>
                        {(c.priority === 'critical' || c.priority === 'high') && <PriorityIcon priority={c.priority} className="w-3.5 h-3.5" />}
                      </div>
                      {matches.slice(0, 2).map((m, i) => (
                        <div key={i} className="mt-1.5 text-[13px] text-muted leading-snug">
                          <span className="inline-flex items-center gap-1 font-medium text-ink/70 mr-1">
                            {m.field === 'note' && <Lock className="w-3 h-3" />}{m.label}:
                          </span>
                          <span className="line-clamp-2">{highlight(m.snippet, terms)}</span>
                        </div>
                      ))}
                      {!matches.length && c.lastMessageSnippet && <div className="mt-1 text-[13px] text-muted truncate">{c.lastMessageSnippet}</div>}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>

      {showSplit && (
        <>
          <ChatWindow />
          {viewingMergedConversationId ? <MergedConversationPanel /> : <CustomerProfilePanel />}
        </>
      )}
    </>
  );
};

export default SearchPanel;
