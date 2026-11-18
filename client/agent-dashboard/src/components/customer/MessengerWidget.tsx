import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment, CustomerSession } from '../../../../../shared/src/types';
import { MessageSquare, X, Send, Paperclip, Smile, ArrowLeft, Check, CheckCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = 'http://localhost:3000';

/** Read widget settings from localStorage, with fallback defaults */
function getStoredSettings() {
  try {
    const raw = localStorage.getItem('widget_settings');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    themeColor: '#8B5CF6',
    brandName: 'Chai Samosa',
    greeting: 'We reply in a few minutes',
    welcome: 'Ask us anything, or share your feedback.',
    darkTheme: false,
  };
}

const REPLY_TIME_TEXT: Record<string, string> = {
  asap: "We'll reply as soon as we can",
  minutes: 'We usually reply in a few minutes',
  hours: 'We usually reply in a few hours',
  day: 'We usually reply in a day',
};

type Availability = {
  replyTime: string | null; isOpenNow: boolean; nextOpenAt?: string;
  name?: string; showAttribution?: boolean; attributionText?: string;
  onlineAgents?: { id: string; name: string; avatar?: string }[];
};

/** "in 25 minutes", "at 9:00 AM", "tomorrow at 9:00 AM", "on Monday at 9:00 AM" */
function describeBack(iso?: string): string {
  if (!iso) return 'soon';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'soon';
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
  if (diffMin <= 1) return 'in a moment';
  if (diffMin < 60) return `in ${diffMin} minutes`;
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `at ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  if (diffMin < 7 * 24 * 60) return `on ${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

function getStoredChatTheme(): 'sky-blue' | 'classic' {
  return (localStorage.getItem('chat_color_theme') as any) || 'sky-blue';
}

/** Simple markdown bold/italic/inline-code renderer */
const formatMarkdown = (text: string) => {
  if (!text) return null;
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.1);padding:1px 4px;border-radius:4px;font-size:0.8em">$1</code>');
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="text-decoration:underline;opacity:0.85">$1</a>');
  return (
    <div
      className="leading-relaxed whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export const MessengerWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'chat'>('home');
  const [guestId, setGuestId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [localConversations, setLocalConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [agentTyping, setAgentTyping] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Files attached to the draft; sent together with the text when the customer presses Send
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  // True when the user clicked "Start New Chat" but hasn't sent a first message yet.
  // The actual ticket is created lazily on first send to avoid empty tickets.
  const [isPendingNewConv, setIsPendingNewConv] = useState(false);
  // Real geo-IP data fetched once and cached
  const [geoInfo, setGeoInfo] = useState<{
    country: string; city: string; ip: string; countryCode: string; timezone?: string;
  } | null>(null);
  // Workspace office hours / reply time (public endpoint)
  const [availability, setAvailability] = useState<Availability | null>(null);

  // ── Live theme settings (re-read whenever storage changes) ──────────────
  const [widgetSettings, setWidgetSettings] = useState(getStoredSettings);
  const [chatColorTheme, setChatColorTheme] = useState<'sky-blue' | 'classic'>(getStoredChatTheme);

  useEffect(() => {
    const onStorage = () => {
      setWidgetSettings(getStoredSettings());
      setChatColorTheme(getStoredChatTheme());
    };
    window.addEventListener('storage', onStorage);
    // Also poll every 500ms for same-tab changes (Zustand writes to localStorage)
    const interval = setInterval(onStorage, 500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, []);

  const themeColor = widgetSettings.themeColor || '#8B5CF6';

  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  /** Preview text a customer may see: the last public message, never an internal note */
  const customerPreview = (c: Conversation) =>
    c.customerSnippet ?? (c.lastMessageSnippet?.startsWith('[Note]') ? '' : c.lastMessageSnippet);

  /** Parse OS name from userAgent string */
  const parseOS = (): string => {
    const ua = navigator.userAgent;
    if (/Windows NT 10/.test(ua)) return 'Windows 10';
    if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
    if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
    if (/Windows/.test(ua)) return 'Windows';
    // iOS/iPadOS first: their user agents also contain "like Mac OS X"
    if (/iPhone OS/.test(ua)) { const m = ua.match(/iPhone OS ([\d_]+)/); return `iOS ${m?.[1]?.replace(/_/g, '.') || ''}`; }
    if (/iPad/.test(ua)) return 'iPadOS';
    if (/Android/.test(ua)) { const m = ua.match(/Android ([\d.]+)/); return `Android ${m?.[1] || ''}`; }
    if (/Mac OS X 10[_\s]15/.test(ua)) return 'macOS Catalina';
    if (/Mac OS X 10[_\s]14/.test(ua)) return 'macOS Mojave';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown OS';
  };

  /** Parse short browser name from userAgent */
  const parseBrowser = (): string => {
    const ua = navigator.userAgent;
    // iOS browsers all use WebKit but identify themselves with their own tokens
    if (/CriOS\//.test(ua)) { const m = ua.match(/CriOS\/([\d.]+)/); return `Chrome ${m?.[1]?.split('.')[0] || ''}`; }
    if (/FxiOS\//.test(ua)) { const m = ua.match(/FxiOS\/([\d.]+)/); return `Firefox ${m?.[1]?.split('.')[0] || ''}`; }
    if (/EdgiOS\//.test(ua)) { const m = ua.match(/EdgiOS\/([\d.]+)/); return `Edge ${m?.[1]?.split('.')[0] || ''}`; }
    if (/Edg[A]?\//.test(ua)) { const m = ua.match(/Edg[A]?\/([\d.]+)/); return `Edge ${m?.[1]?.split('.')[0] || ''}`; }
    if (/OPR\//.test(ua)) { const m = ua.match(/OPR\/([\d.]+)/); return `Opera ${m?.[1]?.split('.')[0] || ''}`; }
    if (/Chrome\//.test(ua)) { const m = ua.match(/Chrome\/([\d.]+)/); return `Chrome ${m?.[1]?.split('.')[0] || ''}`; }
    if (/Firefox\//.test(ua)) { const m = ua.match(/Firefox\/([\d.]+)/); return `Firefox ${m?.[1]?.split('.')[0] || ''}`; }
    if (/Safari\//.test(ua)) { const m = ua.match(/Version\/([\d.]+)/); return `Safari ${m?.[1]?.split('.')[0] || ''}`; }
    return 'Unknown Browser';
  };

  /**
   * Device the message is sent from. Native apps that embed the widget in a webview can
   * set `window.HelpDesk = { platform: 'ios' | 'android', channel: 'app' }` to be explicit.
   */
  const getDeviceMetadata = () => {
    const ua = navigator.userAgent;
    const cfg = (window as any).HelpDesk || {};
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    // In-app webviews: iOS WKWebView lacks the "Safari/" token; Android WebView adds "; wv)"
    const isWebView = isIOS ? !/Safari\//.test(ua) : isAndroid ? /; wv\)/.test(ua) : false;
    return {
      platform: cfg.platform || (isIOS ? 'ios' : isAndroid ? 'android' : 'web'),
      channel: cfg.channel || (isWebView ? 'app' : 'browser'),
      browser: parseBrowser(),
      os: isIOS && /Macintosh/.test(ua) ? 'iPadOS' : parseOS(),
      sourceUrl: window.location.href,
    };
  };

  // Initialize Guest/User
  useEffect(() => {
    const helpDeskConfig = (window as any).HelpDesk || {};
    
    // User id: a UUID v4 (e.g. 47f1664a-c15e-42fc-b74e-5046559f92db) for everyone, guest or logged in.
    // A logged-in user's own id (window.HelpDesk.userId) is sent separately as externalUserId, and the
    // server answers with the canonical User id for that person (same id on every device).
    let id = localStorage.getItem('customer_guest_id') || '';
    if (helpDeskConfig.userId) {
      localStorage.setItem('customer_external_id', String(helpDeskConfig.userId));
    }
    if (!id) {
      id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      localStorage.setItem('customer_guest_id', id);
    }
    setGuestId(id);

    // Read or set display name
    let name = localStorage.getItem('customer_guest_name') || '';
    if (helpDeskConfig.userName) {
      name = helpDeskConfig.userName;
      localStorage.setItem('customer_guest_name', name);
    } else if (!name) {
      name = `Guest #${id.slice(-4)}`;
      localStorage.setItem('customer_guest_name', name);
    }
    setGuestName(name);

    // Cache email and phone if provided by parent host app config
    if (helpDeskConfig.userEmail) {
      localStorage.setItem('customer_guest_email', helpDeskConfig.userEmail);
    }
    if (helpDeskConfig.userPhone) {
      localStorage.setItem('customer_guest_phone', helpDeskConfig.userPhone);
    }

    // Fetch geo-IP data once (cached in localStorage for 24h)
    const geoKey = 'customer_geo_info';
    const geoExpiry = 'customer_geo_expiry';
    const cachedGeo = localStorage.getItem(geoKey);
    const cachedExpiry = localStorage.getItem(geoExpiry);
    const now = Date.now();

    if (cachedGeo && cachedExpiry && now < parseInt(cachedExpiry)) {
      setGeoInfo(JSON.parse(cachedGeo));
    } else {
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(data => {
          const geo = {
            country: data.country_name || 'Unknown',
            city: data.city || '',
            ip: data.ip || '',
            countryCode: data.country_code || '',
            timezone: data.timezone || undefined,
          };
          setGeoInfo(geo);
          localStorage.setItem(geoKey, JSON.stringify(geo));
          // Cache for 24 hours
          localStorage.setItem(geoExpiry, String(now + 24 * 60 * 60 * 1000));
        })
        .catch(() => {
          // Silently fall back — geo will be null
        });
    }
  }, []);

  // Office hours + reply time: on mount, whenever the Messenger is opened, and every 5 min while open
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // Public workspace info: customer-facing name, attribution, reply time, office hours, who's online
      fetch(`${BACKEND_URL}/api/workspace/public`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!cancelled && data) setAvailability({
            replyTime: data.replyTime, isOpenNow: data.isOpenNow !== false, nextOpenAt: data.nextOpenAt,
            name: data.name, showAttribution: data.showAttribution !== false, attributionText: data.attributionText,
            onlineAgents: Array.isArray(data.onlineAgents) ? data.onlineAgents : [],
          });
        })
        .catch(() => {});
    };
    load();
    const interval = isOpen ? setInterval(load, 5 * 60 * 1000) : undefined;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [isOpen]);

  const isAway = availability ? !availability.isOpenNow : false;
  const headerSubtitle = isAway
    ? `We're away right now — back ${describeBack(availability?.nextOpenAt)}`
    : (availability?.replyTime && REPLY_TIME_TEXT[availability.replyTime]) || widgetSettings.greeting;

  // Read receipts: when the customer is looking at a conversation, mark the team's replies as seen
  // (the agent dashboard then shows "Seen" instead of "Not seen")
  useEffect(() => {
    if (!isOpen || !activeConv) return;
    const markSeen = () => {
      if (document.visibilityState !== 'visible') return;
      const hasUnseen = chatMessages.some(m => m.sender.type === 'agent' && !m.isInternalNote && !m.seen);
      if (!hasUnseen) return;
      // optimistic local update so we don't send this again for the same messages
      setChatMessages(prev => prev.map(m => (m.sender.type === 'agent' && !m.isInternalNote ? { ...m, seen: true } : m)));
      fetch(`${BACKEND_URL}/api/messages/seen/${activeConv.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'customer' })
      }).catch(() => {});
    };
    markSeen();
    document.addEventListener('visibilitychange', markSeen);
    window.addEventListener('focus', markSeen);
    return () => {
      document.removeEventListener('visibilitychange', markSeen);
      window.removeEventListener('focus', markSeen);
    };
  }, [isOpen, activeConv, chatMessages]);

  // Fetch Guest's previous conversations (stored IDs in localStorage)
  useEffect(() => {
    if (!guestId) return;

    const fetchGuestConvs = async () => {
      try {
        // IDs are stored in localStorage when tickets are created (guest has no auth token)
        const raw = localStorage.getItem(`guest_conv_ids_${guestId}`);
        const ids: string[] = raw ? JSON.parse(raw) : [];
        if (ids.length === 0) return;

        // Fetch each ticket individually via the open endpoint
        const results = await Promise.all(
          ids.map(id =>
            fetch(`${BACKEND_URL}/api/tickets/${id}`)
              .then(r => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        const convs: Conversation[] = results
          .filter(Boolean)
          .filter((c: Conversation) => c.customer.id === guestId);
        setLocalConversations(convs.sort(
          (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        ));
      } catch (err) {
        console.error('Failed to fetch customer conversations:', err);
      }
    };

    fetchGuestConvs();

    // Keep list fresh via real-time socket events
    const handleConvUpdate = (conv: Conversation) => {
      // Internal-only tickets/issues are never shown to the customer
      if (conv.kind === 'issue' || conv.sharing === 'internal') return;
      if (conv.customer.id === guestId) {
        setLocalConversations(prev => {
          const idx = prev.findIndex(c => c.id === conv.id);
          if (idx === -1) return [conv, ...prev];
          const next = [...prev];
          next[idx] = conv;
          return next.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );
        });
        if (activeConv && activeConv.id === conv.id) {
          setActiveConv(conv);
        }
      }
    };

    // Server emits 'conversation:update' and 'conversation:new'
    socket?.on('conversation:update', handleConvUpdate);
    socket?.on('conversation:new', handleConvUpdate);

    return () => {
      socket?.off('conversation:update', handleConvUpdate);
      socket?.off('conversation:new', handleConvUpdate);
    };
  }, [guestId, socket, activeConv]);

  // Load messages when entering an active conversation
  useEffect(() => {
    if (!activeConv) return;

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${activeConv.id}`);
        if (res.ok) {
          const data: Message[] = await res.json();
          setChatMessages(data.filter(m => !m.isInternalNote && m.sender?.type !== 'system'));
        }
      } catch (err) {
        console.error('Failed to fetch messages:', err);
      }
    };

    fetchMessages();

    const handleNewMessage = (msg: Message) => {
      // Never show teammates' internal notes or conversation events to the customer
      if (msg.isInternalNote || msg.sender?.type === 'system') return;
      if (msg.conversationId === activeConv.id) {
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };

    const handleTyping = ({ agentName }: { agentName: string }) => {
      setAgentTyping(agentName);
      setTimeout(() => setAgentTyping(null), 3000);
    };

    socket?.on('message:new', handleNewMessage);
    socket?.on('agent:typing', handleTyping);

    return () => {
      socket?.off('message:new', handleNewMessage);
      socket?.off('agent:typing', handleTyping);
    };
  }, [activeConv, socket]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, agentTyping]);

  // Navigate to the chat view but do NOT create the ticket yet.
  // The ticket is created lazily when the customer sends their first message.
  const startNewConversation = () => {
    setActiveConv(null);
    setChatMessages([]);
    setIsPendingNewConv(true);
    setActiveTab('chat');
  };

  const handleSendMessage = async (text?: string, attachmentsArg?: Attachment[]) => {
    const content = text ?? inputText;
    // Sending from the composer includes any attached files
    const attachments = attachmentsArg ?? (text === undefined ? pendingAttachments : []);
    if (!content.trim() && attachments.length === 0) return;
    if (uploading) return;

    setInputText('');
    if (text === undefined) setPendingAttachments([]);

    try {
      // ── Lazy ticket creation: first message creates the conversation ──────
      if (isPendingNewConv) {
        const res = await fetch(`${BACKEND_URL}/api/tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: guestId,
            externalUserId: localStorage.getItem('customer_external_id') || undefined,
            name: guestName,
            email: localStorage.getItem('customer_guest_email') || undefined,
            phone: localStorage.getItem('customer_guest_phone') || undefined,
            initialMessage: content,
            initialAttachments: attachments,
            messageMetadata: getDeviceMetadata(),
            session: {
              browser: parseBrowser(),
              os: parseOS(),
              currentPage: window.location.href,
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
              country: geoInfo ? `${geoInfo.city ? geoInfo.city + ', ' : ''}${geoInfo.country}` : undefined,
              ip: geoInfo?.ip || undefined,
              // Not on CustomerSession yet — passed through via assertion (server spreads session fields).
              timezone: geoInfo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            } as CustomerSession & { timezone?: string }
          })
        });

        if (res.ok || res.status === 210) {
          const conv: Conversation = await res.json();

          // The server decides the canonical User id (UUID). Adopt it if it differs from ours,
          // carrying over the list of this browser's conversations.
          const userId = conv.customer?.id || guestId;
          if (userId !== guestId) {
            const previous: string[] = JSON.parse(localStorage.getItem(`guest_conv_ids_${guestId}`) || '[]');
            const merged: string[] = JSON.parse(localStorage.getItem(`guest_conv_ids_${userId}`) || '[]');
            localStorage.setItem(`guest_conv_ids_${userId}`, JSON.stringify([...new Set([...merged, ...previous])]));
            localStorage.setItem('customer_guest_id', userId);
            setGuestId(userId);
          }

          // Persist conv ID so it survives page refresh (guest has no auth)
          const storageKey = `guest_conv_ids_${userId}`;
          const existing: string[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
          if (!existing.includes(conv.id)) {
            localStorage.setItem(storageKey, JSON.stringify([conv.id, ...existing]));
          }

          setLocalConversations(prev => [conv, ...prev]);
          setActiveConv(conv);
          setIsPendingNewConv(false);
          // Fetch the messages that now include the initial message
          const msgRes = await fetch(`${BACKEND_URL}/api/messages/${conv.id}`);
          if (msgRes.ok) {
            setChatMessages(await msgRes.json());
          }
        } else {
          console.error('Failed to create ticket:', await res.text());
        }
        return;
      }

      // ── Normal send to existing conversation ─────────────────────────────
      if (!activeConv) return;

      const res = await fetch(`${BACKEND_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          sender: { id: guestId, name: guestName, type: 'customer' },
          content,
          attachments: attachments || [],
          metadata: getDeviceMetadata()
        })
      });

      if (res.ok) {
        const msg: Message = await res.json();
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } else {
        console.error('Failed to send message:', await res.text());
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!isTyping) {
      setIsTyping(true);
      socket?.emit('customer:typing', { conversationId: activeConv?.id, guestName });
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 2000);
  };

  const stageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file, file.name || `screenshot-${Date.now()}.png`);
        if (activeConv) formData.append('conversationId', activeConv.id);
        const res = await fetch(`${BACKEND_URL}/api/attachments/upload`, { method: 'POST', body: formData });
        if (res.ok) {
          const attachment: Attachment = await res.json();
          setPendingAttachments(prev => [...prev, attachment]);
        }
      }
    } catch (err) {
      console.error('Failed uploading attachment:', err);
    } finally {
      setUploading(false);
    }
  };

  // Attach files to the draft — they're sent with the message, not on their own
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await stageFiles(files);
  };

  // Paste a screenshot into the message box
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const files = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); stageFiles(files); }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmoji(false);
  };

  // ── Bubble style helpers ─────────────────────────────────────────────────
  const senderBubbleStyle =
    chatColorTheme === 'sky-blue'
      ? { background: '#0284c7', color: '#fff' }
      : { background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff' };

  const recipientBubbleClass =
    chatColorTheme === 'sky-blue'
      ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
      : 'bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200';

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Messenger Screen Container */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-96 h-[550px] bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden mb-4"
          >
            {/* Header — uses themeColor */}
            <div
              className="p-6 text-white flex flex-col gap-4 relative"
              style={{ background: `linear-gradient(135deg, ${themeColor}ee, ${themeColor})` }}
            >
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                {activeTab === 'chat' && (
                  <button
                    onClick={() => { setActiveTab('home'); setIsPendingNewConv(false); }}
                    className="p-1 rounded-full hover:bg-white/10 mr-1 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div>
                  <h3 className="font-bold text-lg tracking-wide">{availability?.name || widgetSettings.brandName}</h3>
                  <p className="text-xs text-white/80 flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${isAway ? 'bg-slate-300' : 'bg-emerald-400 animate-pulse'}`} />
                    {headerSubtitle}
                  </p>
                </div>
              </div>

              {/* Teammates who are online right now (real data) */}
              {!!availability?.onlineAgents?.length && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex -space-x-2">
                    {availability.onlineAgents.slice(0, 3).map(a => a.avatar ? (
                      <img key={a.id} src={a.avatar} className="w-8 h-8 rounded-full border-2 border-white/40 object-cover" alt={a.name} />
                    ) : (
                      <span key={a.id} className="w-8 h-8 rounded-full border-2 border-white/40 bg-white/25 text-white text-xs font-semibold flex items-center justify-center uppercase">
                        {a.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('')}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-white/80 font-medium truncate">
                    {(() => {
                      const names = availability.onlineAgents!.map(a => a.name.split(/\s+/)[0]);
                      if (names.length === 1) return `${names[0]} is online`;
                      if (names.length === 2) return `${names[0]} & ${names[1]} are online`;
                      return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]} are online`;
                    })()}
                  </span>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 flex flex-col">
              {activeTab === 'home' ? (
                /* Home View: Create / Join existing conversations */
                <div className="p-6 flex flex-col gap-6 flex-1 justify-center text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="p-4 rounded-full mb-2"
                      style={{ background: `${themeColor}18`, color: themeColor }}
                    >
                      <MessageSquare className="w-10 h-10" />
                    </div>
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Hello there!</h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[280px]">
                      {widgetSettings.welcome}
                    </p>
                  </div>

                  <button
                    onClick={startNewConversation}
                    className="w-full text-white font-semibold py-3 px-4 rounded-xl shadow-lg active:scale-[0.98] transition-all"
                    style={{ background: themeColor }}
                  >
                    Start a New Chat
                  </button>

                  {/* Previous Conversations */}
                  {localConversations.length > 0 && (
                    <div className="flex flex-col gap-3 text-left mt-4 border-t border-slate-100 dark:border-slate-800/80 pt-4">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Recent Conversations
                      </span>
                      <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                        {localConversations.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setActiveConv(c);
                              setActiveTab('chat');
                            }}
                            className="w-full p-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/50 dark:border-slate-800 rounded-xl transition-all flex justify-between items-center"
                          >
                            <div className="flex flex-col gap-1 pr-4 truncate">
                              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{c.ticketNumber}</span>
                              <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{customerPreview(c) || 'Open ticket'}</span>
                            </div>
                            {c.unreadCountCustomer > 0 && (
                              <span
                                className="text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                                style={{ background: themeColor }}
                              >
                                {c.unreadCountCustomer}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Chat view */
                <div className="flex flex-col flex-1 h-full overflow-hidden">
                  {/* Message feed */}
                  <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                    {chatMessages.length === 0 && (
                      <p className="text-xs text-slate-400 text-center my-6">Beginning of secure chat session.</p>
                    )}

                    {chatMessages.map(m => {
                      const isMe = m.sender.type === 'customer';
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col max-w-[75%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
                        >
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 px-1">
                            {m.sender.name}
                          </span>

                          <div
                            className={`p-3 rounded-2xl text-sm ${isMe ? 'rounded-tr-none' : `${recipientBubbleClass} rounded-tl-none`}`}
                            style={isMe ? senderBubbleStyle : undefined}
                          >
                            {m.content && formatMarkdown(m.content)}

                            {/* File Attachments */}
                            {m.attachments && m.attachments.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-1">
                                {m.attachments.map((a, idx) => (
                                  <a
                                    key={idx}
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                                      isMe
                                        ? 'bg-black/20 border-white/20 hover:bg-black/30 text-white'
                                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                                    }`}
                                  >
                                    {a.type === 'image' ? (
                                      <img src={a.url} alt={a.name} className="w-16 h-16 rounded object-cover border" />
                                    ) : (
                                      <Paperclip className="w-4 h-4 shrink-0" />
                                    )}
                                    <span className="truncate max-w-[120px]">{a.name}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Receipt */}
                          {isMe && (
                            <span className="text-[9px] text-slate-400 mt-1 flex items-center gap-0.5">
                              {m.seen ? (
                                <>
                                  <CheckCheck className="w-3.5 h-3.5" style={{ color: themeColor }} /> Seen
                                </>
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5" /> Sent
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Agent typing */}
                    {agentTyping && (
                      <div className="self-start flex flex-col items-start max-w-[70%]">
                        <span className="text-[10px] text-slate-400 mb-1">{agentTyping} typing</span>
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Typing Composer Panel */}
                  <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 relative">
                    {/* Emoji dropdown picker */}
                    {showEmoji && (
                      <div className="absolute bottom-14 left-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl flex gap-2 z-20">
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

                    {/* Attached files, sent together with the message */}
                    {(pendingAttachments.length > 0 || uploading) && (
                      <div className="flex flex-wrap gap-2 pb-2">
                        {pendingAttachments.map((a, i) => (
                          <div key={`${a.url}-${i}`} className="relative">
                            {a.type === 'image' ? (
                              <img src={a.url} alt={a.name} className="w-14 h-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                            ) : (
                              <div className="h-14 max-w-[150px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
                                <Paperclip className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{a.name}</span>
                              </div>
                            )}
                            <button
                              onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center shadow"
                              title={`Remove ${a.name}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        {uploading && <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">Uploading…</div>}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
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
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setShowEmoji(!showEmoji)}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Smile className="w-4 h-4" />
                      </button>

                      <input
                        type="text"
                        value={inputText}
                        onChange={handleTextChange}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSendMessage();
                        }}
                        placeholder={isPendingNewConv ? 'Type your first message to start the chat...' : 'Write a message...'}
                        className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none"
                        style={{ '--tw-ring-color': themeColor } as any}
                        onFocus={e => (e.target.style.borderColor = themeColor)}
                        onBlur={e => (e.target.style.borderColor = '')}
                      />

                      <button
                        onClick={() => handleSendMessage()}
                        disabled={(!inputText.trim() && pendingAttachments.length === 0) || uploading}
                        className="p-2 text-white rounded-xl active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md"
                        style={{ background: themeColor }}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Attribution (Settings > General) */}
            {availability?.showAttribution !== false && (
              <div className="shrink-0 py-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                {availability?.attributionText && availability.attributionText !== 'Powered by Chai Samosa'
                  ? availability.attributionText
                  : '⚡ Powered by Chai Samosa'}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating launcher bubble — uses themeColor */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="text-white p-4 rounded-full shadow-2xl transition-all flex items-center justify-center border-none"
        style={{ background: themeColor }}
      >
        {isOpen ? <X className="w-6 h-6 animate-fade-in" /> : <MessageSquare className="w-6 h-6 animate-fade-in" />}
      </motion.button>
    </div>
  );
};

export default MessengerWidget;
