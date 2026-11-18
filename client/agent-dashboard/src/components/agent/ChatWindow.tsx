import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment, SavedReply } from '../../../../../shared/src/types';
import { 
  Send, Paperclip, Smile, CheckCheck, Check, 
  Lock, Globe, ExternalLink, Star, MoreHorizontal,
  Clock, GitMerge, Ban, UserPlus, FileText, FileDown,
  Activity, AlarmClock, X, BellOff, MessageSquare, CornerUpLeft,
  SendHorizontal, Hourglass, CheckCircle2, Inbox as InboxIcon, Archive, ArrowLeft, Search, CircleDot,
  Tag as TagIcon, Link2, BookmarkPlus, CopyPlus, SmilePlus, XCircle, Plus,
  ChevronRight, UserCheck, ArrowUpDown, SlidersHorizontal, Ticket, MoreVertical, Square, CheckSquare, Bot
} from 'lucide-react';
import { ConversationEventCategory } from '../../../../../shared/src/types';
import { getDeviceInfo, DeviceIcon } from '../../lib/device';
import { exportAsText, exportAsPdf } from '../../lib/exportConversations';
import { useSnoozeOptions } from '../../lib/useSnoozeOptions';
import { computeSnoozeUntil, isSnoozed, formatSnoozeUntil } from '../../lib/snooze';
import { RichText, handleFormattedPaste } from '../../lib/richText';
import RichComposer, { RichComposerHandle } from './RichComposer';

