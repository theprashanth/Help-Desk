import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment, CustomerSession, MessengerAppearance } from '../../../../../shared/src/types';
import { MessageSquare, X, Paperclip, Smile, ArrowLeft, ArrowUp, CheckCheck, ChevronRight, Ticket, AlertTriangle } from 'lucide-react';
import { MessengerTextProvider, useMessengerStrings } from './messengerText';
import { MESSENGER_STRINGS, MessengerStringKey, fillString } from '../../../../../shared/src/messengerStrings';
import TimeHover from '../ui/TimeHover';
import CsatCard from './CsatCard';
import { createPortal } from 'react-dom';
import { HelpCenter, HelpHomeCard, ArticleSuggestions, HelpView } from './HelpCenter';
import { shortAgo } from '../../lib/timeAgo';
import { API_URL } from '../../lib/config';

/** What the customer sees: no internal notes or team events, but customer-facing state lines ("Ticket resolved"). */
const CUSTOMER_SYSTEM_TYPES = ['customer_event', 'csat_request'];
const customerVisible = (m: Message) => !m.isInternalNote && (m.sender?.type !== 'system' || CUSTOMER_SYSTEM_TYPES.includes(m.metadata?.type));
import { motion, AnimatePresence } from 'framer-motion';
import { RichText } from '../../lib/richText';
import { LiveChatFlow, FlowQuestionCard, FlowChips, flowButtons, FlowAction } from './chatFlowUi';

const BACKEND_URL = API_URL;

/** Where the Messenger runs: the demo page in this app, inside the iframe on a customer's site, or a mobile WebView. */
export type MessengerMode = 'demo' | 'embedded' | 'fullscreen';

/** Who the visitor is on the host site/app (set by the host via ChaiSamosaSettings / boot). */
type Identity = { userId?: string; name?: string; email?: string; phone?: string; userHash?: string };

/** localStorage, namespaced per app id when embedded so different sites/apps never share visitors. */
function makeStore(prefix: string) {
  return {
    get: (k: string) => { try { return localStorage.getItem(prefix + k); } catch { return null; } },
    set: (k: string, v: string) => { try { localStorage.setItem(prefix + k, v); } catch { /* storage blocked */ } },
    remove: (k: string) => { try { localStorage.removeItem(prefix + k); } catch { /* ignore */ } },
  };
}

/** Identity handed to the Messenger: demo page uses window.HelpDesk; mobile WebViews use the URL #fragment. */
function initialIdentity(mode: MessengerMode): Identity {
  if (mode === 'fullscreen') {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return { userId: h.get('user_id') || undefined, name: h.get('name') || undefined, email: h.get('email') || undefined, phone: h.get('phone') || undefined, userHash: h.get('user_hash') || undefined };
  }
  if (mode === 'demo') {
    const cfg = (window as any).HelpDesk || {};
    return { userId: cfg.userId ? String(cfg.userId) : undefined, name: cfg.userName, email: cfg.userEmail, phone: cfg.userPhone, userHash: cfg.userHash };
  }
  return {}; // embedded: arrives from the host page via postMessage
}

/** Map the host's settings object ({ user_id, name, email, phone, user_hash }) to an Identity. */
function identityFromSettings(st: any): Identity {
  if (!st || typeof st !== 'object') return {};
  const str = (v: any) => (v === undefined || v === null || v === '' ? undefined : String(v).slice(0, 300));
  return { userId: str(st.user_id), name: str(st.name), email: str(st.email), phone: str(st.phone), userHash: str(st.user_hash) };
}

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

const REPLY_TIME_KEY: Record<string, MessengerStringKey> = { asap: 'replyAsap', minutes: 'replyMinutes', hours: 'replyHours', day: 'replyDay' };

