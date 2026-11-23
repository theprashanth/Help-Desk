import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Search, CornerUpLeft, StickyNote, CheckCircle2, Hourglass, CircleDot, AlarmClock, UserCheck, UserPlus,
  UserX, ArrowUpDown, Zap, GitMerge, Inbox as InboxIcon, AtSign, PenLine, Users, BarChart3, Settings as SettingsIcon,
  MessageSquare, Bot, Keyboard, Plus, Ticket,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, Conversation, MacroActions, SavedReply } from '../../../../../shared/src/types';
import CloseConversationIcon from '../ui/CloseConversationIcon';
import { applyMacroActions, describeMacroActions } from '../../lib/macros';
import { useSnoozeOptions } from '../../lib/useSnoozeOptions';
import { computeSnoozeUntil } from '../../lib/snooze';

const BACKEND_URL = 'http://localhost:3000';

type Page = 'root' | 'assign' | 'priority' | 'snooze' | 'macro';
type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  kbd?: string[];
  keywords?: string;
  run: () => void | Promise<void>;
  keepOpen?: boolean;
};

const ic = 'w-[17px] h-[17px]';
const PRIORITIES: { value: NonNullable<MacroActions['priority']>; label: string }[] = [
  { value: 'critical', label: 'Urgent' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }, { value: 'none', label: 'No priority' },
];

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Command palette' },
  { keys: ['J'], label: 'Next conversation' },
  { keys: ['K'], label: 'Previous conversation' },
  { keys: ['R'], label: 'Reply' },
  { keys: ['N'], label: 'Add a note' },
  { keys: ['E'], label: 'Close…' },
  { keys: ['Z'], label: 'Snooze…' },
  { keys: ['A'], label: 'Assign…' },
  { keys: ['P'], label: 'Change priority…' },
  { keys: ['M'], label: 'Run a macro…' },
  { keys: ['⌘', '⇧', 'Y'], label: 'Close without resolving' },
  { keys: ['⌘', '⇧', 'M'], label: 'Merge into…' },
  { keys: ['⌘', 'E'], label: 'Show / hide conversation events' },
  { keys: ['?'], label: 'Keyboard shortcuts' },
  { keys: ['Esc'], label: 'Leave the reply box' },
];

const Kbd: React.FC<{ k: string }> = ({ k }) => (
  <kbd className="min-w-6 h-6 px-1.5 rounded-md border border-line bg-surface text-[12px] text-muted inline-flex items-center justify-center font-sans">{k}</kbd>
);

/** True while the user is typing somewhere, so single-letter shortcuts stay out of the way. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const sendChat = (cmd: string): void => { window.dispatchEvent(new CustomEvent('chat:command', { detail: cmd })); };

/**
 * ⌘K command palette and the single-key inbox shortcuts (J/K, R, N, E, Z, A, P, M, ?).
 * Conversation commands act on the open conversation through the normal endpoints, so events,
 * customer state lines and live updates behave exactly as if done from the menus.
 */