// Ticket states offered by the "Update ticket state" palette (values are the existing statuses)
const TICKET_STATES: {
  status: string; label: string; hint?: string; kbd?: string[];
  icon: React.ElementType; color: string;
}[] = [
  { status: 'open', label: 'In progress', hint: 'Keep working on it', icon: CircleDot, color: 'text-accent' },
  { status: 'waiting', label: 'Waiting on customer', hint: 'Moves back to In progress when they reply', icon: Hourglass, color: 'text-red-500' },
  { status: 'resolved', label: 'Resolved', hint: 'The problem is solved', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
  { status: 'closed', label: 'Close', kbd: ['⌘', '⇧', 'Y'], icon: InboxIcon, color: 'text-ink' },
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


export const ChatWindow: React.FC = () => {
  const snoozeOptions = useSnoozeOptions();
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

  const moreMenuRef = useRef<HTMLDivElement>(null);
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<RichComposerHandle>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Derived state
  const isStarred = ticket?.starred || false;

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
  const handleInputChange = (val: string) => {
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

  const handleSendMessage = async (textToSend?: string, filesArg?: Attachment[]) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    // Sending from the composer includes any staged attachments
    const files = filesArg ?? (textToSend === undefined ? pendingAttachments : undefined);
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
        if (textToSend === undefined) {
          setInputText('');
          setPendingAttachments([]);
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
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  const chooseState = (status: string) => {
    setShowStateMenu(false);
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.status]);

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
  const visibleMessages = messages.filter(m => !isEvent(m) || eventFilter.includes(m.metadata?.category || 'other'));
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

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col relative">
      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <div className="flex flex-col shrink-0 bg-surface">
        
        {/* Row 1: Title & Main Actions */}
        <div className="ic-panel-header justify-between gap-3">
          <h2 className="ic-title flex-1 min-w-0" title={ticketTitle}>{ticketTitle}</h2>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
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
                    { icon: UserPlus, label: 'Manage participants', divider: false },
                    { icon: GitMerge, label: 'Merge into…', kbd: '⌘ ⇧ M', divider: false,
                      action: () => { setShowMergePanel(true); setShowMoreMenu(false); } },
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
                    { icon: Clock, label: 'Show timestamp in customer timezone', divider: false },
                    { icon: isBlocked ? BellOff : Ban, label: isBlocked ? 'Unblock user' : 'Block user',
                      danger: true, divider: false,
                      action: () => { setIsBlocked(v => !v); setShowMoreMenu(false); }
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
                      >
                        <item.icon className="w-4 h-4 shrink-0 opacity-80" />
                        <span className="flex-1 truncate">{item.label}</span>
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

      {/* Merge Panel overlay */}
      {showMergePanel && (
        <div className="absolute inset-0 bg-ink/20 z-50 flex items-center justify-center select-none">
          <div className="bg-surface border border-line rounded-2xl shadow-pop p-6 w-[420px] flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-semibold text-ink flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-muted" /> Merge conversation into…
              </h3>
              <button onClick={() => { setShowMergePanel(false); setSelectedTargetId(null); }} className="ic-icon-btn-ghost">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-[14px] text-muted leading-relaxed">
              Consolidate messages from ticket <span className="font-semibold text-ink">{ticket?.ticketNumber}</span> into another active ticket from <span className="font-semibold text-ink">{ticket?.customer.name}</span>.
            </p>

            <input
              type="text"
              value={mergeSearchText}
              onChange={(e) => setMergeSearchText(e.target.value)}
              placeholder="Search by ticket # or category…"
              className="ic-input"
            />

            <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
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
                      className={`w-full flex flex-col gap-1 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                        isSelected
                          ? 'border-ink/60 bg-subtle text-ink'
                          : 'border-line bg-surface hover:bg-subtle text-ink'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-semibold text-[14px]">{dt.ticketNumber}</span>
                        <span className="ic-badge capitalize">{dt.status}</span>
                      </div>
                      <span className="text-[12px] text-muted capitalize">{dt.category} • Priority: {dt.priority}</span>
                      <p className="text-[13px] text-muted truncate">{dt.lastMessageSnippet || 'No messages yet'}</p>
                    </button>
                  );
                })}

              {duplicateTickets.length === 0 && (
                <div className="text-[14px] text-muted text-center py-8 rounded-xl border border-dashed border-line">No other open tickets found for this user.</div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-1">
              <button 
                onClick={() => { setShowMergePanel(false); setSelectedTargetId(null); }} 
                className="ic-btn-ghost"
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
                className="ic-btn-primary"
              >
                {mergeConfirmLoading ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message feed */}
      <div className="flex-1 overflow-y-auto px-8 py-8 flex flex-col gap-4">
        {visibleMessages.map((m, idx) => {
          // Conversation event row (status, assignment, priority, ...)
          if (isEvent(m)) {
            const cat = EVENT_CATEGORIES.find(c => c.key === m.metadata?.category) || EVENT_CATEGORIES[EVENT_CATEGORIES.length - 1];
            return (
              <div key={m.id} id={`msg-${m.id}`} className="flex items-start gap-3 text-[13px] text-muted py-0.5 -mx-1">
                <span className="w-9 shrink-0 text-right tabular-nums text-faint" title={new Date(m.createdAt).toLocaleString()}>
                  {formatRelativeTime(m.createdAt)}
                </span>
                <cat.icon className="w-4 h-4 shrink-0 mt-px" />
                <span className="min-w-0 break-words">{renderEventText(m)}</span>
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
                      {mergeDetails.mergedBy} merged #{mergeDetails.sourceTicketNumber} into this conversation
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
                    <span className="text-[12px] text-faint">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
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
                    className={`px-4 py-2.5 rounded-2xl text-[14px] leading-[1.55] whitespace-pre-wrap break-words text-ink ${
                      chatColorTheme === 'classic'
                        ? 'bg-surface border border-line'
                        : 'bg-bubble-customer'
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
                            <div className="text-[12px] text-muted font-medium mb-1">Source URL</div>
                            {device.sourceUrl ? (
                              <a 
                                href={device.sourceUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="ic-link block truncate mb-2"
                              >
                                {device.sourceUrl}
                              </a>
                            ) : (
                              <div className="text-faint mb-2">Unknown</div>
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
                  className={`px-4 py-2.5 rounded-2xl text-[14px] leading-[1.55] whitespace-pre-wrap break-words text-ink transition-shadow ${
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
                      <Lock className="w-3.5 h-3.5" /> Internal note
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
                    <span title={new Date(m.createdAt).toLocaleString()}>
                      {(() => { const r = formatRelativeTime(m.createdAt); return r === 'now' ? 'Now' : r; })()}
                    </span>
                  </div>

                  {/* Hover toolbar: … / save as macro / tag (Intercom style) */}
                  <div className={`absolute -bottom-3.5 right-4 flex items-center gap-0.5 bg-surface border border-line rounded-full shadow-card p-0.5 transition-opacity z-10 ${
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

      {/* Composer Panel */}
      <div className="shrink-0 px-4 pb-4 pt-1 relative">
        {/* Saved replies trigger selector popup */}
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
                  <div className="font-semibold text-ink">{r.trigger}</div>
                  <div className="truncate w-full text-[13px] text-muted">{r.title}</div>
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
                onClick={() => setIsInternal(false)}
                className={`flex items-center gap-1.5 h-7 px-2.5 text-[14px] rounded-full transition-colors ${
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
              Type <kbd className="ic-kbd font-sans">/</kbd> for saved replies
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
              disabled={(!inputText.trim() && pendingAttachments.length === 0) || uploading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[14px] font-semibold text-ink hover:bg-ink/[0.06] disabled:text-faint disabled:pointer-events-none transition-colors"
            >
              {isInternal ? 'Add note' : 'Send'}
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
