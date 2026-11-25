import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, Plus, Send, UserPlus, X, AlertTriangle } from 'lucide-react';
import { Conversation, Message, SideConversation } from '../../../../../shared/src/types';
import { useSocket } from '../../context/SocketContext';
import { BACKEND_URL } from './mergeUi';
import { shortAgo } from '../../lib/timeAgo';
import TimeHover from '../ui/TimeHover';

/**
 * Email around a conversation:
 *  - Participants (chat ⋯ › Manage participants): people CC'd on every teammate reply.
 *  - Side conversations (sidebar › Links): a separate email thread with someone outside the team,
 *    kept in the conversation as internal notes.
 */

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

/** Whether email is set up (SMTP), so things that send email can say so up front. */
function useEmailReady(token: string): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { call('/api/email/settings', token).then(s => setReady(!!s.ready)).catch(() => setReady(false)); }, [token]);
  return ready;
}

const NotReady: React.FC = () => (
  <p className="flex items-start gap-2 text-[13px] text-amber-800 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-200 rounded-lg px-3 py-2">
    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
    Email isn’t set up yet, so nothing can be sent. An admin can add SMTP details in Settings › Channels › Email.
  </p>
);

const Overlay: React.FC<{ onClose: () => void; busy?: boolean; width: number; children: React.ReactNode }> = ({ onClose, busy, width, children }) =>
  createPortal(
    <div className="fixed inset-0 z-[60] bg-ink/25 flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
      <div className="max-w-full max-h-[90vh] bg-surface rounded-2xl shadow-pop border border-line overflow-hidden flex flex-col" style={{ width }}>{children}</div>
    </div>,
    document.body,
  );

const Header: React.FC<{ icon: React.ReactNode; title: string; onClose: () => void }> = ({ icon, title, onClose }) => (
  <div className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
    <span className="text-muted">{icon}</span>
    <h3 className="flex-1 text-[16px] font-semibold text-ink truncate">{title}</h3>
    <button onClick={onClose} className="ic-icon-btn-ghost" title="Close"><X className="w-[18px] h-[18px]" /></button>
  </div>
);

// ── Participants ────────────────────────────────────────────────────────────

