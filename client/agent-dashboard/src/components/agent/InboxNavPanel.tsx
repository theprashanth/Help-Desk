import React, { useRef, useState } from 'react';
import {
  Plus, Search, PenLine, Users, UserX, BarChart3, ChevronDown, ChevronRight,
  MessageSquare, Ticket, Wrench, Bot, CheckCircle2, MessagesSquare, AtSign, UsersRound
, Sparkles } from 'lucide-react';
import { useTeams } from '../../lib/teams';
import { Agent } from '../../../../../shared/src/types';

export interface InboxCounts {
  yours: number;
  yoursUnread: number;
  createdByYou: number;
  all: number;
  unassigned: number;
  byAgent: Record<string, number>;
  byKind: Record<string, number>;
  byTeam?: Record<string, number>;
  bot?: { active: number; resolved: number };
  ai?: { active: number; resolved: number; handoff: number };
  mentions?: { unread: number; conversationIds: string[] };
}

interface Props {
  activeView: string;
  onSelect: (view: string) => void;
  counts: InboxCounts | null;
  agents: Agent[];
  me: Agent;
  onSearch: () => void;
  onOpenDashboard: () => void;
  onCreate: (kind: 'conversation' | 'ticket' | 'issue') => void;
}

const TICKET_TYPES = [
  { group: 'Customer tickets', kind: 'ticket' as const, label: 'Tickets', emoji: '🎟️', hint: 'Shared with the customer' },
  { group: 'Tracker tickets', kind: 'issue' as const, label: 'Issue', emoji: '🔧', hint: 'Internal, links many reports' },
];

const Count: React.FC<{ n?: number }> = ({ n }) =>
  n === undefined ? null : <span className="ic-count">{n}</span>;

