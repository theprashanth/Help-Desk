import React, { useEffect, useState } from 'react';
import { CornerDownRight, Eye, EyeOff, Lock, Ticket } from 'lucide-react';
import { Conversation, Message } from '../../../../../shared/src/types';
import { RichText } from '../../lib/richText';
import { shortAgo } from '../../lib/timeAgo';
import TimeHover from '../ui/TimeHover';
import { API_URL } from '../../lib/config';

export const BACKEND_URL = API_URL;

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  waiting: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  closed: 'bg-subtle text-muted',
  archived: 'bg-subtle text-muted',
  merged: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
};

/** Merged into another conversation? (older merges only left a "[Merged into …]" snippet) */
export const isMerged = (c: Pick<Conversation, 'mergedInto' | 'lastMessageSnippet'>) =>
  !!c.mergedInto || (c.lastMessageSnippet || '').startsWith('[Merged into');

/** Merged tickets read as "Merged" whatever their stored status. */
export const statusOf = (c: Pick<Conversation, 'status' | 'mergedInto' | 'lastMessageSnippet'>) => (isMerged(c) ? 'merged' : c.status);

export const StatusPill: React.FC<{ status: string; className?: string }> = ({ status, className = '' }) => (
  <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium capitalize shrink-0 ${STATUS_STYLES[status] || STATUS_STYLES.closed} ${className}`}>
    {status}
  </span>
);

/** "Azure Stereo from Hyderabad" (city taken from the session location when known). */
export function customerLabel(c: Conversation): string {
  const name = c.customer?.name || 'Customer';
  const place = (c.customer?.session?.country || '').split(/\s[-–,·]\s|,/)[0].trim();
  return place ? `${name} from ${place}` : name;
}

/** One-line description of what the conversation is about. */
export const aboutText = (c: Conversation) => {
  const snippet = (c.lastMessageSnippet || '').startsWith('[Merged into') ? '' : c.lastMessageSnippet;
  return (c.description || c.title || c.customerSnippet || snippet || '').replace(/^\[Note\]\s*/, '').trim();
};

export const CustomerDot: React.FC<{ name?: string; size?: number }> = ({ name, size = 24 }) => (
  <span
    className="relative rounded-full bg-amber-200 text-amber-900 dark:bg-amber-400/30 dark:text-amber-100 font-semibold flex items-center justify-center shrink-0 uppercase"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
  >
    {(name || '?').trim().charAt(0)}
  </span>
);

/** Ticket chip row + summary, like the top of a ticket. */
export const TicketHeaderCard: React.FC<{ conv: Conversation; summary?: string }> = ({ conv, summary }) => {
  const shared = conv.sharing !== 'internal';
  const text = summary ?? aboutText(conv);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap text-[13px] text-ink">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-subtle font-medium">
          <Ticket className="w-3.5 h-3.5" /> #{conv.ticketNumber.replace(/^#/, '')}
        </span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <CustomerDot name={conv.customer?.name} size={20} />
          <span className="truncate">{customerLabel(conv)}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-muted" title={shared ? 'Shared with customer' : 'Internal only'}>
          {shared ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {shared ? 'Shared with customer' : 'Internal'}
        </span>
      </div>
      {text && <p className="text-[14px] text-ink leading-relaxed">{text}</p>}
    </div>
  );
};

/** Load a conversation's messages (oldest first). */
export function useConversationMessages(id: string | null | undefined, token: string | null, refreshKey = 0) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  useEffect(() => {
    if (!id || !token) { setMessages(null); return; }
    let live = true;
    setMessages(null);
    fetch(`${BACKEND_URL}/api/messages/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then(list => { if (live) setMessages(Array.isArray(list) ? list : []); })
      .catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [id, token, refreshKey]);
  return messages;
}

