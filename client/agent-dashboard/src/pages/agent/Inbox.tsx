import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import InboxList from '../../components/agent/InboxList';
import ChatWindow from '../../components/agent/ChatWindow';
import CustomerProfilePanel from '../../components/agent/CustomerProfilePanel';
import { MergedConversationPanel } from '../../components/agent/MergedConversationPanel';
import Analytics from './Analytics';
import Contacts from './Contacts';
import Settings from './Settings';
import TestingPanel from '../../components/agent/TestingPanel';
import { InboxNavPanel, InboxCounts } from '../../components/agent/InboxNavPanel';
import { CreateTicketPanel } from '../../components/agent/CreateTicketPanel';
import ProfileMenu, { ThemePref } from '../../components/agent/ProfileMenu';
import { SearchPanel } from '../../components/agent/SearchPanel';
import CommandPalette from '../../components/agent/CommandPalette';
import { isBotView, isInboxView, KIND_LABELS, StateFilter, mentionedConversationIds } from '../../lib/inboxViews';
import { isSnoozed } from '../../lib/snooze';
import { Agent } from '../../../../../shared/src/types';
import { 
  Inbox as InboxIcon,
  BarChart3, Settings as SettingsIcon, Sun, Moon, Sparkles, Globe, Bell, BellOff, Pin, PinOff, Users
} from 'lucide-react';
import { isAudioReady, onAudioReadyChange, unlockAudio, playChime } from '../../lib/sound';

const BACKEND_URL = 'http://localhost:3000';

