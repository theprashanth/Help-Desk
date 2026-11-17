import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { Message, Conversation } from '../../../../../shared/src/types';
import { ArrowLeft, Lock, ExternalLink } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export const MergedConversationPanel: React.FC = () => {
  const token = useStore((state) => state.token);
  const viewingMergedConversationId = useStore((state) => state.viewingMergedConversationId);
  const setViewingMergedConversationId = useStore((state) => state.setViewingMergedConversationId);

  const [mergedConv, setMergedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'activity' | 'details'>('activity');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation metadata & message logs
  useEffect(() => {
    if (!viewingMergedConversationId || !token) return;

    const fetchMergedData = async () => {
      setLoading(true);
      try {
        // Fetch conversation details
        const convRes = await fetch(`${BACKEND_URL}/api/tickets/${viewingMergedConversationId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (convRes.ok) {
          const convData = await convRes.json();
          setMergedConv(convData);
        }

        // Fetch messages log
        const msgRes = await fetch(`${BACKEND_URL}/api/messages/${viewingMergedConversationId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          setMessages(msgData);
        }
      } catch (err) {
        console.error('Failed to load merged conversation:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMergedData();
  }, [viewingMergedConversationId, token]);

  // Scroll to bottom on load
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (!viewingMergedConversationId) return null;

  const customerName = mergedConv?.customer?.name || 'Customer';
  const customerLocation = mergedConv?.customer?.session?.country || 'Hyderabad - India';
  const ticketNumber = mergedConv?.ticketNumber || 'Ticket';

  return (
    <div className="w-96 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 h-full flex flex-col shrink-0 animate-slide-left z-20">
      {/* Header with back button */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
        <button
          onClick={() => setViewingMergedConversationId(null)}
          className="flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white font-extrabold text-xs tracking-wide transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span className="truncate max-w-[200px]">{customerName} from {customerLocation}</span>
        </button>
        <button 
          onClick={() => setViewingMergedConversationId(null)}
          title="Return to details"
          className="p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-600 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-100 dark:border-slate-850 px-4">
        <button
          onClick={() => setActiveTab('activity')}
          className={`py-3 px-3 text-xs font-black transition-all border-b-2 tracking-wide uppercase ${
            activeTab === 'activity'
              ? 'border-violet-500 text-violet-600 dark:text-violet-400 font-extrabold'
              : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-700 font-bold'
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`py-3 px-3 text-xs font-black transition-all border-b-2 tracking-wide uppercase ${
            activeTab === 'details'
              ? 'border-violet-500 text-violet-600 dark:text-violet-400 font-extrabold'
              : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-700 font-bold'
          }`}
        >
          Details
        </button>
      </div>

      {/* Pane Content */}
      <div className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/20">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-semibold">
            Loading merged conversation…
          </div>
        ) : activeTab === 'activity' ? (
          <div className="p-4 flex flex-col gap-4">
            {messages.map((m) => {
              const isCustomer = m.sender.type === 'customer';
              // Check if it is a merge indicator
              const isMergeIndicator = m.metadata?.type === 'merged_indicator';

              if (isMergeIndicator) {
                return (
                  <div key={m.id} className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-semibold bg-slate-100/50 dark:bg-slate-850/40 p-3 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                    <span className="text-slate-400 dark:text-slate-600">↳</span>
                    <span>{m.content}</span>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[85%] ${
                    isCustomer ? 'self-start items-start' : 'self-end items-end'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[9px] text-slate-450 dark:text-slate-500 font-bold">{m.sender.name}</span>
                    <span className="text-[8px] text-slate-400 dark:text-slate-600">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div
                    className={`p-3 rounded-2xl text-[11px] leading-relaxed shadow-sm ${
                      m.isInternalNote
                        ? 'bg-amber-500/5 dark:bg-amber-950/15 border border-amber-300/40 dark:border-amber-900/40 text-amber-950 dark:text-amber-300 rounded-tr-none'
                        : isCustomer
                        ? 'bg-white dark:bg-[#0c1220] border border-slate-200/60 dark:border-slate-800/80 text-slate-850 dark:text-slate-200 rounded-tl-none'
                        : 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none'
                    }`}
                  >
                    {m.isInternalNote && (
                      <div className="flex items-center gap-1 text-[8px] font-black text-amber-500 dark:text-amber-455 uppercase tracking-widest mb-1">
                        <Lock className="w-3 h-3" /> Note
                      </div>
                    )}
                    <p className="whitespace-pre-line font-medium">{m.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Render simple details card */
          <div className="p-4 flex flex-col gap-4 font-semibold text-xs text-slate-600 dark:text-slate-400">
            <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-850">
              <span className="text-slate-400">Ticket Number</span>
              <span className="font-extrabold text-slate-800 dark:text-slate-200">{ticketNumber}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-850">
              <span className="text-slate-400">Category</span>
              <span className="capitalize font-extrabold text-slate-800 dark:text-slate-200">{mergedConv?.category || 'general'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-850">
              <span className="text-slate-400">Priority</span>
              <span className="capitalize font-extrabold text-slate-800 dark:text-slate-200">{mergedConv?.priority || 'medium'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-850">
              <span className="text-slate-400">Status</span>
              <span className="uppercase text-[10px] text-amber-600 font-extrabold bg-amber-100/50 dark:bg-amber-955/20 px-2 py-0.5 rounded-full">{mergedConv?.status || 'merged'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
