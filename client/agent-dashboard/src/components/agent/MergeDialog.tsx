import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsRight, Info, MessageSquare, Search, Ticket } from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { shortAgo } from '../../lib/timeAgo';
import TimeHover from '../ui/TimeHover';
import {
  BACKEND_URL, StatusPill, statusOf, isMerged, customerLabel, aboutText, TicketHeaderCard, MiniTranscript, useConversationMessages,
} from './mergeUi';

/**
 * Merge, in two steps:
 *  1. "Merge into…": pick the primary conversation (search, ↑↓, Enter).
 *  2. "Permanently merge these conversations?": the conversations to merge on the left (checkboxes, 1/N pager),
 *     the primary on the right. Each checked one is merged into the primary and closed.
 */
export const MergeDialog: React.FC<{
  conversation: Conversation;     // the one you started from (checked by default)
  token: string;
  meId?: string;
  onClose: () => void;
  onMerged: (primaryId: string) => void;
}> = ({ conversation, token, meId, onClose, onMerged }) => {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [others, setOthers] = useState<Conversation[] | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [primary, setPrimary] = useState<Conversation | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set([conversation.id]));
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Other conversations of the same customer that can still be merged
  useEffect(() => {
    let live = true;
    fetch(`${BACKEND_URL}/api/customers/${conversation.customer.id}/tickets`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Conversation[]) => {
        if (!live) return;
        const usable = (Array.isArray(list) ? list : [])
          .filter(c => c.id !== conversation.id && !isMerged(c) && c.status !== 'archived')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setOthers(usable);
      })
      .catch(() => { if (live) setOthers([]); });
    return () => { live = false; };
  }, [conversation.id, conversation.customer.id, token]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (others || []).filter(c => !q || [c.ticketNumber, c.title, aboutText(c), c.category].some(v => (v || '').toLowerCase().includes(q)));
  }, [others, query]);
  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { if (step === 'pick') searchRef.current?.focus(); }, [step]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Left side of the confirm step: the one you started from, then the rest (never the primary)
  const sources = useMemo(
    () => (primary ? [conversation, ...(others || []).filter(c => c.id !== primary.id)] : []),
    [primary, conversation, others],
  );
  const current = sources[Math.min(page, Math.max(0, sources.length - 1))];

  const choosePrimary = (c: Conversation) => {
    setPrimary(c);
    setChecked(new Set([conversation.id]));
    setPage(0);
    setError(null);
    setStep('confirm');
  };

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const merge = async () => {
    if (!primary || !checked.size) return;
    setBusy(true); setError(null);
    try {
      for (const s of sources.filter(c => checked.has(c.id))) {
        const res = await fetch(`${BACKEND_URL}/api/tickets/${primary.id}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sourceId: s.id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Couldn't merge ${s.ticketNumber}`);
        }
      }
      onMerged(primary.id);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  // Keyboard: ↑↓ Enter in the picker; ←→ pages and Esc everywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (step === 'confirm' && !busy) setStep('pick'); else if (!busy) onClose(); return; }
      if (step === 'pick') {
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(i => Math.min(i + 1, Math.max(0, matches.length - 1))); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter' && matches[cursor]) { e.preventDefault(); choosePrimary(matches[cursor]); }
      } else if (!(e.target instanceof HTMLInputElement)) {
        if (e.key === 'ArrowLeft') setPage(p => Math.max(0, p - 1));
        if (e.key === 'ArrowRight') setPage(p => Math.min(sources.length - 1, p + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Rendered on <body> so it centers over the whole app, not inside the chat column
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-ink/25 flex items-center justify-center p-4 animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      {step === 'pick' ? (
        <div className="w-[640px] max-w-full h-[min(560px,90vh)] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
            <button onClick={onClose} className="ic-icon-btn-ghost" title="Back"><ArrowLeft className="w-[18px] h-[18px]" /></button>
            <h3 className="text-[16px] font-semibold text-ink">Merge into…</h3>
          </div>
          <label className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
            <Search className="w-[18px] h-[18px] text-muted shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for an item to merge into…"
              className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
            />
          </label>
          <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-3">
            <p className="flex items-center gap-1.5 px-3 pb-3 text-[13.5px] font-medium text-muted">
              Select a primary conversation
              <span title={`Messages from #${conversation.ticketNumber} are added to the one you pick, and #${conversation.ticketNumber} is closed.`}><Info className="w-4 h-4" /></span>
            </p>
            {others === null && <p className="px-3 py-8 text-center text-[14px] text-muted">Loading conversations…</p>}
            {others !== null && matches.length === 0 && (
              <p className="mx-3 py-10 text-center text-[14px] text-muted rounded-xl border border-dashed border-line">
                {others.length ? 'Nothing matches your search' : `${conversation.customer.name} has no other conversations to merge into`}
              </p>
            )}
            {matches.map((c, i) => {
              const Icon = c.kind === 'ticket' || c.kind === 'issue' ? Ticket : MessageSquare;
              return (
                <button
                  key={c.id}
                  data-row={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choosePrimary(c)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-[14px] ${i === cursor ? 'bg-subtle' : ''}`}
                >
                  <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0 flex items-center gap-2 text-muted">
                    <span className="text-ink truncate shrink-0 max-w-[45%]">{customerLabel(c)}</span>
                    <span className="shrink-0">• #{c.ticketNumber.replace(/^#/, '')} •</span>
                    <StatusPill status={statusOf(c)} />
                    <span className="truncate min-w-0">• {c.title || aboutText(c) || 'No messages yet'}</span>
                  </span>
                  <TimeHover iso={c.updatedAt} className="text-[13px] text-muted shrink-0">{shortAgo(c.updatedAt)}</TimeHover>
                </button>
              );
            })}
          </div>
          <div className="px-5 h-11 border-t border-line flex items-center text-[12.5px] text-muted shrink-0">
            ↑↓ navigate · ↵ select · esc close
          </div>
        </div>
      ) : primary && current && (
        <div className="w-[1100px] max-w-full h-[min(640px,92vh)] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden">
          <h3 className="px-6 pt-5 pb-4 text-[19px] font-semibold text-ink border-b border-dashed border-line shrink-0">Permanently merge these conversations?</h3>
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-0 bg-canvas">
            <MergeCard
              conv={current}
              token={token}
              meId={meId}
              checkbox={{ checked: checked.has(current.id), onChange: () => toggle(current.id) }}
            />
            <div className="flex items-center justify-center w-10 relative">
              <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-line" />
              <span className="relative w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-ink"><ChevronsRight className="w-4 h-4" /></span>
            </div>
            <MergeCard conv={primary} token={token} meId={meId} primary />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-6 h-16 border-t border-line shrink-0">
            <div className="flex items-center justify-between pr-4">
              <span className="flex items-center gap-1.5 text-[14px] text-muted">
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[11px] font-bold ${checked.size ? 'bg-ink text-surface' : 'border border-line'}`}>
                  {checked.size === sources.length ? '✓' : checked.size ? '–' : ''}
                </span>
                {checked.size}/{sources.length} selected
                <span title="Check each conversation you want merged into the primary. Use the arrows to see them all."><Info className="w-4 h-4" /></span>
              </span>
              {sources.length > 1 && (
                <span className="flex items-center gap-1 text-[14px] text-muted">
                  <button className="ic-icon-btn-ghost w-8 h-8 disabled:opacity-30" disabled={page === 0} onClick={() => setPage(p => p - 1)} title="Previous"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="tabular-nums w-10 text-center">{page + 1} / {sources.length}</span>
                  <button className="ic-icon-btn-ghost w-8 h-8 disabled:opacity-30" disabled={page >= sources.length - 1} onClick={() => setPage(p => p + 1)} title="Next"><ChevronRight className="w-4 h-4" /></button>
                </span>
              )}
            </div>
            <span className="w-10" />
            <div className="flex items-center justify-end gap-2">
              {error && <span className="text-[13px] text-red-600 dark:text-red-400 mr-auto pl-4 truncate">{error}</span>}
              <button onClick={() => setStep('pick')} disabled={busy} className="ic-btn-ghost">Back</button>
              <button onClick={onClose} disabled={busy} className="ic-btn-ghost">Cancel</button>
              <button onClick={merge} disabled={busy || !checked.size} className="ic-btn-primary disabled:opacity-50">
                {busy ? 'Merging…' : checked.size > 1 ? `Merge ${checked.size} conversations` : 'Merge conversations'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

/** One side of the confirm step: header (checkbox or Primary badge) + ticket card + transcript. */
const MergeCard: React.FC<{
  conv: Conversation;
  token: string;
  meId?: string;
  primary?: boolean;
  checkbox?: { checked: boolean; onChange: () => void };
}> = ({ conv, token, meId, primary, checkbox }) => {
  const messages = useConversationMessages(conv.id, token);
  return (
    <div className="p-5 min-h-0 min-w-0 flex">
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-2xl bg-surface border ${checkbox?.checked ? 'border-ink/20' : 'border-line'} shadow-sm overflow-hidden`}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line shrink-0">
          {checkbox && (
            <input type="checkbox" checked={checkbox.checked} onChange={checkbox.onChange} className="w-4 h-4 accent-orange-600 cursor-pointer" aria-label={`Merge ${conv.ticketNumber}`} />
          )}
          <span className="flex-1 min-w-0 truncate text-[14.5px] font-semibold text-ink">{customerLabel(conv)}</span>
          <span className="text-[12.5px] text-muted bg-subtle rounded-full px-2 h-6 inline-flex items-center shrink-0">#{conv.ticketNumber.replace(/^#/, '')}</span>
          <StatusPill status={statusOf(conv)} />
          {primary && <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 shrink-0">Primary</span>}
        </div>
        <div className="px-5 py-4 border-b border-line shrink-0"><TicketHeaderCard conv={conv} /></div>
        <div className={`flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col ${checkbox && !checkbox.checked ? 'opacity-50' : ''}`}>
          <MiniTranscript messages={messages} meId={meId} />
        </div>
      </div>
    </div>
  );
};

export default MergeDialog;
