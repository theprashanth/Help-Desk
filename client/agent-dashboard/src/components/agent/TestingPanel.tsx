import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { 
  Play, RotateCcw, AlertTriangle, Database, Users, 
  Terminal, Sparkles, MessageSquareCode
} from 'lucide-react';
import Button from '../ui/Button';

const BACKEND_URL = 'http://localhost:3000';

export const TestingPanel: React.FC = () => {
  const token = useStore((state) => state.token);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const setConversations = useStore((state) => state.setConversations);
  const setActiveConversationId = useStore((state) => state.setActiveConversationId);

  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(['[System] Testing Simulator Ready.']);
  const [activeUsersCount, setActiveUsersCount] = useState(0);

  const pushLog = (text: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${text}`]);
  };

  const handleReset = async () => {
    if (!window.confirm('WARNING: This will completely wipe out all database conversations, messages, notes, and user profiles. Are you sure?')) return;
    
    setLoading(true);
    pushLog('Database reset command dispatched...');
    try {
      const res = await fetch(`${BACKEND_URL}/api/simulation/reset`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setConversations([]);
        setActiveConversationId(null);
        setActiveUsersCount(0);
        pushLog(`SUCCESS: ${data.message || 'Database collections dropped.'}`);
        pushLog('SUCCESS: Default credentials created (admin@localhost / admin123).');
      } else {
        pushLog('ERROR: Reset failed.');
      }
    } catch (e: any) {
      pushLog(`ERROR: Connection failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setLoading(true);
    pushLog('Initiating bulk seed simulation (100 conversations)...');
    try {
      const res = await fetch(`${BACKEND_URL}/api/simulation/seed`, {
        method: 'POST'
      });
      
      if (res.ok) {
        pushLog('Database cleared. Agents seeded...');
        pushLog('Tags VIP, Bug, Billing, Feature added...');
        pushLog('Generating 100 mock customer profiles with details...');
        pushLog('Simulating 100 conversation histories with weights...');
        pushLog('SUCCESS: 100 conversations injected into system!');
        
        // Refresh conversations list
        const listRes = await fetch(`${BACKEND_URL}/api/tickets`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (listRes.ok) {
          const list = await listRes.json();
          setConversations(list);
          setActiveUsersCount(25);
        }
      } else {
        pushLog('ERROR: Seeding request failed.');
      }
    } catch (e: any) {
      pushLog(`ERROR: Seeding exception: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerCustomerMessage = async () => {
    if (!activeConversationId) {
      pushLog('ERROR: Select an active chat first to simulate customer messages.');
      return;
    }
    
    pushLog('Simulating customer following up on active conversation...');
    try {
      const res = await fetch(`${BACKEND_URL}/api/simulation/activity`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'customer_message',
          conversationId: activeConversationId
        })
      });

      if (res.ok) {
        pushLog('SUCCESS: Simulated customer message posted.');
      } else {
        pushLog('ERROR: Customer simulation API returned error status.');
      }
    } catch (e: any) {
      pushLog(`ERROR: Connection error: ${e.message}`);
    }
  };

  const handleTriggerAgentReply = async () => {
    if (!activeConversationId) {
      pushLog('ERROR: Select an active chat first to simulate agent replies.');
      return;
    }

    pushLog('Simulating agent typing state and drafting auto-reply...');
    try {
      const res = await fetch(`${BACKEND_URL}/api/simulation/activity`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'agent_reply',
          conversationId: activeConversationId
        })
      });

      if (res.ok) {
        pushLog('SUCCESS: Typing indicators activated. Reply dispatched in 2.5s.');
      } else {
        pushLog('ERROR: Agent simulation API returned error.');
      }
    } catch (e: any) {
      pushLog(`ERROR: Connection error: ${e.message}`);
    }
  };

  const generateFakeUsers = () => {
    setActiveUsersCount(prev => prev + 5);
    pushLog('SUCCESS: 5 fake active online users simulated on Mock Website.');
  };

  return (
    <div className="flex-1 h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto flex flex-col gap-6 select-none">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-500" /> Local Seeder & Testing Panel
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Simulate real-world customer traffic, seed support tickers, or clear database state locally.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Core Controls */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Database className="w-4 h-4 text-brand-500" /> Database Administration
            </h3>
            
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                loading={loading}
                onClick={handleSeed}
                className="gap-2 shadow-brand-500/20"
              >
                <Sparkles className="w-4.5 h-4.5" /> Seed 100 Conversations
              </Button>

              <Button
                variant="danger"
                loading={loading}
                onClick={handleReset}
                className="gap-2"
              >
                <RotateCcw className="w-4.5 h-4.5" /> Reset Database
              </Button>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-xl flex gap-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <span className="font-bold">Important Notice:</span> Seeding drops existing local records and generates 100 fully populated customer conversations with logs, tags, and response coordinates. Default login is: <span className="font-bold font-mono bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-amber-200">admin@localhost</span> / <span className="font-bold font-mono bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-amber-200">admin123</span>.
              </div>
            </div>
          </div>

          {/* Interactive Chat simulation */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <MessageSquareCode className="w-4 h-4 text-brand-500" /> Interactive Traffic Simulator
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Simulate customer text */}
              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border flex flex-col gap-3">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Simulate Customer Action</span>
                <p className="text-[11px] text-slate-400">Triggers a follow-up inquiry from the active selected conversation client.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTriggerCustomerMessage}
                  className="w-full text-xs font-semibold py-2"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" /> Customer Send Message
                </Button>
              </div>

              {/* Simulate agent reply */}
              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border flex flex-col gap-3">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Simulate Agent Reply</span>
                <p className="text-[11px] text-slate-400">Simulates active typing, and responds automatically via the assigned support agent.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTriggerAgentReply}
                  className="w-full text-xs font-semibold py-2"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" /> Agent Typing & Send
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Stats & Terminal */}
        <div className="flex flex-col gap-4">
          {/* Online stats */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-3">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-500" /> Online Customer Simulator
            </h3>
            
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-950/30 p-3 rounded-xl border">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Mock Online Clients:</span>
              <span className="text-sm font-bold text-emerald-500 flex items-center gap-1.5 font-mono">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" /> {activeUsersCount} Users
              </span>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={generateFakeUsers}
              className="w-full text-xs"
            >
              Add +5 Simulated Online Users
            </Button>
          </div>

          {/* Seeder log shell output */}
          <div className="flex-1 bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-lg flex flex-col gap-2 min-h-60 overflow-hidden font-mono text-[11px] text-slate-300">
            <h4 className="font-bold text-xs text-brand-400 flex items-center gap-2 border-b border-slate-800 pb-2">
              <Terminal className="w-4 h-4 text-brand-500" /> Simulator Console Output
            </h4>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-slate-800 pr-1">
              {logs.map((log, idx) => (
                <div key={idx} className="leading-relaxed whitespace-pre-wrap">{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestingPanel;
