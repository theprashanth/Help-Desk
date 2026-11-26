import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment, SavedReply } from '../../../../../shared/src/types';
import { 
  Send, Paperclip, Smile, CheckCheck, Check, 
  Lock, Globe, ExternalLink, Star, MoreHorizontal,
  Clock, GitMerge, Ban, Copy, UserPlus, FileText, FileDown,
  Activity, AlarmClock, X, BellOff, MessageSquare, CornerUpLeft,
  SendHorizontal, Hourglass, CheckCircle2, Archive, ArrowLeft, Search, CircleDot,
  Tag as TagIcon, Link2, BookmarkPlus, CopyPlus, SmilePlus, XCircle, Plus,
  ChevronRight, UserCheck, ArrowUpDown, SlidersHorizontal, Ticket, MoreVertical, Square, CheckSquare, Bot, Zap, Mail, Sparkles, Languages, Wrench
} from 'lucide-react';
import { ConversationEventCategory } from '../../../../../shared/src/types';
import { getDeviceInfo, DeviceIcon } from '../../lib/device';
import { exportAsText, exportAsPdf } from '../../lib/exportConversations';
import { useSnoozeOptions } from '../../lib/useSnoozeOptions';
import { computeSnoozeUntil, isSnoozed, formatSnoozeUntil } from '../../lib/snooze';
import { RichText, handleFormattedPaste } from '../../lib/richText';
import RichComposer, { RichComposerHandle } from './RichComposer';
import MergeDialog from './MergeDialog';
import { ConvertToTicketDialog, LinkIssueDialog, IssueBroadcastDialog } from './IssueDialogs';
import { KnownIssueBar, linkedCounts, broadcastSummary } from './IssueLinks';
import { ParticipantsDialog } from './EmailThreads';
import CloseDialog from './CloseDialog';
import { PresenceIndicator, othersIn } from './Presence';
import CloseConversationIcon from '../ui/CloseConversationIcon';
import TimeHover, { longTimestamp, TimeZoneContext } from '../ui/TimeHover';
import { MergedBanner } from './mergeUi';
import SlaChip from '../ui/SlaChip';
import { useAiStatus } from '../../lib/aiFeatures';
import { applyMacroActions, describeMacroActions, hasMacroActions } from '../../lib/macros';
import { API_URL } from '../../lib/config';

