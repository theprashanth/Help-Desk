import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import InboxList from '../../components/agent/InboxList';
import ChatWindow from '../../components/agent/ChatWindow';
import CustomerProfilePanel from '../../components/agent/CustomerProfilePanel';
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
    { id: 'open', label: 'Open Inbox', icon: <InboxIcon className="w-4 h-4" /> },
    { id: 'assigned', label: 'My Assigned', icon: <User className="w-4 h-4" /> },
    { id: 'waiting', label: 'Waiting', icon: <Clock className="w-4 h-4" /> },
    { id: 'resolved', label: 'Resolved Today', icon: <CheckSquare className="w-4 h-4" /> },
    { id: 'closed', label: 'Closed Tickets', icon: <Archive className="w-4 h-4" /> },
  ];

  const mainTabs = [
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="w-4 h-4" /> },
    { id: 'testing', label: 'Testing Panel', icon: <Sparkles className="w-4.5 h-4.5" /> },
  ];

  const isChatTab = ['open', 'assigned', 'waiting', 'resolved', 'closed', 'archived'].includes(activeTab);

  if (!agent) return null;

  return (
    <div className="h-screen w-screen bg-slate-50 dark:bg-slate-950 flex overflow-hidden">
      {/* Sidebar navigation */}
      <div className="w-64 h-full bg-slate-900 text-slate-400 flex flex-col shrink-0">
        {/* Sidebar Header Logo */}
        <div className="p-6 flex items-center gap-2 border-b border-slate-800">
          <div className="p-1.5 bg-brand-500 rounded-lg text-white">
            <Globe className="w-5 h-5 animate-pulse" />
          </div>
          <span className="font-bold text-slate-100 tracking-wide text-sm">Help Desk Support</span>
        </div>

        {/* Sidebar Middle items */}
        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-5">
          {/* Inbox section */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-3">Queues</span>
            {sidebarItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === item.id 
                    ? 'bg-brand-500 text-white shadow-md shadow-brand-500/10' 
                    : 'hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Administration settings */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-3">Platform</span>
            {mainTabs.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === item.id 
                    ? 'bg-brand-500 text-white shadow-md shadow-brand-500/10' 
                    : 'hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar bottom */}
        <div className="p-4 border-t border-slate-800 flex flex-col gap-3">
          {/* Profile bar */}
          <div className="flex items-center gap-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-800/80">
            <img 
              src={agent.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop'} 
              className="w-8 h-8 rounded-full border border-slate-700 object-cover shrink-0" 
              alt="Avatar" 
            />
            <div className="flex flex-col truncate">
              <span className="text-slate-200 text-xs font-bold truncate leading-tight">{agent.name}</span>
              <span className="text-[10px] text-slate-500 truncate capitalize font-medium">{agent.role.replace('_', ' ')}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-between items-center text-xs px-1">
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg hover:bg-slate-800 hover:text-slate-200 transition-colors"
              title="Toggle Dark Mode"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-slate-800 hover:text-red-400 transition-colors flex items-center gap-1 font-semibold"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4 text-red-500" /> Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace content area */}
      <div className="flex-1 h-full flex overflow-hidden">
        {isChatTab ? (
          /* Render chat inbox screens */
          <>
            {/* List column */}
            <InboxList currentQueue={activeTab} />

            {/* Chat column */}
            <ChatWindow />

            {/* Customer metadata Inspector panel */}
            {activeConversationId && <CustomerProfilePanel />}
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