export const ParticipantsDialog: React.FC<{ conversation: Conversation; token: string; onClose: () => void; onDone: (c: Conversation) => void }> = ({ conversation, token, onClose, onDone }) => {
  const ready = useEmailReady(token);
  const [list, setList] = useState<string[]>(conversation.participants || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const add = () => {
    const parts = input.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const bad = parts.find(p => !EMAIL_RE.test(p));
    if (bad) { setError(`“${bad}” isn’t an email address`); return; }
    setList(l => Array.from(new Set([...l, ...parts])).slice(0, 10));
    setInput(''); setError(null);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { onDone(await call(`/api/tickets/${conversation.id}/participants`, token, 'PUT', { participants: list })); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };
  const changed = JSON.stringify(list) !== JSON.stringify(conversation.participants || []);
  const viaEmail = conversation.channel === 'email';

  return (
    <Overlay onClose={onClose} busy={busy} width={500}>
      <Header icon={<UserPlus className="w-[18px] h-[18px]" />} title="Manage participants" onClose={onClose} />
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-[13.5px] text-muted leading-relaxed">
          Participants get every reply you send in this conversation by email{viaEmail ? ', on CC' : ''}, and their email replies come back here
          {viaEmail ? '.' : ' as internal notes (the customer keeps chatting in the Messenger).'}
        </p>
        {ready === false && <NotReady />}
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {list.map(a => (
            <span key={a} className="ic-badge text-[12.5px] inline-flex items-center gap-1">
              {a}
              <button onClick={() => setList(l => l.filter(x => x !== a))} className="text-muted hover:text-ink" title="Remove"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {!list.length && <span className="text-[13px] text-faint">No participants</span>}
        </div>
        <div className="flex gap-2">
          <input ref={ref} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (input.trim()) add(); } }}
            placeholder="name@company.com" className="ic-input h-9" />
          <button onClick={add} disabled={!input.trim()} className="ic-btn-secondary h-9">Add</button>
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
        <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={save} className="ic-btn-primary" disabled={busy || !changed || (ready === false && list.length > 0)}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Overlay>
  );
};

// ── Side conversations ──────────────────────────────────────────────────────

export const NewSideConversationDialog: React.FC<{ conversation: Conversation; token: string; onClose: () => void; onDone: (r: SideConversation) => void }> = ({ conversation, token, onClose, onDone }) => {
  const ready = useEmailReady(token);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(() => conversation.title || `About ${conversation.customer.name}'s request`);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = EMAIL_RE.test(to.trim()) && subject.trim() && content.trim();
  const send = async () => {
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try { onDone(await call(`/api/tickets/${conversation.id}/side-conversations`, token, 'POST', { to: to.trim(), subject: subject.trim(), content: content.trim() })); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose} busy={busy} width={560}>
      <Header icon={<Mail className="w-[18px] h-[18px]" />} title="New side conversation" onClose={onClose} />
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-[13.5px] text-muted leading-relaxed">
          Email someone outside the team, like a supplier or another department. The thread stays in this conversation as internal notes; {conversation.customer.name} doesn’t see it.
        </p>
        {ready === false && <NotReady />}
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink">To</span>
          <input autoFocus value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" className="ic-input" /></label>
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink">Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} className="ic-input" /></label>
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium text-ink">Message</span>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} className="ic-textarea"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} /></label>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">
        <button onClick={onClose} className="ic-btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={send} className="ic-btn-primary" disabled={!ok || busy || ready === false} title="⌘ Enter"><Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Overlay>
  );
};

/** One side conversation: its messages (from the conversation's notes) and a reply box. */
export const SideConversationDialog: React.FC<{ rec: SideConversation; token: string; onClose: () => void }> = ({ rec, token, onClose }) => {
  const socket = useSocket();
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    call(`/api/messages/${rec.conversationId}?limit=1000`, token)
      .then((all: Message[]) => setMsgs(all.filter(m => m.metadata?.side?.id === rec.id)))
      .catch(() => setMsgs([]));
  }, [rec.conversationId, rec.id, token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return;
    const on = (m: Message) => { if (m.metadata?.side?.id === rec.id) setMsgs(prev => (prev && !prev.some(x => x.id === m.id) ? [...prev, m] : prev)); };
    socket.on('message:new', on);
    return () => { socket.off('message:new', on); };
  }, [socket, rec.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const reply = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try { await call(`/api/side-conversations/${rec.id}/reply`, token, 'POST', { content: text.trim() }); setText(''); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  return (
    <Overlay onClose={onClose} busy={busy} width={600}>
      <Header icon={<Mail className="w-[18px] h-[18px]" />} title={`${rec.subject} · ${rec.to}`} onClose={onClose} />
      <div className="flex-1 min-h-[200px] overflow-y-auto px-5 py-4 flex flex-col gap-3 bg-canvas">
        {msgs === null && <p className="text-[13px] text-muted text-center py-6">Loading…</p>}
        {msgs?.length === 0 && <p className="text-[13px] text-muted text-center py-6">No messages yet</p>}
        {msgs?.map(m => {
          const inbound = m.metadata?.side?.direction === 'in';
          return (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${inbound ? 'self-start bg-surface border border-line' : 'self-end bg-note border border-note-line'}`}>
              <div className="flex items-center gap-2 text-[12px] text-muted mb-1">
                <span className="font-medium text-ink/80">{m.sender.name}</span>
                <TimeHover iso={m.createdAt}>{shortAgo(m.createdAt)}</TimeHover>
              </div>
              {m.content}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-3 flex flex-col gap-2 shrink-0">
        {error && <p className="text-[13px] text-red-600 px-1">{error}</p>}
        <div className="flex gap-2 items-end">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder={`Reply to ${rec.to}`} className="ic-textarea flex-1"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reply(); } }} />
          <button onClick={reply} disabled={!text.trim() || busy} className="ic-btn-primary h-10" title="⌘ Enter"><Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </Overlay>
  );
};

/** Sidebar › Links › Side conversations: the list, + to start one, click to open. */
export const SideConversationsLinks: React.FC<{ conv: Conversation; token: string; readOnly?: boolean }> = ({ conv, token, readOnly }) => {
  const socket = useSocket();
  const [list, setList] = useState<SideConversation[]>([]);
  const [creating, setCreating] = useState(false);
  const [openRec, setOpenRec] = useState<SideConversation | null>(null);
  const load = useCallback(() => { call(`/api/tickets/${conv.id}/side-conversations`, token).then(setList).catch(() => setList([])); }, [conv.id, token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return;
    const on = (m: Message) => { if (m.conversationId === conv.id && m.metadata?.side) load(); };
    socket.on('message:new', on);
    return () => { socket.off('message:new', on); };
  }, [socket, conv.id, load]);

  return (
    <>
      <div className="flex justify-between items-center min-h-[34px] text-[13px] text-muted">
        <span>Side conversations{list.length ? <span className="ml-1.5 text-faint">{list.length}</span> : null}</span>
        {!readOnly && (
          <button className="ic-icon-btn w-7 h-7" title="New side conversation" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /></button>
        )}
      </div>
      {list.map(r => (
        <button key={r.id} onClick={() => setOpenRec(r)} className="-mx-2 px-2 h-8 rounded-lg hover:bg-subtle flex items-center gap-2 text-left text-[13px]">
          <Mail className="w-3.5 h-3.5 text-muted shrink-0" />
          <span className="text-ink truncate min-w-0 flex-1">{r.subject}</span>
          <span className="text-muted truncate max-w-[45%]">{r.to}</span>
          {r.lastMessageAt && <span className="text-faint shrink-0">{shortAgo(r.lastMessageAt)}</span>}
        </button>
      ))}
      {creating && (
        <NewSideConversationDialog conversation={conv} token={token} onClose={() => setCreating(false)}
          onDone={r => { setCreating(false); load(); setOpenRec(r); }} />
      )}
      {openRec && <SideConversationDialog rec={openRec} token={token} onClose={() => setOpenRec(null)} />}
    </>
  );
};
