import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Wrench, X, MessageSquare, Ticket } from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { BACKEND_URL, StatusPill, statusOf } from './mergeUi';
import { LinkIssueDialog } from './IssueDialogs';

type LinkedRow = { id: string; ticketNumber: string; kind: string; title?: string; status: string; customer: { id: string; name: string } };

const num = (t: string) => `#${t.replace(/^#/, '')}`;
// Opens beside the current chat (like Recent conversations), so the inbox view you're in stays as it is
const open = (id: string) => useStore.getState().setViewingMergedConversationId(id);

/**
 * Sidebar › Links › Tracker ticket.
 *  - Conversations and tickets: the issue they're linked to (open it, unlink, or link one with +).
 *  - Issues: every conversation and ticket linked to it.
 */
export const TrackerLinks: React.FC<{ conv: Conversation; token: string; readOnly?: boolean; onUpdated: (c: Conversation) => void }> = ({ conv, token, readOnly, onUpdated }) => {
  const socket = useSocket();
  const [dialog, setDialog] = useState(false);
  const [issue, setIssue] = useState<Conversation | null>(null);
  const [linked, setLinked] = useState<LinkedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fromStore = useStore(s => (conv.linkedIssueId ? s.conversations.find(c => c.id === conv.linkedIssueId) : undefined));

  // The linked issue (from the loaded list when it's there, otherwise fetched)
  useEffect(() => {
    setIssue(null);
    if (!conv.linkedIssueId || fromStore) return;
    let live = true;
    fetch(`${BACKEND_URL}/api/tickets/${conv.linkedIssueId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (live) setIssue(c); })
      .catch(() => {});
    return () => { live = false; };
  }, [conv.linkedIssueId, fromStore, token]);

  // An issue's linked conversations; refreshed when someone links or unlinks one
  const loadLinked = useCallback(() => {
    fetch(`${BACKEND_URL}/api/tickets/${conv.id}/linked`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then(setLinked)
      .catch(() => setLinked([]));
  }, [conv.id, token]);
  useEffect(() => {
    setLinked(null);
    if (conv.kind !== 'issue') return;
    loadLinked();
    if (!socket) return;
    const onMsg = (m: any) => { if (m?.conversationId === conv.id && m?.metadata?.field === 'linkedConversation') loadLinked(); };
    socket.on('message:new', onMsg);
    return () => { socket.off('message:new', onMsg); };
  }, [conv.id, conv.kind, socket, loadLinked]);

  const unlink = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${conv.id}/issue`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ issueId: null }),
      });
      if (res.ok) onUpdated(await res.json());
    } finally { setBusy(false); }
  };

  if (conv.kind === 'issue') {
    return (
      <div className="flex flex-col py-1">
        <div className="flex items-center min-h-[30px] text-[13px] text-muted">
          Linked conversations{linked?.length ? <span className="ml-1.5 text-faint">{linked.length}</span> : null}
        </div>
        {linked === null && <p className="py-1 text-[13px] text-faint">Loading…</p>}
        {linked?.length === 0 && <p className="py-1 text-[13px] text-faint">None yet. Link reports from a conversation's ⋯ menu.</p>}
        {linked?.map(c => {
          const Icon = c.kind === 'ticket' ? Ticket : MessageSquare;
          return (
            <button key={c.id} onClick={() => open(c.id)} className="group -mx-2 px-2 h-8 rounded-lg hover:bg-subtle flex items-center gap-2 text-left text-[13px]">
              <Icon className="w-3.5 h-3.5 text-muted shrink-0" />
              <span className="text-ink truncate min-w-0">{c.customer.name}</span>
              <span className="text-muted shrink-0">{num(c.ticketNumber)}</span>
              <span className="flex-1 min-w-0 truncate text-muted">{c.title}</span>
              <StatusPill status={c.status} className="shrink-0" />
            </button>
          );
        })}
      </div>
    );
  }

  const shown = fromStore || issue;
  return (
    <>
      <div className="flex justify-between items-center min-h-[34px] text-[13px] text-muted gap-2">
        <span className="shrink-0">Tracker ticket</span>
        {!conv.linkedIssueId && !readOnly && (
          <button className="ic-icon-btn w-7 h-7" title="Link to issue" onClick={() => setDialog(true)}>
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      {conv.linkedIssueId && (
        <div className="group -mx-2 px-2 min-h-[34px] rounded-lg hover:bg-subtle flex items-center gap-2 text-[13px]">
          <button onClick={() => open(conv.linkedIssueId!)} className="flex-1 min-w-0 flex items-center gap-2 text-left" title={shown?.title || 'Open issue'}>
            <Wrench className="w-3.5 h-3.5 text-muted shrink-0" />
            <span className="text-ink truncate min-w-0">{shown ? shown.title || 'Untitled issue' : 'Issue'}</span>
            {shown && <span className="text-muted shrink-0">{num(shown.ticketNumber)}</span>}
            {shown && <StatusPill status={statusOf(shown)} className="shrink-0" />}
          </button>
          {!readOnly && (
            <>
              <button onClick={() => setDialog(true)} className="hidden group-hover:inline text-[12px] text-muted hover:text-ink shrink-0">Change</button>
              <button onClick={unlink} disabled={busy} className="hidden group-hover:inline-flex ic-icon-btn-ghost w-6 h-6 shrink-0" title="Unlink">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}
      {dialog && (
        <LinkIssueDialog conversation={conv} token={token} onClose={() => setDialog(false)} onDone={c => { setDialog(false); onUpdated(c); }} />
      )}
    </>
  );
};
