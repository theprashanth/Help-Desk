import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, Ticket, Unlink, Wrench, X } from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { BACKEND_URL, StatusPill, statusOf, aboutText } from './mergeUi';
import { shortAgo } from '../../lib/timeAgo';

/**
 * "Convert to ticket" and "Link to issue" from a chat's ⋯ menu.
 *  - Convert: the conversation becomes a customer ticket (same thread, still shared with the customer) with a title.
 *  - Link: attach the conversation or ticket to a tracker issue, pick a different one, unlink, or create a new issue.
 */

const Overlay: React.FC<{ onClose: () => void; busy?: boolean; children: React.ReactNode }> = ({ onClose, busy, children }) =>
  createPortal(
    <div
      className="fixed inset-0 z-[60] bg-ink/25 flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}
    >
      {children}
    </div>,
    document.body,
  );

async function call(path: string, token: string, method: string, body?: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

export const ConvertToTicketDialog: React.FC<{
  conversation: Conversation;
  token: string;
  onClose: () => void;
  onDone: (updated: Conversation) => void;
}> = ({ conversation, token, onClose, onDone }) => {
  const [title, setTitle] = useState(() => (conversation.title || aboutText(conversation) || '').slice(0, 120));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.select(); }, []);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      onDone(await call(`/api/tickets/${conversation.id}/convert`, token, 'POST', { title: title.trim(), description: description.trim() }));
    } catch (e: any) {
      setError(e.message); setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose} busy={busy}>
      <div className="w-[520px] max-w-full bg-surface rounded-2xl shadow-pop border border-line overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
          <Ticket className="w-[18px] h-[18px] text-muted" />
          <h3 className="flex-1 text-[16px] font-semibold text-ink">Convert to customer ticket</h3>
          <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-[13.5px] text-muted leading-relaxed">
            #{conversation.ticketNumber.replace(/^#/, '')} with {conversation.customer.name} becomes a ticket. The thread stays the same and {conversation.customer.name} still sees it.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Title</span>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="e.g. Refund for order #1234"
              className="ic-input"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Description <span className="text-faint font-normal">(optional)</span></span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="ic-textarea" placeholder="What needs to happen" />
          </label>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
          <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={submit} className="ic-btn-primary" disabled={!title.trim() || busy}>{busy ? 'Converting…' : 'Convert to ticket'}</button>
        </div>
      </div>
    </Overlay>
  );
};

export const LinkIssueDialog: React.FC<{
  conversation: Conversation;
  token: string;
  onClose: () => void;
  onDone: (updated: Conversation) => void;
}> = ({ conversation, token, onClose, onDone }) => {
  const [issues, setIssues] = useState<Conversation[] | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BACKEND_URL}/api/tickets?kind=issue`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Conversation[]) => {
        if (!live) return;
        const open = (s: string) => (s === 'open' || s === 'waiting' ? 0 : 1);
        setIssues((Array.isArray(list) ? list : [])
          .filter(c => !c.mergedInto && c.status !== 'archived')
          .sort((a, b) => open(a.status) - open(b.status) || b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => { if (live) setIssues([]); });
    searchRef.current?.focus();
    return () => { live = false; };
  }, [token]);

  const q = query.trim();
  const matches = useMemo(() => {
    const lq = q.toLowerCase();
    return (issues || []).filter(c => !lq || [c.ticketNumber, c.title, c.description].some(v => (v || '').toLowerCase().includes(lq)));
  }, [issues, q]);
  // Rows: the issues, then "Create issue" when something is typed
  const rows = q ? matches.length + 1 : matches.length;
  useEffect(() => { setCursor(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  const link = async (issueId: string | null) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      onDone(await call(`/api/tickets/${conversation.id}/issue`, token, 'PUT', { issueId }));
    } catch (e: any) {
      setError(e.message); setBusy(false);
    }
  };

  const createAndLink = async () => {
    if (!q || busy) return;
    setBusy(true); setError(null);
    try {
      const issue = await call('/api/tickets/manual', token, 'POST', {
        kind: 'issue', title: q, priority: conversation.priority, category: conversation.category,
      });
      onDone(await call(`/api/tickets/${conversation.id}/issue`, token, 'PUT', { issueId: issue.id }));
    } catch (e: any) {
      setError(e.message); setBusy(false);
    }
  };

  const choose = (i: number) => (i < matches.length ? link(matches[i].id) : createAndLink());

  return (
    <Overlay onClose={onClose} busy={busy}>
      <div className="w-[600px] max-w-full h-[min(520px,90vh)] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
          <Wrench className="w-[18px] h-[18px] text-muted" />
          <h3 className="flex-1 text-[16px] font-semibold text-ink">Link to issue</h3>
          {conversation.linkedIssueId && (
            <button onClick={() => link(null)} disabled={busy} className="ic-btn-ghost text-[13px]">
              <Unlink className="w-4 h-4" /> Unlink
            </button>
          )}
          <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <label className="flex items-center gap-3 px-5 h-12 border-b border-line shrink-0">
          <Search className="w-[18px] h-[18px] text-muted shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(rows - 1, c + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
              if (e.key === 'Enter' && rows) { e.preventDefault(); choose(cursor); }
            }}
            placeholder="Search issues, or type a title for a new one…"
            className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
        </label>
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2">
          {issues === null && <p className="px-3 py-8 text-center text-[14px] text-muted">Loading issues…</p>}
          {issues !== null && !matches.length && !q && (
            <p className="mx-3 my-2 py-10 text-center text-[14px] text-muted rounded-xl border border-dashed border-line">
              No issues yet. Type a title to create one.
            </p>
          )}
          {matches.map((c, i) => {
            const current = c.id === conversation.linkedIssueId;
            return (
              <button
                key={c.id}
                data-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => link(c.id)}
                disabled={busy || current}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] ${i === cursor ? 'bg-subtle' : ''}`}
              >
                <span className="w-7 h-7 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0"><Wrench className="w-3.5 h-3.5" /></span>
                <span className="flex-1 min-w-0 flex items-center gap-2 text-muted">
                  <span className="text-ink truncate min-w-0">{c.title || 'Untitled issue'}</span>
                  <span className="shrink-0">#{c.ticketNumber.replace(/^#/, '')}</span>
                  <StatusPill status={statusOf(c)} />
                  {current && <span className="shrink-0 text-[12px] font-medium text-accent">Linked</span>}
                </span>
                <span className="text-[13px] text-muted shrink-0">{shortAgo(c.updatedAt)}</span>
              </button>
            );
          })}
          {q && (
            <button
              data-row={matches.length}
              onMouseEnter={() => setCursor(matches.length)}
              onClick={createAndLink}
              disabled={busy}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] ${cursor === matches.length ? 'bg-subtle' : ''}`}
            >
              <span className="w-7 h-7 rounded-full bg-ink text-surface flex items-center justify-center shrink-0"><Plus className="w-3.5 h-3.5" /></span>
              <span className="flex-1 min-w-0 truncate text-ink">Create issue “{q}” and link it</span>
            </button>
          )}
        </div>
        {error && <p className="px-5 py-2 text-[13px] text-red-600 border-t border-line">{error}</p>}
        <div className="px-5 h-10 border-t border-line flex items-center text-[12.5px] text-muted shrink-0">
          ↑↓ navigate · ↵ link · esc close
        </div>
      </div>
    </Overlay>
  );
};
