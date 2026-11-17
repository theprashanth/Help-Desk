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

const getInitials = (name?: string, id?: string) => {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1 && parts[0][0] && parts[1][0]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.trim().substring(0, 2).toUpperCase();
  }
  if (id && id.trim()) {
    const cleanId = id.replace(/guest_?/i, '').trim();
    return cleanId.substring(0, 2).toUpperCase();
  }
  return 'G';
};

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
};

const renderPlatformIcon = (platform?: string) => {
  const normalized = platform?.toLowerCase() || 'web';
  
  if (normalized === 'android') {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-450 dark:text-slate-500 fill-current mr-1 shrink-0">
        <title>Android App</title>
        <path d="M17.5 12c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-11 0c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm11.56-5.81l1.79-3.11c.08-.15.03-.33-.12-.41-.15-.08-.33-.03-.41.12l-1.83 3.18C15.07 5.37 13.59 5 12 5s-3.07.37-4.49.98L5.68 2.8c-.08-.15-.26-.2-.41-.12-.15.08-.2.26-.12.41l1.79 3.11C3.69 8.25 1.5 11.37 1.5 15h21c0-3.63-2.19-6.75-5.44-8.81z"/>
      </svg>
    );
  }
  
  if (normalized === 'ios') {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-450 dark:text-slate-500 fill-current mr-1 shrink-0">
        <title>iOS App</title>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.7-1.13 1.84-.99 2.94.12.08 1.12-.04 2.82-1.33z"/>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-450 dark:text-slate-500 fill-current mr-1 shrink-0">
      <title>Web Chat</title>
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2z"/>
    </svg>
  );
};

