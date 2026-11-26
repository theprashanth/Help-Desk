import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { tabFromPath, pathForTab, settingsPath } from '../../lib/agentRoutes';
import InboxList from '../../components/agent/InboxList';
import ChatWindow from '../../components/agent/ChatWindow';
import CustomerProfilePanel from '../../components/agent/CustomerProfilePanel';
import { MergedConversationPanel } from '../../components/agent/MergedConversationPanel';
import Analytics from './Analytics';
import Contacts from './Contacts';
import KnowledgeBaseSettings from '../../components/settings/KnowledgeBaseSettings';
import Settings from './Settings';
import TestingPanel from '../../components/agent/TestingPanel';
import { InboxNavPanel, InboxCounts } from '../../components/agent/InboxNavPanel';
import { CreateTicketPanel } from '../../components/agent/CreateTicketPanel';
import ProfileMenu, { ThemePref } from '../../components/agent/ProfileMenu';
import { SearchPanel } from '../../components/agent/SearchPanel';
import CommandPalette from '../../components/agent/CommandPalette';
import { isBotView, isInboxView, KIND_LABELS, StateFilter, mentionedConversationIds, matchesView } from '../../lib/inboxViews';
import { isSnoozed } from '../../lib/snooze';
import { Agent } from '../../../../../shared/src/types';
import { 
  Inbox as InboxIcon,
  BarChart3, Settings as SettingsIcon, Sun, Moon, Globe, Bell, Pin, PinOff, Users, BookOpen, Sparkles, Bot
} from 'lucide-react';
import { isAudioReady, onAudioReadyChange, unlockAudio, playChime } from '../../lib/sound';
import { API_URL } from '../../lib/config';

const BACKEND_URL = API_URL;