/** What the customer sees for a ticket's state. */
const TICKET_STATE: Record<string, { key: MessengerStringKey; cls: string }> = {
  open: { key: 'stateInProgress', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  waiting: { key: 'stateWaiting', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  resolved: { key: 'stateResolved', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  closed: { key: 'stateResolved', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};

type Availability = {
  replyTime: string | null; isOpenNow: boolean; nextOpenAt?: string;
  name?: string; showAttribution?: boolean; attributionText?: string;
  onlineAgents?: { id: string; name: string; avatar?: string }[];
  messenger?: Partial<MessengerAppearance>;
  chatFlow?: LiveChatFlow | null;   // Settings › Chat flow (published), null when off
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

/** Message body: **bold**, *italic*, `code`, safe links */
const formatMarkdown = (text: string) => (
  <RichText
    text={text}
    className="leading-relaxed whitespace-pre-wrap"
    codeClass="bg-black/10 px-1 rounded text-[0.85em]"
    linkClass="underline opacity-90"
  />
);

export const MessengerWidget: React.FC<{ appId?: string; mode?: MessengerMode }> = ({ appId = 'default_workspace', mode = 'demo' }) => {
  const embedded = mode === 'embedded';
  const fullscreen = mode === 'fullscreen';
  const store = useMemo(() => makeStore(mode === 'demo' ? '' : `cs_${appId}_`), [mode, appId]);
  const [identity, setIdentity] = useState<Identity>(() => initialIdentity(mode));
  const [booted, setBooted] = useState(mode !== 'embedded'); // embedded waits for the host page
  const [blocked, setBlocked] = useState(false);             // not allowed on this domain
  const [resetNonce, setResetNonce] = useState(0);           // bumps on shutdown (logout)
  const parentOriginRef = useRef<string | null>(null);
  const [isOpen, setIsOpen] = useState(fullscreen);
  const [activeTab, setActiveTab] = useState<'home' | 'chat' | 'all' | 'help' | 'tickets'>('home');
  const [helpView, setHelpView] = useState<HelpView>({ kind: 'home' });
  const openHelp = (v: HelpView) => { setHelpView(v); setActiveTab('help'); };
  // Proactive messages (Settings › Proactive messages): a chat message popping up from the launcher, or a page banner
  type Outbound = { id: string; kind: 'chat' | 'banner'; body: string; link?: { label: string; url: string }; bannerStyle: 'info' | 'promo'; sender: { name: string; avatar?: string } | null };
  const [outboundChat, setOutboundChat] = useState<Outbound | null>(null);     // preview above the launcher
  const [pendingOutbound, setPendingOutbound] = useState<Outbound | null>(null); // opened: the reply starts a conversation
  const [banner, setBanner] = useState<Outbound | null>(null);
  const [hostUrl, setHostUrl] = useState('');
  const [guestId, setGuestId] = useState('');
  // Every request names the app (workspace) and, once known, this visitor's User id — the server only
  // returns a conversation to the customer it belongs to.
  const guestIdRef = useRef('');
  useEffect(() => { guestIdRef.current = guestId; }, [guestId]);
  const api = useCallback((path: string, init: RequestInit = {}) => fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string>) || {}),
      'X-Workspace-Id': appId,
      ...(guestIdRef.current ? { 'X-Customer-Id': guestIdRef.current } : {}),
    },
  }), [appId]);
  const [guestName, setGuestName] = useState('');
  const [localConversations, setLocalConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [agentTyping, setAgentTyping] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Files attached to the draft; sent together with the text when the customer presses Send
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  // True when the user clicked "Start New Chat" but hasn't sent a first message yet.
  // The actual ticket is created lazily on first send to avoid empty tickets.
  const [isPendingNewConv, setIsPendingNewConv] = useState(false);
  // Chat flow: the details form runs locally until it's complete, then the server takes over
  const [flowIntake, setFlowIntake] = useState<{ step: number; answers: Record<string, string | null> } | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const flowBusyRef = useRef(false);                 // blocks double taps before React re-renders
  const reloadWorkspaceRef = useRef<() => void>(() => {});
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



  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // Composer grows with the text (up to ~6 lines), like Intercom's
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [inputText]);
  // Re-render every minute so "5m" / "1h" message times stay current
  const [, setClock] = useState(0);
  useEffect(() => { const t = setInterval(() => setClock(n => n + 1), 60_000); return () => clearInterval(t); }, []);
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
 
    // User id: a UUID v4 (e.g. 47f1664a-c15e-42fc-b74e-5046559f92db) for everyone, guest or logged in.
    // A logged-in user's own id (window.HelpDesk.userId) is sent separately as externalUserId, and the
    // server answers with the canonical User id for that person (same id on every device).
    if (!booted) return;
    let id = store.get('customer_guest_id') || '';
    if (!id) {
      id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      store.set('customer_guest_id', id);
    }
    guestIdRef.current = id;
    setGuestId(id);

    // Read or set display name
    let name = store.get('customer_guest_name') || '';
    if (identity.name) {
      name = identity.name;
      store.set('customer_guest_name', name);
    } else if (!name) {
      name = `Guest #${id.slice(-4)}`;
      store.set('customer_guest_name', name);
    }
    setGuestName(name);

    // Cache email and phone if provided by the host site/app
    if (identity.email) store.set('customer_guest_email', identity.email);
    if (identity.phone) store.set('customer_guest_phone', identity.phone);

    // Fetch geo-IP data once (cached in localStorage for 24h)
    const geoKey = 'customer_geo_info';
    const geoExpiry = 'customer_geo_expiry';
    const cachedGeo = store.get(geoKey);
    const cachedExpiry = store.get(geoExpiry);
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
          store.set(geoKey, JSON.stringify(geo));
          // Cache for 24 hours
          store.set(geoExpiry, String(now + 24 * 60 * 60 * 1000));
        })
        .catch(() => {
          // Silently fall back — geo will be null
        });
    }
  }, [booted, store, identity, resetNonce]);

  // Office hours + reply time: on mount, whenever the Messenger is opened, and every 5 min while open
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      reloadWorkspaceRef.current = load;
      // Public workspace info: customer-facing name, attribution, reply time, office hours, who's online
      api(`/api/workspace/public`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!cancelled && data) setAvailability({
            replyTime: data.replyTime, isOpenNow: data.isOpenNow !== false, nextOpenAt: data.nextOpenAt,
            name: data.name, showAttribution: data.showAttribution !== false, attributionText: data.attributionText,
            onlineAgents: Array.isArray(data.onlineAgents) ? data.onlineAgents : [],
            messenger: data.messenger || undefined,
            chatFlow: data.chatFlow || null,
          });
        })
        .catch(() => {});
    };
    load();
    const interval = isOpen ? setInterval(load, 5 * 60 * 1000) : undefined;
    socket?.on('chatflow:updated', load); // an admin published a new version of the chat flow
    return () => { cancelled = true; if (interval) clearInterval(interval); socket?.off('chatflow:updated', load); };
  }, [isOpen, api, socket]);

  // Appearance from Settings > Messenger Live Chat (server); local dashboard settings only as a fallback
  const look = {
    themeColor: availability?.messenger?.themeColor || widgetSettings.themeColor || '#8B5CF6',
    brandName: availability?.messenger?.brandName || availability?.name || widgetSettings.brandName,
    greeting: availability?.messenger?.greeting || widgetSettings.greeting,
    welcome: availability?.messenger?.welcome || widgetSettings.welcome,
    launcherPosition: (availability?.messenger?.launcherPosition || 'right') as 'left' | 'right',
    showLauncher: fullscreen ? false : availability?.messenger?.showLauncher !== false,
  };
  const themeColor = look.themeColor;
  // Settings › Multilingual: the Messenger's text in the visitor's language (English until it loads)
  const strings = useMessengerStrings(api, !!availability?.messenger?.autoLanguage);
  const t = (key: MessengerStringKey, vars?: Record<string, string | number>) => fillString(strings?.[key] || MESSENGER_STRINGS[key], vars);
  const welcomeText = strings?.welcome || look.welcome;
  const greetingText = strings?.greeting || look.greeting;
  // Open tracker issues with a public notice ("We're aware of…"), shown on the home screen
  const [knownIssues, setKnownIssues] = useState<{ id: string; notice: string; updatedAt: string }[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    api('/api/messenger/known-issues').then(r => (r.ok ? r.json() : [])).then(l => setKnownIssues(Array.isArray(l) ? l : [])).catch(() => {});
  }, [isOpen, api]);
  // AI Agent buttons: it helped (resolve) / it didn't / talk to a person (both hand over to the team)
  const [aiBusy, setAiBusy] = useState(false);
  const sendAiFeedback = async (action: 'helpful' | 'not_helpful' | 'human') => {
    if (!activeConv) return;
    setAiBusy(true);
    try {
      const res = await api('/api/messenger/ai-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: activeConv.id, action }) });
      if (res.ok) { const c = await res.json(); setActiveConv(c); setLocalConversations(prev => prev.map(x => (x.id === c.id ? c : x))); }
    } catch { /* offline: the buttons stay */ }
    setAiBusy(false);
  };
  // "Updated 5m" — or "Just now" for anything this minute
  const updatedText = (iso?: string) => (shortAgo(iso) === 'Now' ? t('justNow') : t('updated', { time: shortAgo(iso) }));
  const ticketPill = (c: Conversation) => {
    const st = TICKET_STATE[c.status] || TICKET_STATE.open;
    return <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{t(st.key)}</span>;
  };
  const renderTicketRow = (c: Conversation) => (
    <button
      key={c.id}
      onClick={() => { setActiveConv(c); setActiveTab('chat'); }}
      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
    >
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${themeColor}18`, color: themeColor }}>
        <Ticket className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm truncate ${c.unreadCountCustomer > 0 ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-200'}`}>
          {c.title || customerPreview(c) || t('ticket')}
        </span>
        <span className="block text-xs text-slate-400 truncate">{c.ticketNumber} · {updatedText(c.updatedAt || c.createdAt)}</span>
      </span>
      {ticketPill(c)}
    </button>
  );
  const renderConvRow = (c: Conversation) => c.kind === 'ticket' ? renderTicketRow(c) : (
    <button
      key={c.id}
      onClick={() => { setActiveConv(c); setActiveTab('chat'); }}
      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
    >
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${themeColor}18`, color: themeColor }}>
        <MessageSquare className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm truncate ${c.unreadCountCustomer > 0 ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-200'}`}>
          {customerPreview(c) || t('openConversation')}
        </span>
        <span className="block text-xs text-slate-400 truncate">
          {c.ticketNumber} · {shortAgo(c.updatedAt || c.createdAt)}{c.status === 'resolved' || c.status === 'closed' ? ` · ${t('stateResolved')}` : ''}
        </span>
      </span>
      {c.unreadCountCustomer > 0 ? (
        <span className="text-white font-bold text-[10px] min-w-5 h-5 px-1 rounded-full flex items-center justify-center shrink-0" style={{ background: themeColor }}>
          {c.unreadCountCustomer}
        </span>
      ) : (
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      )}
    </button>
  );

  // ── Host page <-> Messenger (embedded in an iframe by messenger.js) ─────
  const postToHost = useCallback((msg: any) => {
    if (!embedded || window.parent === window) return;
    window.parent.postMessage({ source: 'chai-samosa', ...msg }, parentOriginRef.current || '*');
  }, [embedded]);

  const resetVisitor = useCallback(() => {
    // ChaiSamosa('shutdown'): forget this visitor (e.g. on logout) and start fresh as a new lead
    const id = store.get('customer_guest_id');
    if (id) store.remove(`guest_conv_ids_${id}`);
    ['customer_guest_id', 'customer_guest_name', 'customer_guest_email', 'customer_guest_phone'].forEach(k => store.remove(k));
    guestIdRef.current = '';
    setGuestId('');
    setLocalConversations([]);
    setActiveConv(null);
    setChatMessages([]);
    setIsOpen(false);
    setResetNonce(n => n + 1);
  }, [store]);

  useEffect(() => {
    if (!embedded) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !e.data || e.data.source !== 'chai-samosa-host') return;
      const { type, settings, page } = e.data;
      if (type === 'boot') {
        parentOriginRef.current = e.origin; // the browser guarantees this is the real host site
        hostPageRef.current = { host: new URL(e.origin).host, url: typeof page?.url === 'string' ? page.url : e.origin };
        setHostUrl(hostPageRef.current.url);
        setIdentity(identityFromSettings(settings));
        setBooted(true);
      } else if (type === 'update') {
        if (settings) setIdentity(prev => ({ ...prev, ...identityFromSettings(settings) }));
        if (typeof page?.url === 'string') setHostUrl(page.url);
      } else if (type === 'page') {
        if (typeof page?.url === 'string') setHostUrl(page.url); // the host page navigated (single-page apps)
      } else if (type === 'banner-dismissed' || type === 'banner-clicked') {
        const id = e.data.id;
        if (typeof id === 'string') outboundEventRef.current(id, type === 'banner-dismissed' ? 'dismissed' : 'opened');
        if (type === 'banner-dismissed') setBanner(null);
      } else if (type === 'shutdown') {
        setIdentity({});
        resetVisitor();
      } else if (type === 'show') {
        setIsOpen(true);
      } else if (type === 'hide') {
        setIsOpen(false);
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ source: 'chai-samosa', type: 'ready' }, '*'); // ask the host for boot settings
    return () => window.removeEventListener('message', onMessage);
  }, [embedded, resetVisitor]);

  // Tell the host how big the iframe must be (closed = just the launcher, open = the panel)
  const showPreview = !!outboundChat && !isOpen;
  useEffect(() => {
    if (booted) postToHost({ type: 'resize', open: isOpen, preview: showPreview, position: look.launcherPosition, showLauncher: look.showLauncher, hidden: blocked });
  }, [booted, isOpen, showPreview, look.launcherPosition, look.showLauncher, blocked, postToHost]);

  // ── Proactive messages ───────────────────────────────────────────────────
  const outboundEventRef = useRef<(id: string, event: 'opened' | 'dismissed') => void>(() => {});
  outboundEventRef.current = (id, event) => {
    api(`/api/messenger/outbound/${id}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: guestIdRef.current, event }) }).catch(() => {});
  };
  const pageUrl = embedded ? hostUrl : (typeof window !== 'undefined' ? window.location.href : '');
  useEffect(() => {
    if (!booted || blocked || !guestId || (embedded && !pageUrl)) return;
    let cancelled = false;
    api('/api/messenger/outbound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: guestId, url: pageUrl }) })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Outbound[]) => {
        if (cancelled || !Array.isArray(list)) return;
        const chat = list.find(m => m.kind === 'chat');
        if (chat) setOutboundChat(prev => prev || chat);
        setBanner(list.find(m => m.kind === 'banner') || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [booted, blocked, guestId, pageUrl, embedded, api]);
  // Embedded: the host page draws the banner (outside the iframe)
  useEffect(() => {
    if (!embedded || !booted) return;
    postToHost({ type: 'banner', banner: banner ? { id: banner.id, body: banner.body, link: banner.link, style: banner.bannerStyle, color: look.themeColor } : null });
  }, [banner, embedded, booted, postToHost, look.themeColor]);
  const openOutboundChat = () => {
    if (!outboundChat) return;
    outboundEventRef.current(outboundChat.id, 'opened');
    setPendingOutbound(outboundChat);
    setOutboundChat(null);
    setActiveConv(null);
    setChatMessages([]);
    setFlowIntake(null);
    setFlowError(null);
    setIsPendingNewConv(true);
    setActiveTab('chat');
    setIsOpen(true);
  };
  const dismissOutboundChat = () => {
    if (!outboundChat) return;
    outboundEventRef.current(outboundChat.id, 'dismissed');
    setOutboundChat(null);
  };

  // Boot check: is the Messenger allowed on this site, and does the logged-in identity verify?
  const hostPageRef = useRef<{ host: string; url: string } | null>(null);
  useEffect(() => {
    if (!booted) return;
    const params = new URLSearchParams(window.location.search);
    const isMobile = fullscreen;
    const host = isMobile
      ? `${params.get('app') || 'mobile app'}`
      : hostPageRef.current?.host || window.location.host;
    api('/api/messenger/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        url: isMobile ? undefined : (hostPageRef.current?.url || window.location.href),
        kind: isMobile ? 'mobile' : 'website',
        platform: isMobile ? (params.get('platform') || 'mobile') : 'web',
        userId: identity.userId,
        userHash: identity.userHash,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res) return;
        if (res.allowed === false) { setBlocked(true); return; }
        if (res.identity === 'rejected') {
          console.warn('[Chai Samosa] Identity verification failed (missing or wrong user_hash). Continuing as an anonymous visitor.');
          setIdentity({});
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, identity.userId, identity.userHash]);

  // Private real-time channel for this visitor (their messages, typing, read receipts)
  useEffect(() => {
    if (!socket || !guestId) return;
    const join = () => socket.emit('messenger:join', { customerId: guestId, appId });
    join();
    socket.on('connect', join);
    return () => { socket.off('connect', join); };
  }, [socket, guestId]);

  const isAway = availability ? !availability.isOpenNow : false;
  // Newest first, for the home screen ("Recent conversations") and the All conversations screen
  const sortedConversations = useMemo(
    () => [...localConversations].sort((x, y) => new Date(y.updatedAt || y.createdAt).getTime() - new Date(x.updatedAt || x.createdAt).getTime()),
    [localConversations],
  );

  const inFlowChat = activeTab === 'chat' && (!!flowIntake || (!!activeConv?.bot && activeConv.bot.state !== 'handoff'));
  const flowLocked = !!availability?.chatFlow && inFlowChat;
  const headerSubtitle = isAway
    ? t('awayBack', { when: describeBack(availability?.nextOpenAt) })
    : (availability?.replyTime && REPLY_TIME_KEY[availability.replyTime] ? t(REPLY_TIME_KEY[availability.replyTime]) : greetingText);
  const chats = useMemo(() => sortedConversations.filter(c => c.kind !== 'ticket'), [sortedConversations]);
  // Customer tickets (open ones first), for the home screen and the Tickets screen
  const tickets = useMemo(() => sortedConversations.filter(c => c.kind === 'ticket')
    .sort((a, b) => Number(a.status === 'resolved' || a.status === 'closed') - Number(b.status === 'resolved' || b.status === 'closed')), [sortedConversations]);

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
      api(`/api/messages/seen/${activeConv.id}`, {
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
        const raw = store.get(`guest_conv_ids_${guestId}`);
        const ids: string[] = raw ? JSON.parse(raw) : [];

        // Fetch each ticket individually via the open endpoint
        const results = await Promise.all(
          ids.map(id =>
            api(`/api/tickets/${id}`)
              .then(r => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        const convs: Conversation[] = results
          .filter(Boolean)
          .filter((c: Conversation) => c.customer.id === guestId);
        // Plus everything the server knows for this visitor (e.g. tickets a teammate opened for them)
        const mine: Conversation[] = await api('/api/messenger/conversations').then(r => (r.ok ? r.json() : [])).catch(() => []);
        for (const c of Array.isArray(mine) ? mine : []) if (!convs.some(x => x.id === c.id)) convs.push(c);
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
        // Updates can arrive out of order: an older copy must never replace a newer one
        // (that's what made chat-flow buttons jump back to the previous menu)
        const newer = (old?: Conversation | null) => !old?.updatedAt || !conv.updatedAt || conv.updatedAt >= old.updatedAt;
        setLocalConversations(prev => {
          const idx = prev.findIndex(c => c.id === conv.id);
          if (idx === -1) return [conv, ...prev];
          if (!newer(prev[idx])) return prev;
          const next = [...prev];
          next[idx] = conv;
          return next.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );
        });
        if (activeConv && activeConv.id === conv.id && newer(activeConv)) {
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
        const res = await api(`/api/messages/${activeConv.id}`);
        if (res.ok) {
          const data: Message[] = await res.json();
          setChatMessages(data.filter(customerVisible));
        }
      } catch (err) {
        console.error('Failed to fetch messages:', err);
      }
    };

    fetchMessages();

    const handleNewMessage = (msg: Message) => {
      // Never show teammates' internal notes or conversation events to the customer
      if (!customerVisible(msg)) return;
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

  // Auto-scroll. While the bot's menus run, put the visitor's latest tap at the top so the reply and its
  // options are read from the start (not jumped past to the last option); otherwise follow the newest message.
  const botRunning = !!activeConv?.bot && activeConv.bot.state !== 'handoff';
  useEffect(() => {
    const box = messagesScrollRef.current;
    const taps = box?.querySelectorAll<HTMLElement>('[data-from="customer"]');
    const lastTap = taps?.length ? taps[taps.length - 1] : null;
    if (box && botRunning && lastTap) {
      const top = lastTap.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
      box.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, agentTyping, botRunning]);

  // Navigate to the chat view but do NOT create the ticket yet.
  // The ticket is created lazily when the customer sends their first message.
  const liveFlow = availability?.chatFlow || null;

  /** The server decides the canonical User id; adopt it and remember this conversation in this browser. */
  const adoptConversation = (conv: Conversation) => {
    const userId = conv.customer?.id || guestId;
    if (userId !== guestId) {
      const previous: string[] = JSON.parse(store.get(`guest_conv_ids_${guestId}`) || '[]');
      const merged: string[] = JSON.parse(store.get(`guest_conv_ids_${userId}`) || '[]');
      store.set(`guest_conv_ids_${userId}`, JSON.stringify([...new Set([...merged, ...previous])]));
      store.set('customer_guest_id', userId);
      guestIdRef.current = userId;
      setGuestId(userId);
    }
    const storageKey = `guest_conv_ids_${userId}`;
    const existing: string[] = JSON.parse(store.get(storageKey) || '[]');
    if (!existing.includes(conv.id)) store.set(storageKey, JSON.stringify([conv.id, ...existing]));
  };

  const sessionInfo = () => ({
    browser: parseBrowser(),
    os: parseOS(),
    currentPage: window.location.href,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    country: geoInfo ? `${geoInfo.city ? geoInfo.city + ', ' : ''}${geoInfo.country}` : undefined,
    ip: geoInfo?.ip || undefined,
    timezone: geoInfo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  } as CustomerSession & { timezone?: string });

  /** Questions this visitor still has to answer (logged-in users skip what the site already told us). */
  const flowQuestions = (flow: LiveChatFlow) => (flow.askDetails ? flow.questions : []).filter(q =>
    !(q.type === 'name' && identity.name) && !(q.type === 'email' && identity.email) && !(q.type === 'phone' && identity.phone));

  /** Details form complete: create the bot-handled conversation (the server writes the transcript). */
  const finishFlowIntake = async (answers: Record<string, string | null>) => {
    if (!liveFlow || flowBusyRef.current) return;
    flowBusyRef.current = true;
    const known: Record<string, string> = {};
    for (const q of liveFlow.askDetails ? liveFlow.questions : []) {
      if (q.type === 'name' && identity.name) known[q.id] = identity.name;
      if (q.type === 'email' && identity.email) known[q.id] = identity.email;
      if (q.type === 'phone' && identity.phone) known[q.id] = identity.phone;
    }
    setFlowBusy(true); setFlowError(null);
    try {
      const res = await api('/api/chat-flow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: guestId, externalUserId: identity.userId, userHash: identity.userHash, answers: { ...known, ...answers }, session: sessionInfo() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlowError(data.error || 'Something went wrong — please try again');
        // Jump back to the question the server rejected
        const qs = flowQuestions(liveFlow);
        const at = qs.findIndex(q => q.id === data.questionId);
        if (at >= 0) setFlowIntake({ step: at, answers });
        else if (res.status === 409) { setFlowIntake(null); }
        return;
      }
      const conv: Conversation = data;
      adoptConversation(conv);
      const name = (answers && Object.entries(answers).find(([id]) => liveFlow.questions.find(q => q.id === id)?.type === 'name')?.[1]) || '';
      if (name) { store.set('customer_guest_name', name); setGuestName(name); }
      setLocalConversations(prev => [conv, ...prev.filter(c => c.id !== conv.id)]);
      setActiveConv(conv);
      setIsPendingNewConv(false);
      setFlowIntake(null);
      const msgRes = await api(`/api/messages/${conv.id}`);
      if (msgRes.ok) setChatMessages(await msgRes.json());
    } catch {
      setFlowError('Couldn’t connect — please try again');
    } finally {
      flowBusyRef.current = false;
      setFlowBusy(false);
    }
  };

  const answerFlowQuestion = (value: string | null) => {
    if (!flowIntake || !liveFlow) return;
    const qs = flowQuestions(liveFlow);
    const q = qs[flowIntake.step];
    if (!q) return;
    const answers = { ...flowIntake.answers, [q.id]: value };
    setFlowError(null);
    if (flowIntake.step + 1 >= qs.length) { setFlowIntake({ step: qs.length, answers }); finishFlowIntake(answers); }
    else setFlowIntake({ step: flowIntake.step + 1, answers });
  };

  /** A button in the flow (option, Yes/No, Back, Restart). */
  const runFlowAction = async (b: FlowAction) => {
    if (!activeConv || flowBusyRef.current) return;
    flowBusyRef.current = true;
    setFlowBusy(true); setFlowError(null);
    try {
      const res = await api('/api/chat-flow/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConv.id, action: b.action, optionId: b.optionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlowError(data.error || 'Something went wrong — please try again');
        // The flow was edited/published while the visitor was in it: fetch the latest version
        if (data.resync || res.status === 409) reloadWorkspaceRef.current();
        // Re-sync this conversation's position too
        const fresh = await api(`/api/tickets/${activeConv.id}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
        if (fresh) setActiveConv(fresh);
        return;
      }
      setActiveConv(data);
      setLocalConversations(prev => prev.map(c => (c.id === data.id ? data : c)));
      const msgRes = await api(`/api/messages/${activeConv.id}`);
      if (msgRes.ok) {
        const list: Message[] = await msgRes.json();
        setChatMessages(list.filter(customerVisible));
      }
    } catch {
      setFlowError('Couldn’t connect — please try again');
    } finally {
      flowBusyRef.current = false;
      setFlowBusy(false);
    }
  };

  const startNewConversation = () => {
    setPendingOutbound(null);
    setActiveConv(null);
    setChatMessages([]);
    setIsPendingNewConv(true);
    setFlowError(null);
    setFlowIntake(null);
    setActiveTab('chat');
    if (liveFlow) {
      // Chat flow: greet, ask the details one by one, then show the menu
      if (flowQuestions(liveFlow).length) setFlowIntake({ step: 0, answers: {} });
      else finishFlowIntake({});
    }
  };

  const handleSendMessage = async (text?: string, attachmentsArg?: Attachment[]) => {
    const content = text ?? inputText;
    // Sending from the composer includes any attached files
    const attachments = attachmentsArg ?? (text === undefined ? pendingAttachments : []);
    if (!content.trim() && attachments.length === 0) return;
    if (uploading) return;

    setSendError(null);
    setInputText('');
    if (text === undefined) setPendingAttachments([]);

    try {
      // ── Lazy ticket creation: first message creates the conversation ──────
      if (isPendingNewConv) {
        const res = await api(`/api/tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: guestId,
            externalUserId: identity.userId,
            userHash: identity.userHash,
            name: guestName,
            email: store.get('customer_guest_email') || undefined,
            phone: store.get('customer_guest_phone') || undefined,
            initialMessage: content,
            initialAttachments: attachments,
            ...(pendingOutbound ? { outboundId: pendingOutbound.id } : {}),
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
          adoptConversation(conv);
          setLocalConversations(prev => [conv, ...prev]);
          setActiveConv(conv);
          setIsPendingNewConv(false);
          setPendingOutbound(null);
          // Fetch the messages that now include the initial message
          const msgRes = await api(`/api/messages/${conv.id}`);
          if (msgRes.ok) {
            setChatMessages(await msgRes.json());
          }
        } else {
          const body = await res.json().catch(() => ({}));
          setSendError(body.error || t('sendFailed'));
          if (text === undefined) setInputText(content);
        }
        return;
      }

      // ── Normal send to existing conversation ─────────────────────────────
      if (!activeConv) return;

      const res = await api(`/api/messages`, {
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
        const body = await res.json().catch(() => ({}));
        setSendError(body.error || t('sendFailed'));
        if (text === undefined) setInputText(content);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setSendError(t('sendOffline'));
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
        const res = await api(`/api/attachments/upload`, { method: 'POST', body: formData });
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
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  // Not allowed on this domain (Settings > Messenger > Security), or still waiting for the host page
  if (blocked || !booted) return null;
  const onLeft = look.launcherPosition === 'left';
  const rootClass = fullscreen
    ? 'fixed inset-0 flex flex-col'
    : embedded
      ? `fixed bottom-3 ${onLeft ? 'left-3 items-start' : 'right-3 items-end'} z-50 flex flex-col`
      : `fixed bottom-6 ${onLeft ? 'left-6 items-start' : 'right-6 items-end'} z-50 flex flex-col`;
  const panelSize = fullscreen
    ? 'w-full h-full rounded-none border-0 shadow-none'
    : embedded
      ? 'w-[calc(100vw-24px)] max-w-96 h-[calc(100vh-96px)] max-h-[600px] rounded-3xl shadow-xl border mb-3'
      : 'w-96 h-[550px] rounded-3xl shadow-2xl border mb-4';

  return (
    <MessengerTextProvider strings={strings}>
    <div className={rootClass}>
      {/* Messenger Screen Container */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`${panelSize} bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden`}
          >
            {/* Header — uses themeColor */}
            <div
              className="p-6 text-white flex flex-col gap-4 relative"
              style={{ background: `linear-gradient(135deg, ${themeColor}ee, ${themeColor})` }}
            >
              {!fullscreen && (
                <button
                  onClick={() => setIsOpen(false)}
                  className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              )}

              <div className="flex items-center gap-3">
                {activeTab !== 'home' && (
                  <button
                    title="Back"
                    onClick={() => {
                      // In the help center, go up one level first
                      if (activeTab === 'help' && helpView.kind !== 'home') { setHelpView({ kind: 'home' }); return; }
                      setActiveTab('home'); setIsPendingNewConv(false); setPendingOutbound(null); setFlowIntake(null); setFlowError(null);
                    }}
                    className="p-1 rounded-full hover:bg-white/10 mr-1 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div>
                  <h3 className="font-bold text-lg tracking-wide">{inFlowChat && liveFlow ? liveFlow.botName : look.brandName}</h3>
                  <p className="text-xs text-white/80 flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${isAway ? 'bg-slate-300' : 'bg-emerald-400 animate-pulse'}`} />
                    {inFlowChat && liveFlow?.botSubtitle ? liveFlow.botSubtitle : headerSubtitle}
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
                      if (names.length === 1) return t('oneOnline', { name: names[0] });
                      if (names.length === 2) return t('twoOnline', { a: names[0], b: names[1] });
                      return t('manyOnline', { names: names.slice(0, -1).join(', '), last: names[names.length - 1] });
                    })()}
                  </span>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 flex flex-col">
              {activeTab === 'home' ? (
                /* Home View: Create / Join existing conversations */
                <div className="p-6 flex flex-col flex-1 text-center">
                <div className="my-auto flex flex-col gap-6">
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="p-4 rounded-full mb-2"
                      style={{ background: `${themeColor}18`, color: themeColor }}
                    >
                      <MessageSquare className="w-10 h-10" />
                    </div>
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{t('hello')}</h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[280px]">
                      {welcomeText}
                    </p>
                  </div>

                  {/* Known issues the team has posted ("We're aware of…") */}
                  {knownIssues.map(k => (
                    <div key={k.id} className="text-left rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex gap-3">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{t('knownIssue')}</p>
                        <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 whitespace-pre-wrap">{k.notice}</p>
                        <p className="text-[11px] text-slate-400 mt-1">{updatedText(k.updatedAt)}</p>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={startNewConversation}
                    className="w-full text-white font-semibold py-3 px-4 rounded-xl shadow-lg active:scale-[0.98] transition-all"
                    style={{ background: themeColor }}
                  >
                    {t('startChat')}
                  </button>

                  {/* Their tickets: open ones first */}
                  {tickets.length > 0 && (
                    <div className="flex flex-col gap-2.5 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('yourTickets')}</span>
                        {tickets.length > 2 && (
                          <button onClick={() => setActiveTab('tickets')} className="text-xs font-semibold hover:underline" style={{ color: themeColor }}>
                            {t('seeAll', { count: tickets.length })}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {tickets.slice(0, 2).map(c => renderTicketRow(c))}
                      </div>
                    </div>
                  )}

                  {/* Knowledge base: search + popular articles */}
                  <HelpHomeCard api={api} themeColor={themeColor} onOpen={openHelp} />

                  {/* Recent conversations: the latest two; the rest under "See all" */}
                  {chats.length > 0 && (
                    <div className="flex flex-col gap-2.5 text-left mt-2 border-t border-slate-100 dark:border-slate-800/80 pt-5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('recentConversations')}</span>
                        {chats.length > 2 && (
                          <button onClick={() => setActiveTab('all')} className="text-xs font-semibold hover:underline" style={{ color: themeColor }}>
                            {t('seeAll', { count: chats.length })}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {chats.slice(0, 2).map(c => renderConvRow(c))}
                      </div>
                    </div>
                  )}
                </div>
                </div>
              ) : activeTab === 'help' ? (
                <HelpCenter api={api} themeColor={themeColor} view={helpView} onNavigate={setHelpView} onAskTeam={startNewConversation} />
              ) : activeTab === 'tickets' ? (
                /* All tickets */
                <div className="p-4 flex flex-col gap-3">
                  <h4 className="px-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t('allTickets')}</h4>
                  <div className="flex flex-col rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {tickets.map(c => renderTicketRow(c))}
                  </div>
                </div>
              ) : activeTab === 'all' ? (
                /* All conversations */
                <div className="p-4 flex flex-col gap-3">
                  <h4 className="px-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t('allConversations')}</h4>
                  <div className="flex flex-col rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {chats.map(c => renderConvRow(c))}
                  </div>
                  <button
                    onClick={startNewConversation}
                    className="mt-1 w-full text-white font-semibold py-2.5 px-4 rounded-xl active:scale-[0.98] transition-all text-sm"
                    style={{ background: themeColor }}
                  >
                    {t('startChat')}
                  </button>
                </div>
              ) : (
                /* Chat view */
                <div className="flex flex-col flex-1 h-full overflow-hidden">
                  {/* Message feed */}
                  {/* A ticket: its title and state stay visible above the messages */}
                  {activeConv?.kind === 'ticket' && (
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 shrink-0">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${themeColor}18`, color: themeColor }}>
                        <Ticket className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{activeConv.title || t('ticket')}</span>
                        <span className="block text-xs text-slate-400">{t('ticket')} {activeConv.ticketNumber}</span>
                      </span>
                      {ticketPill(activeConv)}
                    </div>
                  )}
                  <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                    {chatMessages.length === 0 && !flowIntake && (
                      <p className="text-xs text-slate-400 text-center my-6">{t('beginning')}</p>
                    )}

                    {/* Chat flow details form (local until complete) */}
                    {flowIntake && liveFlow && (() => {
                      const qs = flowQuestions(liveFlow);
                      const botBubble = (key: string, text: string) => (
                        <div key={key} className="flex flex-col max-w-[85%] self-start items-start">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 px-1">{liveFlow.botName}</span>
                          <div className={`p-3 rounded-2xl rounded-tl-none text-sm ${recipientBubbleClass}`}>{formatMarkdown(text)}</div>
                        </div>
                      );
                      return (
                        <>
                          {botBubble('welcome', liveFlow.welcome)}
                          {qs.slice(0, flowIntake.step).map(q => (
                            <React.Fragment key={q.id}>
                              {botBubble(`q-${q.id}`, q.label)}
                              <div className="flex flex-col max-w-[75%] self-end items-end">
                                <div className="p-3 rounded-2xl rounded-tr-none text-sm" style={senderBubbleStyle}>{flowIntake.answers[q.id] ?? 'Skipped'}</div>
                              </div>
                            </React.Fragment>
                          ))}
                          {qs[flowIntake.step] ? (
                            <FlowQuestionCard
                              question={qs[flowIntake.step]}
                              defaultCountry={liveFlow.defaultCountry}
                              themeColor={themeColor}
                              busy={flowBusy}
                              error={flowError}
                              onSubmit={answerFlowQuestion}
                            />
                          ) : (
                            <p className="text-xs text-slate-400 self-center">{flowBusy ? 'One moment…' : flowError}</p>
                          )}
                        </>
                      );
                    })()}

                    {isPendingNewConv && pendingOutbound && (
                      <div className="flex flex-col max-w-[85%] self-start items-start">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 px-1">{pendingOutbound.sender?.name || look.brandName}</span>
                        <div className={`p-3 rounded-2xl rounded-tl-none text-sm ${recipientBubbleClass}`}>{formatMarkdown(pendingOutbound.body)}</div>
                      </div>
                    )}

                    {chatMessages.map((m, idx) => {
                      // Ticket state lines: in progress / waiting on you / resolved / closed (Settings › General)
                      // CSAT: rate the conversation after it was resolved (only the latest request is live)
                      if (m.metadata?.type === 'csat_request') {
                        const latest = [...chatMessages].reverse().find(x => x.metadata?.type === 'csat_request')?.id === m.id;
                        const rated = activeConv?.rating && activeConv.rating.at >= m.createdAt ? activeConv.rating : undefined;
                        return (
                          <CsatCard
                            key={m.id}
                            question={m.content}
                            rating={rated}
                            active={latest}
                            themeColor={themeColor}
                            onSubmit={async (score, comment) => {
                              if (!activeConv) return 'Something went wrong';
                              try {
                                const res = await api(`/api/conversations/${activeConv.id}/rating`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score, comment }),
                                });
                                const data = await res.json().catch(() => ({}));
                                if (!res.ok) return data.error || 'Your rating couldn’t be sent';
                                setActiveConv(data);
                                return null;
                              } catch { return 'Your rating couldn’t be sent. Check your connection.'; }
                            }}
                          />
                        );
                      }
                      if (m.metadata?.type === 'customer_event') {
                        const st = m.metadata.state as string;
                        const tone = st === 'resolved'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : st === 'waiting'
                          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                          : st === 'open'
                          ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';
                        return (
                          <div key={m.id} className="self-center flex items-center gap-2 my-1 text-xs text-slate-500 dark:text-slate-400">
                            <span className="h-px w-8 bg-slate-200 dark:bg-slate-700" />
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${tone}`}>
                              {st === 'resolved' ? <CheckCheck className="w-3.5 h-3.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                              {m.content}
                              <TimeHover iso={m.createdAt} className="text-slate-400">· {shortAgo(m.createdAt)}</TimeHover>
                            </span>
                            <span className="h-px w-8 bg-slate-200 dark:bg-slate-700" />
                          </div>
                        );
                      }
                      const isMe = m.sender.type === 'customer';
                      // Messages from the same person within 5 minutes form a group; the last one gets "Name · 1h"
                      const sameGroup = (a?: Message, b?: Message) => !!a && !!b && a.metadata?.type !== 'customer_event' && b.metadata?.type !== 'customer_event'
                        && a.sender.type === b.sender.type && a.sender.id === b.sender.id
                        && Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < 5 * 60_000;
                      const lastInGroup = !sameGroup(m, chatMessages[idx + 1]);
                      const firstInGroup = !sameGroup(chatMessages[idx - 1], m);
                      return (
                        <div
                          key={m.id}
                          data-from={m.sender.type}
                          className={`flex flex-col max-w-[75%] ${isMe ? 'self-end items-end' : 'self-start items-start'} ${firstInGroup ? '' : '-mt-2'}`}
                        >

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

                          {/* AI Agent: the help articles it answered from */}
                          {m.metadata?.type === 'ai_agent' && Array.isArray(m.metadata.sources) && m.metadata.sources.length > 0 && (
                            <div className="mt-1.5 flex flex-col gap-1 items-start">
                              <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('aiSources')}</span>
                              {m.metadata.sources.map((src: { id: string; title: string }) => (
                                <button key={src.id} onClick={() => openHelp({ kind: 'article', id: src.id })}
                                  className="text-left text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:underline flex items-center gap-1.5 max-w-full"
                                  style={{ color: themeColor }}>
                                  <span className="truncate">{src.title}</span><ChevronRight className="w-3 h-3 shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}
                          {lastInGroup && (
                            <span className="mt-1 px-1 text-[11px] text-slate-400 dark:text-slate-500">
                              {!isMe && m.metadata?.type === 'ai_agent' && <span className="mr-1 px-1 py-px rounded bg-slate-200/70 dark:bg-slate-800 text-[9px] font-bold text-slate-500">{t('aiLabel')}</span>}
                              {!isMe && <>{m.sender.name} · </>}
                              <TimeHover iso={m.createdAt}>{shortAgo(m.createdAt) === 'Now' ? t('justNow') : shortAgo(m.createdAt)}</TimeHover>
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* AI Agent: "Did that answer your question?" under its latest answer */}
                    {activeConv?.aiAgent?.state === 'active' && (() => {
                      const last = [...chatMessages].reverse().find(x => x.sender.type !== 'system');
                      if (!last || last.metadata?.type !== 'ai_agent' || !last.metadata?.askFeedback || last.metadata?.handoff) return null;
                      return (
                        <div className="self-start flex flex-col gap-2 max-w-[85%]">
                          <span className="px-1 text-xs text-slate-500 dark:text-slate-400">{t('aiHelpful')}</span>
                          <div className="flex gap-2">
                            <button disabled={aiBusy} onClick={() => sendAiFeedback('helpful')} className="text-xs font-semibold px-3 py-1.5 rounded-full text-white disabled:opacity-60" style={{ background: themeColor }}>{t('aiYes')}</button>
                            <button disabled={aiBusy} onClick={() => sendAiFeedback('not_helpful')} className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60">{t('aiNo')}</button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Chat flow buttons under the bot's latest message */}
                    {liveFlow && activeConv?.bot && activeConv.bot.state !== 'handoff' && (
                      <>
                        <FlowChips buttons={flowButtons(liveFlow, activeConv.bot)} themeColor={themeColor} busy={flowBusy} onPick={runFlowAction} />
                        {flowError && <p className="text-xs text-red-500 self-end">{flowError}</p>}
                      </>
                    )}

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

                  {/* While the chat flow is running, typing is locked (the visitor uses the buttons) */}
                  {flowLocked ? (
                    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                      <div className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm px-3 py-2.5 text-slate-400 select-none" aria-disabled="true">
                        {(flowIntake ? liveFlow?.detailsPlaceholder : liveFlow?.menuPlaceholder) || t('chooseOption')}
                      </div>
                    </div>
                  ) : (
                  <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 relative">
                    {/* Emoji dropdown picker */}
                    {showEmoji && (
                      <div className="absolute bottom-full mb-1 left-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl flex gap-2 z-20">
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

                    {isPendingNewConv && !pendingOutbound && !flowIntake && (
                      <ArticleSuggestions api={api} text={inputText} onOpen={id => openHelp({ kind: 'article', id })} />
                    )}

                    {/* While the AI Agent is answering, a person is always one tap away */}
                    {activeConv?.aiAgent?.state === 'active' && (
                      <div className="mb-2 flex justify-end">
                        <button disabled={aiBusy} onClick={() => sendAiFeedback('human')} className="text-xs font-semibold hover:underline disabled:opacity-60" style={{ color: themeColor }}>
                          {t('talkToPerson')}
                        </button>
                      </div>
                    )}

                    {sendError && (
                      <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-xs flex items-start gap-2" role="alert">
                        <span className="flex-1">{sendError}</span>
                        <button onClick={() => setSendError(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
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
                        {uploading && <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">{t('uploading')}</div>}
                      </div>
                    )}

                    <div
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 transition-colors focus-within:border-[var(--composer-color)]"
                      style={{ ['--composer-color' as any]: themeColor }}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        multiple
                        accept="image/*,application/pdf"
                      />
                      {/* Enter sends; Shift+Enter starts a new line */}
                      <textarea
                        ref={composerRef}
                        rows={1}
                        value={inputText}
                        onChange={handleTextChange}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder={isPendingNewConv ? t('firstMessage') : t('message')}
                        aria-label="Message"
                        className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none max-h-[140px] overflow-y-auto"
                      />
                      <div className="flex items-center gap-0.5 px-2 pb-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          title="Attach a file"
                          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                        >
                          <Paperclip className="w-[18px] h-[18px]" />
                        </button>
                        <button
                          onClick={() => setShowEmoji(!showEmoji)}
                          title="Emoji"
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${showEmoji ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        >
                          <Smile className="w-[18px] h-[18px]" />
                        </button>
                        <span className="flex-1" />
                        {(() => {
                          const canSend = (!!inputText.trim() || pendingAttachments.length > 0) && !uploading;
                          return (
                            <button
                              onClick={() => handleSendMessage()}
                              disabled={!canSend}
                              title="Send (Enter)"
                              className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:pointer-events-none"
                              style={canSend ? { background: themeColor, color: '#fff' } : { background: 'rgb(226 232 240)', color: 'rgb(148 163 184)' }}
                            >
                              <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  )}
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

      {/* Proactive chat message, popping up from the launcher */}
      {showPreview && outboundChat && (
        <div className="mb-3 w-[300px] max-w-[calc(100vw-24px)] relative">
          <button onClick={dismissOutboundChat} aria-label="Dismiss" className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-700 text-white flex items-center justify-center shadow z-10"><X className="w-3.5 h-3.5" /></button>
          <button onClick={openOutboundChat} className="w-full text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-4">
            <span className="flex items-center gap-2 mb-1.5">
              {outboundChat.sender?.avatar
                ? <img src={outboundChat.sender.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                : <span className="w-6 h-6 rounded-full text-white text-[11px] font-semibold flex items-center justify-center uppercase" style={{ background: themeColor }}>{(outboundChat.sender?.name || look.brandName).charAt(0)}</span>}
              <span className="text-xs text-slate-500">{outboundChat.sender?.name || look.brandName}</span>
            </span>
            <span className="block text-sm text-slate-800 dark:text-slate-100 line-clamp-4">{formatMarkdown(outboundChat.body)}</span>
          </button>
        </div>
      )}

      {/* Page banner: drawn here in the demo; embedded, the host page draws it (messenger.js) */}
      {!embedded && !fullscreen && banner && typeof document !== 'undefined' && createPortal(
        <div className={`fixed top-0 inset-x-0 z-[60] px-4 py-2.5 flex items-center gap-3 text-sm shadow ${banner.bannerStyle === 'promo' ? 'text-white' : 'bg-white text-slate-800 border-b border-slate-200'}`}
          style={banner.bannerStyle === 'promo' ? { background: themeColor } : undefined} role="status">
          <span className="flex-1 min-w-0 text-center">{formatMarkdown(banner.body)}</span>
          {banner.link && (
            <a href={banner.link.url} target="_blank" rel="noreferrer" onClick={() => outboundEventRef.current(banner.id, 'opened')} className="shrink-0 font-semibold underline">{banner.link.label}</a>
          )}
          <button onClick={() => { outboundEventRef.current(banner.id, 'dismissed'); setBanner(null); }} aria-label="Dismiss banner" className="shrink-0 opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>,
        document.body,
      )}

      {/* Floating launcher bubble — uses themeColor (hidden in mobile apps or when turned off) */}
      {look.showLauncher && (
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="text-white p-4 rounded-full shadow-2xl transition-all flex items-center justify-center border-none"
        style={{ background: themeColor }}
      >
        {isOpen ? <X className="w-6 h-6 animate-fade-in" /> : <MessageSquare className="w-6 h-6 animate-fade-in" />}
      </motion.button>
      )}
    </div>
    </MessengerTextProvider>
  );
};

export default MessengerWidget;
