import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelLeft, Plus, ChevronDown, X, Search, User, UserPlus, Eye, EyeOff, Lock,
  CornerUpLeft, Users, Wrench, Ticket, MessageSquare
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, Conversation } from '../../../../../shared/src/types';
import { useTeams } from '../../lib/teams';

const BACKEND_URL = 'http://localhost:3000';
const PLATFORM_OPTIONS = ['Web', 'iOS', 'Android'];

type CustomerPick =
  | { kind: 'existing'; id: string; name: string; email?: string }
  | { kind: 'external'; externalId: string };

interface Props {
  agents: Agent[];
  onCreated: (conv: Conversation) => void;
}

/** Manual create screen for a conversation, customer ticket or tracker issue (+ its details panel). */
export const CreateTicketPanel: React.FC<Props> = ({ agents, onCreated }) => {
  const composer = useStore((s) => s.composer)!;
  const setComposer = useStore((s) => s.setComposer);
  const token = useStore((s) => s.token);
  const me = useStore((s) => s.agent)!;
  const kind = composer.kind;

  const [customer, setCustomer] = useState<CustomerPick | null>(
    composer.customer ? { kind: 'existing', ...composer.customer } : null
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('none');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [rootCause, setRootCause] = useState('');
  const [editingRootCause, setEditingRootCause] = useState(false);
  const [platformMenu, setPlatformMenu] = useState(false);
  const [sharing, setSharing] = useState<'shared' | 'internal'>(kind === 'issue' ? 'internal' : 'shared');
  const [assigneeId, setAssigneeId] = useState<string>(me.id);
  const teams = useTeams();
  const defaultTeamId = useStore(s => s.defaultTeamId);
  const [teamId, setTeamId] = useState<string>('');
  useEffect(() => { if (defaultTeamId) setTeamId(t => t || defaultTeamId); }, [defaultTeamId]);
  const [message, setMessage] = useState('');
  const [messageIsNote, setMessageIsNote] = useState(kind !== 'conversation');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; email?: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pickerOpen || !token) return;
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/customers?search=${encodeURIComponent(query)}&limit=8`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [pickerOpen, query, token]);

  const heading = kind === 'ticket' ? 'Create Customer ticket' : kind === 'issue' ? 'Create Issue' : 'New conversation';
  const needsCustomer = kind !== 'issue';
  const needsTitle = kind !== 'conversation';
  const canSubmit =
    (!needsCustomer || !!customer) &&
    (!needsTitle || title.trim().length > 0) &&
    (kind !== 'conversation' || message.trim().length > 0) &&
    !submitting;

  const missing = useMemo(() => {
    if (needsCustomer && !customer) return 'Add a customer';
    if (needsTitle && !title.trim()) return 'Add a title';
    if (kind === 'conversation' && !message.trim()) return 'Write the first message';
    return null;
  }, [needsCustomer, customer, needsTitle, title, kind, message]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          kind,
          customer: customer
            ? customer.kind === 'existing' ? { id: customer.id } : { externalId: customer.externalId }
            : undefined,
          title: needsTitle ? title.trim() : undefined,
          description: needsTitle ? description.trim() || undefined : undefined,
          category,
          priority,
          assignedAgentId: assigneeId === 'unassigned' ? undefined : assigneeId,
          ...(teamId ? { teamId } : {}),
          attributes: needsTitle ? { platforms, rootCause: rootCause.trim() || undefined } : undefined,
          sharing,
          message: message.trim() ? { content: message.trim(), isInternalNote: messageIsNote } : undefined,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create');
      setComposer(null);
      onCreated(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ⌘/Ctrl + Enter submits
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && !pickerOpen && !platformMenu) setComposer(null);
  };

  const trimmedQuery = query.trim();
  const exactIdMatch = results.some(r => r.id === trimmedQuery);

  return (
    <>
      {/* Main create panel */}
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col relative" onKeyDown={onKeyDown}>
        <div className="ic-panel-header justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PanelLeft className="w-[18px] h-[18px] text-muted shrink-0" />
            <h2 className="ic-title">{heading}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setComposer(null)} className="ic-btn-secondary">Cancel</button>
            <button onClick={submit} disabled={!canSubmit} className="ic-btn-primary" title={missing || '⌘ Enter'}>
              {submitting ? 'Creating…' : kind === 'conversation' ? (messageIsNote ? 'Create' : 'Send') : kind === 'issue' ? 'Create issue' : 'Create ticket'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-5">
          {/* Customer */}
          <div className="relative">
            {customer ? (
              <div className="inline-flex items-center gap-2 h-9 pl-1.5 pr-1 rounded-full bg-subtle max-w-full">
                <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200 text-[12px] font-semibold flex items-center justify-center shrink-0">
                  {customer.kind === 'existing' ? customer.name.charAt(0).toUpperCase() : '#'}
                </span>
                <span className="text-[14px] font-medium text-ink truncate">
                  {customer.kind === 'existing' ? customer.name : `User ${customer.externalId}`}
                </span>
                <span className="text-[13px] text-muted truncate">
                  {customer.kind === 'existing' ? customer.email || customer.id : 'new from user ID'}
                </span>
                <button onClick={() => setCustomer(null)} className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-ink/10" title="Remove customer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setPickerOpen(o => !o); setTimeout(() => searchRef.current?.focus(), 0); }}
                className="ic-btn-secondary"
              >
                <Plus className="w-4 h-4" /> {needsCustomer ? 'Add customer' : 'Link a customer (optional)'}
                <ChevronDown className="w-4 h-4" />
              </button>
            )}

            {pickerOpen && !customer && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="ic-menu absolute left-0 top-full mt-2 w-[380px] py-0 overflow-hidden animate-fade-in">
                  <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-line">
                    <Search className="w-4 h-4 text-faint shrink-0" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.stopPropagation(); setPickerOpen(false); }
                        if (e.key === 'Enter' && results[0]) { setCustomer({ kind: 'existing', ...results[0] }); setPickerOpen(false); }
                      }}
                      placeholder="Search by name, email or user ID..."
                      className="flex-1 min-w-0 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    />
                  </div>
                  <div className="py-1.5 max-h-72 overflow-y-auto">
                    {results.map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setCustomer({ kind: 'existing', ...r }); setPickerOpen(false); }}
                        className="ic-menu-item h-auto py-2"
                      >
                        <User className="w-4 h-4 text-muted shrink-0" />
                        <span className="flex flex-col min-w-0 text-left">
                          <span className="truncate">{r.name}</span>
                          <span className="text-[12px] text-faint truncate">{r.email || r.id}</span>
                        </span>
                      </button>
                    ))}
                    {results.length === 0 && (
                      <div className="px-3.5 py-2.5 text-[13px] text-muted">
                        {trimmedQuery ? 'No matching customers' : 'No customers yet'}
                      </div>
                    )}
                    {trimmedQuery && !exactIdMatch && (
                      <>
                        <div className="my-1.5 border-t border-line" />
                        <button
                          onClick={() => { setCustomer({ kind: 'external', externalId: trimmedQuery }); setPickerOpen(false); }}
                          className="ic-menu-item h-auto py-2"
                          title="Create the customer from a user ID in your own database"
                        >
                          <UserPlus className="w-4 h-4 text-muted shrink-0" />
                          <span className="flex flex-col min-w-0 text-left">
                            <span className="truncate">Use user ID "{trimmedQuery}"</span>
                            <span className="text-[12px] text-faint">Creates the customer from your database ID</span>
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {needsTitle && (
            <>
              <input
                autoFocus={!!customer || kind === 'issue'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add title..."
                className="w-full h-11 px-3 -mx-3 rounded-lg bg-subtle/60 hover:bg-subtle focus:bg-subtle text-[17px] font-medium text-ink placeholder:text-faint focus:outline-none"
                style={{ width: 'calc(100% + 1.5rem)' }}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description..."
                rows={3}
                className="w-full px-3 -mx-3 py-2.5 rounded-lg bg-subtle/60 hover:bg-subtle focus:bg-subtle text-[15px] text-ink placeholder:text-faint focus:outline-none resize-none leading-relaxed"
                style={{ width: 'calc(100% + 1.5rem)' }}
              />

              {/* Attributes */}
              <div className="flex flex-col gap-1 text-[14px] max-w-[640px]">
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Ticket type</span>
                  <span className="flex items-center gap-2 text-ink">
                    {kind === 'issue' ? <><Wrench className="w-4 h-4" /> Issue</> : <><Ticket className="w-4 h-4" /> Tickets</>}
                  </span>
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Category</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="ic-select h-8 w-48 text-[14px]">
                    <option value="general">General</option>
                    <option value="bug">Bug</option>
                    <option value="payment">Payment</option>
                    <option value="subscription">Subscription</option>
                    <option value="refund">Refund</option>
                    <option value="feature_request">Feature Request</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Priority</span>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className="ic-select h-8 w-48 text-[14px]">
                    <option value="none">No priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Urgent</option>
                  </select>
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Platforms</span>
                  <div className="flex flex-wrap items-center gap-1.5 relative">
                    {platforms.map(p => (
                      <span key={p} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-subtle text-[13px]">
                        {p}
                        <button onClick={() => setPlatforms(platforms.filter(x => x !== p))} className="w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-ink/10"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {platforms.length < PLATFORM_OPTIONS.length && (
                      <button onClick={() => setPlatformMenu(o => !o)} className="text-muted hover:text-ink inline-flex items-center gap-1">
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    )}
                    {platformMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPlatformMenu(false)} />
                        <div className="ic-menu absolute left-0 top-full mt-1 w-44">
                          {PLATFORM_OPTIONS.filter(p => !platforms.includes(p)).map(p => (
                            <button key={p} onClick={() => { setPlatforms([...platforms, p]); setPlatformMenu(false); }} className="ic-menu-item">{p}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Root cause</span>
                  {editingRootCause || rootCause ? (
                    <input
                      autoFocus={editingRootCause}
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      onBlur={() => setEditingRootCause(false)}
                      placeholder="e.g. Payment provider outage"
                      className="ic-input h-8 max-w-sm"
                    />
                  ) : (
                    <button onClick={() => setEditingRootCause(true)} className="text-muted hover:text-ink inline-flex items-center gap-1 w-fit">
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center min-h-[36px]">
                  <span className="text-muted">Sharing</span>
                  {kind === 'issue' ? (
                    <span className="flex items-center gap-2 text-ink"><Lock className="w-4 h-4" /> Internal only</span>
                  ) : (
                    <button
                      onClick={() => setSharing(sharing === 'shared' ? 'internal' : 'shared')}
                      className="flex items-center gap-2 text-ink w-fit hover:opacity-80"
                      title="Click to toggle"
                    >
                      {sharing === 'shared' ? <><Eye className="w-4 h-4" /> Always shared</> : <><EyeOff className="w-4 h-4" /> Internal only</>}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {kind === 'conversation' && (
            <div className="ic-empty flex-1 min-h-[160px]">
              <MessageSquare className="w-10 h-10 text-muted" strokeWidth={1.5} />
              <span className="text-[14px]">
                {customer ? 'Write the first message below to start the conversation.' : 'Add a customer, then write the first message.'}
              </span>
            </div>
          )}

          {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {/* Composer: first reply / note */}
        <div className="shrink-0 px-4 pb-4 pt-1">
          <div className={`rounded-2xl border shadow-card p-3 ${messageIsNote ? 'bg-note border-note-line' : 'bg-surface border-line'}`}>
            <div className="flex items-center gap-1 mb-1">
              {kind !== 'issue' && (
                <button
                  onClick={() => setMessageIsNote(false)}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-semibold ${!messageIsNote ? 'bg-ink/[0.07] text-ink' : 'text-muted hover:text-ink'}`}
                >
                  <CornerUpLeft className="w-3.5 h-3.5" /> Reply
                </button>
              )}
              <button
                onClick={() => setMessageIsNote(true)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-semibold ${messageIsNote ? 'bg-ink/[0.07] text-ink' : 'text-muted hover:text-ink'}`}
              >
                <Lock className="w-3.5 h-3.5" /> Note
              </button>
              <span className="ml-auto text-[12px] text-faint">⌘ Enter to create</span>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={messageIsNote ? 'Add an internal note (optional) — only teammates can see this' : 'Write the first message to the customer...'}
              className="w-full bg-transparent px-1.5 py-1 text-[15px] text-ink placeholder:text-faint focus:outline-none resize-none"
            />
          </div>
        </div>
      </div>

      {/* Details panel while creating */}
      <div className="ic-panel w-[320px] 2xl:w-[360px] h-full shrink-0 flex flex-col">
        <div className="ic-tabs pt-4">
          <span className="ic-tab ic-tab-active">Details</span>
        </div>
        <div className="ic-detail-section py-3">
          <div className="ic-detail-row">
            <span className="ic-detail-label">Assignee</span>
            <div className="ic-detail-value flex items-center gap-1 min-w-0">
              <User className="w-4 h-4 text-muted shrink-0" />
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="flex-1 min-w-0 truncate bg-transparent cursor-pointer px-1.5 h-8 rounded-lg hover:bg-subtle border-none focus:outline-none text-[14px]"
              >
                <option value="unassigned" className="bg-surface text-ink">Unassigned</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id} className="bg-surface text-ink">{a.id === me.id ? `${a.name} (you)` : a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ic-detail-row">
            <span className="ic-detail-label">Team Inbox</span>
            <div className="ic-detail-value flex items-center gap-1 min-w-0">
              <Users className="w-4 h-4 text-muted shrink-0" />
              {teams.length === 0 ? (
                <span className="truncate text-muted px-1.5">No teams yet</span>
              ) : (
                <select
                  value={teamId}
                  onChange={e => setTeamId(e.target.value)}
                  className={`flex-1 min-w-0 truncate bg-transparent cursor-pointer px-1.5 h-8 rounded-lg hover:bg-subtle border-none focus:outline-none text-[14px] ${teamId ? 'text-ink' : 'text-muted'}`}
                  title="Team inbox"
                >
                  <option value="" className="bg-surface text-ink">No team</option>
                  {teams.map(t => <option key={t.id} value={t.id} className="bg-surface text-ink">{t.name}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 text-[13px] text-muted leading-relaxed">
          {kind === 'issue'
            ? 'Issues are internal tracker tickets. Customers never see them.'
            : kind === 'ticket'
              ? sharing === 'shared'
                ? 'The customer can see this ticket and its public replies.'
                : 'This ticket is internal only until you share it.'
              : 'The customer receives your first message in the Messenger.'}
        </div>
      </div>
    </>
  );
};

export default CreateTicketPanel;
