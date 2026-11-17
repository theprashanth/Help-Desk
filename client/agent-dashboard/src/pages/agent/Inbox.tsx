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
import { 
  Inbox as InboxIcon, User, Clock, CheckSquare, Archive, 
  BarChart3, Settings as SettingsIcon, LogOut, Sun, Moon, Sparkles, Globe
} from 'lucide-react';

export const Inbox: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('open'); // open, assigned, waiting, resolved, closed, archived, analytics, settings, testing
  const [darkMode, setDarkMode] = useState(false);
  
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  const logout = useStore((state) => state.logout);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const viewingMergedConversationId = useStore((state) => state.viewingMergedConversationId);
  const inboxNavOpen = useStore((state) => state.inboxNavOpen);
  const setActiveConversationId = useStore((state) => state.setActiveConversationId);
  const setFocusMessageId = useStore((state) => state.setFocusMessageId);

  // Deep links from "Copy link": /agent/inbox?conversation=<id>&message=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conversation');
    if (!convId || !token) return;
    const messageId = params.get('message');
    const queueForStatus: Record<string, string> = { open: 'open', waiting: 'waiting', resolved: 'resolved', closed: 'closed', archived: 'archived' };
    fetch(`http://localhost:3000/api/tickets/${encodeURIComponent(convId)}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(conv => {
        if (!conv) return;
        setActiveTab(queueForStatus[conv.status] || 'open');
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

  // Sidebar item helper
  const sidebarItems = [
    { id: 'open', label: 'Open Inbox', icon: <InboxIcon className="w-[18px] h-[18px]" /> },
    { id: 'assigned', label: 'My Assigned', icon: <User className="w-[18px] h-[18px]" /> },
    { id: 'waiting', label: 'Waiting', icon: <Clock className="w-[18px] h-[18px]" /> },
    { id: 'resolved', label: 'Resolved Today', icon: <CheckSquare className="w-[18px] h-[18px]" /> },
    { id: 'closed', label: 'Closed Tickets', icon: <Archive className="w-[18px] h-[18px]" /> },
  ];

  const mainTabs = [
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-[19px] h-[19px]" /> },
    { id: 'testing', label: 'Testing Panel', icon: <Sparkles className="w-[19px] h-[19px]" /> },
  ];

  const isChatTab = ['open', 'assigned', 'waiting', 'resolved', 'closed', 'archived'].includes(activeTab);

  // Remember the last inbox queue so the rail's Inbox icon returns to it
  const [lastQueue, setLastQueue] = useState<string>('open');
  useEffect(() => {
    if (isChatTab) setLastQueue(activeTab);
  }, [activeTab, isChatTab]);

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  if (!agent) return null;

  return (
    <div className="h-screen w-screen bg-canvas text-ink flex overflow-hidden p-2 pl-0 gap-2">
      {/* Far-left icon rail */}
      <nav className="w-14 h-full shrink-0 flex flex-col items-center py-1.5 gap-1">
        {/* Logo mark */}
        <div className="w-9 h-9 mb-2 rounded-lg bg-ink text-on-ink flex items-center justify-center" title="Pebble Help">
          <Globe className="w-[18px] h-[18px]" />
        </div>

        <button
          onClick={() => setActiveTab(lastQueue)}
          className={`ic-rail-btn ${isChatTab ? 'ic-rail-btn-active' : ''}`}
          title="Inbox"
        >
          <InboxIcon className="w-[19px] h-[19px]" />
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
            <img
              src={agent.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop'}
              className="w-7 h-7 rounded-full object-cover"
              alt="Avatar"
            />
            <span className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-canvas" />
          </button>

          {profileMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
              <div className="ic-menu absolute left-11 bottom-0 w-60 animate-fade-in">
                <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line mb-1">
                  <img
                    src={agent.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop'}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    alt="Avatar"
                  />
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
            <aside className="ic-panel-side w-[220px] h-full shrink-0 flex flex-col animate-fade-in">
              <div className="h-16 shrink-0 flex items-center px-5">
                <h1 className="ic-title">Inbox</h1>
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-0.5">
                {sidebarItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`ic-nav-item ${activeTab === item.id ? 'ic-nav-item-active' : ''}`}
                  >
                    <span className="text-ink/80">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </aside>
            )}

            {/* List column */}
            <InboxList currentQueue={activeTab} />

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