export const CommandPalette: React.FC<{
  enabled: boolean;                          // inbox screens only
  agents: Agent[];
  onSelectView: (view: string) => void;
  onOpenTab: (tab: 'analytics' | 'settings' | 'search') => void;
  onCreate: (kind: 'conversation' | 'ticket' | 'issue') => void;
}> = ({ enabled, agents, onSelectView, onOpenTab, onCreate }) => {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const conversations = useStore(s => s.conversations);
  const activeId = useStore(s => s.activeConversationId);
  const setActiveConversationId = useStore(s => s.setActiveConversationId);
  const savedReplies = useStore(s => s.savedReplies);
  const setSavedReplies = useStore(s => s.setSavedReplies);
  const snoozeOptions = useSnoozeOptions();
  const isLight = me?.role === 'light';
  const teams = useStore(s => s.teams);

  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [page, setPage] = useState<Page>('root');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Conversations found on the server (the store only holds the list that's showing)
  const [found, setFound] = useState<Conversation[]>([]);
  const conv = useMemo(() => conversations.find(c => c.id === activeId) || null, [conversations, activeId]);
  useEffect(() => {
    const q = query.trim().replace(/^#/, '');
    if (!open || page !== 'root' || q.length < 2 || !token) { setFound([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/tickets?search=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
        .then(r => (r.ok ? r.json() : []))
        .then(d => Array.isArray(d) && setFound(d.filter((c: Conversation) => !c.mergedInto).slice(0, 8)))
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, open, page, token]);

  const openAt = (p: Page) => { setPage(p); setQuery(''); setCursor(0); setOpen(true); setHelp(false); };
  const close = () => { setOpen(false); setPage('root'); setQuery(''); };

  // Macros may not be loaded yet if no conversation has been opened
  useEffect(() => {
    if (!open || savedReplies.length || !token) return;
    fetch(`${BACKEND_URL}/api/saved-replies`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : [])).then(d => Array.isArray(d) && d.length && setSavedReplies(d)).catch(() => {});
  }, [open, savedReplies.length, token, setSavedReplies]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open, page]);
  useEffect(() => { setCursor(0); }, [query, page]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const act = async (actions: MacroActions, label: string) => {
    if (!conv) return;
    const r = await applyMacroActions(conv, actions, { token, agentId: me?.id });
    setNotice(r.ok ? { text: label } : { text: r.error || 'Something went wrong', error: true });
  };

  // ── Global keys ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close(); else openAt('root');
        return;
      }
      if (open || mod || e.altKey) return;
      if (e.key === 'Escape' && help) { e.preventDefault(); setHelp(false); return; }
      if (isTypingTarget(e.target)) {
        // Esc leaves the reply box so the single-key shortcuts work again
        if (e.key === 'Escape' && (e.target as HTMLElement).isContentEditable && !document.querySelector('[role="dialog"], .ic-menu')) {
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (document.querySelector('[role="dialog"]')) return; // another dialog owns the keyboard
      const k = e.key;
      const hasConv = !!conv;
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      if (k === '?') run(() => setHelp(h => !h));
      else if (k === 'j') run(() => window.dispatchEvent(new CustomEvent('inbox:step', { detail: 1 })));
      else if (k === 'k') run(() => window.dispatchEvent(new CustomEvent('inbox:step', { detail: -1 })));
      else if (!hasConv) return;
      else if (k === 'n') run(() => sendChat('note'));
      else if (isLight) return; // read-only seat: notes and navigation only
      else if (k === 'r') run(() => sendChat('reply'));
      else if (k === 'e') run(() => sendChat('close'));
      else if (k === 'z') run(() => sendChat('snooze'));
      else if (k === 'a') run(() => openAt('assign'));
      else if (k === 'p') run(() => openAt('priority'));
      else if (k === 'm') run(() => openAt('macro'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Items for the current page ──────────────────────────────────────────
  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    const who = (id?: string) => agents.find(a => a.id === id)?.name;

    if (page === 'assign') {
      if (!conv) return list;
      if (me) list.push({ id: 'me', group: 'Assign to', label: `${me.name} (you)`, icon: <UserCheck className={ic} />, run: () => act({ assignTo: 'me' }, 'Assigned to you') });
      agents.filter(a => a.id !== me?.id).forEach(a => list.push({
        id: a.id, group: 'Assign to', label: a.name, hint: a.id === conv.assignedAgentId ? 'Current' : a.status === 'online' ? 'Online' : undefined,
        icon: <span className="w-[18px] h-[18px] rounded-full bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100 text-[10px] font-semibold flex items-center justify-center uppercase">{a.name.charAt(0)}</span>,
        run: () => act({ assignTo: a.id }, `Assigned to ${a.name}`),
      }));
      if (conv.assignedAgentId) list.push({ id: 'unassign', group: 'Assign to', label: 'Unassign', icon: <UserX className={ic} />, run: () => act({ assignTo: 'unassigned' }, 'Unassigned') });
      return list;
    }
    if (page === 'priority') {
      PRIORITIES.forEach(p => list.push({
        id: p.value, group: 'Priority', label: p.label, hint: conv?.priority === p.value ? 'Current' : undefined,
        icon: <ArrowUpDown className={ic} />, run: () => act({ priority: p.value }, `Priority set to ${p.label}`),
      }));
      return list;
    }
    if (page === 'snooze') {
      snoozeOptions.forEach(o => list.push({
        id: o.value, group: 'Snooze until', label: o.label, hint: o.sub, icon: <AlarmClock className={ic} />,
        run: async () => {
          if (!conv) return;
          const res = await fetch(`${BACKEND_URL}/api/tickets/${conv.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ snoozedUntil: computeSnoozeUntil(o.value) }),
          });
          setNotice(res.ok ? { text: `Snoozed · ${o.label}` } : { text: 'Could not snooze', error: true });
        },
      }));
      return list;
    }
    if (page === 'macro') {
      macroItems(list, savedReplies, me?.id, agents);
      return list;
    }

    // Root
    if (conv && isLight) {
      list.push({ id: 'note', group: `Conversation ${conv.ticketNumber}`, label: 'Add a note', icon: <StickyNote className={ic} />, kbd: ['N'], keywords: 'internal', run: () => sendChat('note') });
    } else if (conv) {
      const g = `Conversation ${conv.ticketNumber}`;
      list.push(
        { id: 'reply', group: g, label: 'Reply', icon: <CornerUpLeft className={ic} />, kbd: ['R'], run: () => sendChat('reply') },
        { id: 'note', group: g, label: 'Add a note', icon: <StickyNote className={ic} />, kbd: ['N'], keywords: 'internal', run: () => sendChat('note') },
      );
      if (conv.status !== 'closed') list.push({ id: 'close', group: g, label: 'Close…', icon: <CloseConversationIcon className={ic} />, kbd: ['E'], run: () => sendChat('close') });
      if (conv.status !== 'resolved') list.push({ id: 'resolve', group: g, label: 'Mark as resolved', icon: <CheckCircle2 className={ic} />, keywords: 'solve done', run: () => act({ status: 'resolved' }, 'Marked as resolved') });
      if (conv.status !== 'waiting') list.push({ id: 'waiting', group: g, label: 'Mark as waiting on customer', icon: <Hourglass className={ic} />, keywords: 'pending', run: () => act({ status: 'waiting' }, 'Waiting on customer') });
      if (conv.status !== 'open') list.push({ id: 'reopen', group: g, label: 'Reopen', icon: <CircleDot className={ic} />, keywords: 'in progress open', run: () => act({ status: 'open' }, 'Reopened') });
      list.push(
        { id: 'snooze', group: g, label: 'Snooze…', icon: <AlarmClock className={ic} />, kbd: ['Z'], run: () => { setPage('snooze'); }, keepOpen: true },
      );
      if (conv.assignedAgentId !== me?.id) list.push({ id: 'assign-me', group: g, label: 'Assign to me', icon: <UserCheck className={ic} />, keywords: 'take', run: () => act({ assignTo: 'me' }, 'Assigned to you') });
      list.push(
        { id: 'assign', group: g, label: 'Assign to…', hint: who(conv.assignedAgentId) ? `Now: ${who(conv.assignedAgentId)}` : 'Unassigned', icon: <UserPlus className={ic} />, kbd: ['A'], run: () => { setPage('assign'); }, keepOpen: true },
        { id: 'priority', group: g, label: 'Change priority…', icon: <ArrowUpDown className={ic} />, kbd: ['P'], run: () => { setPage('priority'); }, keepOpen: true },
        { id: 'macro', group: g, label: 'Run a macro…', icon: <Zap className={ic} />, kbd: ['M'], keywords: 'saved reply', run: () => { setPage('macro'); }, keepOpen: true },
      );
      if (!conv.mergedInto) list.push({ id: 'merge', group: g, label: 'Merge into…', icon: <GitMerge className={ic} />, kbd: ['⌘', '⇧', 'M'], run: () => sendChat('merge') });
    }

    const nav = 'Go to';
    list.push(
      { id: 'v-yours', group: nav, label: 'Your inbox', icon: <InboxIcon className={ic} />, run: () => onSelectView('yours') },
      { id: 'v-mentions', group: nav, label: 'Mentions', icon: <AtSign className={ic} />, run: () => onSelectView('mentions') },
      { id: 'v-created', group: nav, label: 'Created by you', icon: <PenLine className={ic} />, run: () => onSelectView('created') },
      { id: 'v-all', group: nav, label: 'All conversations', icon: <Users className={ic} />, run: () => onSelectView('all') },
      { id: 'v-unassigned', group: nav, label: 'Unassigned', icon: <UserX className={ic} />, run: () => onSelectView('unassigned') },
      { id: 'v-tickets', group: nav, label: 'Tickets', icon: <Ticket className={ic} />, run: () => onSelectView('kind:ticket') },
      { id: 'v-bot', group: nav, label: 'Bot chats', icon: <Bot className={ic} />, run: () => onSelectView('bot') },
      ...teams.map(t => ({ id: `v-team-${t.id}`, group: nav, label: `${t.name} team inbox`, icon: t.emoji ? <span className="text-[15px] leading-none">{t.emoji}</span> : <Users className={ic} />, keywords: 'team', run: () => onSelectView(`team:${t.id}`) })),
      ...agents.filter(a => a.id !== me?.id).map(a => ({ id: `v-agent-${a.id}`, group: nav, label: `${a.name}'s inbox`, icon: <Users className={ic} />, keywords: 'teammate', run: () => onSelectView(`agent:${a.id}`) })),
      { id: 'search', group: nav, label: 'Search everything', icon: <Search className={ic} />, run: () => onOpenTab('search') },
      { id: 'analytics', group: nav, label: 'Analytics', icon: <BarChart3 className={ic} />, keywords: 'reports dashboard', run: () => onOpenTab('analytics') },
      { id: 'settings', group: nav, label: 'Settings', icon: <SettingsIcon className={ic} />, run: () => onOpenTab('settings') },
      ...(isLight ? [] : [
        { id: 'new-conv', group: 'Create', label: 'New conversation', icon: <Plus className={ic} />, run: () => onCreate('conversation') },
        { id: 'new-ticket', group: 'Create', label: 'New ticket', icon: <Plus className={ic} />, run: () => onCreate('ticket') },
      ]),
      { id: 'help', group: 'Help', label: 'Keyboard shortcuts', icon: <Keyboard className={ic} />, kbd: ['?'], run: () => { setHelp(true); } },
    );

    // Typing also searches macros and loaded conversations
    if (query.trim()) {
      if (conv && !isLight) macroItems(list, savedReplies, me?.id, agents);
      const q = query.trim().toLowerCase().replace(/^#/, '');
      const local = conversations.filter(c => [c.ticketNumber, c.customer?.name, c.customer?.email, c.title, c.lastMessageSnippet]
        .some(v => (v || '').toLowerCase().replace(/^#/, '').includes(q)));
      const seen = new Set<string>();
      [...local, ...found]
        .filter(c => c.id !== conv?.id && !seen.has(c.id) && !!seen.add(c.id))
        .slice(0, 8)
        .forEach(c => list.push({
          id: `c-${c.id}`, group: 'Conversations', label: `${c.customer?.name || 'Visitor'} · ${c.ticketNumber}`,
          hint: (c.title || c.lastMessageSnippet || '').slice(0, 60), icon: <MessageSquare className={ic} />,
          keywords: `${c.ticketNumber} ${c.customer?.email || ''} ${c.title || ''} ${c.lastMessageSnippet || ''}`,
          run: () => {
            // Not in the list that's showing: open it from All conversations (every state)
            if (!useStore.getState().conversations.some(x => x.id === c.id)) {
              useStore.getState().setStateFilter('all');
              onSelectView('all');
            }
            setActiveConversationId(c.id);
          },
        }));
    }
    return list;

    function macroItems(out: Item[], replies: SavedReply[], myId: string | undefined, team: Agent[]) {
      replies
        .filter(r => r.availableFor !== 'myself' || r.creator?.id === myId)
        .forEach(r => out.push({
          id: `m-${r.id}`, group: 'Macros', label: r.title, icon: <Zap className={`${ic} text-amber-500`} />,
          hint: [r.content?.trim() ? 'Inserts reply' : '', ...describeMacroActions(r.actions, team)].filter(Boolean).join(' · ') || r.trigger,
          keywords: `${r.trigger} ${r.content}`,
          run: () => { window.dispatchEvent(new CustomEvent('macro:run', { detail: r })); },
        }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, conv, agents, me, savedReplies, snoozeOptions, query, conversations, token, found, teams, isLight]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const words = q.split(/\s+/);
    return items.filter(i => i.group === 'Conversations' || words.every(w => `${i.label} ${i.keywords || ''} ${i.hint || ''}`.toLowerCase().includes(w)));
  }, [items, query]);

  const pick = async (it?: Item) => {
    if (!it) return;
    if (!it.keepOpen) close();
    await it.run();
  };

  // Keys inside the palette
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (page !== 'root') setPage('root'); else close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(i => Math.min(i + 1, Math.max(0, shown.length - 1))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(shown[cursor]); }
      else if (e.key === 'Backspace' && !query && page !== 'root') { e.preventDefault(); setPage('root'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const title: Record<Page, string> = { root: '', assign: 'Assign to', priority: 'Change priority', snooze: 'Snooze', macro: 'Run a macro' };
  const placeholder = page === 'root'
    ? (conv ? `Type a command or search… (${conv.ticketNumber})` : 'Type a command or search…')
    : page === 'macro' ? 'Search macros…' : page === 'assign' ? 'Search teammates…' : 'Search…';

  let lastGroup = '';
  return (
    <>
      {notice && createPortal(
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] h-10 px-4 rounded-full shadow-pop border text-[14px] flex items-center gap-2 animate-fade-in ${notice.error ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/30 dark:text-red-200' : 'bg-surface border-line text-ink'}`}>
          {notice.error ? null : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}{notice.text}
        </div>,
        document.body,
      )}

      {help && createPortal(
        <div className="fixed inset-0 z-[70] bg-ink/25 flex items-start justify-center pt-[12vh] p-4 animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget) setHelp(false); }}>
          <div className="w-[480px] max-w-full bg-surface rounded-2xl shadow-pop border border-line overflow-hidden" role="dialog" aria-label="Keyboard shortcuts">
            <div className="flex items-center gap-2 px-5 h-14 border-b border-line">
              <Keyboard className="w-[18px] h-[18px] text-muted" />
              <h3 className="text-[16px] font-semibold text-ink flex-1">Keyboard shortcuts</h3>
              <Kbd k="esc" />
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {SHORTCUTS.map(s => (
                <div key={s.label} className="flex items-center justify-between px-3 h-10 rounded-lg text-[14px] text-ink">
                  <span>{s.label}</span>
                  <span className="flex items-center gap-1">{s.keys.map(k => <Kbd key={k} k={k} />)}</span>
                </div>
              ))}
            </div>
            <p className="px-5 py-3 border-t border-line text-[12.5px] text-muted">Single-letter shortcuts work when you're not typing. Press Esc in the reply box to leave it.</p>
          </div>
        </div>,
        document.body,
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[70] bg-ink/25 flex items-start justify-center pt-[12vh] p-4 animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
          <div className="w-[640px] max-w-full h-[min(520px,80vh)] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden" role="dialog" aria-label="Command palette">
            <label className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
              {page === 'root'
                ? <Search className="w-[18px] h-[18px] text-muted shrink-0 ml-1" />
                : <button onClick={() => setPage('root')} className="ic-icon-btn-ghost" title="Back"><ArrowLeft className="w-[18px] h-[18px]" /></button>}
              {page !== 'root' && <span className="text-[14px] font-medium text-ink shrink-0">{title[page]}</span>}
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
              />
            </label>
            <div ref={listRef} className="flex-1 overflow-y-auto p-2">
              {shown.length === 0 && (
                <p className="px-3 py-8 text-center text-[14px] text-muted">
                  {page === 'macro' && !savedReplies.length ? 'No macros yet. Create one in Settings › Macros.' : 'No matching commands'}
                </p>
              )}
              {shown.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <React.Fragment key={it.id}>
                    {header && page === 'root' && <div className="px-3 pt-3 pb-1.5 text-[12.5px] font-medium text-muted first:pt-1">{header}</div>}
                    <button
                      data-active={i === cursor}
                      onMouseMove={() => i !== cursor && setCursor(i)}
                      onClick={() => pick(it)}
                      className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left text-[14.5px] text-ink ${i === cursor ? 'bg-subtle' : ''}`}
                    >
                      <span className="w-6 flex justify-center shrink-0 text-muted">{it.icon}</span>
                      <span className="min-w-0 truncate shrink-0 max-w-[60%]">{it.label}</span>
                      <span className="flex-1 min-w-0 truncate text-[13px] text-muted">{it.hint}</span>
                      {it.kbd && <span className="flex items-center gap-1 shrink-0">{it.kbd.map(k => <Kbd key={k} k={k} />)}</span>}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="px-5 h-11 border-t border-line flex items-center gap-4 text-[12.5px] text-muted shrink-0">
              <span>↑↓ navigate · ↵ select · esc {page === 'root' ? 'close' : 'back'}</span>
              <button onClick={() => { close(); setHelp(true); }} className="ml-auto hover:text-ink">Shortcuts <Kbd k="?" /></button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default CommandPalette;