/** Compact read-only transcript: customer on the left, team on the right, events as small lines. */
export const MiniTranscript: React.FC<{
  messages: Message[] | null;
  meId?: string;
  onOpenConversation?: (id: string) => void;
  onViewMerged?: (id: string) => void;   // shows "X merged #N into this ticket" cards with a View button
  large?: boolean;
}> = ({ messages, meId, onOpenConversation, onViewMerged, large }) => {
  if (!messages) return <p className="text-[13px] text-faint py-6 text-center">Loading conversation…</p>;
  const shown = messages.filter(m => m.metadata?.type !== 'customer_event' && m.metadata?.type !== 'csat_request' && (m.metadata?.type !== 'merge' || !!onViewMerged));
  const bubbleText = large ? 'text-[14.5px] px-4 py-3' : 'text-[13.5px] px-3.5 py-2.5';
  if (!shown.length) return <p className="text-[13px] text-faint py-6 text-center">No messages yet</p>;
  return (
    <div className={`flex flex-col ${large ? 'gap-3' : 'gap-2.5'}`}>
      {shown.map(m => {
        if (m.metadata?.type === 'merged_indicator') {
          const by = m.sender.id === meId ? 'You' : m.sender.name;
          const targetId = m.metadata.mergedIntoConversationId;
          const num = String(m.metadata.mergedIntoTicketNumber || '').replace(/^#/, '');
          return (
            <div key={m.id} className="flex items-center gap-2.5 text-[13px] text-muted py-1">
              <TimeHover iso={m.createdAt} className="w-9 shrink-0 text-right text-faint">{shortAgo(m.createdAt)}</TimeHover>
              <Ticket className="w-4 h-4 shrink-0" />
              <CornerDownRight className="w-4 h-4 shrink-0" />
              <span>
                {by} merged this ticket into{' '}
                {onOpenConversation && targetId ? (
                  <button onClick={() => onOpenConversation(targetId)} className="text-blue-600 dark:text-blue-400 hover:underline">#{num}</button>
                ) : `#${num}`}
              </span>
            </div>
          );
        }
        if (m.metadata?.type === 'merge' && onViewMerged) {
          const d = m.metadata.mergeDetails || {};
          const by = m.sender.id === meId ? 'You' : (d.mergedBy || m.sender.name);
          return (
            <div key={m.id} className="self-end w-full max-w-[85%] rounded-2xl border border-line bg-surface shadow-sm px-5 py-4 flex flex-col gap-2 my-1">
              <p className="text-[14px] font-semibold text-ink">{by} merged #{String(d.sourceTicketNumber || '').replace(/^#/, '')} into this ticket</p>
              {d.customerName && <p className="text-[13.5px] text-muted">chat with {d.customerName}</p>}
              <div className="flex items-center justify-between mt-1">
                {d.sourceConversationId && (
                  <button onClick={() => onViewMerged(d.sourceConversationId)} className="ic-btn-primary ic-btn-sm">View conversation</button>
                )}
                <TimeHover iso={m.createdAt} className="text-[12px] text-faint">{shortAgo(m.createdAt)}</TimeHover>
              </div>
            </div>
          );
        }
        if (m.metadata?.type === 'event') {
          return (
            <div key={m.id} className="flex items-center gap-2.5 text-[12.5px] text-faint py-0.5">
              <TimeHover iso={m.createdAt} className="w-9 shrink-0 text-right">{shortAgo(m.createdAt)}</TimeHover>
              <span className="min-w-0 truncate">{m.content}</span>
            </div>
          );
        }
        const isCustomer = m.sender.type === 'customer';
        return (
          <div key={m.id} className={`flex items-end gap-2 max-w-[85%] ${isCustomer ? 'self-start' : 'self-end flex-row-reverse'}`}>
            {isCustomer && <CustomerDot name={m.sender.name} size={26} />}
            <div
              className={`${bubbleText} rounded-2xl leading-relaxed text-ink break-words ${
                m.isInternalNote ? 'bg-note border border-note-line' : isCustomer ? 'bg-subtle' : 'bg-blue-100 dark:bg-blue-500/20'
              }`}
            >
              {m.isInternalNote && (
                <div className="flex items-center gap-1 text-[11.5px] font-medium text-muted mb-0.5"><Lock className="w-3 h-3" /> Note</div>
              )}
              {m.content ? <RichText text={m.content} /> : m.attachments?.length ? <span className="text-muted">📎 {m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</span> : null}
              <div className={`mt-1 text-[11.5px] text-muted ${isCustomer ? '' : 'text-right'}`}>
                {!isCustomer && <span className="font-medium">{m.sender.name} · </span>}<TimeHover iso={m.createdAt}>{shortAgo(m.createdAt)}</TimeHover>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Yellow "Ticket merged" bar with a jump to the primary conversation. */
export const MergedBanner: React.FC<{ onGo: () => void; compact?: boolean }> = ({ onGo, compact }) => (
  <div className={`flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ${compact ? 'flex-wrap px-3.5 py-3' : 'px-5 py-3.5'}`}>
    <span className="text-amber-700 dark:text-amber-300 text-[18px] leading-none shrink-0">⚠</span>
    <p className={`flex-1 text-[14px] text-ink leading-snug ${compact ? 'min-w-[150px]' : 'min-w-0'}`}>
      <span className="font-semibold">Ticket merged.</span> Continue in the primary conversation.
    </p>
    <button onClick={onGo} className="ic-btn-primary ic-btn-sm shrink-0">Go to primary</button>
  </div>
);
