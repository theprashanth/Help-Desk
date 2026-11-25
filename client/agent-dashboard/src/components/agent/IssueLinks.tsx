import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Wrench, X, MessageSquare, Ticket, Megaphone, ChevronRight } from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { BACKEND_URL, StatusPill, statusOf } from './mergeUi';
import { LinkIssueDialog, IssueBroadcastDialog } from './IssueDialogs';
import { useAiStatus } from '../../lib/aiFeatures';

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
  const [broadcast, setBroadcast] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const ai = useAiStatus();
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
    // A linked conversation changed state (reopened, resolved…): keep its pill current
    const onUpdate = (c: any) => {
      if (c?.id) setLinked(prev => (prev?.some(r => r.id === c.id) ? prev.map(r => (r.id === c.id ? { ...r, status: c.status, title: c.title ?? r.title } : r)) : prev));
    };
    socket.on('message:new', onMsg);
    socket.on('conversation:update', onUpdate);
    return () => { socket.off('message:new', onMsg); socket.off('conversation:update', onUpdate); };
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
        <PublicNoticeEditor issue={conv} token={token} readOnly={readOnly} onUpdated={onUpdated} />
        <div className="border-t border-line my-2" />
        <div className="flex items-center min-h-[30px] text-[13px] text-muted">
          Linked conversations{linked?.length ? <span className="ml-1.5 text-faint">{linked.length}</span> : null}
        </div>
        {linked === null && <p className="py-1 text-[13px] text-faint">Loading…</p>}
        {linked?.length === 0 && <p className="py-1 text-[13px] text-faint">None yet. Link reports from a conversation's ⋯ menu.</p>}
        {!!linked?.length && !readOnly && (
          <button onClick={() => { setSentNote(null); setBroadcast(true); }} className="ic-btn-secondary h-8 text-[13px] self-start my-1">
            <Megaphone className="w-3.5 h-3.5" /> Message linked customers
          </button>
        )}
        {sentNote && <p className="py-1 text-[13px] text-emerald-600 dark:text-emerald-400">{sentNote}</p>}
        {broadcast && linked && (
          <IssueBroadcastDialog
            issue={conv}
            token={token}
            totalReports={linked.length}
            openReports={linked.filter(c => c.status !== 'resolved' && c.status !== 'closed').length}
            aiReady={ai.configured}
            onClose={() => setBroadcast(false)}
            onDone={r => { setBroadcast(false); setSentNote(broadcastSummary(r)); loadLinked(); }}
          />
        )}
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

export const broadcastSummary = (r: { sent: number; resolved: number; failed: unknown[] }) =>
  `Sent to ${r.sent} conversation${r.sent === 1 ? '' : 's'}${r.resolved ? `, resolved ${r.resolved}` : ''}${r.failed.length ? ` · ${r.failed.length} failed` : ''}`;

/** Count of an issue's linked conversations, and how many are still open. */
export async function linkedCounts(issueId: string, token: string): Promise<{ total: number; open: number }> {
  try {
    const r = await fetch(`${BACKEND_URL}/api/tickets/${issueId}/linked`, { headers: { Authorization: `Bearer ${token}` } });
    const list: LinkedRow[] = r.ok ? await r.json() : [];
    return { total: list.length, open: list.filter(c => c.status !== 'resolved' && c.status !== 'closed').length };
  } catch { return { total: 0, open: 0 }; }
}

/**
 * Slim bar under a chat's header when it's linked to an issue, so nobody re-investigates a problem the
 * team already tracks: "Known issue · Payments #41168 · 3 reports · In progress". Opens the issue beside the chat.
 */
export const KnownIssueBar: React.FC<{ issueId: string; token: string }> = ({ issueId, token }) => {
  const fromStore = useStore(s => s.conversations.find(c => c.id === issueId));
  const [fetched, setFetched] = useState<Conversation | null>(null);
  const [reports, setReports] = useState<number | null>(null);
  const socket = useSocket();
  useEffect(() => {
    let live = true;
    setFetched(null);
    if (!fromStore) {
      fetch(`${BACKEND_URL}/api/tickets/${issueId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null)).then(c => { if (live) setFetched(c); }).catch(() => {});
    }
    return () => { live = false; };
  }, [issueId, token, !!fromStore]);
  useEffect(() => {
    let live = true;
    const load = () => linkedCounts(issueId, token).then(c => { if (live) setReports(c.total); });
    load();
    // Keep the issue's state and report count current while the chat is open
    const onUpdate = (c: any) => { if (c?.id === issueId) { setFetched(prev => (prev ? { ...prev, ...c } : prev)); if (typeof c.reportCount === 'number') setReports(c.reportCount); } };
    socket?.on('conversation:update', onUpdate);
    return () => { live = false; socket?.off('conversation:update', onUpdate); };
  }, [issueId, token, socket]);

  const issue = fromStore || fetched;
  if (!issue) return null;
  const fixed = issue.status === 'resolved' || issue.status === 'closed';
  return (
    <button
      onClick={() => open(issueId)}
      className={`w-full flex items-center gap-2 px-5 h-9 text-[13px] border-b border-line text-left shrink-0 ${
        fixed ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'}`}
      title="Open the issue"
    >
      <Wrench className="w-3.5 h-3.5 shrink-0" />
      <span className="font-medium shrink-0">{fixed ? 'Linked issue fixed' : 'Known issue'}</span>
      <span className="flex-1 truncate min-w-0">· {issue.title || 'Untitled issue'} <span className="opacity-70">{num(issue.ticketNumber)}</span></span>
      {reports !== null && <span className="shrink-0 opacity-80">{reports} report{reports === 1 ? '' : 's'}</span>}
      <ChevronRight className="w-4 h-4 shrink-0 opacity-70" />
    </button>
  );
};

/**
 * Issues: a short public notice shown on the Messenger home while the issue is open ("We're aware of
 * payment failures on iOS and are fixing it"), so customers know before they write in.
 */
export const PublicNoticeEditor: React.FC<{ issue: Conversation; token: string; readOnly?: boolean; onUpdated: (c: Conversation) => void }> = ({ issue, token, readOnly, onUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(issue.publicNotice || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(issue.publicNotice || ''); setEditing(false); }, [issue.id, issue.publicNotice]);
  const save = async (value: string | null) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${issue.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ publicNotice: value && value.trim() ? value.trim().slice(0, 300) : null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save');
      onUpdated(d); setEditing(false);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  const live = !!issue.publicNotice && (issue.status === 'open' || issue.status === 'waiting');
  return (
    <div className="flex flex-col py-1 gap-1.5">
      <div className="flex items-center justify-between min-h-[30px] text-[13px] text-muted">
        <span>Public notice {issue.publicNotice && <span className={`ml-1 text-[12px] ${live ? 'text-emerald-600 dark:text-emerald-400' : 'text-faint'}`}>{live ? '· on the Messenger' : '· hidden (issue not open)'}</span>}</span>
        {!readOnly && !editing && (
          <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => setEditing(true)}>{issue.publicNotice ? 'Edit' : 'Add'}</button>
        )}
      </div>
      {!editing && issue.publicNotice && <p className="text-[13px] text-ink bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2 whitespace-pre-wrap">{issue.publicNotice}</p>}
      {!editing && !issue.publicNotice && <p className="text-[12.5px] text-faint">Tell customers you know about this problem, right on the Messenger home.</p>}
      {editing && (
        <>
          <textarea autoFocus rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={300} className="ic-textarea text-[13px]"
            placeholder="We’re aware that card payments are failing in the iOS app and are working on a fix." />
          <div className="flex gap-2 justify-end">
            {issue.publicNotice && <button className="ic-btn-ghost h-8 text-[12.5px] text-red-600 mr-auto" disabled={busy} onClick={() => save(null)}>Remove</button>}
            <button className="ic-btn-secondary h-8 text-[12.5px]" disabled={busy} onClick={() => { setText(issue.publicNotice || ''); setEditing(false); }}>Cancel</button>
            <button className="ic-btn-primary h-8 text-[12.5px]" disabled={busy || !text.trim()} onClick={() => save(text)}>{busy ? 'Saving…' : 'Show on Messenger'}</button>
          </div>
        </>
      )}
      {error && <p className="text-[12.5px] text-red-600">{error}</p>}
    </div>
  );
};
