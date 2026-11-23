import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Conversation } from '../../../../../shared/src/types';
import { ChevronLeft, ExternalLink, MessageSquareReply } from 'lucide-react';
import { BACKEND_URL, TicketHeaderCard, MiniTranscript, MergedBanner, useConversationMessages, statusOf, StatusPill } from './mergeUi';
import CustomerProfilePanel from './CustomerProfilePanel';

/**
 * Another conversation opened beside the current one (from "Recent conversations" or a merge card).
 * It takes half the workspace — the inbox list hides while it's open — with Activity / Details tabs.
 * A merged ticket shows "Ticket merged · Go to primary"; anything else offers Reply (opens it in the main view).
 */
export const MergedConversationPanel: React.FC = () => {
  const token = useStore((state) => state.token);
  const me = useStore((state) => state.agent);
  const viewingId = useStore((state) => state.viewingMergedConversationId);
  const setViewingId = useStore((state) => state.setViewingMergedConversationId);
  const openConversation = (id: string) => useStore.getState().setActiveConversationId(id);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [tab, setTab] = useState<'activity' | 'details'>('activity');
  const messages = useConversationMessages(viewingId, token);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewingId || !token) return;
    let live = true;
    setConv(null);
    setTab('activity');
    fetch(`${BACKEND_URL}/api/tickets/${viewingId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (live) setConv(c); })
      .catch(() => {});
    return () => { live = false; };
  }, [viewingId, token]);

  useEffect(() => { if (tab === 'activity') endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, tab]);

  // Esc closes it (unless you're typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)))) setViewingId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setViewingId]);

  if (!viewingId) return null;

  // Older merges only left an indicator message, so fall back to it
  const indicator = messages?.slice().reverse().find(m => m.metadata?.type === 'merged_indicator');
  const mergedIntoId: string | undefined = conv?.mergedInto?.id || indicator?.metadata?.mergedIntoConversationId;
  const title = conv?.title?.trim() || (conv ? `Conversation with ${conv.customer?.name || 'customer'}` : 'Loading…');

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col relative animate-slide-left z-20 overflow-hidden">
      {/* Header: back, title, open, status */}
      <div className="ic-panel-header gap-2 pl-3 pr-4">
        <button onClick={() => setViewingId(null)} className="ic-icon-btn-ghost shrink-0" title="Close (Esc)">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className="flex-1 min-w-0 truncate text-[17px] font-semibold text-ink border-b border-dashed border-line pb-0.5" title={title}>{title}</h3>
        <button onClick={() => openConversation(viewingId)} className="ic-icon-btn-ghost shrink-0" title="Open in the main view">
          <ExternalLink className="w-4 h-4" />
        </button>
        {conv && <StatusPill status={statusOf(conv)} className="h-8 px-3.5 text-[13px]" />}
      </div>

      {/* Tabs */}
      <div className="ic-tabs px-5 pt-2 shrink-0">
        <button onClick={() => setTab('activity')} className={`ic-tab ${tab === 'activity' ? 'ic-tab-active' : ''}`}>Activity</button>
        <button onClick={() => setTab('details')} className={`ic-tab ${tab === 'details' ? 'ic-tab-active' : ''}`}>Details</button>
      </div>

      {tab === 'activity' ? (
        <>
          {conv && (
            <div className="px-6 py-5 border-b border-line shrink-0">
              <TicketHeaderCard conv={conv} summary={conv.description || ''} />
              {!conv.description && <p className="mt-3 text-[14px] text-faint">{conv.title ? 'No description' : 'Add description…'}</p>}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col">
            <MiniTranscript
              messages={messages}
              meId={me?.id}
              large
              onOpenConversation={openConversation}
              onViewMerged={id => setViewingId(id)}
            />
            <div ref={endRef} />
          </div>
          <div className="px-5 pb-5 pt-2 shrink-0">
            {mergedIntoId ? (
              <MergedBanner onGo={() => openConversation(mergedIntoId)} />
            ) : (
              <button onClick={() => openConversation(viewingId)} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-line bg-surface shadow-sm text-[14px] font-semibold text-ink hover:bg-subtle">
                <MessageSquareReply className="w-4 h-4" /> Reply
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {mergedIntoId && (
            <div className="mx-5 mt-4 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[13.5px] text-ink flex items-center gap-2 shrink-0">
              Merged into
              <button onClick={() => openConversation(mergedIntoId)} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                #{(conv?.mergedInto?.ticketNumber || indicator?.metadata?.mergedIntoTicketNumber || '').toString().replace(/^#/, '')}
              </button>
            </div>
          )}
          {/* The full details sidebar for this conversation: assignee, attributes, links, user data, recent conversations… */}
          <CustomerProfilePanel conversationId={viewingId} embedded />
        </div>
      )}
    </div>
  );
};

export default MergedConversationPanel;
