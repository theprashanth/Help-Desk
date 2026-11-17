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
    <div className="ic-panel w-[320px] 2xl:w-[360px] h-full flex flex-col shrink-0 animate-slide-left z-20">
      {/* Header with back button */}
      <div className="ic-panel-header gap-2 pl-3 pr-3">
        <button
          onClick={() => setViewingMergedConversationId(null)}
          className="flex items-center gap-2 min-w-0 flex-1 h-9 pl-2 pr-3 rounded-full text-ink hover:bg-ink/[0.05] transition-colors text-left"
        >
          <ArrowLeft className="w-[18px] h-[18px] text-muted shrink-0" />
          <span className="truncate text-[15px] font-semibold">{customerName} from {customerLocation}</span>
        </button>
        <button 
          onClick={() => setViewingMergedConversationId(null)}
          title="Return to details"
          className="ic-icon-btn-ghost"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs Menu */}
      <div className="ic-tabs pt-3">
        <button
          onClick={() => setActiveTab('activity')}
          className={`ic-tab ${activeTab === 'activity' ? 'ic-tab-active' : ''}`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`ic-tab ${activeTab === 'details' ? 'ic-tab-active' : ''}`}
        >
          Details
        </button>
      </div>

      {/* Pane Content */}
      <div className="flex-1 overflow-y-auto bg-surface">
        {loading ? (
          <div className="h-full flex items-center justify-center text-[14px] text-muted">
            Loading merged conversation…
          </div>
        ) : activeTab === 'activity' ? (
          <div className="px-4 py-5 flex flex-col gap-4">
            {messages.map((m) => {
              const isCustomer = m.sender.type === 'customer';
              // Check if it is a merge indicator
              const isMergeIndicator = m.metadata?.type === 'merged_indicator';

              if (isMergeIndicator) {
                return (
                  <div key={m.id} className="flex items-start gap-2 text-[13px] text-muted bg-subtle px-3.5 py-2.5 rounded-xl">
                    <span className="text-faint">↳</span>
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
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed text-ink ${
                      m.isInternalNote
                        ? 'bg-note border border-note-line'
                        : isCustomer
                        ? 'bg-bubble-customer'
                        : 'bg-bubble-agent'
                    }`}
                  >
                    {m.isInternalNote && (
                      <div className="flex items-center gap-1 text-[12px] font-medium text-muted mb-1">
                        <Lock className="w-3 h-3" /> Note
                      </div>
                    )}
                    <p className="whitespace-pre-line">{m.content}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-[12px] text-muted">
                      <span className="font-medium">{m.sender.name}</span>
                      <span className="text-faint">·</span>
                      <span>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Render simple details card */
          <div className="px-5 py-3 flex flex-col">
            <div className="ic-detail-row">
              <span className="ic-detail-label">Ticket number</span>
              <span className="ic-detail-value font-medium">{ticketNumber}</span>
            </div>
            <div className="ic-detail-row">
              <span className="ic-detail-label">Category</span>
              <span className="ic-detail-value capitalize">{mergedConv?.category || 'general'}</span>
            </div>
            <div className="ic-detail-row">
              <span className="ic-detail-label">Priority</span>
              <span className="ic-detail-value capitalize">{mergedConv?.priority || 'medium'}</span>
            </div>
            <div className="ic-detail-row">
              <span className="ic-detail-label">Status</span>
              <span className="ic-detail-value">
                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium capitalize bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  {mergedConv?.status || 'merged'}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
