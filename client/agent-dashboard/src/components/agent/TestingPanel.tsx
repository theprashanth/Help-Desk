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
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      <div className="ic-panel-header">
        <Sparkles className="w-5 h-5 text-muted shrink-0" />
        <h1 className="ic-title">Local seeder &amp; testing panel</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6">
        <p className="text-[14px] text-muted -mt-1">
          Simulate real-world customer traffic, seed support tickers, or clear database state locally.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Core Controls */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="ic-card p-6 flex flex-col gap-4">
              <h3 className="text-[15px] font-semibold text-ink flex items-center gap-2">
                <Database className="w-[18px] h-[18px] text-muted" /> Database administration
              </h3>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  loading={loading}
                  onClick={handleSeed}
                  className="gap-2"
                >
                  <Sparkles className="w-4 h-4" /> Seed 100 conversations
                </Button>

                <Button
                  variant="danger"
                  loading={loading}
                  onClick={handleReset}
                  className="gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Reset database
                </Button>
              </div>

              <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-500/20 rounded-xl flex gap-3 text-[13px] leading-relaxed text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Important notice:</span> Seeding drops existing local records and generates 100 fully populated customer conversations with logs, tags, and response coordinates. Default login is: <span className="font-mono text-[12px] px-1.5 py-0.5 rounded-md bg-surface border border-amber-200/70 dark:border-amber-500/20">admin@localhost</span> / <span className="font-mono text-[12px] px-1.5 py-0.5 rounded-md bg-surface border border-amber-200/70 dark:border-amber-500/20">admin123</span>.
                </div>
              </div>
            </div>

            {/* Interactive Chat simulation */}
            <div className="ic-card p-6 flex flex-col gap-4">
              <h3 className="text-[15px] font-semibold text-ink flex items-center gap-2">
                <MessageSquareCode className="w-[18px] h-[18px] text-muted" /> Interactive traffic simulator
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Simulate customer text */}
                <div className="p-4 bg-sidebar rounded-xl border border-line flex flex-col gap-2">
                  <span className="text-[14px] font-medium text-ink">Simulate customer action</span>
                  <p className="text-[13px] text-muted leading-relaxed flex-1">Triggers a follow-up inquiry from the active selected conversation client.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTriggerCustomerMessage}
                    className="w-full mt-1 bg-surface border border-line hover:bg-subtle"
                  >
                    <Play className="w-3.5 h-3.5" /> Customer send message
                  </Button>
                </div>

                {/* Simulate agent reply */}
                <div className="p-4 bg-sidebar rounded-xl border border-line flex flex-col gap-2">
                  <span className="text-[14px] font-medium text-ink">Simulate agent reply</span>
                  <p className="text-[13px] text-muted leading-relaxed flex-1">Simulates active typing, and responds automatically via the assigned support agent.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTriggerAgentReply}
                    className="w-full mt-1 bg-surface border border-line hover:bg-subtle"
                  >
                    <Play className="w-3.5 h-3.5" /> Agent typing &amp; send
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats & Terminal */}
          <div className="flex flex-col gap-6">
            {/* Online stats */}
            <div className="ic-card p-6 flex flex-col gap-4">
              <h3 className="text-[15px] font-semibold text-ink flex items-center gap-2">
                <Users className="w-[18px] h-[18px] text-muted" /> Online customer simulator
              </h3>

              <div className="flex justify-between items-center bg-sidebar px-4 py-3 rounded-xl border border-line">
                <span className="text-[13px] text-muted">Mock online clients</span>
                <span className="text-[15px] font-semibold text-ink flex items-center gap-2 tabular-nums">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> {activeUsersCount} Users
                </span>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={generateFakeUsers}
                className="w-full"
              >
                Add +5 simulated online users
              </Button>
            </div>

            {/* Seeder log shell output */}
            <div className="ic-card flex-1 flex flex-col min-h-60 overflow-hidden">
              <h4 className="text-[14px] font-semibold text-ink flex items-center gap-2 px-4 h-11 shrink-0 border-b border-line">
                <Terminal className="w-4 h-4 text-muted" /> Simulator console output
              </h4>
              <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 p-4 bg-sidebar font-mono text-[12px] text-ink/80">
                {logs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed whitespace-pre-wrap break-words">{log}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestingPanel;