/** Profile photo, or initials when there isn't one (never a stock photo). */
const AgentAvatar: React.FC<{ agent: { name: string; avatar?: string }; className?: string }> = ({ agent, className = '' }) =>
  agent.avatar
    ? <img src={agent.avatar} alt={agent.name} className={`${className} rounded-full object-cover shrink-0`} />
    : <span className={`${className} rounded-full bg-ink/10 text-ink font-semibold flex items-center justify-center shrink-0 uppercase`}>
        {agent.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?'}
      </span>;

export const Inbox: React.FC = () => {
  // The screen comes from the address (lib/agentRoutes): an inbox view id (yours, all, agent:<id>, kind:<kind>…),
  // 'search', or contacts | analytics | settings | testing. Changing it changes the address.
  const location = useLocation();
  const routeTo = useNavigate();
  const activeTab = tabFromPath(location.pathname);
  const setActiveTab = (next: string | ((current: string) => string)) => {
    const tab = typeof next === 'function' ? next(tabFromPath(window.location.pathname)) : next;
    const path = pathForTab(tab);
    if (path !== window.location.pathname) routeTo(path);
  };
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
  // Another conversation open beside the chat (from Recent conversations or a merge): the list slides away
  const sideConversationOpen = !!(viewingMergedConversationId && activeConversationId && !composer);
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

  // Deep links: "Copy link" (/agent/inbox?conversation=<id>&message=<id>) and the open conversation (?c=<id>)
  const deepLinkDone = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conversation') || params.get('c');
    if (!convId || !token) { deepLinkDone.current = true; return; }
    const messageId = params.get('message');
    fetch(`${API_URL}/api/tickets/${encodeURIComponent(convId)}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(conv => {
        if (!conv) return;
        const state: StateFilter = isSnoozed(conv) ? 'snoozed'
          : (['waiting', 'resolved', 'closed', 'archived'].includes(conv.status) ? conv.status : 'open') as StateFilter;
        setStateFilter(state);
        const tab = tabFromPath(window.location.pathname);
        if (!(isInboxView(tab) && matchesView(conv, tab, useStore.getState().agent?.id))) setActiveTab('all');
        setActiveConversationId(conv.id);
        if (messageId) setFocusMessageId(messageId);
      })
      .catch(e => console.error(e))
      .finally(() => { deepLinkDone.current = true; });
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

  // The open conversation is part of the address (?c=<id>), so a refresh reopens it
  useEffect(() => {
    if (!deepLinkDone.current) return;
    const inInbox = isInboxView(activeTab);
    const want = inInbox && activeConversationId ? `?c=${encodeURIComponent(activeConversationId)}` : '';
    if (window.location.search !== want) routeTo(`${window.location.pathname}${want}`, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, activeTab]);

  // Other screens can open Settings (e.g. Ask AI's "Set up in Settings")
  useEffect(() => {
    const open = () => {
      const section = sessionStorage.getItem('settings_open_section') || undefined;
      sessionStorage.removeItem('settings_open_section');
      routeTo(settingsPath(section));
    };
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
    fetch(`${API_URL}/api/tickets/${encodeURIComponent(convId)}`, { headers: { Authorization: `Bearer ${token}` } })
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
    { id: 'contacts', label: 'Contacts', icon: <Users className="w-[18px] h-[18px]" /> },
    { id: 'knowledge', label: 'Knowledge base', icon: <BookOpen className="w-[18px] h-[18px]" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-[18px] h-[18px]" /> },
    // The testing panel (seed data, simulations) is still at /agent/testing, just not in the menu
  ];

  const isChatTab = isInboxView(activeTab) || activeTab === 'search';
  // The AI Assistant / AI Agent menu items open those Settings pages and light up while you're there
  const aiSection = activeTab !== 'settings' ? null
    : /^\/agent\/settings\/ai\/?$/.test(location.pathname) ? 'ai'
    : /^\/agent\/settings\/ai-agent\/?$/.test(location.pathname) ? 'aiAgent' : null;

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
    // Bot-handled chats are resolved until someone asks for a person, so show every state there.
    // Any other view opens on Open: the state picked elsewhere (e.g. Resolved, after opening a resolved chat
    // from Contacts or a link) doesn't carry over, so Tickets shows the open tickets, or "Create ticket".
    if (isBotView(view)) useStore.getState().setStateFilter('all');
    else if (view !== 'mentions' && view !== activeTab) useStore.getState().setStateFilter('open');
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
  const railHoverIn = () => { if (railTimer.current) clearTimeout(railTimer.current); railTimer.current = setTimeout(() => setRailHover(true), 100); };
  const railHoverOut = () => { if (railTimer.current) clearTimeout(railTimer.current); railTimer.current = setTimeout(() => setRailHover(false), 100); };
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
  // Profile menu opens on hover (like Intercom), stays open while the pointer is on it, closes shortly after it leaves
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileHoverIn = () => { if (profileTimer.current) clearTimeout(profileTimer.current); profileTimer.current = setTimeout(() => setProfileMenuOpen(true), 150); };
  const profileHoverOut = () => { if (profileTimer.current) clearTimeout(profileTimer.current); profileTimer.current = setTimeout(() => setProfileMenuOpen(false), 300); };
  useEffect(() => () => { if (profileTimer.current) clearTimeout(profileTimer.current); }, []);

  // Labels fade in just after the menu starts widening, and out at once when it closes
  const railFade = `whitespace-nowrap transition-opacity ${railExpanded ? 'opacity-100 duration-150 delay-75' : 'opacity-0 duration-75'}`;

  // One row of the far-left menu. Rows are always full width (32px when the rail is narrow), so they widen
  // smoothly with the menu and the icon never moves.
  const railItem = (o: {
    key: string; label: string; icon: React.ReactNode; onClick: () => void; title: string;
    active?: boolean; badge?: number; dot?: boolean; className?: string;
  }) => (
    <button
      key={o.key}
      onClick={o.onClick}
      title={railExpanded ? undefined : o.title}
      className={`relative h-8 w-full shrink-0 flex items-center gap-3 px-[7px] rounded-lg text-ink hover:bg-ink/[0.06] transition-colors ${
        o.active ? 'bg-surface shadow-pill hover:bg-surface' : ''
      } ${o.className || ''}`}
    >
      <span className="relative shrink-0 flex">
        {o.icon}
        {!!o.badge && (
          <span className={`absolute -top-2 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center tabular-nums ring-2 ring-canvas transition-opacity duration-100 ${railExpanded ? 'opacity-0' : 'opacity-100'}`}>
            {o.badge > 99 ? '99+' : o.badge}
          </span>
        )}
      </span>
      <span className={`truncate text-[14px] font-semibold ${railFade}`}>{o.label}</span>
      {!!o.badge && (
        <span className={`min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center tabular-nums ${railFade}`}>
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
      {/* Sizes match Intercom: a 44px icon rail (32px tiles) and a 196px menu when hovered or pinned.
          The rail's box is 8px narrower than the nav because the page's 8px gap sits under it. */}
      <div className="relative h-full shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]" style={{ width: railPinned ? 188 : 36 }}>
        <nav
          onMouseEnter={railHoverIn}
          onMouseLeave={railHoverOut}
          // Opens over ~200ms and closes faster (~150ms) on a smooth "decelerate" curve, like Intercom; the
          // shadow and edge fade with it
          className={`absolute left-0 top-0 bottom-0 z-50 flex flex-col gap-1 px-1.5 py-1.5 overflow-hidden bg-canvas border-r transition-[width,box-shadow,border-color] ease-[cubic-bezier(0.2,0,0,1)] ${
            railExpanded ? 'w-[196px] duration-200' : 'w-11 duration-150'
          } ${railExpanded && !railPinned ? 'shadow-[6px_0_24px_-8px_rgba(0,0,0,0.18)] border-line' : 'shadow-none border-transparent'}`}
        >
          {/* Logo + pin */}
          <div className="h-8 mb-1.5 flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 shrink-0 flex items-center justify-center">
              <div className="w-6 h-6 rounded-md bg-ink text-on-ink flex items-center justify-center" title="Chai Shots">
                <Globe className="w-[15px] h-[15px]" />
              </div>
            </div>
            <span className={`flex-1 min-w-0 truncate text-[14px] font-semibold text-ink ${railFade}`}>{workspaceName}</span>
            <button
              onClick={toggleRailPinned}
              tabIndex={railExpanded ? 0 : -1}
              className={`ic-icon-btn-ghost !w-7 !h-7 shrink-0 ${railFade} ${railExpanded ? '' : 'pointer-events-none'}`}
              title={railPinned ? 'Unpin — collapse to icons' : 'Pin — keep the menu open'}
            >
              {railPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>
          </div>

          {railItem({
            key: 'inbox',
            label: 'Inbox',
            active: isChatTab,
            onClick: () => setActiveTab(lastQueue),
            title: counts?.yoursUnread ? `Inbox (${counts.yoursUnread} unread in your inbox)` : 'Inbox',
            icon: <InboxIcon className="w-[18px] h-[18px]" />,
            badge: counts?.yoursUnread || 0,
          })}
          {mainTabs.map(item => railItem({
            key: item.id, label: item.label, active: activeTab === item.id, onClick: () => setActiveTab(item.id), title: item.label, icon: item.icon,
          }))}
          {/* AI: shortcuts to their Settings pages */}
          {railItem({
            key: 'ai-assistant', label: 'AI Assistant', title: 'AI Assistant',
            active: aiSection === 'ai', onClick: () => routeTo(settingsPath('ai')),
            icon: <Sparkles className="w-[18px] h-[18px]" />,
          })}
          {railItem({
            key: 'ai-agent', label: 'AI Agent', title: 'AI Agent',
            active: aiSection === 'aiAgent', onClick: () => routeTo(settingsPath('aiAgent')),
            icon: <Bot className="w-[18px] h-[18px]" />,
          })}

          <div className="flex-1" />

          {railItem({
            key: 'sound',
            // Browsers keep a freshly loaded page silent until its first click or key press; any click turns
            // sound on (SocketContext), so before that the bell is "waiting", not off
            label: soundReady ? 'Sound alerts on' : 'Sound alerts start after your first click',
            onClick: handleSoundButton,
            title: soundReady
              ? 'Sound alerts are on — click to play a test chime'
              : 'Your browser keeps a page silent until you click on it. Sound alerts start after your first click anywhere (or click here).',
            icon: (
              <span className="relative inline-flex">
                <Bell className="w-[18px] h-[18px]" />
                {!soundReady && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-canvas" />}
              </span>
            ),
          })}
          {railItem({
            key: 'theme', label: darkMode ? 'Light mode' : 'Dark mode', onClick: toggleDarkMode, title: 'Toggle Dark Mode',
            icon: darkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />,
          })}
          {railItem({
            key: 'settings', label: 'Settings', active: activeTab === 'settings' && !aiSection, onClick: () => setActiveTab('settings'), title: 'Settings',
            icon: <SettingsIcon className="w-[18px] h-[18px]" />,
          })}

          {/* Profile + sign out */}
          <div className="relative mt-1 shrink-0">
            <button
              ref={profileButtonRef}
              onClick={() => { if (profileTimer.current) clearTimeout(profileTimer.current); setProfileMenuOpen(true); }}
              onMouseEnter={profileHoverIn}
              onMouseLeave={profileHoverOut}
              className="relative h-8 w-full flex items-center gap-2.5 pr-3 rounded-full hover:bg-ink/[0.06]"
              title={agent.name}
            >
              <span className="relative w-8 h-8 shrink-0 flex items-center justify-center">
                <AgentAvatar agent={agent} className="w-7 h-7 text-[11px]" />
                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-canvas ${agent.away ? 'bg-amber-400' : 'bg-emerald-500'}`} title={agent.away ? 'Away' : 'Online'} />
              </span>
              <span className={`truncate text-[14px] font-semibold text-ink ${railFade}`}>{agent.name}</span>
            </button>

            {profileMenuOpen && (
              <ProfileMenu
                agent={agent}
                avatar={<AgentAvatar agent={agent} className="w-10 h-10 text-[14px]" />}
                anchor={profileButtonRef.current}
                themePref={themePref}
                onThemeChange={setThemePref}
                onOpenSettings={(section) => routeTo(settingsPath(section))}
                onLogout={handleLogout}
                onClose={() => setProfileMenuOpen(false)}
                onPointerEnter={() => { if (profileTimer.current) clearTimeout(profileTimer.current); }}
                onPointerLeave={profileHoverOut}
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
            {/* List column: slides closed while another conversation is open beside the chat (and back
                when it closes). It stays mounted, so its scroll position and filters are kept. */}
            <div
              aria-hidden={sideConversationOpen || undefined}
              className={`h-full shrink-0 overflow-hidden transition-[width,margin,opacity] ease-[cubic-bezier(0.2,0,0,1)] ${
                sideConversationOpen ? 'w-0 -mr-2 opacity-0 pointer-events-none duration-200' : 'w-[340px] 2xl:w-[380px] opacity-100 duration-200'
              }`}
            >
              <InboxList currentQueue={activeTab} viewTitle={viewTitle} agents={agents} />
            </div>

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

                {/* Details panel, or another conversation opened from it (Recent conversations, a merge):
                    the panel grows smoothly into the space the list leaves, and shrinks back on close */}
                {activeConversationId && (
                  <div
                    className={`h-full min-w-0 flex shrink-0 basis-[320px] 2xl:basis-[360px] transition-[flex-grow] ease-[cubic-bezier(0.2,0,0,1)] [&>*]:!w-full ${
                      sideConversationOpen ? 'grow duration-200' : 'grow-0 duration-150'
                    }`}
                  >
                    {viewingMergedConversationId ? (
                      <MergedConversationPanel />
                    ) : (
                      <div key="details" className="h-full flex animate-fade-in [&>*]:!w-full"><CustomerProfilePanel /></div>
                    )}
                  </div>
                )}
              </>
            )}
            </>
            )}
          </>
        ) : activeTab === 'contacts' ? (
          <Contacts onOpenConversation={openConversation} />
        ) : activeTab === 'knowledge' ? (
          <div className="ic-panel flex-1 min-w-0 h-full flex flex-col overflow-hidden">
            <KnowledgeBaseSettings onBack={() => setActiveTab(lastQueue)} />
          </div>
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