/** Left "Inbox" panel: views with live counts, teammates, channel/type views, and the + create menu. */
export const InboxNavPanel: React.FC<Props> = ({
  activeView, onSelect, counts, agents, me, onSearch, onOpenDashboard, onCreate
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [ticketMenuOpen, setTicketMenuOpen] = useState(false);
  const ticketItemRef = useRef<HTMLButtonElement>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const openTicketMenu = () => {
    const r = ticketItemRef.current?.getBoundingClientRect();
    if (r) setFlyoutPos({ top: Math.max(8, r.top - 6), left: r.right + 10 });
    setTicketMenuOpen(true);
  };
  const [typeQuery, setTypeQuery] = useState('');
  const [teammatesOpen, setTeammatesOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const teams = useTeams();
  const [botOpen, setBotOpen] = useState(true);

  const closeMenus = () => { setCreateOpen(false); setTicketMenuOpen(false); setTypeQuery(''); };
  const create = (kind: 'conversation' | 'ticket' | 'issue') => { closeMenus(); onCreate(kind); };

  const item = (id: string, label: React.ReactNode, icon: React.ReactNode, count?: number) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      className={`ic-nav-item ${activeView === id ? 'ic-nav-item-active' : ''}`}
    >
      <span className="w-[18px] flex justify-center text-ink shrink-0 [&_svg]:stroke-[2.25]">{icon}</span>
      <span className="truncate">{label}</span>
      <Count n={count} />
    </button>
  );

  const types = TICKET_TYPES.filter(t => t.label.toLowerCase().includes(typeQuery.trim().toLowerCase()));
  const teammates = agents.filter(a => a.id !== me.id);

  return (
    <aside className="ic-panel-side w-[208px] h-full shrink-0 flex flex-col animate-fade-in">
      {/* Header + create menu */}
      <div className="h-16 shrink-0 flex items-center justify-between px-5 relative">
        <h1 className="ic-title">Inbox</h1>
        <button
          onClick={() => (createOpen ? closeMenus() : setCreateOpen(true))}
          className={`ic-icon-btn ${createOpen ? 'bg-ink/10' : ''} ${me.role === 'light' ? 'hidden' : ''}`}
          title="Create a conversation or ticket"
        >
          <Plus className="w-[18px] h-[18px]" />
        </button>

        {createOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={closeMenus} />
            <div className="ic-menu absolute left-3 top-14 w-[210px] animate-fade-in">
              <button onClick={() => create('conversation')} className="ic-menu-item" onMouseEnter={() => setTicketMenuOpen(false)}>
                <MessageSquare className="w-4 h-4" /> Conversation
              </button>
              <button
                ref={ticketItemRef}
                onClick={() => (ticketMenuOpen ? setTicketMenuOpen(false) : openTicketMenu())}
                onMouseEnter={openTicketMenu}
                className={`ic-menu-item ${ticketMenuOpen ? 'bg-subtle' : ''}`}
              >
                <Ticket className="w-4 h-4" />
                <span className="flex-1">Ticket</span>
                <ChevronRight className="w-4 h-4 text-muted" />
              </button>

              {/* Ticket types submenu */}
              {ticketMenuOpen && flyoutPos && (
                <div className="ic-menu fixed w-[250px] py-0 overflow-hidden animate-fade-in" style={{ top: flyoutPos.top, left: flyoutPos.left }}>
                  <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-line">
                    <Search className="w-4 h-4 text-faint shrink-0" />
                    <input
                      autoFocus
                      value={typeQuery}
                      onChange={(e) => setTypeQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') closeMenus();
                        if (e.key === 'Enter' && types[0]) create(types[0].kind);
                      }}
                      placeholder="Search ticket types..."
                      className="flex-1 min-w-0 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    />
                  </div>
                  <div className="py-1.5">
                    {types.length === 0 && <div className="px-3.5 py-2.5 text-[13px] text-muted">No matching ticket types</div>}
                    {types.map(t => (
                      <React.Fragment key={t.kind}>
                        <div className="px-3.5 pt-2 pb-1 text-[12px] font-medium text-faint">{t.group}</div>
                        <button onClick={() => create(t.kind)} className="ic-menu-item" title={t.hint}>
                          <span className="w-4 text-center">{t.emoji}</span> {t.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mx-5 border-t border-dashed border-line" />

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
        <button onClick={onSearch} className={`ic-nav-item ${activeView === 'search' ? 'ic-nav-item-active' : ''}`}>
          <span className="w-[18px] flex justify-center text-ink/80"><Search className="w-[17px] h-[17px]" /></span>
          Search
        </button>

        <div className="h-1.5" />

        {item('yours', 'Your inbox',
          me.avatar
            ? <img src={me.avatar} alt="" className="w-[18px] h-[18px] rounded-full object-cover" />
            : <Users className="w-[17px] h-[17px]" />,
          counts?.yours)}
        {item('mentions', 'Mentions', <AtSign className="w-[17px] h-[17px]" />, counts?.mentions?.unread)}
        {item('created', 'Created by you', <PenLine className="w-[17px] h-[17px]" />, counts?.createdByYou)}
        {item('all', 'All', <Users className="w-[17px] h-[17px]" />, counts?.all)}
        {item('unassigned', 'Unassigned', <UserX className="w-[17px] h-[17px]" />, counts?.unassigned)}
        <button onClick={onOpenDashboard} className="ic-nav-item">
          <span className="w-[18px] flex justify-center text-ink/80"><BarChart3 className="w-[17px] h-[17px]" /></span>
          Dashboard
        </button>

        {/* Teammates */}
        <button onClick={() => setTeammatesOpen(o => !o)} className="ic-nav-group mt-4 hover:bg-ink/[0.03] rounded-lg">
          <span>Teammates</span>
          {teammatesOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
        </button>
        {teammatesOpen && (
          teammates.length === 0
            ? <div className="px-3 py-1.5 text-[13px] text-muted">No other teammates yet</div>
            : teammates.map(a => item(`agent:${a.id}`, a.name,
                a.avatar
                  ? <img src={a.avatar} alt="" className="w-[18px] h-[18px] rounded-full object-cover" />
                  : <span className="w-[18px] h-[18px] rounded-full bg-subtle text-[10px] font-semibold flex items-center justify-center">{a.name.charAt(0)}</span>,
                counts?.byAgent?.[a.id] ?? 0))
        )}

        {/* Team inboxes (Settings › Teams) */}
        {teams.length > 0 && (
          <>
            <button onClick={() => setTeamsOpen(o => !o)} className="ic-nav-group mt-4 hover:bg-ink/[0.03] rounded-lg">
              <span>Team inboxes</span>
              {teamsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
            </button>
            {teamsOpen && teams.map(t => item(`team:${t.id}`, t.name,
              t.emoji ? <span className="text-[15px] leading-none">{t.emoji}</span> : <UsersRound className="w-[16px] h-[16px]" />,
              counts?.byTeam?.[t.id] ?? 0))}
          </>
        )}

        {/* Views by type */}
        <button onClick={() => setViewsOpen(o => !o)} className="ic-nav-group mt-4 hover:bg-ink/[0.03] rounded-lg">
          <span>Views</span>
          {viewsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
        </button>
        {viewsOpen && (
          <>
            {item('kind:conversation', 'Conversations', <span className="text-[15px] leading-none">💬</span>, counts?.byKind?.conversation ?? 0)}
            {item('kind:ticket', 'Tickets', <span className="text-[15px] leading-none">🎟️</span>, counts?.byKind?.ticket ?? 0)}
            {item('kind:issue', 'Issues', <Wrench className="w-[16px] h-[16px]" />, counts?.byKind?.issue ?? 0)}
          </>
        )}

        {/* Chat-flow bot: chats that never reached a person, kept for reference */}
        <button onClick={() => setBotOpen(o => !o)} className="ic-nav-group mt-4 hover:bg-ink/[0.03] rounded-lg">
          <span>Bot chats</span>
          {botOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
        </button>
        {botOpen && (
          <>
            {/* Settings › AI Agent: every chat it answered (the ones it's answering now aren't in the team's views) */}
            {item('ai', 'AI Agent', <Sparkles className="w-[16px] h-[16px]" />, counts?.ai?.active)}
            {item('bot:resolved', 'Resolved by bot', <CheckCircle2 className="w-[16px] h-[16px]" />, counts?.bot?.resolved)}
            {item('bot:active', 'In progress', <MessagesSquare className="w-[16px] h-[16px]" />, counts?.bot?.active)}
            {item('bot', 'All bot chats', <Bot className="w-[16px] h-[16px]" />, counts?.bot ? counts.bot.active + counts.bot.resolved : undefined)}
          </>
        )}
      </div>
    </aside>
  );
};

export default InboxNavPanel;
