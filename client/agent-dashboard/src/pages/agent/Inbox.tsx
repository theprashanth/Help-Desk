import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import InboxList from '../../components/agent/InboxList';
import ChatWindow from '../../components/agent/ChatWindow';
import CustomerProfilePanel from '../../components/agent/CustomerProfilePanel';
import { MergedConversationPanel } from '../../components/agent/MergedConversationPanel';
import Analytics from './Analytics';
import Settings from './Settings';
import TestingPanel from '../../components/agent/TestingPanel';
import { InboxNavPanel, InboxCounts } from '../../components/agent/InboxNavPanel';
import { CreateTicketPanel } from '../../components/agent/CreateTicketPanel';
import { SearchPanel } from '../../components/agent/SearchPanel';
import { isInboxView, KIND_LABELS, StateFilter } from '../../lib/inboxViews';
import { isSnoozed } from '../../lib/snooze';
import { Agent } from '../../../../../shared/src/types';
import { 
  Inbox as InboxIcon,
  BarChart3, Settings as SettingsIcon, LogOut, Sun, Moon, Sparkles, Globe, Bell, BellOff
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
        .then(c => c && setCounts(c))
        .catch(() => {});
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 400); };
    load();
    const interval = setInterval(load, 60_000);
    const events = ['conversation:new', 'conversation:update', 'conversation:deleted', 'conversation:assigned'];
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

  // Dark Mode toggle
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/agent/login');
  };

  const mainTabs = [
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
    if (activeTab === 'created') return 'Created by you';
    if (activeTab === 'all') return 'All';
    if (activeTab === 'unassigned') return 'Unassigned';
    if (activeTab.startsWith('agent:')) return agents.find(a => a.id === activeTab.slice(6))?.name || 'Teammate';
    if (activeTab.startsWith('kind:')) return KIND_LABELS[activeTab.slice(5)] || 'Inbox';
    return 'Inbox';
  })();

  const selectView = (view: string) => {
    setComposer(null);
    setActiveTab(view);
  };

  if (!agent) return null;

  return (
    <div className="h-screen w-screen bg-canvas text-ink flex overflow-hidden p-2 pl-0 gap-2">
      {/* Far-left icon rail */}
      <nav className="w-14 h-full shrink-0 flex flex-col items-center py-1.5 gap-1">
        {/* Logo mark */}
        <div className="w-9 h-9 mb-2 rounded-lg bg-ink text-on-ink flex items-center justify-center" title="Chai Samosa">
          <Globe className="w-[18px] h-[18px]" />
        </div>

        <button
          onClick={() => setActiveTab(lastQueue)}
          className={`ic-rail-btn ${isChatTab ? 'ic-rail-btn-active' : ''}`}
          title={counts?.yoursUnread ? `Inbox (${counts.yoursUnread} unread in your inbox)` : 'Inbox'}
        >
          <span className="relative">
            <InboxIcon className="w-[19px] h-[19px]" />
            {!!counts?.yoursUnread && (
              <span className="absolute -top-2 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center tabular-nums ring-2 ring-canvas">
                {counts.yoursUnread > 99 ? '99+' : counts.yoursUnread}
              </span>
            )}
          </span>
        </button>
        {mainTabs.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`ic-rail-btn ${activeTab === item.id ? 'ic-rail-btn-active' : ''}`}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={handleSoundButton}
          className={`ic-rail-btn relative ${soundReady ? '' : 'text-accent bg-accent/10 hover:bg-accent/20'}`}
          title={soundReady ? 'Sound alerts are on — click to play a test chime' : 'Sound alerts are blocked by the browser — click to turn them on'}
        >
          {soundReady ? <Bell className="w-[19px] h-[19px]" /> : <BellOff className="w-[19px] h-[19px]" />}
          {!soundReady && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent animate-pulse" />}
        </button>
        <button
          onClick={toggleDarkMode}
          className="ic-rail-btn"
          title="Toggle Dark Mode"
        >
          {darkMode ? <Sun className="w-[19px] h-[19px]" /> : <Moon className="w-[19px] h-[19px]" />}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`ic-rail-btn ${activeTab === 'settings' ? 'ic-rail-btn-active' : ''}`}
          title="Settings"
        >
          <SettingsIcon className="w-[19px] h-[19px]" />
        </button>

        {/* Profile + sign out */}
        <div className="relative mt-1">
          <button
            onClick={() => setProfileMenuOpen(o => !o)}
            className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-ink/[0.06]"
            title={agent.name}
          >
            <AgentAvatar agent={agent} className="w-7 h-7 text-[11px]" />
            <span className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-canvas" />
          </button>

          {profileMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
              <div className="ic-menu absolute left-11 bottom-0 w-60 animate-fade-in">
                <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line mb-1">
                  <AgentAvatar agent={agent} className="w-8 h-8 text-[12px]" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[14px] font-semibold text-ink truncate">{agent.name}</span>
                    <span className="text-[12px] text-muted truncate capitalize">{agent.role.replace('_', ' ')}</span>
                  </div>
                </div>
                <button
                  onClick={() => { setProfileMenuOpen(false); toggleDarkMode(); }}
                  className="ic-menu-item"
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {darkMode ? 'Light mode' : 'Dark mode'}
                </button>
                <button
                  onClick={handleLogout}
                  className="ic-menu-item text-red-600"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

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
            {/* List column */}
            <InboxList currentQueue={activeTab} viewTitle={viewTitle} agents={agents} />

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