/** Profile photo, or initials when there isn't one (never a stock photo). */
const AgentAvatar: React.FC<{ agent: { name: string; avatar?: string }; className?: string }> = ({ agent, className = '' }) =>
  agent.avatar
    ? <img src={agent.avatar} alt={agent.name} className={`${className} rounded-full object-cover shrink-0`} />
    : <span className={`${className} rounded-full bg-ink/10 text-ink font-semibold flex items-center justify-center shrink-0 uppercase`}>
        {agent.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?'}
      </span>;

export const Inbox: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('yours'); // inbox view id (yours, created, all, unassigned, agent:<id>, kind:<kind>) or analytics | settings | testing
  const [darkMode, setDarkMode] = useState(false);
  
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  const logout = useStore((state) => state.logout);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const viewingMergedConversationId = useStore((state) => state.viewingMergedConversationId);
  const inboxNavOpen = useStore((state) => state.inboxNavOpen);
  const workspaceName = useStore((state) => state.workspaceName);
  const setActiveConversationId = useStore((state) => state.setActiveConversationId);
  const setFocusMessageId = useStore((state) => state.setFocusMessageId);
  const setStateFilter = useStore((state) => state.setStateFilter);
  const composer = useStore((state) => state.composer);
  const setComposer = useStore((state) => state.setComposer);
  const socket = useStore((state) => state.socket);

  // Workspace snooze presets (Settings > General)
  const setSnoozePresets = useStore((state) => state.setSnoozePresets);
  const setWorkspaceName = useStore((state) => state.setWorkspaceName);
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/workspace`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(ws => {
        if (!ws) return;
        if (Array.isArray(ws.snoozeOptions)) setSnoozePresets(ws.snoozeOptions);
        if (ws.name) setWorkspaceName(ws.name); // browser tab title
      })
      .catch(() => {});
  }, [token, setSnoozePresets, setWorkspaceName]);

  // Teammates (for the Teammates section and assignee pickers)
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/agents`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [token]);

  // Live counts for the inbox panel: refetch on any conversation change (debounced) and every minute
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetch(`${BACKEND_URL}/api/inbox/counts`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(c => {
          if (!c) return;
          mentionedConversationIds.clear();
          (c.mentions?.conversationIds || []).forEach((id: string) => mentionedConversationIds.add(id));
          setCounts(c);
        })
        .catch(() => {});
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 400); };
    load();
    const interval = setInterval(load, 60_000);
    const events = ['conversation:new', 'conversation:update', 'conversation:deleted', 'conversation:assigned', 'mention:new'];
    events.forEach(ev => socket?.on(ev, schedule));
    return () => {
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      events.forEach(ev => socket?.off(ev, schedule));
    };
  }, [token, socket]);

  // Deep links from "Copy link": /agent/inbox?conversation=<id>&message=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conversation');
    if (!convId || !token) return;
    const messageId = params.get('message');
    fetch(`http://localhost:3000/api/tickets/${encodeURIComponent(convId)}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(conv => {
        if (!conv) return;
        const state: StateFilter = isSnoozed(conv) ? 'snoozed'
          : (['waiting', 'resolved', 'closed', 'archived'].includes(conv.status) ? conv.status : 'open') as StateFilter;
        setStateFilter(state);
        setActiveTab('all');
        setActiveConversationId(conv.id);
        if (messageId) setFocusMessageId(messageId);
      })
      .catch(e => console.error(e))
      .finally(() => window.history.replaceState(null, '', window.location.pathname));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setInboxNavOpen = useStore((state) => state.setInboxNavOpen);

  // Auto-collapse the inbox nav on narrower windows (only when crossing the breakpoint,
  // so a manual toggle isn't overridden by every resize event)
  useEffect(() => {
    let wide = window.innerWidth >= 1440;
    const onResize = () => {
      const nowWide = window.innerWidth >= 1440;
      if (nowWide !== wide) {
        wide = nowWide;
        setInboxNavOpen(nowWide);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setInboxNavOpen]);
  const navigate = useNavigate();

  // Redirect if unauthenticated
  useEffect(() => {
    if (!token || !agent) {
      navigate('/agent/login');
    }
  }, [token, agent, navigate]);

  // Theme: System (follows the OS), Light or Dark — saved per browser
  const [themePref, setThemePref] = useState<ThemePref>(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const isDark = themePref === 'dark' || (themePref === 'system' && media.matches);
      setDarkMode(isDark);
      document.documentElement.classList.toggle('dark', isDark);
    };
    apply();
    localStorage.setItem('theme', themePref);
    if (themePref !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [themePref]);

  // The rail's moon/sun button flips to the opposite of what's showing
  const toggleDarkMode = () => setThemePref(darkMode ? 'light' : 'dark');

  // Other screens can open Settings (e.g. Ask AI's "Set up in Settings")
  useEffect(() => {
    const open = () => setActiveTab('settings');
    window.addEventListener('open-settings', open);
    return () => window.removeEventListener('open-settings', open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/agent/login');
  };

  // Open any conversation in the inbox (from Contacts): the All view, in the state it's in
  const openConversation = (convId: string) => {
    if (!token) return;
    fetch(`http://localhost:3000/api/tickets/${encodeURIComponent(convId)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(conv => {
        if (!conv) return;
        const state: StateFilter = isSnoozed(conv) ? 'snoozed'
          : (['waiting', 'resolved', 'closed', 'archived'].includes(conv.status) ? conv.status : 'open') as StateFilter;
        setComposer(null);
        setStateFilter(state);
        setActiveTab('all');
        setActiveConversationId(conv.id);
      })
      .catch(e => console.error(e));
  };

  const mainTabs = [
    { id: 'contacts', label: 'Contacts', icon: <Users className="w-[19px] h-[19px]" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-[19px] h-[19px]" /> },
    { id: 'testing', label: 'Testing Panel', icon: <Sparkles className="w-[19px] h-[19px]" /> },
  ];

  const isChatTab = isInboxView(activeTab) || activeTab === 'search';

  // Remember the last inbox queue so the rail's Inbox icon returns to it
  const [lastQueue, setLastQueue] = useState<string>('yours');
  useEffect(() => {
    if (isChatTab) setLastQueue(activeTab);
  }, [activeTab, isChatTab]);

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Sound alerts need one click before the browser allows audio
  const [soundReady, setSoundReady] = useState(isAudioReady());
  useEffect(() => onAudioReadyChange(setSoundReady), []);
  const handleSoundButton = async () => {
    const ok = await unlockAudio();
    if (ok) playChime({ force: true });
  };

  const viewTitle = (() => {
    if (activeTab === 'yours') return 'Your inbox';
    if (activeTab === 'mentions') return 'Mentions';
    if (activeTab === 'created') return 'Created by you';
    if (activeTab === 'all') return 'All';
    if (activeTab === 'unassigned') return 'Unassigned';
    if (activeTab.startsWith('agent:')) return agents.find(a => a.id === activeTab.slice(6))?.name || 'Teammate';
    if (activeTab.startsWith('kind:')) return KIND_LABELS[activeTab.slice(5)] || 'Inbox';
    if (activeTab.startsWith('team:')) return useStore.getState().teams.find(t => t.id === activeTab.slice(5))?.name || 'Team inbox';
    if (activeTab === 'bot') return 'All bot chats';
    if (activeTab === 'ai') return 'AI Agent';
    if (activeTab === 'bot:active') return 'Bot chats in progress';
    if (activeTab === 'bot:resolved') return 'Resolved by bot';
    return 'Inbox';
  })();

  const selectView = (view: string) => {
    setComposer(null);
    // Bot-handled chats are resolved until someone asks for a person, so show every state there
    if (isBotView(view)) useStore.getState().setStateFilter('all');
    if (view === 'mentions') {
      // Every mention, whatever the conversation's state; opening the view marks them read
      useStore.getState().setStateFilter('all');
      fetch(`${BACKEND_URL}/api/auth/profile/mentions-seen`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
        .then(() => setCounts(c => (c ? { ...c, mentions: { ...(c.mentions || { conversationIds: [] }), unread: 0 } } : c)))
        .catch(() => {});
    }
    setActiveTab(view);
  };

  // Far-left menu: expands on hover (short delay so passing the mouse over it doesn't flash it open)
  const [railPinned, setRailPinned] = useState(() => localStorage.getItem('nav_rail_pinned') === '1');
  const [railHover, setRailHover] = useState(false);
  const railTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railHoverIn = () => { if (railTimer.current) clearTimeout(railTimer.current); railTimer.current = setTimeout(() => setRailHover(true), 120); };
  const railHoverOut = () => { if (railTimer.current) clearTimeout(railTimer.current); railTimer.current = setTimeout(() => setRailHover(false), 180); };
  useEffect(() => () => { if (railTimer.current) clearTimeout(railTimer.current); }, []);
  const toggleRailPinned = () => {
    const next = !railPinned;
    setRailPinned(next);
    if (!next) setRailHover(false);
    try { localStorage.setItem('nav_rail_pinned', next ? '1' : '0'); } catch { /* private mode */ }
  };
  // Stays open while the profile menu is showing (the menu sits outside the rail)
  const railExpanded = railPinned || railHover || profileMenuOpen;
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  // One row of the far-left menu; the icon stays in the same place whether collapsed or expanded
  const railItem = (o: {
    key: string; label: string; icon: React.ReactNode; onClick: () => void; title: string;
    active?: boolean; badge?: number; dot?: boolean; className?: string;
  }) => (
    <button
      key={o.key}
      onClick={o.onClick}
      title={railExpanded ? undefined : o.title}
      className={`relative h-9 shrink-0 flex items-center rounded-lg text-ink/80 hover:bg-ink/[0.06] hover:text-ink transition-colors ${
        railExpanded ? 'w-full gap-3 px-[8.5px]' : 'w-9 justify-center'
      } ${o.active ? 'bg-surface shadow-pill text-ink hover:bg-surface' : ''} ${o.className || ''}`}
    >
      <span className="relative shrink-0 flex">
        {o.icon}
        {!railExpanded && !!o.badge && (
          <span className="absolute -top-2 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center tabular-nums ring-2 ring-canvas">
            {o.badge > 99 ? '99+' : o.badge}
          </span>
        )}
      </span>
      {railExpanded && <span className="truncate text-[14px] font-medium">{o.label}</span>}
      {railExpanded && !!o.badge && (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center tabular-nums">
          {o.badge > 99 ? '99+' : o.badge}
        </span>
      )}
      {o.dot && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent animate-pulse" />}
    </button>
  );

  if (!agent) return null;

  return (
    <div className="h-screen w-screen bg-canvas text-ink flex overflow-hidden p-2 pl-0 gap-2">
      {/* Far-left navigation: a slim icon bar that expands over the page on hover (or stays open when pinned) */}
      <div className="relative h-full shrink-0 transition-[width] duration-150" style={{ width: railPinned ? 220 : 56 }}>
        <nav
          onMouseEnter={railHoverIn}
          onMouseLeave={railHoverOut}
          className={`absolute left-0 top-0 bottom-0 z-50 flex flex-col gap-1 px-2.5 py-1.5 overflow-hidden transition-[width,box-shadow] duration-150 ease-out ${
            railExpanded ? 'w-[220px]' : 'w-14'
          } ${railExpanded && !railPinned ? 'bg-canvas shadow-2xl rounded-r-2xl ring-1 ring-line' : ''}`}
        >
          {/* Logo + pin */}
          <div className="h-9 mb-2 flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-ink text-on-ink flex items-center justify-center" title="Chai Samosa">
              <Globe className="w-[18px] h-[18px]" />
            </div>
            {railExpanded && (
              <>
                <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-ink">{workspaceName}</span>
                <button
                  onClick={toggleRailPinned}
                  className="ic-icon-btn-ghost shrink-0"
                  title={railPinned ? 'Unpin — collapse to icons' : 'Pin — keep the menu open'}
                >
                  {railPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>

          {railItem({
            key: 'inbox',
            label: 'Inbox',
            active: isChatTab,
            onClick: () => setActiveTab(lastQueue),
            title: counts?.yoursUnread ? `Inbox (${counts.yoursUnread} unread in your inbox)` : 'Inbox',
            icon: <InboxIcon className="w-[19px] h-[19px]" />,
            badge: counts?.yoursUnread || 0,
          })}
          {mainTabs.map(item => railItem({
            key: item.id, label: item.label, active: activeTab === item.id, onClick: () => setActiveTab(item.id), title: item.label, icon: item.icon,
          }))}

          <div className="flex-1" />

          {railItem({
            key: 'sound',
            label: soundReady ? 'Sound alerts on' : 'Turn on sound alerts',
            onClick: handleSoundButton,
            title: soundReady ? 'Sound alerts are on — click to play a test chime' : 'Sound alerts are blocked by the browser — click to turn them on',
            icon: soundReady ? <Bell className="w-[19px] h-[19px]" /> : <BellOff className="w-[19px] h-[19px]" />,
            className: soundReady ? '' : 'text-accent bg-accent/10 hover:bg-accent/20',
            dot: !soundReady,
          })}
          {railItem({
            key: 'theme', label: darkMode ? 'Light mode' : 'Dark mode', onClick: toggleDarkMode, title: 'Toggle Dark Mode',
            icon: darkMode ? <Sun className="w-[19px] h-[19px]" /> : <Moon className="w-[19px] h-[19px]" />,
          })}
          {railItem({
            key: 'settings', label: 'Settings', active: activeTab === 'settings', onClick: () => setActiveTab('settings'), title: 'Settings',
            icon: <SettingsIcon className="w-[19px] h-[19px]" />,
          })}

          {/* Profile + sign out */}
          <div className="relative mt-1 shrink-0">
            <button
              ref={profileButtonRef}
              onClick={() => setProfileMenuOpen(o => !o)}
              className={`relative h-9 flex items-center gap-3 rounded-full hover:bg-ink/[0.06] ${railExpanded ? 'w-full pr-3' : 'w-9 justify-center'}`}
              title={agent.name}
            >
              <span className="relative w-9 h-9 shrink-0 flex items-center justify-center">
                <AgentAvatar agent={agent} className="w-7 h-7 text-[11px]" />
                <span className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-canvas ${agent.away ? 'bg-amber-400' : 'bg-emerald-500'}`} title={agent.away ? 'Away' : 'Online'} />
              </span>
              {railExpanded && <span className="truncate text-[14px] font-medium text-ink">{agent.name}</span>}
            </button>

            {profileMenuOpen && (
              <ProfileMenu
                agent={agent}
                avatar={<AgentAvatar agent={agent} className="w-10 h-10 text-[14px]" />}
                anchor={profileButtonRef.current}
                themePref={themePref}
                onThemeChange={setThemePref}
                onOpenSettings={(section) => { sessionStorage.setItem('settings_open_section', section); setActiveTab('settings'); }}
                onLogout={handleLogout}
                onClose={() => setProfileMenuOpen(false)}
              />
            )}
          </div>
        </nav>
      </div>

      {/* ⌘K palette + single-key shortcuts */}
      <CommandPalette
        enabled={isChatTab || activeTab === 'analytics' || activeTab === 'settings'}
        agents={agents}
        onSelectView={(view) => { setComposer(null); selectView(view); }}
        onOpenTab={(tab) => { setComposer(null); setActiveTab(tab); }}
        onCreate={(kind) => { setActiveTab(t => (isInboxView(t) ? t : 'yours')); setComposer({ kind }); }}
      />

      {/* Main Workspace content area */}
      <div className="flex-1 h-full min-w-0 flex gap-2 overflow-hidden animate-fade-in">
        {isChatTab ? (
          /* Render chat inbox screens */
          <>
            {/* Inbox navigation panel (collapsible from the list header) */}
            {inboxNavOpen && (
              <InboxNavPanel
                activeView={activeTab}
                onSelect={selectView}
                counts={counts}
                agents={agents}
                me={agent}
                onSearch={() => { setComposer(null); setActiveTab('search'); }}
                onOpenDashboard={() => setActiveTab('analytics')}
                onCreate={(kind) => setComposer({ kind })}
              />
            )}

            {activeTab === 'search' && !composer ? (
              /* Full search across conversations, notes, tickets, customers and tags */
              <SearchPanel agents={agents} />
            ) : (
            <>
            {/* List column (hidden while another conversation is open beside the chat) */}
            {!(viewingMergedConversationId && activeConversationId && !composer) && (
              <InboxList currentQueue={activeTab} viewTitle={viewTitle} agents={agents} />
            )}

            {composer ? (
              /* Manual create screen replaces the conversation + details panels */
              <CreateTicketPanel
                agents={agents}
                onCreated={(conv) => {
                  setStateFilter('open');
                  setActiveTab('created');
                  setActiveConversationId(conv.id);
                }}
              />
            ) : (
              <>
                {/* Chat column */}
                <ChatWindow />

                {/* Customer metadata Inspector panel or Merged Conversation preview */}
                {activeConversationId && (
                  viewingMergedConversationId ? (
                    <MergedConversationPanel />
                  ) : (
                    <CustomerProfilePanel />
                  )
                )}
              </>
            )}
            </>
            )}
          </>
        ) : activeTab === 'contacts' ? (
          <Contacts onOpenConversation={openConversation} />
        ) : activeTab === 'analytics' ? (
          <Analytics />
        ) : activeTab === 'settings' ? (
          <Settings />
        ) : activeTab === 'testing' ? (
          <TestingPanel />
        ) : null}
      </div>
    </div>
  );
};

export default Inbox;