// Ticket states offered by the "Update ticket state" palette (values are the existing statuses)
const TICKET_STATES: {
  status: string; label: string; hint?: string; kbd?: string[];
  icon: React.ElementType; color: string;
}[] = [
  { status: 'open', label: 'In progress', hint: 'Customer sees "In progress"', icon: CircleDot, color: 'text-accent' },
  { status: 'waiting', label: 'Waiting on customer', hint: 'Customer sees "Waiting on you"', icon: Hourglass, color: 'text-red-500' },
  { status: 'resolved', label: 'Resolved', hint: 'Customer sees "Resolved"', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
  { status: 'closed', label: 'Close', kbd: ['⌘', '⇧', 'Y'], icon: CloseConversationIcon, color: 'text-ink' },
  { status: 'archived', label: 'Archive', hint: 'Hide from every queue', icon: Archive, color: 'text-muted' },
];
// Conversation event categories shown in "Show conversation events"
const EVENT_CATEGORIES: { key: ConversationEventCategory; label: string; prefix: string; icon: React.ElementType }[] = [
  { key: 'status', label: 'Status changes', prefix: 'State', icon: CircleDot },
  { key: 'assignment', label: 'Assignment', prefix: 'Assignment', icon: UserCheck },
  { key: 'priority', label: 'Priority', prefix: 'Priority', icon: ArrowUpDown },
  { key: 'tags', label: 'Tags', prefix: 'Tags', icon: TagIcon },
  { key: 'attributes', label: 'Attributes & title', prefix: 'Attribute', icon: SlidersHorizontal },
  { key: 'tickets', label: 'Tickets', prefix: 'Ticket', icon: Ticket },
  { key: 'other', label: 'Other', prefix: '', icon: MoreVertical },
];
// v2: events are shown by default (Intercom shows every activity inline); older saved choices reset once
const EVENT_FILTER_KEY = 'hd_conversation_event_filter_v2';

const STATE_LABELS: Record<string, string> = {
  open: 'In progress', waiting: 'Waiting on customer', resolved: 'Resolved',
  closed: 'Closed', archived: 'Archived', merged: 'Merged'
};

const BACKEND_URL = API_URL;

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


/** Messages of recently opened conversations, so switching back shows them at once (refreshed in the background). */
const messageCache = new Map<string, Message[]>();
const MESSAGE_CACHE_MAX = 40;

export const ChatWindow: React.FC = () => {
  const snoozeOptions = useSnoozeOptions();
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  // Light seats are read-only: internal notes only, no conversation actions
  const isLight = agent?.role === 'light';
  const chatColorTheme = useStore((state) => (state as any).chatColorTheme);
  
  const [ticket, setTicket] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  // Ask AI → "Insert in reply": add the text to this conversation's reply box (as a reply, not a note)
  const replyDraft = useStore((state) => state.replyDraft);
  useEffect(() => {
    if (!replyDraft || replyDraft.conversationId !== activeConversationId) return;
    setInputText(prev => (prev.trim() ? `${prev.trimEnd()}\n\n${replyDraft.text}` : replyDraft.text));
    setIsInternal(false);
    useStore.getState().setReplyDraft(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyDraft, activeConversationId]);
  
  const [isInternal, setIsInternal] = useState(false); // Toggle internal note vs public message
  useEffect(() => { if (isLight && !isInternal) setIsInternal(true); }, [isLight, isInternal]);
  const [uploading, setUploading] = useState(false);
  // Files attached to the draft; sent together with the text when you press Send
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  useEffect(() => { setPendingAttachments([]); }, [activeConversationId]);
  const [showEmoji, setShowEmoji] = useState(false);
  
  // Saved Replies
  const [showReplies, setShowReplies] = useState(false);
  const [filteredReplies, setFilteredReplies] = useState<SavedReply[]>([]);
  const savedReplies = useStore((state) => state.savedReplies);
  const setSavedReplies = useStore((state) => state.setSavedReplies);
  const allTags = useStore((state) => state.tags);
  const setAllTags = useStore((state) => state.setTags);
  const focusMessageId = useStore((state) => state.focusMessageId);
  const setFocusMessageId = useStore((state) => state.setFocusMessageId);

  // Per-message action menus (agent messages): "…" actions, tag picker, reactions
  const [msgMenu, setMsgMenu] = useState<{ id: string; kind: 'actions' | 'tags' | 'react' } | null>(null);
  const [msgMenuQuery, setMsgMenuQuery] = useState('');
  const [macroDraft, setMacroDraft] = useState<{ title: string; trigger: string; content: string } | null>(null);
  const [macroSaving, setMacroSaving] = useState(false);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const setComposer = useStore((state) => state.setComposer);

  // Which conversation event categories to show inline (remembered per browser; none by default)
  const [eventFilter, setEventFilter] = useState<ConversationEventCategory[]>(() => {
    const all = EVENT_CATEGORIES.map(c => c.key);
    try {
      const saved = localStorage.getItem(EVENT_FILTER_KEY);
      return saved === null ? all : JSON.parse(saved);
    } catch { return all; }
  });
  const [showEventsSubmenu, setShowEventsSubmenu] = useState(false);
  const [eventsFlyoutPos, setEventsFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const openEventsSubmenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 250;
    // open to the left of the menu (it sits at the right edge of the panel); fall back to the right
    const left = r.left - width - 8 >= 8 ? r.left - width - 8 : r.right + 8;
    const top = Math.min(Math.max(8, r.top - 6), window.innerHeight - 420);
    setEventsFlyoutPos({ top, left });
    setShowEventsSubmenu(true);
  };
  const updateEventFilter = (next: ConversationEventCategory[]) => {
    setEventFilter(next);
    localStorage.setItem(EVENT_FILTER_KEY, JSON.stringify(next));
  };
  const allEventsOn = eventFilter.length === EVENT_CATEGORIES.length;
  const toggleAllEvents = () => updateEventFilter(allEventsOn ? [] : EVENT_CATEGORIES.map(c => c.key));
  const toggleEventCategory = (key: ConversationEventCategory) =>
    updateEventFilter(eventFilter.includes(key) ? eventFilter.filter(k => k !== key) : [...eventFilter, key]);

  // ⌘E toggles all conversation events
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setEventFilter(prev => {
          const next = prev.length === EVENT_CATEGORIES.length ? [] : EVENT_CATEGORIES.map(c => c.key);
          localStorage.setItem(EVENT_FILTER_KEY, JSON.stringify(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  
  // Typing state
  const [isTyping, setIsTyping] = useState(false);
  const [customerTyping, setCustomerTyping] = useState(false);
  

  // Header action states
  // Block user: stored on the customer; blocked customers can't send messages or start chats
  const isBlocked = !!ticket?.customer?.blocked;
  const toggleBlocked = async () => {
    if (!ticket || !token) return;
    const blocked = !isBlocked;
    if (blocked && !window.confirm(`Block ${ticket.customer.name}? They won't be able to send messages or start new conversations until you unblock them.`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/customers/${ticket.customer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ blocked, conversationId: ticket.id }),
      });
      if (res.ok) {
        const customer = await res.json();
        setTicket(t => (t ? { ...t, customer: { ...t.customer, ...(customer?.id ? customer : { blocked }) } } : t));
      }
    } catch (e) { console.error(e); }
  };
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [issueDialog, setIssueDialog] = useState<'convert' | 'link' | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);
  // "Show timestamp in customer timezone": remembered for every conversation on this device
  const [customerTimes, setCustomerTimes] = useState(() => { try { return localStorage.getItem('ts_customer_tz') === '1'; } catch { return false; } });
  const toggleCustomerTimes = () => setCustomerTimes(v => {
    try { localStorage.setItem('ts_customer_tz', v ? '0' : '1'); } catch { /* private mode */ }
    return !v;
  });
  // Resolving an issue that still has open reports offers to message those customers
  const [issueBroadcast, setIssueBroadcast] = useState<{ total: number; open: number } | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const messagesForRef = useRef<string | null>(null); // which conversation `messages` belongs to
  const jumpToBottomRef = useRef(true);                // next render: jump straight to the latest message
  const nearBottomRef = useRef(true);                  // the reader is at (or close to) the latest message
  const composerRef = useRef<RichComposerHandle>(null);
  const typingTimeoutRef = useRef<any>(null);
  // @mentions in notes: teammate picker + who was mentioned in this draft
  const [teammates, setTeammates] = useState<{ id: string; name: string; email: string; avatar?: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const draftMentionsRef = useRef<Map<string, string>>(new Map()); // id -> name
  const lastTypingPingRef = useRef(0);
  const draftStartedAtRef = useRef<string | null>(null);
  // Double-reply guard: a teammate is typing, or replied after this draft started
  const [collision, setCollision] = useState<{ who: string; kind: 'typing' | 'replied'; at?: string; text?: string; files?: Attachment[] } | null>(null);
  const presenceHere = useStore((state) => (activeConversationId ? state.presence[activeConversationId] : undefined));
  // AI (Settings › AI assistant): suggested replies, translation in/out, originals shown on demand
  const aiStatus = useAiStatus();
  const [suggestions, setSuggestions] = useState<{ forId: string; replies: string[] } | null>(null);
  const [translateOut, setTranslateOut] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set());
  const toggleOriginal = (id: string) => setShowOriginal(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Macro picked from "/" whose actions run when this draft is sent
  const [pendingMacro, setPendingMacro] = useState<SavedReply | null>(null);
  const [macroNotice, setMacroNotice] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => { setPendingMacro(null); setMacroNotice(null); }, [activeConversationId]);
  useEffect(() => {
    if (!macroNotice) return;
    const t = setTimeout(() => setMacroNotice(null), 4000);
    return () => clearTimeout(t);
  }, [macroNotice]);
  // The customer's latest message, if they're the one waiting (automatic messages don't count)
  const waitingOn = (() => {
    const AUTO = ['auto_reply', 'bot', 'bot_choice', 'csat_request', 'customer_event', 'event'];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender.type === 'system' || m.isInternalNote || m.sender.id === 'bot' || AUTO.includes(m.metadata?.type)) continue;
      return m.sender.type === 'customer' ? m.id : null;
    }
    return null;
  })();
  useEffect(() => {
    if (!waitingOn || !activeConversationId || !aiStatus.configured || !aiStatus.features.suggestedReplies || isLight) return;
    if (suggestions?.forId === waitingOn) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/ai/suggest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: activeConversationId }),
    }).then(r => (r.ok ? r.json() : { replies: [] }))
      .then(d => { if (!cancelled) setSuggestions({ forId: waitingOn, replies: Array.isArray(d.replies) ? d.replies : [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingOn, activeConversationId, aiStatus.configured, aiStatus.features.suggestedReplies, isLight]);
  useEffect(() => { setSuggestions(null); setTranslateOut(true); }, [activeConversationId]);
  const showSuggestions = !isInternal && !inputText.trim() && !pendingMacro && !macroNotice && !showReplies && mentionQuery === null
    && suggestions?.forId === waitingOn && !!suggestions?.replies.length;

  const runMacroActions = async (macro: SavedReply, conv: Conversation | null) => {
    if (!conv || !macro.actions) return;
    const r = await applyMacroActions(conv, macro.actions, { token, agentId: agent?.id });
    setMacroNotice(r.ok ? { text: `Applied “${macro.title}”` } : { text: r.error || 'Macro failed', error: true });
  };

  // Derived state
  const isStarred = ticket?.starred || false;

  // Sync ticket details
  useEffect(() => {
    if (!activeConversationId) {
      setTicket(null);
      setMessages([]);
      messagesForRef.current = null;
      return;
    }
    const t = conversations.find(c => c.id === activeConversationId);
    if (t) setTicket(t);
  }, [activeConversationId, conversations]);


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

    // Show this conversation right away: its cached messages (or nothing) instead of the previous chat's,
    // opened at the latest message
    const convId = activeConversationId;
    if (messagesForRef.current !== convId) {
      messagesForRef.current = convId;
      jumpToBottomRef.current = true;
      nearBottomRef.current = true;
      setMessages(messageCache.get(convId) || []);
    }

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${convId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data: Message[] = await res.json();
          if (messagesForRef.current !== convId) return; // switched away meanwhile
          // Fresh copy replaces the cached one; stay at the bottom if that's where the reader is
          if (nearBottomRef.current) jumpToBottomRef.current = true;
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

  // Keep the cache in step with what's on screen
  useEffect(() => {
    const id = messagesForRef.current;
    if (!id || id !== activeConversationId) return;
    messageCache.delete(id);
    messageCache.set(id, messages);
    if (messageCache.size > MESSAGE_CACHE_MAX) messageCache.delete(messageCache.keys().next().value!);
  }, [messages, activeConversationId]);

  // Opening a conversation: jump straight to the latest message before the screen paints (no scrolling
  // through the history). New messages afterwards glide in only if the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (jumpToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      if (messages.length) jumpToBottomRef.current = false;
      nearBottomRef.current = true;
    } else if (nearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, customerTyping, activeConversationId]);

  // Images load after the first paint and push content down: stay pinned to the bottom while they do
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const onLoad = () => { if (nearBottomRef.current) el.scrollTop = el.scrollHeight; };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, [activeConversationId]);

  // Input changes & saved replies triggers
  const handleInputChange = (val: string) => {
    setInputText(val);

    // Emit typing indicator
    if (!socket || !activeConversationId || !agent) return;
    // Track when this draft started (double-reply guard)
    if (!draftStartedAtRef.current && val.trim()) draftStartedAtRef.current = new Date().toISOString();
    if (!val.trim()) draftStartedAtRef.current = null;
    // Re-announce while typing continuously, so teammates' "typing…" doesn't expire mid-sentence
    if (isTyping && Date.now() - lastTypingPingRef.current > 3000) {
      lastTypingPingRef.current = Date.now();
      socket.emit('typing', { conversationId: activeConversationId, senderType: 'agent', senderName: agent.name, isTyping: true });
    }
    if (!isTyping) {
      setIsTyping(true);
      lastTypingPingRef.current = Date.now();
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

    // @mentions (notes only): "@sa" opens the teammate picker
    const at = isInternal ? val.match(/(^|\s)@([\w.]{0,30})$/) : null;
    if (at) {
      const q = at[2].toLowerCase();
      setMentionQuery(q);
      setMentionIndex(0);
    } else if (mentionQuery !== null) {
      setMentionQuery(null);
    }

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
    const textWithoutSlash = inputText.replace(/\/(\w*)$/, reply.content || '');
    setInputText(textWithoutSlash);
    setShowReplies(false);
    composerRef.current?.focus();
    if (!hasMacroActions(reply)) return;
    // Action-only macros run now; otherwise the actions run when the reply is sent
    if (!reply.content?.trim()) { setPendingMacro(null); runMacroActions(reply, ticket); }
    else setPendingMacro(reply);
  };
  // Used by the ⌘K palette ("Run macro…")
  useEffect(() => {
    const onRun = (e: Event) => {
      const reply = (e as CustomEvent<SavedReply>).detail;
      if (!reply) return;
      if (reply.content?.trim()) {
        setInputText(prev => (prev.trim() ? prev + '\n' : '') + reply.content);
        if (hasMacroActions(reply)) setPendingMacro(reply);
        setTimeout(() => composerRef.current?.focus(), 0);
      } else runMacroActions(reply, ticket);
    };
    window.addEventListener('macro:run', onRun);
    return () => window.removeEventListener('macro:run', onRun);
  });

  // Mention picker keys: ↑↓ to move, Enter/Tab to pick, Esc to close (captured before the composer)
  useEffect(() => {
    if (mentionQuery === null) return;
    const onKey = (e: KeyboardEvent) => {
      const list = mentionMatchesRef.current;
      if (!list.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setMentionIndex(i => Math.min(i + 1, list.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setMentionIndex(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); insertMentionRef.current(list[Math.min(mentionIndexRef.current, list.length - 1)]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMentionQuery(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mentionQuery]);

  // Teammates for the @mention picker
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then(list => setTeammates(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [token]);
  const mentionMatches = mentionQuery === null ? [] : teammates
    .filter(t => t.name.toLowerCase().split(/\s+/).some(w => w.startsWith(mentionQuery)) || t.name.toLowerCase().startsWith(mentionQuery) || t.email.toLowerCase().startsWith(mentionQuery))
    .slice(0, 6);
  const mentionMatchesRef = useRef(mentionMatches); mentionMatchesRef.current = mentionMatches;
  const mentionIndexRef = useRef(mentionIndex); mentionIndexRef.current = mentionIndex;
  const insertMentionRef = useRef<(t: { id: string; name: string }) => void>(() => {});
  const insertMention = (t: { id: string; name: string }) => {
    // Replace the "@que" being typed with a bold "@Full Name "
    setInputText(prev => prev.replace(/(^|\s)@([\w.]{0,30})$/, (_m, pre) => `${pre}**@${t.name}** `));
    draftMentionsRef.current.set(t.id, t.name);
    setMentionQuery(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  };
  insertMentionRef.current = insertMention;

  const handleSendMessage = async (textToSend?: string, filesArg?: Attachment[], force = false) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    // Sending from the composer includes any staged attachments
    const files = filesArg ?? (textToSend === undefined ? pendingAttachments : undefined);
    if (!text.trim() && (!files || files.length === 0)) return;
    if (!activeConversationId || !agent) return;

    // Collision detection: don't double-reply to the customer by accident (notes are fine)
    if (!force && !isInternal) {
      const others = othersIn(presenceHere, agent.id);
      const typer = others.find(v => v.typing);
      const since = draftStartedAtRef.current;
      const theirs = since
        ? [...messages].reverse().find(m => m.sender.type === 'agent' && m.sender.id !== agent.id && m.sender.id !== 'bot'
            && !m.isInternalNote && m.metadata?.type !== 'event' && m.metadata?.type !== 'auto_reply' && m.createdAt > since)
        : undefined;
      if (theirs) { setCollision({ who: theirs.sender.name, kind: 'replied', at: theirs.createdAt, text: textToSend, files: filesArg }); return; }
      if (typer) { setCollision({ who: typer.name, kind: 'typing', text: textToSend, files: filesArg }); return; }
    }
    draftStartedAtRef.current = null;

    // Translation: send the reply in the customer's language, keeping what the teammate wrote
    let outgoing = text;
    let original: { text: string; language: string } | undefined;
    if (!isInternal && translateOut && aiStatus.features.translation && ticket?.language && text.trim()) {
      if (translating) return; // already on its way
      setTranslating(true);
      try {
        const tr = await fetch(`${BACKEND_URL}/api/ai/translate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ conversationId: activeConversationId, text }),
        });
        const d = await tr.json();
        if (!tr.ok) throw new Error(d.error || 'Translation failed');
        outgoing = d.text;
        original = { text, language: aiStatus.features.teamLanguage };
      } catch (e: any) {
        setMacroNotice({ text: `Not sent: ${e.message}. Turn off translation to send as written.`, error: true });
        return;
      } finally {
        setTranslating(false);
      }
    }

    // Your own message: show it, even if you'd scrolled up (it can arrive over the socket before the response)
    jumpToBottomRef.current = true;
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
          content: outgoing,
          attachments: files || [],
          isInternalNote: isInternal,
          ...(original ? { metadata: { original } } : {}),
          // Teammates still @mentioned in the note's text
          ...(isInternal ? (() => {
            const ids = Array.from(draftMentionsRef.current.entries()).filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
            return ids.length ? { metadata: { mentions: ids } } : {};
          })() : {}),
        })
      });

      if (res.ok) {
        if (textToSend === undefined) {
          setInputText('');
          setPendingAttachments([]);
          draftMentionsRef.current.clear();
          setMentionQuery(null);
          if (pendingMacro) { const m = pendingMacro; setPendingMacro(null); runMacroActions(m, ticket); }
        }
      }
    } catch (err) {
      console.error('Failed to post message:', err);
    }
  };

  // Upload file attachment handler
  const uploadAttachment = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name || `screenshot-${Date.now()}.png`);
    const res = await fetch(`${BACKEND_URL}/api/messages/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
    const attachment: Attachment = await res.json();
    setPendingAttachments(prev => [...prev, attachment]);
  };

  const stageFiles = async (files: File[]) => {
    if (files.length === 0 || !activeConversationId) return;
    setUploading(true);
    try {
      for (const f of files) await uploadAttachment(f);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      composerRef.current?.focus();
    }
  };

  // Attach files to the draft (they're sent with the message, not on their own)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow choosing the same file again
    await stageFiles(files);
  };

  // Paste a screenshot straight into the composer
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
      if (ticket.kind === 'issue' && newStatus === 'resolved' && token) {
        const counts = await linkedCounts(ticket.id, token);
        if (counts.open > 0) setIssueBroadcast(counts);
      }
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

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(t => (t === text ? null : t)), 2200);
  };

  const openMsgMenu = (id: string, kind: 'actions' | 'tags' | 'react') => {
    setMsgMenuQuery('');
    setMsgMenu(prev => (prev && prev.id === id && prev.kind === kind ? null : { id, kind }));
  };

  // Toggle a tag on a message (creates the tag first if it doesn't exist yet)
  const handleToggleMessageTag = async (m: Message, tagName: string) => {
    const name = tagName.trim();
    if (!name) return;
    try {
      if (!allTags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        const palette = ['#2a5bd7', '#e5622d', '#14b8a6', '#8b5cf6', '#db2777', '#ca8a04'];
        const res = await fetch(`${BACKEND_URL}/api/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name, color: palette[allTags.length % palette.length] })
        });
        if (res.ok) setAllTags([...allTags, await res.json()]);
      }
      const current = m.tags || [];
      const next = current.includes(name) ? current.filter(t => t !== name) : [...current, name];
      const res = await fetch(`${BACKEND_URL}/api/messages/${m.id}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tags: next })
      });
      if (res.ok) {
        const updated: Message = await res.json();
        setMessages(prev => prev.map(x => (x.id === updated.id ? updated : x)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyMessageLink = async (m: Message) => {
    const url = `${window.location.origin}/agent/inbox?conversation=${encodeURIComponent(m.conversationId)}&message=${encodeURIComponent(m.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const startSaveAsMacro = (m: Message) => {
    const title = (m.content || 'New macro').replace(/\s+/g, ' ').trim().slice(0, 48);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'macro';
    setMacroError(null);
    setMacroDraft({ title, trigger: `/${slug}`, content: m.content || '' });
  };

  const handleSaveMacro = async () => {
    if (!macroDraft) return;
    const trigger = macroDraft.trigger.startsWith('/') ? macroDraft.trigger : `/${macroDraft.trigger}`;
    if (!macroDraft.title.trim() || trigger.length < 2 || !macroDraft.content.trim()) {
      setMacroError('Title, shortcut and content are required.');
      return;
    }
    if (savedReplies.some(r => r.trigger.toLowerCase() === trigger.toLowerCase())) {
      setMacroError(`The shortcut ${trigger} is already used by another macro.`);
      return;
    }
    setMacroSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: macroDraft.title.trim(), trigger, content: macroDraft.content })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save macro');
      setSavedReplies([...savedReplies, await res.json()]);
      setMacroDraft(null);
      showToast(`Saved as macro ${trigger}`);
    } catch (e: any) {
      setMacroError(e.message);
    } finally {
      setMacroSaving(false);
    }
  };

  // Deep link (?message=…): scroll to the message once it's loaded, then highlight it briefly
  useEffect(() => {
    if (!focusMessageId || !messages.some(x => x.id === focusMessageId)) return;
    const el = document.getElementById(`msg-${focusMessageId}`);
    if (el) {
      nearBottomRef.current = false; // reading an older message: don't snap back to the bottom
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      setHighlightMsgId(focusMessageId);
      setTimeout(() => setHighlightMsgId(null), 2400);
    }
    setFocusMessageId(null);
  }, [focusMessageId, messages, setFocusMessageId]);

  // Persisted snooze: pass an ISO time, or null to unsnooze
  const handleSnoozeChange = async (snoozedUntil: string | null) => {
    if (!ticket) return;
    try {
      await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ snoozedUntil })
      });
    } catch (e) {
      console.error(e);
    }
  };

  // "Update ticket state" palette
  const [showStateMenu, setShowStateMenu] = useState(false);
  const [stateQuery, setStateQuery] = useState('');
  const [stateIndex, setStateIndex] = useState(0);
  const filteredStates = TICKET_STATES.filter(st =>
    st.label.toLowerCase().includes(stateQuery.trim().toLowerCase())
  );
  const openStateMenu = () => {
    setStateQuery('');
    const currentIdx = TICKET_STATES.findIndex(st => st.status === ticket?.status);
    setStateIndex(currentIdx >= 0 ? currentIdx : 0);
    setShowStateMenu(true);
    setShowMoreMenu(false);
    setShowSnoozeMenu(false);
  };
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const chooseState = (status: string) => {
    setShowStateMenu(false);
    // "Close" asks for a resolved state first (Resolved, or close without resolving)
    if (status === 'closed' && ticket && ticket.status !== 'closed') { setShowCloseDialog(true); return; }
    if (ticket && status !== ticket.status) handleStatusChange(status);
  };

  // ⌘⇧Y closes the open conversation (shown as a hint in the palette)
  useEffect(() => {
    if (!ticket) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        setShowStateMenu(false);
        if (ticket.status !== 'closed') handleStatusChange('closed');
      }
      // ⌘⇧M opens "Merge into…" (shown as a hint in the … menu)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm' && !ticket.mergedInto) {
        e.preventDefault();
        setShowMoreMenu(false);
        setShowMergePanel(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.status]);

  // Commands from the keyboard shortcuts and the ⌘K palette (R, N, E, Z, merge)
  useEffect(() => {
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      if (!ticket) return;
      if (cmd === 'reply' || cmd === 'note') {
        setIsInternal(cmd === 'note');
        setTimeout(() => composerRef.current?.focus(), 0);
      } else if (cmd === 'close') {
        setShowStateMenu(false);
        if (ticket.status !== 'closed') setShowCloseDialog(true);
      } else if (cmd === 'snooze') {
        setShowMoreMenu(false);
        setShowSnoozeMenu(true);
      } else if (cmd === 'merge' && !ticket.mergedInto) {
        setShowMoreMenu(false);
        setShowMergePanel(true);
      }
    };
    window.addEventListener('chat:command', onCmd);
    return () => window.removeEventListener('chat:command', onCmd);
  }, [ticket]);

  const formatMarkdown = (text: string) => (
    <RichText
      text={text}
      codeClass="bg-ink/[0.06] px-1 py-0.5 rounded text-[13px] text-ink font-mono"
      linkClass="text-link underline underline-offset-2"
    />
  );

  if (!ticket) {
    return (
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col relative">
        <div className="ic-empty flex-1 px-8">
          <MessageSquare className="w-12 h-12 text-muted mb-2" strokeWidth={1.5} />
          <h3 className="ic-empty-title">No conversation selected</h3>
          <p className="text-[14px] text-muted">Select a conversation from the inbox to respond.</p>
        </div>
      </div>
    );
  }
  const ticketSnoozedUntil = isSnoozed(ticket) ? ticket.snoozedUntil || null : null;
  const isEvent = (m: Message) => m.metadata?.type === 'event';
  // Merged into another conversation? (stored on the ticket; older merges only left the indicator message)
  const mergedInto = ticket?.mergedInto || (() => {
    const ind = [...messages].reverse().find(m => m.metadata?.type === 'merged_indicator');
    return ind?.metadata?.mergedIntoConversationId ? { id: ind.metadata.mergedIntoConversationId as string, ticketNumber: String(ind.metadata.mergedIntoTicketNumber || '') } : null;
  })();
  // Customer-facing state lines duplicate the teammates' own state events, so they're hidden here
  const visibleMessages = messages.filter(m => m.metadata?.type !== 'customer_event' && m.metadata?.type !== 'csat_request' && (!isEvent(m) || eventFilter.includes(m.metadata?.category || 'other')));
  const ticketTitle = (ticket.kind === 'ticket' || ticket.kind === 'issue') && ticket.title ? ticket.title : ticket.customer.name;

  // Event text with "You" for your own actions, e.g. "You assigned yourself"
  const renderEventText = (m: Message) => {
    let text = m.content;
    const meta = m.metadata || {};
    if (agent && meta.actorId === agent.id && meta.actorName && text.startsWith(meta.actorName)) {
      text = 'You' + text.slice(meta.actorName.length);
      text = text.replace(/assigned themselves$/, 'assigned yourself');
    }
    if (agent && meta.targetId === agent.id && meta.targetName && meta.actorId !== agent.id) {
      text = text.replace(new RegExp(`${meta.targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), 'you');
    }
    const cat = EVENT_CATEGORIES.find(c => c.key === meta.category);
    return cat?.prefix ? `${cat.prefix}: ${text}` : text;
  };

  const customerZone = ticket.customer?.session?.timezone;
  return (
    <TimeZoneContext.Provider value={customerTimes && customerZone ? customerZone : undefined}>
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col relative">
      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <div className="flex flex-col shrink-0 bg-surface">
        
        {/* Row 1: Title & Main Actions */}
        <div className="ic-panel-header justify-between gap-3">
          <h2 className="ic-title flex-1 min-w-0" title={ticketTitle}>{ticketTitle}</h2>
          {/* Teammates viewing or typing in this conversation */}
          <PresenceIndicator viewers={othersIn(presenceHere, agent?.id)} />
          {/* SLA countdown for the reply the customer is waiting on */}
          <SlaChip conv={ticket} size="md" />
          {ticket.language && (
            <span title={`The customer writes in ${ticket.language}`} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-ink/[0.06] text-muted text-[12.5px] shrink-0">
              <Languages className="w-3.5 h-3.5" /> {ticket.language}
            </span>
          )}

          {/* Right Action Buttons */}
          <div className={`flex items-center gap-1.5 shrink-0 ${isLight ? 'hidden' : ''}`}>
            {/* ★ Star / Priority flag */}
            <button
              onClick={handleStarToggle}
              title={isStarred ? 'Remove priority flag' : 'Flag as priority'}
              className={`ic-icon-btn ${isStarred ? 'text-amber-500' : ''}`}
            >
              <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-500' : ''}`} />
            </button>

            {/* Snooze */}
            <div className="relative" ref={snoozeMenuRef}>
              <button
                onClick={() => { setShowSnoozeMenu(v => !v); setShowMoreMenu(false); }}
                title={ticketSnoozedUntil ? `Snoozed until ${formatSnoozeUntil(ticketSnoozedUntil)}` : 'Snooze conversation'}
                className={`ic-icon-btn ${
                  ticketSnoozedUntil
                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300'
                    : showSnoozeMenu ? 'bg-ink/10' : ''
                }`}
              >
                <AlarmClock className="w-4 h-4" />
              </button>

              {showSnoozeMenu && (
                <div className="ic-menu absolute top-full right-0 mt-2 w-64">
                  <div className="px-3.5 pt-1 pb-2 text-[13px] font-medium text-muted">
                    {ticketSnoozedUntil ? `Snoozed until ${formatSnoozeUntil(ticketSnoozedUntil)}` : 'Snooze until…'}
                  </div>
                  {snoozeOptions.map(opt => (
                    <button
                       key={opt.value}
                       onClick={() => { setShowSnoozeMenu(false); handleSnoozeChange(computeSnoozeUntil(opt.value)); }}
                       className="ic-menu-item justify-between"
                    >
                      <span>{opt.label}</span>
                      <span className="text-[13px] text-faint">{opt.sub}</span>
                    </button>
                  ))}
                  {ticketSnoozedUntil && (
                    <>
                      <div className="my-1.5 border-t border-line" />
                      <button
                        onClick={() => { setShowSnoozeMenu(false); handleSnoozeChange(null); }}
                        className="ic-menu-item text-red-600 dark:text-red-400"
                      >
                        <X className="w-4 h-4" /> Unsnooze
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ··· More Options Menu */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => { setShowMoreMenu(v => !v); setShowSnoozeMenu(false); }}
                className={`ic-icon-btn ${showMoreMenu ? 'bg-ink/10' : ''}`}
                title="More options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showMoreMenu && (
                <div className="ic-menu absolute top-full right-0 mt-2 w-[300px]">
                  {[
                    ...(ticket.kind !== 'issue' ? [{ icon: UserPlus, label: 'Manage participants', divider: false,
                      hint: ticket.participants?.length ? ticket.participants.join(', ') : 'CC people on your replies by email',
                      action: () => { setShowMoreMenu(false); setShowParticipants(true); } }] : []),
                    { icon: GitMerge, label: 'Merge into…', kbd: '⌘ ⇧ M', divider: false,
                      action: () => { setShowMergePanel(true); setShowMoreMenu(false); } },
                    ...((ticket.kind || 'conversation') === 'conversation' && !ticket.mergedInto ? [
                      { icon: Ticket, label: 'Convert to ticket', divider: false,
                        action: () => { setShowMoreMenu(false); setIssueDialog('convert'); } },
                    ] : []),
                    ...(ticket.kind !== 'issue' ? [
                      { icon: Wrench, label: ticket.linkedIssueId ? 'Change linked issue…' : 'Link to issue…', divider: false,
                        action: () => { setShowMoreMenu(false); setIssueDialog('link'); } },
                    ] : []),
                    { icon: Globe, label: 'New conversation', divider: true,
                      action: () => {
                        setShowMoreMenu(false);
                        setComposer({ kind: 'conversation', customer: { id: ticket.customer.id, name: ticket.customer.name, email: ticket.customer.email } });
                      } },
                    { icon: FileText, label: 'Export conversation as text', divider: false,
                      action: () => { setShowMoreMenu(false); if (token) exportAsText([ticket], token); } },
                    { icon: FileDown, label: 'Export conversation as PDF', divider: false,
                      action: () => { setShowMoreMenu(false); if (token) exportAsPdf([ticket], token); } },
                    { icon: Activity, label: 'Show conversation events', kbd: '⌘ E', divider: true, submenu: true },
                    { icon: Clock, label: 'Show timestamp in customer timezone', divider: false, checked: customerTimes,
                      hint: customerZone ? customerZone.replace(/_/g, ' ') : 'Their timezone isn’t known yet',
                      action: () => { setShowMoreMenu(false); toggleCustomerTimes(); } },
                    { icon: isBlocked ? BellOff : Ban, label: isBlocked ? 'Unblock user' : 'Block user',
                      danger: true, divider: false,
                      action: () => { setShowMoreMenu(false); toggleBlocked(); }
                    },
                  ].map((item: any, i) => (
                    <React.Fragment key={i}>
                      {item.divider && <div className="my-1.5 border-t border-line" />}
                      {item.submenu ? (
                        <div className="relative" onMouseEnter={(e) => openEventsSubmenu(e.currentTarget)}>
                          <button
                            onClick={(e) => (showEventsSubmenu ? setShowEventsSubmenu(false) : openEventsSubmenu(e.currentTarget))}
                            className={`ic-menu-item ${showEventsSubmenu ? 'bg-subtle' : ''}`}
                          >
                            <item.icon className="w-4 h-4 shrink-0 opacity-80" />
                            <span className="flex-1 truncate">{item.label}</span>
                            <span className="flex items-center gap-1 shrink-0">
                              {item.kbd.split(' ').map((k: string, ki: number) => <kbd key={ki} className="ic-kbd font-sans">{k}</kbd>)}
                            </span>
                            <ChevronRight className="w-4 h-4 text-muted" />
                          </button>
                          {showEventsSubmenu && eventsFlyoutPos && (
                            <div className="fixed z-50" style={{ top: eventsFlyoutPos.top, left: eventsFlyoutPos.left }}>
                              <div className="ic-menu w-[250px]">
                                <button onClick={toggleAllEvents} className="ic-menu-item">
                                  {allEventsOn ? <CheckSquare className="w-4 h-4 text-accent" /> : <Square className="w-4 h-4 text-muted" />}
                                  All
                                </button>
                                <div className="my-1.5 border-t border-line" />
                                {EVENT_CATEGORIES.map(cat => (
                                  <button key={cat.key} onClick={() => toggleEventCategory(cat.key)} className="ic-menu-item">
                                    {eventFilter.includes(cat.key) ? <CheckSquare className="w-4 h-4 text-accent" /> : <Square className="w-4 h-4 text-muted" />}
                                    {cat.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                      <button
                        onMouseEnter={() => setShowEventsSubmenu(false)}
                        onClick={item.action || (() => setShowMoreMenu(false))}
                        className={`ic-menu-item ${item.danger ? 'text-red-600 dark:text-red-400' : ''}`}
                        title={item.hint}
                      >
                        <item.icon className="w-4 h-4 shrink-0 opacity-80" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.checked && <Check className="w-4 h-4 shrink-0 text-accent" />}
                        {item.kbd && (
                          <span className="flex items-center gap-1 shrink-0">
                            {item.kbd.split(' ').map((k: string, ki: number) => <kbd key={ki} className="ic-kbd font-sans">{k}</kbd>)}
                          </span>
                        )}
                      </button>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            {/* Update ticket state */}
            <button
              onClick={openStateMenu}
              className="ic-icon-btn bg-link/15 text-link hover:bg-link/25"
              title={`Update ticket state (now: ${STATE_LABELS[ticket.status] || ticket.status})`}
            >
              <SendHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Ticket chips (wraps instead of overflowing) */}
        <div className="px-5 py-2.5 flex flex-wrap items-center gap-1.5 border-b border-line text-[13px] min-w-0">
          <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-subtle font-medium text-ink tabular-nums shrink-0">
            {ticket.ticketNumber}
          </span>
          <span className="inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-subtle text-ink min-w-0 max-w-[260px]">
            <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200 text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase">
              {ticket.customer.name.charAt(0) || 'G'}
            </span>
            <span className="truncate">{ticket.customer.email || 'Guest'}</span>
          </span>
          <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-subtle text-muted capitalize shrink-0">
            {ticket.category.replace('_', ' ')}
          </span>
          <button
            onClick={openStateMenu}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-subtle text-ink hover:bg-ink/10 shrink-0"
            title="Update ticket state"
          >
            <span className={`w-2 h-2 rounded-full ${
              ticket.status === 'open' ? 'bg-accent'
              : ticket.status === 'waiting' ? 'bg-red-500'
              : ticket.status === 'resolved' ? 'bg-emerald-500'
              : 'bg-faint'
            }`} />
            {STATE_LABELS[ticket.status] || ticket.status}
          </button>
          {ticket.priority === 'critical' && (
            <span className="inline-flex items-center h-7 px-2.5 rounded-full font-medium bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 shrink-0">
              Urgent
            </span>
          )}
          {ticket.priority === 'high' && (
            <span className="inline-flex items-center h-7 px-2.5 rounded-full font-medium bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 shrink-0">
              High
            </span>
          )}
          {isBlocked && (
            <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-subtle text-muted shrink-0">
              <Ban className="w-3.5 h-3.5" /> Blocked
            </span>
          )}
          {ticketSnoozedUntil && (
            <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 min-w-0">
              <AlarmClock className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Snoozed · {formatSnoozeUntil(ticketSnoozedUntil)}</span>
            </span>
          )}
        </div>

        {/* Click-outside overlay */}
        {(showMoreMenu || showSnoozeMenu) && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setShowMoreMenu(false); setShowSnoozeMenu(false); setShowEventsSubmenu(false); }}
          />
        )}
      </div>

      {/* Close message menus on outside click */}
      {msgMenu && <div className="fixed inset-0 z-20" onClick={() => setMsgMenu(null)} />}

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-28 z-[70] px-3.5 h-9 rounded-full bg-ink text-on-ink text-[13px] font-medium flex items-center gap-2 shadow-pop animate-fade-in">
          <Check className="w-4 h-4" /> {toast}
        </div>
      )}

      {/* Save as macro */}
      {macroDraft && (
        <div className="fixed inset-0 z-[60] bg-black/30 flex items-start justify-center px-4 pt-[12vh] animate-fade-in" onClick={() => setMacroDraft(null)}>
          <div className="w-full max-w-[520px] bg-surface rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Save as macro">
            <div className="flex items-center gap-2 px-5 h-14 border-b border-line">
              <BookmarkPlus className="w-[18px] h-[18px] text-muted" />
              <h3 className="text-[16px] font-semibold text-ink flex-1">Save as macro</h3>
              <button onClick={() => setMacroDraft(null)} className="ic-icon-btn-ghost" title="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div>
                <label className="ic-label">Title</label>
                <input className="ic-input" value={macroDraft.title} onChange={(e) => setMacroDraft({ ...macroDraft, title: e.target.value })} />
              </div>
              <div>
                <label className="ic-label">Shortcut</label>
                <input className="ic-input font-mono" value={macroDraft.trigger} onChange={(e) => setMacroDraft({ ...macroDraft, trigger: e.target.value.replace(/\s+/g, '-') })} />
                <p className="ic-help mt-1.5">Type this in the composer to insert the macro.</p>
              </div>
              <div>
                <label className="ic-label">Content</label>
                <textarea rows={5} className="ic-textarea" value={macroDraft.content} onChange={(e) => setMacroDraft({ ...macroDraft, content: e.target.value })} onPaste={(e) => handleFormattedPaste(e, v => setMacroDraft(d => d && { ...d, content: v }))} />
              </div>
              {macroError && <p className="text-[13px] text-red-600 dark:text-red-400">{macroError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
              <button onClick={() => setMacroDraft(null)} className="ic-btn-ghost">Cancel</button>
              <button onClick={handleSaveMacro} disabled={macroSaving} className="ic-btn-primary">{macroSaving ? 'Saving…' : 'Save macro'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Update ticket state palette */}
      {showStateMenu && (
        <div
          className="fixed inset-0 z-[60] bg-black/30 flex items-start justify-center px-4 pt-[14vh] animate-fade-in"
          onClick={() => setShowStateMenu(false)}
        >
          <div
            className="w-full max-w-[560px] bg-surface rounded-2xl shadow-pop overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Update ticket state"
          >
            <div className="flex items-center gap-2 px-3 h-14 border-b border-line">
              <button onClick={() => setShowStateMenu(false)} className="ic-icon-btn-ghost" title="Back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h3 className="text-[16px] font-semibold text-ink">Update ticket state</h3>
            </div>
            <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
              <Search className="w-4 h-4 text-faint shrink-0" />
              <input
                autoFocus
                value={stateQuery}
                onChange={(e) => { setStateQuery(e.target.value); setStateIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setStateIndex(i => Math.min(i + 1, Math.max(filteredStates.length - 1, 0))); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setStateIndex(i => Math.max(i - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); const st = filteredStates[stateIndex]; if (st) chooseState(st.status); }
                  else if (e.key === 'Escape') { e.preventDefault(); setShowStateMenu(false); }
                }}
                placeholder="Search..."
                className="flex-1 min-w-0 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
              />
            </div>
            <div className="p-2 flex flex-col gap-0.5 max-h-[50vh] overflow-y-auto">
              {filteredStates.length === 0 && (
                <div className="px-3 py-6 text-center text-[14px] text-muted">No matching state</div>
              )}
              {filteredStates.map((st, i) => {
                const isCurrent = st.status === ticket.status;
                return (
                  <button
                    key={st.status}
                    onMouseEnter={() => setStateIndex(i)}
                    onClick={() => chooseState(st.status)}
                    className={`w-full flex items-center gap-3 px-3 h-12 rounded-xl text-left transition-colors ${
                      i === stateIndex ? 'bg-subtle' : ''
                    }`}
                  >
                    <st.icon className={`w-[18px] h-[18px] shrink-0 ${st.color}`} />
                    <span className="text-[15px] text-ink truncate">{st.label}</span>
                    {isCurrent && <Check className="w-4 h-4 text-accent shrink-0" />}
                    <span className="flex-1" />
                    {st.kbd ? (
                      <span className="flex items-center gap-1 shrink-0">
                        {st.kbd.map((k, ki) => <kbd key={ki} className="ic-kbd font-sans">{k}</kbd>)}
                      </span>
                    ) : st.hint ? (
                      <span className="text-[13px] text-muted truncate hidden sm:block">{st.hint}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="px-4 h-10 flex items-center border-t border-line text-[12px] text-muted">
              ↑↓ navigate · ↵ select · esc close
            </div>
          </div>
        </div>
      )}

      {/* Double-reply guard */}
      {collision && (
        <div className="absolute inset-0 z-50 bg-ink/20 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) setCollision(null); }}>
          <div className="w-[420px] max-w-full bg-surface rounded-2xl shadow-pop border border-line p-5 flex flex-col gap-3" role="alertdialog" aria-label="Teammate is replying">
            <h3 className="text-[16px] font-semibold text-ink">
              {collision.kind === 'typing' ? `${collision.who} is typing a reply` : `${collision.who} already replied`}
            </h3>
            <p className="text-[14px] text-muted leading-relaxed">
              {collision.kind === 'typing'
                ? `${collision.who} is writing to the customer in this conversation right now. Send your reply anyway?`
                : `${collision.who} replied to the customer ${formatRelativeTime(collision.at!) === 'now' ? 'just now' : formatRelativeTime(collision.at!) + ' ago'}, after you started your draft. Check their reply before sending yours.`}
            </p>
            <div className="flex justify-end gap-2 mt-1">
              <button className="ic-btn-ghost" onClick={() => { setCollision(null); if (collision.kind === 'replied') draftStartedAtRef.current = new Date().toISOString(); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>
                {collision.kind === 'replied' ? 'Review their reply' : 'Wait'}
              </button>
              <button className="ic-btn-primary" onClick={() => { const c = collision; setCollision(null); handleSendMessage(c.text, c.files, true); }}>Send anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* Close: choose Resolved or close without resolving */}
      {showCloseDialog && ticket && (
        <CloseDialog
          currentStatus={ticket.status}
          ticketLabel={ticket.ticketNumber}
          onClose={() => setShowCloseDialog(false)}
          onPick={status => { setShowCloseDialog(false); if (status !== ticket.status) handleStatusChange(status); }}
        />
      )}

      {/* Merge: pick the primary, then confirm side by side */}
      {showMergePanel && ticket && token && (
        <MergeDialog
          conversation={ticket}
          token={token}
          meId={agent?.id}
          onClose={() => setShowMergePanel(false)}
          onMerged={primaryId => { setShowMergePanel(false); useStore.getState().setActiveConversationId(primaryId); }}
        />
      )}

      {issueDialog && ticket && token && (issueDialog === 'convert' ? (
        <ConvertToTicketDialog
          conversation={ticket}
          token={token}
          onClose={() => setIssueDialog(null)}
          onDone={updated => { setIssueDialog(null); useStore.getState().updateConversation(updated); }}
        />
      ) : (
        <LinkIssueDialog
          conversation={ticket}
          token={token}
          onClose={() => setIssueDialog(null)}
          onDone={updated => { setIssueDialog(null); useStore.getState().updateConversation(updated); }}
        />
      ))}

      {issueBroadcast && ticket && token && (
        <IssueBroadcastDialog
          issue={ticket}
          token={token}
          totalReports={issueBroadcast.total}
          openReports={issueBroadcast.open}
          resolveByDefault
          aiReady={aiStatus.configured}
          onClose={() => setIssueBroadcast(null)}
          onDone={r => { setIssueBroadcast(null); showToast(broadcastSummary(r)); }}
        />
      )}

      {showParticipants && ticket && token && (
        <ParticipantsDialog
          conversation={ticket}
          token={token}
          onClose={() => setShowParticipants(false)}
          onDone={updated => { setShowParticipants(false); useStore.getState().updateConversation(updated); }}
        />
      )}

      {/* The AI Agent is answering this conversation: say so, and let a teammate take over */}
      {ticket?.aiAgent?.state === 'active' && token && (
        <div className="w-full flex items-center gap-2 px-5 h-9 text-[13px] border-b border-line bg-violet-50 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200 shrink-0">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 truncate">The AI Agent is answering this conversation{ticket.aiAgent.replies ? ` · ${ticket.aiAgent.replies} repl${ticket.aiAgent.replies === 1 ? 'y' : 'ies'}` : ''}</span>
          {!isLight && (
            <button
              className="text-[12.5px] font-medium hover:underline shrink-0"
              onClick={async () => {
                const res = await fetch(`${BACKEND_URL}/api/tickets/${ticket.id}/ai-takeover`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) useStore.getState().updateConversation(await res.json());
              }}
            >
              Take over
            </button>
          )}
        </div>
      )}

      {/* Linked to an issue: say so before anyone starts investigating */}
      {ticket?.linkedIssueId && token && <KnownIssueBar issueId={ticket.linkedIssueId} token={token} />}

      {/* Message feed */}
      <div
        ref={feedRef}
        onScroll={e => { const el = e.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160; }}
        className={`flex-1 overflow-y-auto px-6 pt-5 ${showSuggestions ? 'pb-3' : 'pb-5'} flex flex-col gap-2.5`}
      >
        {visibleMessages.map((m, idx) => {
          // Conversation event row (status, assignment, priority, ...)
          if (isEvent(m)) {
            const cat = EVENT_CATEGORIES.find(c => c.key === m.metadata?.category) || EVENT_CATEGORIES[EVENT_CATEGORIES.length - 1];
            return (
              <div key={m.id} id={`msg-${m.id}`} className="flex items-start gap-3 text-[13px] text-muted py-0.5 -mx-1">
                <TimeHover iso={m.createdAt} className="w-9 shrink-0 text-right tabular-nums text-faint">
                  {formatRelativeTime(m.createdAt)}
                </TimeHover>
                <cat.icon className="w-4 h-4 shrink-0 mt-px" />
                <span className="min-w-0 break-words">{renderEventText(m)}</span>
              </div>
            );
          }

          // This ticket was merged into another: "You merged this ticket into #123"
          if (m.metadata?.type === 'merged_indicator') {
            const by = m.sender.id === agent?.id ? 'You' : m.sender.name;
            const targetId = m.metadata.mergedIntoConversationId;
            return (
              <div key={m.id} id={`msg-${m.id}`} className="flex items-center gap-3 text-[13px] text-muted py-0.5 -mx-1">
                <TimeHover iso={m.createdAt} className="w-9 shrink-0 text-right tabular-nums text-faint">
                  {formatRelativeTime(m.createdAt)}
                </TimeHover>
                <GitMerge className="w-4 h-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {by} merged this ticket into{' '}
                  <button onClick={() => targetId && useStore.getState().setActiveConversationId(targetId)} className="text-blue-600 dark:text-blue-400 hover:underline">
                    #{String(m.metadata.mergedIntoTicketNumber || '').replace(/^#/, '')}
                  </button>
                </span>
              </div>
            );
          }

          // Check if this message is a merge event
          if (m.metadata?.type === 'merge') {
            const { mergeDetails } = m.metadata;
            return (
              <div 
                key={m.id}
                className="w-full flex justify-center my-3 select-none"
              >
                <div className="ic-card p-5 max-w-xl w-full flex flex-col gap-3.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-ink text-[14px] leading-snug">
                      {mergeDetails.mergedBy} merged #{String(mergeDetails.sourceTicketNumber || '').replace(/^#/, '')} into this conversation
                    </span>
                    <span className="text-muted text-[14px]">
                      chat with {mergeDetails.customerName} from {mergeDetails.customerLocation}
                    </span>
                  </div>

                  {mergeDetails.question && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[13px] text-muted font-medium">Question</span>
                      <p className="text-[14px] text-ink leading-relaxed">
                        {mergeDetails.question}
                      </p>
                    </div>
                  )}

                  {mergeDetails.summary && mergeDetails.summary.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[13px] text-muted font-medium">Summary</span>
                      <ul className="text-[14px] text-ink flex flex-col gap-1.5">
                        {mergeDetails.summary.map((bullet: string, idx: number) => (
                          <li key={idx} className="flex items-start gap-2.5">
                            <span className="w-1.5 h-1.5 bg-faint rounded-full mt-2 shrink-0" />
                            <span className="leading-normal">{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-1">
                    <button 
                      onClick={() => useStore.getState().setViewingMergedConversationId(mergeDetails.sourceConversationId)}
                      className="ic-btn-primary ic-btn-sm"
                    >
                      View conversation
                    </button>
                    <TimeHover iso={m.createdAt} className="text-[12px] text-faint">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(customerTimes && customerZone ? { timeZone: customerZone } : {}) })}
                    </TimeHover>
                  </div>
                </div>
              </div>
            );
          }

          const isCustomer = m.sender.type === 'customer';
          
          if (isCustomer) {
            const device = getDeviceInfo(m.metadata, ticket.customer.session);
            const next = visibleMessages[idx + 1];
            const deviceChangesNext = !!next && next.sender.type === 'customer' &&
              getDeviceInfo(next.metadata, ticket.customer.session).label !== device.label;
            const isLastInBlock = deviceChangesNext || idx === visibleMessages.length - 1 || 
              visibleMessages[idx + 1].sender.type !== 'customer' ||
              visibleMessages[idx + 1].isInternalNote ||
              visibleMessages[idx + 1].metadata?.type === 'merge';

            return (
              <div
                key={m.id}
                className="flex items-end gap-3 self-start max-w-[90%] xl:max-w-[80%] min-w-0 group/msg relative pl-10"
              >
                {/* Platform Avatar Icon on the Left */}
                <div className="absolute left-0 bottom-0 w-7 h-7 flex items-center justify-center">
                  {isLastInBlock && (
                    <div className="relative cursor-default select-none">
                      {/* Circle Avatar (pastel with customer initials or ID initials) */}
                      <div className="ic-avatar w-7 h-7 bg-amber-200/80 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200 text-[11px]">
                        {getInitials(m.sender.name, m.sender.id)}
                      </div>
                      
                      {/* Green online dot */}
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-surface rounded-full" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col min-w-0">
                  {/* Bubble */}
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-[14px] leading-[1.4] whitespace-pre-wrap break-words text-ink ${
                      chatColorTheme === 'classic'
                        ? 'bg-surface border border-line'
                        : 'bg-bubble-customer'
                    }`}
                  >
                    {m.content && (m.metadata?.translation && !showOriginal.has(m.id)
                      ? formatMarkdown(m.metadata.translation.text)
                      : formatMarkdown(m.content))}
                    {m.metadata?.translation && (
                      <button onClick={() => toggleOriginal(m.id)} className="mt-1.5 flex items-center gap-1 text-[12px] text-muted hover:text-ink">
                        <Languages className="w-3 h-3" />
                        {showOriginal.has(m.id) ? `Original (${m.metadata.translation.from}) · Show translation` : `Translated from ${m.metadata.translation.from} · Show original`}
                      </button>
                    )}
                    
                    {/* File Attachments */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2.5">
                        {m.attachments.map((a, aIdx) => (
                          <a
                            key={aIdx}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2.5 p-2 rounded-xl border border-line bg-surface text-[13px] text-ink hover:bg-subtle transition-colors whitespace-normal"
                          >
                            {a.type === 'image' ? (
                              <img src={a.url} alt={a.name} className="w-20 h-20 rounded-lg object-cover border border-line" />
                            ) : (
                              <Paperclip className="w-4 h-4 shrink-0 text-muted" />
                            )}
                            <div className="flex flex-col truncate">
                              <span className="truncate max-w-[180px] font-medium">{a.name}</span>
                              <span className="text-[12px] text-muted">{(a.size || 0) > 0 ? `${Math.round(a.size! / 1024)} KB` : ''}</span>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted ml-auto" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Relative timestamp details shown at the bottom of the last message in block */}
                    {isLastInBlock && (
                      <div className="flex items-center gap-1 mt-1.5 text-[13px] text-muted select-none relative group/tooltip cursor-pointer w-fit whitespace-normal">
                        <DeviceIcon info={device} />
                        <span>
                          {formatRelativeTime(m.createdAt)}
                        </span>

                        {/* Hover Tooltip Details */}
                        <div className="absolute left-0 top-[16px] pt-2.5 hidden group-hover/tooltip:block z-50">
                          <div className="bg-surface border border-line p-3.5 rounded-xl shadow-pop text-[13px] text-ink min-w-[260px] text-left">
                            <div className="flex items-center justify-between gap-3 mb-2.5 pb-2.5 border-b border-line">
                              <span className="text-[14px] font-medium text-ink whitespace-nowrap">{longTimestamp(m.createdAt)}</span>
                              <button
                                onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(longTimestamp(m.createdAt)).catch(() => {}); }}
                                className="ic-icon-btn-ghost w-7 h-7 shrink-0"
                                title="Copy date and time"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {/* The page of your website they wrote from (none inside a mobile app or a direct Messenger link) */}
                            {device.sourceUrl && (
                              <>
                                <div className="text-[12px] text-muted font-medium mb-1">Page on your website</div>
                                <a
                                  href={device.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ic-link block truncate mb-2"
                                >
                                  {device.sourceUrl}
                                </a>
                              </>
                            )}
                            <div className="flex items-center gap-2 font-medium text-ink mb-1.5">
                              <DeviceIcon info={device} className="w-4 h-4" />
                              {device.label}
                            </div>
                            <div className="text-[13px] text-ink leading-relaxed">
                              <span className="text-muted">Platform:</span> {device.platform === 'ios' ? 'iOS' : device.platform === 'android' ? 'Android' : 'Web'} {device.channel === 'app' ? 'app' : 'browser'}<br />
                              <span className="text-muted">Browser:</span> {device.browser || 'Unknown'}<br />
                              <span className="text-muted">OS:</span> {device.os || 'Unknown'}<br />
                              <span className="text-muted">Time:</span> {new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          const isLastAgentInBlock = idx === visibleMessages.length - 1 ||
            visibleMessages[idx + 1].sender.type !== 'agent' ||
            visibleMessages[idx + 1].sender.id !== m.sender.id ||
            !!visibleMessages[idx + 1].isInternalNote !== !!m.isInternalNote ||
            visibleMessages[idx + 1].metadata?.type === 'merge';
          const menuOpenHere = msgMenu?.id === m.id;
          const q = msgMenuQuery.trim().toLowerCase();
          const messageActions = [
            { key: 'tag', label: 'Add tag', icon: TagIcon, run: () => openMsgMenu(m.id, 'tags') },
            { key: 'react', label: 'Add reaction', icon: SmilePlus, run: () => openMsgMenu(m.id, 'react') },
            { key: 'link', label: 'Copy link', icon: Link2, run: () => { setMsgMenu(null); handleCopyMessageLink(m); } },
            ...(m.content ? [{ key: 'macro', label: 'Save as macro', icon: BookmarkPlus, run: () => { setMsgMenu(null); startSaveAsMacro(m); } }] : []),
          ].filter(act => act.label.toLowerCase().includes(q));
          const showDelete = 'delete'.includes(q);
          const tagMatches = allTags.filter(t => t.name.toLowerCase().includes(q));
          const canCreateTag = q.length > 0 && !allTags.some(t => t.name.toLowerCase() === q);

          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={`flex items-end gap-2.5 self-end max-w-[94%] xl:max-w-[85%] min-w-0 group relative ${menuOpenHere ? 'z-30' : ''}`}
            >
              <div className="flex flex-col items-end min-w-0 relative">
                {/* Message box */}
                <div
                  className={`px-4 py-2.5 rounded-2xl text-[14px] leading-[1.4] whitespace-pre-wrap break-words text-ink transition-shadow ${
                    m.isInternalNote
                      ? 'bg-note border border-note-line'
                      : chatColorTheme === 'classic'
                        ? 'bg-surface border border-line'
                        : 'bg-bubble-agent'
                  } relative ${highlightMsgId === m.id ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''}`}
                >
                  {/* Render indicators for internal note */}
                  {m.isInternalNote && (
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink/70 mb-1">
                      {m.metadata?.type === 'ai_summary'
                        ? <><Sparkles className="w-3.5 h-3.5 text-accent" /> AI summary · internal</>
                        : m.metadata?.side
                          ? <><Mail className="w-3.5 h-3.5" /> Side conversation #{m.metadata.side.number} · {m.metadata.side.direction === 'in' ? 'from' : 'to'} {m.metadata.side.address}</>
                          : m.metadata?.participant
                            ? <><Mail className="w-3.5 h-3.5" /> Participant's email · internal</>
                            : <><Lock className="w-3.5 h-3.5" /> Internal note</>}
                    </div>
                  )}

                  {/* Markdown parser content */}
                  {m.content && (m.metadata?.original && showOriginal.has(m.id) ? formatMarkdown(m.metadata.original.text) : formatMarkdown(m.content))}
                  {m.metadata?.original && (
                    <button onClick={() => toggleOriginal(m.id)} className="mt-1.5 flex items-center gap-1 text-[12px] text-muted hover:text-ink">
                      <Languages className="w-3 h-3" />
                      {showOriginal.has(m.id) ? `What you wrote (${m.metadata.original.language}) · Show what was sent` : 'Sent translated · Show what you wrote'}
                    </button>
                  )}
                  {/* AI Agent answers: label, confidence and the articles it used */}
                  {m.metadata?.type === 'ai_agent' && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                      <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-accent" /> AI Agent{typeof m.metadata.confidence === 'number' ? ` · ${Math.round(m.metadata.confidence * 100)}% sure` : ''}{m.metadata.handoff ? ' · handed over' : ''}</span>
                      {(m.metadata.sources || []).map((src: { id: string; title: string }) => (
                        <span key={src.id} className="ic-badge text-[11.5px] truncate max-w-[200px]" title={src.title}>{src.title}</span>
                      ))}
                    </div>
                  )}

                  {/* File Attachments */}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-col gap-2 mt-2.5">
                      {m.attachments.map((a, aIdx) => (
                        <a
                          key={aIdx}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center gap-2.5 p-2 rounded-xl border text-[13px] text-ink transition-colors whitespace-normal ${
                            m.isInternalNote
                              ? 'bg-surface/60 border-note-line hover:bg-surface'
                              : 'bg-surface/70 border-line hover:bg-surface'
                          }`}
                        >
                          {a.type === 'image' ? (
                            <img src={a.url} alt={a.name} className="w-20 h-20 rounded-lg object-cover border border-line" />
                          ) : (
                            <Paperclip className="w-4 h-4 shrink-0 text-muted" />
                          )}
                          <div className="flex flex-col truncate">
                            <span className="truncate max-w-[180px] font-medium">{a.name}</span>
                            <span className="text-[12px] text-muted">{(a.size || 0) > 0 ? `${Math.round(a.size! / 1024)} KB` : ''}</span>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted ml-auto" />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Meta line: "Not seen • Now" (Intercom style); sender shown on the avatar */}
                  <div className="flex items-center justify-end gap-1.5 mt-1 text-[13px] text-muted whitespace-nowrap">
                    {m.isInternalNote ? (
                      <span className="truncate">{m.sender.name}</span>
                    ) : m.metadata?.type === 'auto_reply' ? (
                      <span className="flex items-center gap-1" title="Sent automatically when the customer started the conversation (Settings > Office hours)">
                        <Bot className="w-3.5 h-3.5" /> Automated
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1 ${m.seen ? 'text-link' : ''}`} title={m.seen && m.seenAt ? `Seen ${new Date(m.seenAt).toLocaleString()}` : 'Delivered, not seen yet'}>
                        {m.seen && <CheckCheck className="w-3.5 h-3.5" />}
                        {m.seen ? 'Seen' : 'Not seen'}
                      </span>
                    )}
                    <span className="text-faint">•</span>
                    <TimeHover iso={m.createdAt}>
                      {(() => { const r = formatRelativeTime(m.createdAt); return r === 'now' ? 'Now' : r; })()}
                    </TimeHover>
                  </div>

                  {/* Hover toolbar: … / save as macro / tag. Hangs off the bottom-left edge (Intercom style) so the
                      "Seen • Now" time on the right stays visible and hoverable */}
                  <div className={`absolute -bottom-5 -left-5 flex items-center gap-0.5 bg-surface border border-line rounded-full shadow-card p-0.5 transition-opacity z-10 ${
                    menuOpenHere ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                  }`}>
                    <button onClick={() => openMsgMenu(m.id, 'actions')} className={`w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-subtle ${msgMenu?.id === m.id && msgMenu.kind === 'actions' ? 'bg-subtle' : ''}`} title="More actions">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {m.content && (
                      <button onClick={() => startSaveAsMacro(m)} className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-subtle" title="Save as macro">
                        <CopyPlus className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => openMsgMenu(m.id, 'tags')} className={`w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-subtle ${msgMenu?.id === m.id && msgMenu.kind === 'tags' ? 'bg-subtle' : ''}`} title="Add tag">
                      <TagIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Message tags */}
                {m.tags && m.tags.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1 mt-4 max-w-full">
                    {m.tags.map(tn => {
                      const color = allTags.find(t => t.name === tn)?.color;
                      return (
                        <span key={tn} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-subtle text-[12px] font-medium text-ink">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color || 'rgb(var(--ic-faint))' }} />
                          {tn}
                          <button
                            onClick={() => handleToggleMessageTag(m, tn)}
                            className="w-4 h-4 inline-flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-ink/10"
                            title={`Remove tag ${tn}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Reactions facepile */}
                {m.reactions && m.reactions.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {m.reactions.map((r, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleReactionToggle(m.id, r.emoji)}
                        className="bg-surface hover:bg-subtle border border-line h-6 px-2 rounded-full text-[13px] flex items-center gap-1 transition-colors"
                        title={`Added by ${r.agentName}`}
                      >
                        <span>{r.emoji}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Action menu / tag picker / reactions popover */}
                {menuOpenHere && (
                  <div className={`ic-menu absolute right-0 w-72 py-0 overflow-hidden animate-fade-in ${idx >= visibleMessages.length - 2 ? 'bottom-full mb-2' : 'top-full mt-5'}`}>
                    {msgMenu!.kind === 'react' ? (
                      <div className="flex items-center gap-1 p-2">
                        {['👍', '❤️', '😊', '💡', '🎉', '🙏'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => { handleReactionToggle(m.id, emoji); setMsgMenu(null); }}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-subtle text-[18px]"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-line">
                          <Search className="w-4 h-4 text-faint shrink-0" />
                          <input
                            autoFocus
                            value={msgMenuQuery}
                            onChange={(e) => setMsgMenuQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setMsgMenu(null);
                              if (e.key === 'Enter' && msgMenu!.kind === 'tags') {
                                const exact = tagMatches[0]?.name || (canCreateTag ? msgMenuQuery.trim() : '');
                                if (exact) handleToggleMessageTag(m, exact);
                              }
                              if (e.key === 'Enter' && msgMenu!.kind === 'actions' && messageActions[0]) messageActions[0].run();
                            }}
                            placeholder={msgMenu!.kind === 'tags' ? 'Search or create a tag...' : 'Search actions...'}
                            className="flex-1 min-w-0 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
                          />
                        </div>

                        {msgMenu!.kind === 'actions' ? (
                          <div className="py-1.5">
                            {messageActions.map(act => (
                              <button key={act.key} onClick={act.run} className="ic-menu-item">
                                <act.icon className="w-4 h-4" />
                                {act.label}
                              </button>
                            ))}
                            {showDelete && (
                              <>
                                {messageActions.length > 0 && <div className="my-1.5 border-t border-line" />}
                                <button
                                  onClick={() => { setMsgMenu(null); handleMessageDelete(m.id); }}
                                  className="ic-menu-item text-red-600 dark:text-red-400"
                                >
                                  <XCircle className="w-4 h-4" /> Delete
                                </button>
                              </>
                            )}
                            {messageActions.length === 0 && !showDelete && (
                              <div className="px-3.5 py-3 text-[13px] text-muted">No matching actions</div>
                            )}
                          </div>
                        ) : (
                          <div className="py-1.5 max-h-64 overflow-y-auto">
                            {tagMatches.map(t => {
                              const applied = (m.tags || []).includes(t.name);
                              return (
                                <button key={t.id} onClick={() => handleToggleMessageTag(m, t.name)} className="ic-menu-item">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                  <span className="flex-1 truncate">{t.name}</span>
                                  {applied && <Check className="w-4 h-4 text-accent" />}
                                </button>
                              );
                            })}
                            {canCreateTag && (
                              <button onClick={() => handleToggleMessageTag(m, msgMenuQuery)} className="ic-menu-item">
                                <Plus className="w-4 h-4 text-muted" />
                                <span className="truncate">Create tag "<span className="font-medium">{msgMenuQuery.trim()}</span>"</span>
                              </button>
                            )}
                            {tagMatches.length === 0 && !canCreateTag && (
                              <div className="px-3.5 py-3 text-[13px] text-muted">No tags yet — type to create one</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Agent avatar on the right (last message of a block) */}
              {isLastAgentInBlock ? (
                <div className="relative shrink-0 mb-0.5" title={m.sender.name}>
                  {m.sender.id === 'bot' ? (
                    <div className="w-7 h-7 rounded-full bg-ink text-on-ink flex items-center justify-center"><Bot className="w-4 h-4" /></div>
                  ) : m.sender.avatar ? (
                    <img src={m.sender.avatar} alt={m.sender.name} className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-subtle text-ink/80 text-[11px] font-semibold flex items-center justify-center">
                      {getInitials(m.sender.name, m.sender.id)}
                    </div>
                  )}
                  {m.sender.id === agent?.id && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-surface" />
                  )}
                </div>
              ) : (
                <div className="w-7 shrink-0" />
              )}
            </div>
          );
        })}

        {/* Customer typing */}
        {customerTyping && (
          <div className="self-start flex flex-col items-start max-w-[65%] pl-10">
            <span className="text-[13px] text-muted mb-1">{ticket.customer.name} typing</span>
            <div className="bg-bubble-customer px-4 py-3.5 rounded-2xl flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-faint rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-faint rounded-full typing-dot" />
              <span className="w-1.5 h-1.5 bg-faint rounded-full typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* A merged ticket is read-only: continue in the primary */}
      {mergedInto ? (
        <div className="shrink-0 px-4 pb-4 pt-1">
          <MergedBanner onGo={() => useStore.getState().setActiveConversationId(mergedInto.id)} />
        </div>
      ) : (
      /* Composer Panel */
      <div className="shrink-0 px-4 pb-4 pt-1 relative">
        {/* Saved replies trigger selector popup */}
        {/* @mention picker (notes) */}
        {isInternal && mentionQuery !== null && mentionMatches.length > 0 && (
          <div className="ic-menu absolute bottom-full left-4 mb-2 w-72 flex flex-col" role="listbox" aria-label="Mention a teammate">
            <div className="px-3.5 pt-1 pb-2 text-[13px] font-medium text-muted">Mention a teammate</div>
            {mentionMatches.map((t, i) => (
              <button
                key={t.id}
                role="option"
                aria-selected={i === mentionIndex}
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={e => { e.preventDefault(); insertMention(t); }}
                className={`ic-menu-item ${i === mentionIndex ? 'bg-subtle' : ''}`}
              >
                <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100 text-[11px] font-semibold flex items-center justify-center uppercase shrink-0">{t.name.charAt(0)}</span>
                <span className="flex-1 min-w-0 truncate">{t.name}{t.id === agent?.id ? ' (you)' : ''}</span>
              </button>
            ))}
          </div>
        )}

        {/* AI suggested replies while the customer is waiting */}
        {showSuggestions && suggestions && (
          // In the layout (not floating over the messages): sits just above the reply box
          <div className="mt-0.5 mb-2 px-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted shrink-0"><Sparkles className="w-3.5 h-3.5 text-accent" /> Suggested</span>
            {suggestions.replies.map((r, i) => (
              <button key={i} title={r} onClick={() => { setInputText(r); setTimeout(() => composerRef.current?.focus(), 0); }}
                className="max-w-[260px] shrink-0 truncate h-8 px-3 rounded-full border border-line bg-surface text-[13px] text-ink hover:bg-subtle shadow-sm">
                {r}
              </button>
            ))}
          </div>
        )}

        {(pendingMacro || macroNotice) && !showReplies && mentionQuery === null && (
          <div className="absolute bottom-full left-4 right-4 mb-2 flex justify-start pointer-events-none">
            {pendingMacro ? (
              <div className="pointer-events-auto inline-flex items-center gap-2 max-w-full rounded-full border border-line bg-surface shadow-sm pl-3 pr-1.5 h-8 text-[13px]">
                <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="truncate text-ink"><span className="font-medium">On send:</span> {describeMacroActions(pendingMacro.actions, teammates).join(' · ')}</span>
                <button onClick={() => setPendingMacro(null)} title="Don't run these actions" className="w-5 h-5 rounded-full flex items-center justify-center text-muted hover:bg-subtle hover:text-ink shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : macroNotice && (
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 h-8 text-[13px] shadow-sm ${macroNotice.error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' : 'border-line bg-surface text-ink'}`}>
                <Zap className="w-3.5 h-3.5 text-amber-500" /> {macroNotice.text}
              </div>
            )}
          </div>
        )}

        {showReplies && (
          <div className="ic-menu absolute bottom-full left-4 mb-2 w-80 flex flex-col">
            <div className="px-3.5 pt-1 pb-2 text-[13px] font-medium text-muted">
              Saved replies
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredReplies.map(r => (
                <button
                  key={r.id}
                  onClick={() => selectSavedReply(r)}
                  className="ic-menu-item h-auto py-2 flex-col items-start gap-0"
                >
                  <div className="font-semibold text-ink flex items-center gap-1.5">{r.trigger}{hasMacroActions(r) && <Zap className="w-3 h-3 text-amber-500" aria-label="Has actions" />}</div>
                  <div className="truncate w-full text-[13px] text-muted">{r.title}{hasMacroActions(r) ? ` · ${describeMacroActions(r.actions, teammates).join(', ')}` : ''}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Emoji selection popup */}
        {showEmoji && (
          <div className="ic-menu min-w-0 absolute bottom-full left-4 mb-2 px-1.5 flex gap-0.5">
            {['👍', '👋', '❤️', '😊', '💡', '🎉'].map(emoji => (
              <button
                key={emoji}
                onClick={() => handleEmojiSelect(emoji)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-xl hover:bg-subtle transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className={`rounded-2xl border shadow-card transition-colors ${
          isInternal 
            ? 'bg-note border-note-line' 
            : 'bg-surface border-line'
        }`}>
          {/* Composer options */}
          <div className="flex justify-between items-center gap-3 px-3 pt-3">
            {/* Public Reply vs Internal Note mode switch */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => !isLight && setIsInternal(false)}
                disabled={isLight}
                title={isLight ? 'Light seats can add internal notes but not reply to customers' : undefined}
                className={`flex items-center gap-1.5 h-7 px-2.5 text-[14px] rounded-full transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  !isInternal
                    ? 'font-semibold text-ink bg-subtle'
                    : 'font-medium text-muted hover:text-ink hover:bg-ink/[0.05]'
                }`}
              >
                <CornerUpLeft className="w-4 h-4" /> Reply
              </button>
              <button
                onClick={() => setIsInternal(true)}
                className={`flex items-center gap-1.5 h-7 px-2.5 text-[14px] rounded-full transition-colors ${
                  isInternal
                    ? 'font-semibold text-ink bg-note-line/70'
                    : 'font-medium text-muted hover:text-ink hover:bg-ink/[0.05]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" /> Note
              </button>
            </div>

            <div className="text-[12px] text-faint flex items-center gap-1.5 min-w-0 whitespace-nowrap overflow-hidden">
              {isLight ? 'Light seat · internal notes only'
                : !isInternal && aiStatus.features.translation && ticket.language ? (
                  <button onClick={() => setTranslateOut(v => !v)} className={`inline-flex items-center gap-1.5 truncate rounded-full px-2 h-6 ${translateOut ? 'bg-subtle text-ink' : 'text-muted line-through'}`}
                    title={translateOut ? `Your reply is translated into ${ticket.language} before it's sent. Click to send as written.` : 'Click to translate your reply again'}>
                    <Languages className={`w-3.5 h-3.5 ${translating ? 'animate-pulse' : ''}`} /> {translating ? `Translating to ${ticket.language}…` : translateOut ? `Sending in ${ticket.language}` : `Translate to ${ticket.language}`}
                  </button>
                )
                : ticket.channel === 'email' && !isInternal && ticket.email?.address ? <span className="inline-flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5" /> Replies are emailed to {ticket.email.address}</span>
                : <>Type <kbd className="ic-kbd font-sans">/</kbd> for saved replies</>}
            </div>
          </div>

          {/* Text Area Input */}
          <RichComposer
            ref={composerRef}
            value={inputText}
            onChange={handleInputChange}
            onPasteFiles={stageFiles}
            placeholder={isInternal ? 'Add an internal note — only teammates can see this' : 'Write a reply…'}
            className="block w-full bg-transparent px-4 pt-2 pb-1 min-h-[52px] max-h-[180px] text-[15px] leading-relaxed text-ink focus:outline-none"
          />

          {/* Staged attachments (sent together with the text) */}
          {(pendingAttachments.length > 0 || uploading) && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {pendingAttachments.map((a, i) => (
                <div key={`${a.url}-${i}`} className="relative group/att">
                  {a.type === 'image' ? (
                    <img src={a.url} alt={a.name} className="w-16 h-16 rounded-lg object-cover border border-line" />
                  ) : (
                    <div className="h-16 max-w-[180px] px-3 rounded-lg border border-line bg-subtle flex items-center gap-2 text-[13px] text-ink">
                      <Paperclip className="w-4 h-4 text-muted shrink-0" />
                      <span className="truncate">{a.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-on-ink flex items-center justify-center shadow-pop"
                    title={`Remove ${a.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="w-16 h-16 rounded-lg border border-dashed border-line flex items-center justify-center text-[12px] text-muted">
                  Uploading…
                </div>
              )}
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <div className="flex items-center gap-0.5">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                multiple
                accept="image/*,application/pdf"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="ic-icon-btn-ghost disabled:opacity-40"
                title="Attach Files"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className={`ic-icon-btn-ghost ${showEmoji ? 'bg-ink/[0.06] text-ink' : ''}`}
                title="Add Emoji"
              >
                <Smile className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => handleSendMessage()}
              disabled={(!inputText.trim() && pendingAttachments.length === 0) || uploading || translating}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[14px] font-semibold text-ink hover:bg-ink/[0.06] disabled:text-faint disabled:pointer-events-none transition-colors"
            >
              {isInternal ? 'Add note' : translating ? 'Translating…' : 'Send'}
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
    </TimeZoneContext.Provider>
  );
};

export default ChatWindow;