export const ChatWindow: React.FC = () => {
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  const chatColorTheme = useStore((state) => (state as any).chatColorTheme);
  
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
  const [isBlocked, setIsBlocked] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [duplicateTickets, setDuplicateTickets] = useState<any[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [mergeConfirmLoading, setMergeConfirmLoading] = useState(false);
  const [mergeSearchText, setMergeSearchText] = useState('');

  // Load other open duplicate tickets for the same customer
  useEffect(() => {
    if (!showMergePanel || !token || !ticket?.customer?.id) return;
    const fetchDuplicates = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/customers/${ticket.customer.id}/tickets`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const openOthers = data.filter((c: any) => 
            c.id !== ticket.id && 
            (c.status === 'open' || c.status === 'waiting')
          );
          setDuplicateTickets(openOthers);
        }
      } catch (e) {
        console.error('Failed to load duplicate tickets:', e);
      }
    };
    fetchDuplicates();
  }, [showMergePanel, token, ticket?.id, ticket?.customer?.id]);

  const [snoozeActive, setSnoozeActive] = useState<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Derived state
  const isStarred = ticket?.starred || false;

  // Auto-grow textarea viewport based on text length
  useEffect(() => {
    const textarea = composerRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.max(45, Math.min(textarea.scrollHeight, 180));
      textarea.style.height = `${newHeight}px`;
    }
  }, [inputText]);

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
      let filtered = savedReplies.filter(r => r.trigger.substring(1).toLowerCase().startsWith(searchTrigger));
      
      // Filter by availability restrictions
      filtered = filtered.filter(r => {
        // Available For filter
        if (r.availableFor === 'myself' && r.creator?.id !== agent?.id) {
          return false;
        }
        
        // Available When filter
        if (r.availableWhen && r.availableWhen.length > 0) {
          if (isInternal) {
            return r.availableWhen.includes('adding_notes');
          } else {
            const hasMessages = messages.length > 0;
            if (!hasMessages) {
              return r.availableWhen.includes('starting_conversations');
            } else {
              return r.availableWhen.includes('replying');
            }
          }
        }
        return true;
      });

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

  const handleStarToggle = async () => {
    if (!ticket) return;
    try {
      await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ starred: !isStarred })
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
    <div className="flex-1 h-full bg-[#f8f9fc] dark:bg-[#030712] flex flex-col overflow-hidden relative">
      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <div className="border-b border-slate-200 dark:border-[#1f212a] bg-white dark:bg-[#080d16] flex flex-col shrink-0">
        
        {/* Row 1: Customer Details & Main Actions */}
        <div className="px-6 py-4 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-[#1f212a]/30">
          {/* Left: Customer name + ticket badge */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-extrabold text-slate-900 dark:text-slate-50 text-base truncate max-w-[200px]">{ticket.customer.name}</h2>
                <span className="text-[9px] font-mono font-black text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                  {ticket.ticketNumber}
                </span>
                {/* Priority highlight badge */}
                {ticket.priority === 'critical' && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 shrink-0 animate-pulse">
                    🔴 Critical
                  </span>
                )}
                {ticket.priority === 'high' && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50 shrink-0">
                    🟠 High
                  </span>
                )}
                {isBlocked && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-150 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border shrink-0 flex items-center gap-1">
                    <Ban className="w-3 h-3" /> Blocked
                  </span>
                )}
                {snoozeActive && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50 shrink-0 flex items-center gap-1">
                    <AlarmClock className="w-3 h-3" /> Snoozed · {snoozeActive}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-medium">
                {ticket.category} · {ticket.customer.email || 'Guest'}
              </p>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* ★ Star / Priority flag */}
            <button
              onClick={handleStarToggle}
              title={isStarred ? 'Remove priority flag' : 'Flag as priority'}
              className={`p-2 rounded-xl transition-all active:scale-95 ${
                isStarred
                  ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border border-amber-200/50 dark:border-amber-900/30'
                  : 'text-slate-455 hover:text-amber-500 hover:bg-slate-50 dark:hover:bg-slate-850/80 border border-transparent'
              }`}
            >
              <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-500' : ''}`} />
            </button>

            {/* ··· More Options Menu */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => { setShowMoreMenu(v => !v); setShowSnoozeMenu(false); }}
                className={`p-2 rounded-xl transition-all border border-transparent active:scale-95 ${
                  showMoreMenu
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-750 dark:text-slate-200 border-slate-200 dark:border-slate-750'
                    : 'text-slate-455 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850/80'
                }`}
                title="More options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMoreMenu && (
                <div className="absolute top-full right-0 mt-2 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden py-1.5 animate-slide-up">
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
                      {item.divider && <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />}
                      <button
                        onClick={item.action || (() => setShowMoreMenu(false))}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold transition-colors text-left ${
                          item.danger
                            ? 'text-red-650 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20'
                            : 'text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0 opacity-70" />
                        <span className="flex-1">{item.label}</span>
                        {item.kbd && <kbd className="text-[10px] text-slate-400 dark:text-slate-550 font-mono bg-slate-100 dark:bg-slate-850 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">{item.kbd}</kbd>}
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
                className={`p-2 rounded-xl transition-all border border-transparent active:scale-95 ${
                  snoozeActive
                    ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-900/30'
                    : 'text-slate-455 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850/80'
                }`}
              >
                <AlarmClock className="w-4 h-4" />
              </button>

              {showSnoozeMenu && (
                <div className="absolute top-full right-0 mt-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden py-1.5 animate-slide-up">
                  <div className="px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
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
                       className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-880/60 transition-colors text-left"
                    >
                      <div>
                        <p className="text-xs text-slate-700 dark:text-slate-350 font-bold">{opt.label}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-550 mt-0.5">{opt.sub}</p>
                      </div>
                      {snoozeActive === opt.label && <Check className="w-3.5 h-3.5 text-brand-500" />}
                    </button>
                  ))}
                  {snoozeActive && (
                    <>
                      <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />
                      <button
                        onClick={() => { setSnoozeActive(null); setShowSnoozeMenu(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 font-bold transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel snooze
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Resolve / Reopen CTA */}
            {['resolved', 'closed'].includes(ticket.status) ? (
              <button
                onClick={() => handleStatusChange('open')}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-850 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-250 dark:border-slate-750 transition-colors shadow-sm"
              >
                Reopen
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange('resolved')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Resolve
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Ticket Properties Toolbar */}
        <div className="px-6 py-2.5 bg-slate-50/50 dark:bg-[#070b13]/40 flex items-center gap-6 text-xs border-t border-slate-100 dark:border-[#1f212a]/30">
          {/* Assignee select */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Assignee:</span>
            <select
              value={ticket.assignedAgentId || 'unassigned'}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 font-bold max-w-[130px] truncate transition-colors cursor-pointer"
            >
              <option value="unassigned">Unassigned</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Priority select */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Priority:</span>
            <select
              value={ticket.priority}
              onChange={(e) => handlePriorityChange(e.target.value)}
              className={`text-xs border rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 font-bold capitalize transition-all cursor-pointer ${
                ticket.priority === 'critical'
                  ? 'bg-red-50/50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400'
                  : ticket.priority === 'high'
                  ? 'bg-orange-50/50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400'
                  : ticket.priority === 'medium'
                  ? 'bg-amber-50/50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
                  : 'bg-slate-100 border-slate-200 text-slate-650 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-405'
              }`}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Status select */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Status:</span>
            <select
              value={ticket.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 font-bold transition-colors cursor-pointer"
            >
              <option value="open">Open</option>
              <option value="waiting">Waiting</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
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
        <div className="absolute inset-0 bg-black/40 z-50 flex items-center justify-center backdrop-blur-sm select-none">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 w-[400px] flex flex-col gap-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-violet-500" /> Merge conversation into…
              </h3>
              <button onClick={() => { setShowMergePanel(false); setSelectedTargetId(null); }} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              Consolidate messages from ticket <span className="font-bold text-slate-800 dark:text-slate-200">{ticket?.ticketNumber}</span> into another active ticket from <span className="font-bold text-violet-500">{ticket?.customer.name}</span>.
            </p>

            <input
              type="text"
              value={mergeSearchText}
              onChange={(e) => setMergeSearchText(e.target.value)}
              placeholder="Search by ticket # or category…"
              className="w-full border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />

            <div className="max-h-48 overflow-y-auto flex flex-col gap-2 border border-slate-100 dark:border-slate-850 rounded-xl p-1 bg-slate-50/50 dark:bg-slate-950/20">
              {duplicateTickets
                .filter(dt => {
                  const query = mergeSearchText.toLowerCase();
                  return (
                    dt.ticketNumber.toLowerCase().includes(query) ||
                    dt.category.toLowerCase().includes(query)
                  );
                })
                .map(dt => {
                  const isSelected = selectedTargetId === dt.id;
                  return (
                    <button
                      key={dt.id}
                      onClick={() => setSelectedTargetId(dt.id)}
                      className={`w-full flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'border-violet-500 bg-violet-500/10 dark:bg-violet-950/20 text-slate-900 dark:text-slate-50 shadow-sm'
                          : 'border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-850/80 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-black text-xs">{dt.ticketNumber}</span>
                        <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-100/50 dark:bg-amber-955/20 px-2 py-0.5 rounded-full">{dt.status}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 capitalize">{dt.category} • Priority: {dt.priority}</span>
                      <p className="text-[11px] text-slate-500 truncate mt-1">{dt.lastMessageSnippet || 'No messages yet'}</p>
                    </button>
                  );
                })}

              {duplicateTickets.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-6 italic font-medium">No other open tickets found for this user.</div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button 
                onClick={() => { setShowMergePanel(false); setSelectedTargetId(null); }} 
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-855 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button 
                disabled={!selectedTargetId || mergeConfirmLoading}
                onClick={async () => {
                  if (!ticket || !selectedTargetId) return;
                  setMergeConfirmLoading(true);
                  try {
                    const res = await fetch(`${BACKEND_URL}/api/tickets/${selectedTargetId}/merge`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({ sourceId: ticket.id })
                    });
                    if (res.ok) {
                      // Transition active view to the target ticket!
                      useStore.getState().setActiveConversationId(selectedTargetId);
                      setShowMergePanel(false);
                      setSelectedTargetId(null);
                    } else {
                      const err = await res.json();
                      alert('Merge failed: ' + err.error);
                    }
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setMergeConfirmLoading(false);
                  }
                }}
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white transition-all ${
                  selectedTargetId && !mergeConfirmLoading
                    ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-750 hover:to-indigo-750 shadow-md shadow-violet-500/10 active:scale-95 cursor-pointer'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                }`}
              >
                {mergeConfirmLoading ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message feed */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
        {messages.map((m, idx) => {
          // Check if this message is a merge event
          if (m.metadata?.type === 'merge') {
            const { mergeDetails } = m.metadata;
            return (
              <div 
                key={m.id}
                className="w-full flex justify-center my-3 select-none"
              >
                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm max-w-xl w-full flex flex-col gap-3.5 hover:shadow-md transition-shadow">
                  <div className="flex flex-col gap-1">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 text-[12px] leading-snug">
                      {mergeDetails.mergedBy} merged #{mergeDetails.sourceTicketNumber} into this conversation
                    </span>
                    <span className="font-bold text-slate-950 dark:text-slate-50 text-[12px] mt-0.5">
                      chat with {mergeDetails.customerName} from {mergeDetails.customerLocation}
                    </span>
                  </div>

                  {mergeDetails.question && (
                    <div className="flex flex-col gap-1 mt-0.5">
                      <span className="text-[10px] text-slate-450 dark:text-slate-550 font-extrabold uppercase tracking-wider">Question</span>
                      <p className="text-xs text-slate-650 dark:text-slate-350 leading-relaxed font-semibold">
                        {mergeDetails.question}
                      </p>
                    </div>
                  )}

                  {mergeDetails.summary && mergeDetails.summary.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-450 dark:text-slate-550 font-extrabold uppercase tracking-wider">Summary</span>
                      <ul className="text-xs text-slate-650 dark:text-slate-350 flex flex-col gap-2 font-semibold">
                        {mergeDetails.summary.map((bullet: string, idx: number) => (
                          <li key={idx} className="flex items-start gap-2.5">
                            <span className="w-1.5 h-1.5 bg-slate-350 dark:bg-slate-700 rounded-full mt-1.5 shrink-0" />
                            <span className="leading-normal">{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-2 pt-1">
                    <button 
                      onClick={() => useStore.getState().setViewingMergedConversationId(mergeDetails.sourceConversationId)}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-black text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
                    >
                      View conversation
                    </button>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          const isCustomer = m.sender.type === 'customer';
          
          if (isCustomer) {
            const isLastInBlock = idx === messages.length - 1 || 
              messages[idx + 1].sender.type !== 'customer' ||
              messages[idx + 1].isInternalNote ||
              messages[idx + 1].metadata?.type === 'merge';

            return (
              <div
                key={m.id}
                className="flex items-end gap-3 self-start max-w-[85%] group/msg relative pl-11"
              >
                {/* Platform Avatar Icon on the Left */}
                <div className="absolute left-0 bottom-1 w-8 h-8 flex items-center justify-center">
                  {isLastInBlock && (
                    <div className="relative cursor-default select-none">
                      {/* Circle Avatar (yellow with customer initials or ID initials) */}
                      <div className="w-7 h-7 rounded-full bg-yellow-400 dark:bg-yellow-500 border border-slate-200/50 dark:border-slate-800 flex items-center justify-center shadow-sm text-slate-800 dark:text-slate-900 font-extrabold text-[10px] tracking-wide select-none">
                        {getInitials(m.sender.name, m.sender.id)}
                      </div>
                      
                      {/* Green online dot */}
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  {/* Bubble */}
                  <div
                    className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap rounded-tl-none ${
                      chatColorTheme === 'classic'
                        ? 'bg-white dark:bg-[#0c1220] border border-slate-200/60 dark:border-slate-800/80 text-slate-800 dark:text-slate-200'
                        : 'bg-slate-100 dark:bg-slate-800 border-none text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {m.content && formatMarkdown(m.content)}
                    
                    {/* File Attachments */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2.5">
                        {m.attachments.map((a, aIdx) => (
                          <a
                            key={aIdx}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 p-2 rounded-xl border text-[11px] font-medium transition-all bg-slate-50 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/80 text-slate-700 dark:text-slate-350 hover:bg-slate-100/50"
                          >
                            {a.type === 'image' ? (
                              <img src={a.url} alt={a.name} className="w-20 h-20 rounded-lg object-cover border dark:border-slate-850" />
                            ) : (
                              <Paperclip className="w-4 h-4 shrink-0" />
                            )}
                            <div className="flex flex-col truncate">
                              <span className="truncate max-w-[150px] font-bold">{a.name}</span>
                              <span className="opacity-70 text-[9px]">{(a.size || 0) > 0 ? `${Math.round(a.size! / 1024)} KB` : ''}</span>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60 ml-auto" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Relative timestamp details shown at the bottom of the last message in block */}
                  {isLastInBlock && (
                    <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-slate-450 dark:text-slate-500 font-bold select-none relative group/tooltip cursor-pointer w-fit">
                      {renderPlatformIcon(m.metadata?.platform)}
                      <span>
                        {formatRelativeTime(m.createdAt)}
                      </span>

                      {/* Hover Tooltip Details */}
                      <div className="absolute left-0 top-[14px] pt-2.5 hidden group-hover/tooltip:block z-50">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-3.5 rounded-xl shadow-xl text-[11px] text-slate-700 dark:text-slate-350 min-w-[250px] font-semibold text-left">
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Source URL</div>
                          <a 
                            href={m.metadata?.sourceUrl || 'https://sudoprashanth.com/'} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-blue-500 hover:underline block truncate mb-2 font-bold"
                          >
                            {m.metadata?.sourceUrl || 'https://sudoprashanth.com/'}
                          </a>
                          <div className="text-[10.5px] text-slate-655 dark:text-slate-400 leading-snug">
                            <span className="font-bold text-slate-400">Platform:</span> {m.metadata?.platform || 'web'}<br />
                            <span className="font-bold text-slate-400">Browser:</span> {m.metadata?.browser || 'Chrome (149.0.0.0)'}<br />
                            <span className="font-bold text-slate-400">OS:</span> {(m.metadata?.os || 'macOS 10.15.7').replace('OS X', 'macOS')}<br />
                            <span className="font-bold text-slate-400">Time:</span> {new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={m.id}
              className="flex flex-col group relative max-w-[75%] self-end items-end"
            >
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-[10px] text-slate-450 dark:text-slate-500 font-bold">{m.sender.name}</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-600">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                
                {/* Delete Message for Agent */}
                <button
                  onClick={() => handleMessageDelete(m.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-350 hover:text-red-500 transition-opacity ml-1 p-0.5 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Message box */}
              <div
                className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap ${
                  m.isInternalNote
                    ? 'bg-amber-500/5 dark:bg-amber-950/15 border border-amber-300/40 dark:border-amber-900/40 text-amber-950 dark:text-amber-300 rounded-tr-none'
                    : chatColorTheme === 'classic'
                      ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/5'
                      : 'bg-[#0284c7] text-white rounded-tr-none shadow-md shadow-sky-600/5'
                }`}
              >
                {/* Render indicators for internal note */}
                {m.isInternalNote && (
                  <div className="flex items-center gap-1.5 text-[9px] font-black text-amber-500 dark:text-amber-455 uppercase tracking-widest mb-1.5">
                    <Lock className="w-3.5 h-3.5" /> Internal Note
                  </div>
                )}

                {/* Markdown parser content */}
                {m.content && formatMarkdown(m.content)}

                {/* File Attachments */}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex flex-col gap-2 mt-2.5">
                    {m.attachments.map((a, aIdx) => (
                      <a
                        key={aIdx}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-2 p-2 rounded-xl border text-[11px] font-medium transition-all ${
                          m.isInternalNote
                            ? 'bg-amber-100/30 border-amber-200/30 text-amber-900'
                            : 'bg-white/10 border-white/20 hover:bg-white/15 text-white'
                        }`}
                      >
                        {a.type === 'image' ? (
                          <img src={a.url} alt={a.name} className="w-20 h-20 rounded-lg object-cover border dark:border-slate-850" />
                        ) : (
                          <Paperclip className="w-4 h-4 shrink-0" />
                        )}
                        <div className="flex flex-col truncate">
                          <span className="truncate max-w-[150px] font-bold">{a.name}</span>
                          <span className="opacity-70 text-[9px]">{(a.size || 0) > 0 ? `${Math.round(a.size! / 1024)} KB` : ''}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60 ml-auto" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Reactions facepile */}
              {m.reactions && m.reactions.length > 0 && (
                <div className="flex gap-1 mt-1.5">
                  {m.reactions.map((r, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleReactionToggle(m.id, r.emoji)}
                      className="bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-800 px-2 py-0.5 rounded-full text-xs shadow-sm flex items-center gap-1 active:scale-90 transition-transform"
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
              } opacity-0 group-hover:opacity-100 flex items-center bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-2 py-1 rounded-full shadow-lg gap-1.5 transition-all z-10 hover:scale-105`}>
                {['👍', '❤️', '😊', '💡'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleReactionToggle(m.id, emoji)}
                    className="hover:scale-125 active:scale-95 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Read receipt check */}
              {!isCustomer && !m.isInternalNote && (
                <span className="text-[9px] text-slate-400 mt-1 flex items-center gap-0.5 px-1 font-bold">
                  {m.seen ? (
                    <>
                      <CheckCheck className="w-3.5 h-3.5 text-violet-500" /> Seen
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
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1.5 font-bold">{ticket.customer.name} typing</span>
            <div className="bg-white dark:bg-[#0c1220] border border-slate-200/60 dark:border-slate-800/80 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center shadow-sm">
              <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-600 rounded-full typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Panel */}
      <div className={`p-4 border-t bg-white dark:bg-[#080d16] relative shrink-0 transition-all ${
        isInternal 
          ? 'border-amber-250 dark:border-amber-900/60 bg-amber-50/5 dark:bg-amber-950/5' 
          : 'border-slate-200 dark:border-[#1f212a]'
      }`}>
        {/* Saved replies trigger selector popup */}
        {showReplies && (
          <div className="absolute bottom-[105%] left-4 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-20 animate-slide-up">
            <div className="bg-slate-50 dark:bg-slate-950/80 px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
              Saved Replies
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredReplies.map(r => (
                <button
                  key={r.id}
                  onClick={() => selectSavedReply(r)}
                  className="w-full text-left px-4 py-3 text-xs hover:bg-violet-50 dark:hover:bg-violet-950/20 text-slate-700 dark:text-slate-350 border-b border-slate-100 dark:border-slate-850/50 last:border-0 font-medium"
                >
                  <div className="font-extrabold text-violet-600 dark:text-violet-400">{r.trigger}</div>
                  <div className="truncate opacity-75 mt-0.5">{r.title}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Emoji selection popup */}
        {showEmoji && (
          <div className="absolute bottom-[105%] left-4 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex gap-2.5 z-20 animate-slide-up">
            {['👍', '👋', '❤️', '😊', '💡', '🎉'].map(emoji => (
              <button
                key={emoji}
                onClick={() => handleEmojiSelect(emoji)}
                className="text-xl hover:scale-125 active:scale-95 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Composer options */}
        <div className="flex justify-between items-center mb-3">
          {/* Public Reply vs Internal Note toggle tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800/80 shadow-inner">
            <button
              onClick={() => setIsInternal(false)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg font-bold transition-all duration-200 active:scale-95 ${
                !isInternal
                  ? 'bg-white dark:bg-slate-850 text-violet-600 dark:text-violet-400 shadow-sm border border-slate-200/50 dark:border-slate-800'
                  : 'text-slate-550 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> Public Reply
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg font-bold transition-all duration-200 active:scale-95 ${
                isInternal
                  ? 'bg-white dark:bg-slate-850 text-amber-600 dark:text-amber-500 shadow-sm border border-slate-200/50 dark:border-slate-800'
                  : 'text-slate-555 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5" /> Internal Note
            </button>
          </div>

          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
            Type <span className="text-violet-500 dark:text-violet-400 font-black">/</span> for saved replies
          </div>
        </div>

        {/* Text Area Input */}
        <div className="flex gap-3.5 items-end">
          <textarea
            ref={composerRef}
            rows={2}
            value={inputText}
            onChange={handleInputChange}
            placeholder={isInternal ? 'Type internal notes (only agents see this)...' : 'Type public reply...'}
            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-2xl px-4 py-3 text-xs text-slate-800 dark:text-slate-250 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 resize-none font-sans font-medium transition-all"
          />

          <div className="flex flex-col gap-2">
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
                className="p-2 text-slate-400 hover:text-slate-655 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-850/50 transition-colors"
                title="Attach Files"
              >
                <Paperclip className="w-4.5 h-4.5" />
              </button>
              
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className="p-2 text-slate-400 hover:text-slate-655 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-850/50 transition-colors"
                title="Add Emoji"
              >
                <Smile className="w-4.5 h-4.5" />
              </button>
            </div>

            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim()}
              className={`p-2.5 rounded-xl text-white active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md flex items-center justify-center shrink-0 ${
                isInternal 
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' 
                  : 'bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-violet-500/25'
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
