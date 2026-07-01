import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment, SavedReply } from '../../../../../shared/src/types';
import { 
  Send, Paperclip, Smile, CheckCheck, Check, Trash2, 
  CheckCircle, Lock, Globe, ExternalLink, Star, MoreHorizontal,
  Clock, GitMerge, Ban, UserPlus, FileText, FileDown,
  Activity, AlarmClock, X, BellOff
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export const ChatWindow: React.FC = () => {
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  
  const [ticket, setTicket] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  const [isInternal, setIsInternal] = useState(false); // Toggle internal note vs public message
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  
  // Saved Replies
  const [showReplies, setShowReplies] = useState(false);
  const [filteredReplies, setFilteredReplies] = useState<SavedReply[]>([]);
  const savedReplies = useStore((state) => state.savedReplies);
  const setSavedReplies = useStore((state) => state.setSavedReplies);
  
  // Typing state
  const [isTyping, setIsTyping] = useState(false);
  const [customerTyping, setCustomerTyping] = useState(false);
  
  // Assignee agents
  const [agents, setAgents] = useState<any[]>([]);

  // Header action states
  const [isStarred, setIsStarred] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [snoozeActive, setSnoozeActive] = useState<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Sync ticket details
  useEffect(() => {
    if (!activeConversationId) {
      setTicket(null);
      setMessages([]);
      return;
    }
    const t = conversations.find(c => c.id === activeConversationId);
    if (t) setTicket(t);
  }, [activeConversationId, conversations]);

  // Fetch agents list
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/agents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setAgents(data))
      .catch(e => console.error(e));
  }, [token]);

  // Fetch saved replies from backend
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/saved-replies`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setSavedReplies(data))
      .catch(e => console.error(e));
  }, [token, setSavedReplies]);

  // Fetch message logs & join socket rooms
  useEffect(() => {
    if (!activeConversationId || !token || !socket) return;

    socket.emit('join', activeConversationId);

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${activeConversationId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data: Message[] = await res.json();
          setMessages(data);
          
          // Mark seen on agent side
          await fetch(`${BACKEND_URL}/api/messages/seen/${activeConversationId}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ role: 'agent' })
          });
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    };

    fetchMessages();

    // Listen for events with explicit callback references to avoid wiping other global listeners
    const handleNewMsg = (msg: Message) => {
      if (msg.conversationId === activeConversationId) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // Automatically mark as seen
        fetch(`${BACKEND_URL}/api/messages/seen/${activeConversationId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ role: 'agent' })
        });
      }
    };

    const handleUpdateMsg = (msg: Message) => {
      if (msg.conversationId === activeConversationId) {
        setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      }
    };

    const handleDeleteMsg = (payload: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== payload.messageId));
    };

    const handleTypingMsg = (payload: { conversationId: string; senderType: 'customer' | 'agent'; isTyping: boolean }) => {
      if (payload.conversationId === activeConversationId && payload.senderType === 'customer') {
        setCustomerTyping(payload.isTyping);
      }
    };

    const handleSeenMsg = (payload: { conversationId: string; role: 'customer' | 'agent'; seenAt: string }) => {
      if (payload.conversationId === activeConversationId && payload.role === 'customer') {
        setMessages(prev => prev.map(m => m.sender.type === 'agent' ? { ...m, seen: true, seenAt: payload.seenAt } : m));
      }
    };

    socket.on('message:new', handleNewMsg);
    socket.on('message:update', handleUpdateMsg);
    socket.on('message:deleted', handleDeleteMsg);
    socket.on('message:typing', handleTypingMsg);
    socket.on('message:seen', handleSeenMsg);

    return () => {
      socket.emit('leave', activeConversationId);
      socket.off('message:new', handleNewMsg);
      socket.off('message:update', handleUpdateMsg);
      socket.off('message:deleted', handleDeleteMsg);
      socket.off('message:typing', handleTypingMsg);
      socket.off('message:seen', handleSeenMsg);
    };
  }, [activeConversationId, token, socket]);

  // Scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, customerTyping]);

  // Input changes & saved replies triggers
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    // Emit typing indicator
    if (!socket || !activeConversationId || !agent) return;
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', {
        conversationId: activeConversationId,
        senderType: 'agent',
        senderName: agent.name,
        isTyping: true
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Debounce type off
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing', {
        conversationId: activeConversationId,
        senderType: 'agent',
        senderName: agent.name,
        isTyping: false
      });
    }, 2000);

    // Search for saved replies trigger (e.g. typing /refund)
    const match = val.match(/\/(\w*)$/);
    if (match) {
      const searchTrigger = match[1].toLowerCase();
      const filtered = savedReplies.filter(r => r.trigger.substring(1).toLowerCase().startsWith(searchTrigger));
      setFilteredReplies(filtered);
      setShowReplies(filtered.length > 0);
    } else {
      setShowReplies(false);
    }
  };

  const selectSavedReply = (reply: SavedReply) => {
    // Replace the trailing slash command with the saved reply text
    const textWithoutSlash = inputText.replace(/\/(\w*)$/, reply.content);
    setInputText(textWithoutSlash);
    setShowReplies(false);
    composerRef.current?.focus();
  };

  const handleSendMessage = async (textToSend?: string, files?: Attachment[]) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    if (!text.trim() && (!files || files.length === 0)) return;
    if (!activeConversationId || !agent) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          sender: {
            type: 'agent',
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar
          },
          content: text,
          attachments: files || [],
          isInternalNote: isInternal
        })
      });

      if (res.ok) {
        if (textToSend === undefined) setInputText('');
      }
    } catch (err) {
      console.error('Failed to post message:', err);
    }
  };

  // Upload file attachment handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversationId) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const attachment: Attachment = await res.json();
        await handleSendMessage('', [attachment]);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmoji(false);
  };

  const handleReactionToggle = async (messageId: string, emoji: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/messages/${messageId}/react`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ emoji })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleMessageDelete = async (messageId: string) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!ticket) return;
    try {
      await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (!ticket) return;
    try {
      await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ priority: newPriority })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleAssigneeChange = async (agentId: string) => {
    if (!ticket) return;
    try {
      await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}/assign`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ agentId: agentId === 'unassigned' ? null : agentId })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const formatMarkdown = (text: string) => {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code class="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-xs text-red-500 font-mono">$1</code>');
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-brand-500 hover:underline">$1</a>');
    
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  };

  if (!ticket) {
    return (
      <div className="flex-1 h-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-full border border-slate-200/50 dark:border-slate-800 shadow-sm">
          <Globe className="w-10 h-10 text-brand-500 animate-pulse" />
        </div>
        <h3 className="font-bold text-slate-800 dark:text-slate-200">No ticket selected</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Select a conversation from the inbox side menu to respond.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full bg-slate-50 dark:bg-slate-950 flex flex-col overflow-hidden relative">
      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
        {/* Left: Customer name + ticket badge */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 dark:text-slate-50 text-base truncate max-w-[180px]">{ticket.customer.name}</h2>
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 shrink-0">
                {ticket.ticketNumber}
              </span>
              {/* Priority highlight badge */}
              {ticket.priority === 'critical' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 shrink-0 animate-pulse">
                  🔴 Critical
                </span>
              )}
              {ticket.priority === 'high' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50 shrink-0">
                  🟠 High
                </span>
              )}
              {isBlocked && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border shrink-0 flex items-center gap-1">
                  <Ban className="w-3 h-3" /> Blocked
                </span>
              )}
              {snoozeActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 shrink-0 flex items-center gap-1">
                  <AlarmClock className="w-3 h-3" /> Snoozed · {snoozeActive}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {ticket.category} · {ticket.customer.email || 'Guest'}
            </p>
          </div>
        </div>

        {/* Right: Intercom-style action bar */}
        <div className="flex items-center gap-1 shrink-0">

          {/* ★ Star / Priority flag */}
          <button
            onClick={() => setIsStarred(v => !v)}
            title={isStarred ? 'Remove priority flag' : 'Flag as priority'}
            className={`p-2 rounded-lg transition-colors ${
              isStarred
                ? 'text-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100'
                : 'text-slate-400 hover:text-amber-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400' : ''}`} />
          </button>

          {/* ··· More Options Menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => { setShowMoreMenu(v => !v); setShowSnoozeMenu(false); }}
              className={`p-2 rounded-lg transition-colors ${
                showMoreMenu
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <div className="absolute top-full right-0 mt-1.5 w-60 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-slide-up">
                {[
                  { icon: UserPlus, label: 'Manage participants', divider: false },
                  { icon: GitMerge, label: 'Merge into…', kbd: '⌘ Shift M', divider: false,
                    action: () => { setShowMergePanel(true); setShowMoreMenu(false); } },
                  { icon: Globe, label: 'New conversation', divider: true },
                  { icon: FileText, label: 'Export conversation as text', divider: false,
                    action: () => {
                      const text = `Ticket: ${ticket.ticketNumber}\nCustomer: ${ticket.customer.name}\n\n[Export feature coming soon]`;
                      const blob = new Blob([text], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${ticket.ticketNumber}.txt`; a.click();
                      setShowMoreMenu(false);
                    }
                  },
                  { icon: FileDown, label: 'Export conversation as PDF', divider: false },
                  { icon: Activity, label: 'Show conversation events', kbd: '⌘ E', divider: true },
                  { icon: Clock, label: 'Show timestamp in customer timezone', divider: false },
                  { icon: isBlocked ? BellOff : Ban, label: isBlocked ? 'Unblock user' : 'Block user',
                    danger: true, divider: false,
                    action: () => { setIsBlocked(v => !v); setShowMoreMenu(false); }
                  },
                ].map((item, i) => (
                  <React.Fragment key={i}>
                    {item.divider && <div className="my-1 border-t border-slate-100 dark:border-slate-700" />}
                    <button
                      onClick={item.action || (() => setShowMoreMenu(false))}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                        item.danger
                          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <item.icon className="w-4 h-4 shrink-0 opacity-70" />
                      <span className="flex-1">{item.label}</span>
                      {item.kbd && <kbd className="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600">{item.kbd}</kbd>}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* 🔔 Snooze */}
          <div className="relative" ref={snoozeMenuRef}>
            <button
              onClick={() => { setShowSnoozeMenu(v => !v); setShowMoreMenu(false); }}
              title="Snooze conversation"
              className={`p-2 rounded-lg transition-colors ${
                snoozeActive
                  ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <AlarmClock className="w-4 h-4" />
            </button>

            {showSnoozeMenu && (
              <div className="absolute top-full right-0 mt-1.5 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-slide-up">
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-700">
                  Snooze until…
                </div>
                {[
                  { label: 'Later today', sub: 'In 3 hours', value: '3h' },
                  { label: 'Tomorrow morning', sub: '9:00 AM', value: 'tomorrow' },
                  { label: 'Next week', sub: 'Monday 9:00 AM', value: 'next-week' },
                  { label: 'Next month', sub: '1st of next month', value: 'next-month' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setSnoozeActive(opt.label); setShowSnoozeMenu(false); handleStatusChange('waiting'); }}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">{opt.label}</p>
                      <p className="text-[11px] text-slate-400">{opt.sub}</p>
                    </div>
                    {snoozeActive === opt.label && <Check className="w-3.5 h-3.5 text-brand-500" />}
                  </button>
                ))}
                {snoozeActive && (
                  <>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    <button
                      onClick={() => { setSnoozeActive(null); setShowSnoozeMenu(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel snooze
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* Assignee quick select */}
          <select
            value={ticket.assignedAgentId || 'unassigned'}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 font-medium max-w-[130px] truncate"
          >
            <option value="unassigned">Unassigned</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          {/* Priority select */}
          <select
            value={ticket.priority}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 font-semibold capitalize ${
              ticket.priority === 'critical'
                ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400'
                : ticket.priority === 'high'
                ? 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400'
                : ticket.priority === 'medium'
                ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
                : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
            }`}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          {/* Status select */}
          <select
            value={ticket.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 font-medium"
          >
            <option value="open">Open</option>
            <option value="waiting">Waiting</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>

          {/* Primary CTA: Resolve / Reopen */}
          {['resolved', 'closed'].includes(ticket.status) ? (
            <button
              onClick={() => handleStatusChange('open')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
            >
              Reopen
            </button>
          ) : (
            <button
              onClick={() => handleStatusChange('resolved')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow-sm shadow-emerald-500/20 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Resolve
            </button>
          )}
        </div>

        {/* Click-outside overlay */}
        {(showMoreMenu || showSnoozeMenu) && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setShowMoreMenu(false); setShowSnoozeMenu(false); }}
          />
        )}
      </div>

      {/* Merge Panel overlay */}
      {showMergePanel && (
        <div className="absolute inset-0 bg-black/30 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 w-96 flex flex-col gap-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-brand-500" /> Merge into…
              </h3>
              <button onClick={() => setShowMergePanel(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Merge this conversation into another existing ticket. All messages will be consolidated.
            </p>
            <input
              type="text"
              placeholder="Search by ticket # or customer name…"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
            <div className="text-xs text-slate-400 text-center py-4">No matching conversations found</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowMergePanel(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
              <button className="px-4 py-2 text-sm font-bold bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors opacity-40 cursor-not-allowed">Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* Message feed */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        {messages.map((m) => {
          const isCustomer = m.sender.type === 'customer';
          return (
            <div
              key={m.id}
              className={`flex flex-col group relative max-w-[70%] ${
                isCustomer ? 'self-start items-start' : 'self-end items-end'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-slate-400 font-semibold">{m.sender.name}</span>
                <span className="text-[9px] text-slate-300 dark:text-slate-500">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                
                {/* Delete Message for Agent */}
                {!isCustomer && (
                  <button
                    onClick={() => handleMessageDelete(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity ml-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Message box */}
              <div
                className={`p-3 rounded-2xl text-sm leading-relaxed ${
                  m.isInternalNote
                    ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-300 rounded-tr-none'
                    : isCustomer
                    ? 'bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                    : 'bg-brand-500 text-white rounded-tr-none shadow-sm'
                }`}
              >
                {/* Render indicators for internal note */}
                {m.isInternalNote && (
                  <div className="flex items-center gap-1 text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">
                    <Lock className="w-3.5 h-3.5" /> Internal Note
                  </div>
                )}

                {/* Markdown parser content */}
                {m.content && formatMarkdown(m.content)}

                {/* File Attachments */}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    {m.attachments.map((a, idx) => (
                      <a
                        key={idx}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                          isCustomer
                            ? 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                            : m.isInternalNote
                            ? 'bg-amber-100/50 border-amber-200/50 text-amber-800'
                            : 'bg-brand-600/50 border-brand-400/50 hover:bg-brand-600 text-white'
                        }`}
                      >
                        {a.type === 'image' ? (
                          <img src={a.url} alt={a.name} className="w-20 h-20 rounded object-cover border" />
                        ) : (
                          <Paperclip className="w-4 h-4 shrink-0" />
                        )}
                        <div className="flex flex-col truncate">
                          <span className="truncate max-w-[150px] font-medium">{a.name}</span>
                          <span className="opacity-70 text-[10px]">{(a.size || 0) > 0 ? `${Math.round(a.size! / 1024)} KB` : ''}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60 ml-auto" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Reactions facepile */}
              {m.reactions && m.reactions.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {m.reactions.map((r, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleReactionToggle(m.id, r.emoji)}
                      className="bg-white dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-750 px-1.5 py-0.5 rounded-full text-xs shadow-sm flex items-center gap-1"
                      title={`Added by ${r.agentName}`}
                    >
                      <span>{r.emoji}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Quick reactions overlay drawer (visible on hover) */}
              <div className={`absolute -top-3 ${
                isCustomer ? 'right-0' : 'left-0'
              } opacity-0 group-hover:opacity-100 flex items-center bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-1.5 py-0.5 rounded-full shadow-md gap-1.5 transition-all z-10`}>
                {['👍', '❤️', '😊', '💡'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleReactionToggle(m.id, emoji)}
                    className="hover:scale-125 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Read receipt check */}
              {!isCustomer && !m.isInternalNote && (
                <span className="text-[9px] text-slate-400 mt-1 flex items-center gap-0.5">
                  {m.seen ? (
                    <>
                      <CheckCheck className="w-3.5 h-3.5 text-brand-500" /> Seen
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" /> Delivered
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}

        {/* Customer typing */}
        {customerTyping && (
          <div className="self-start flex flex-col items-start max-w-[70%]">
            <span className="text-[10px] text-slate-400 mb-1">{ticket.customer.name} typing</span>
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center shadow-sm">
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Panel */}
      <div className={`p-4 border-t bg-white dark:bg-slate-900 relative shrink-0 ${
        isInternal 
          ? 'border-amber-200 dark:border-amber-800 bg-amber-50/10 dark:bg-amber-950/5' 
          : 'border-slate-200 dark:border-slate-800'
      }`}>
        {/* Saved replies trigger selector popup */}
        {showReplies && (
          <div className="absolute bottom-[105%] left-4 w-72 bg-white dark:bg-slate-800 border border-slate-250 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col z-20 animate-slide-up">
            <div className="bg-slate-50 dark:bg-slate-900 px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b">
              Saved Replies
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredReplies.map(r => (
                <button
                  key={r.id}
                  onClick={() => selectSavedReply(r)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-brand-50 dark:hover:bg-brand-950/20 text-slate-700 dark:text-slate-300 border-b last:border-0"
                >
                  <div className="font-bold text-brand-500">{r.trigger}</div>
                  <div className="truncate opacity-75">{r.title}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Emoji selection popup */}
        {showEmoji && (
          <div className="absolute bottom-[105%] left-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex gap-2 z-20">
            {['👍', '👋', '❤️', '😊', '💡', '🎉'].map(emoji => (
              <button
                key={emoji}
                onClick={() => handleEmojiSelect(emoji)}
                className="text-lg hover:scale-125 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Composer options */}
        <div className="flex justify-between items-center mb-3">
          {/* Public Reply vs Internal Note toggle tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
            <button
              onClick={() => setIsInternal(false)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                !isInternal
                  ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> Public Reply
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                isInternal
                  ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-500 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Lock className="w-3.5 h-3.5" /> Internal Note
            </button>
          </div>

          <div className="text-[10px] text-slate-400 font-semibold">
            Type <span className="text-brand-500">/</span> to insert saved replies
          </div>
        </div>

        {/* Text Area Input */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={composerRef}
            rows={2}
            value={inputText}
            onChange={handleInputChange}
            placeholder={isInternal ? 'Type internal notes (only agents see this)...' : 'Type public reply...'}
            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none font-sans"
          />

          <div className="flex flex-col gap-1.5">
            {/* Options bar */}
            <div className="flex gap-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept="image/*,application/pdf"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850/50 transition-colors"
                title="Attach Files"
              >
                <Paperclip className="w-4.5 h-4.5" />
              </button>
              
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850/50 transition-colors"
                title="Add Emoji"
              >
                <Smile className="w-4.5 h-4.5" />
              </button>
            </div>

            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim()}
              className={`p-2 rounded-xl text-white active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md flex items-center justify-center shrink-0 ${
                isInternal 
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/10' 
                  : 'bg-brand-500 hover:bg-brand-600 shadow-brand-500/10'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
