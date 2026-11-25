import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import {
  Search, SlidersHorizontal, AlertCircle, Star, MoreHorizontal, PanelLeft, X, Check, Plus,
  AlarmClock, Timer, Mail, Bell, CalendarDays, SignalHigh, ArrowDownWideNarrow, ArrowUpNarrowWide, Ticket, Wrench,
  ChevronRight, ChevronLeft, UserCheck, Inbox as InboxIcon, User,
  Minus, PenLine, CircleDot, Hourglass, CheckCircle2, Archive, Tag as TagIcon,
  Layers, FileText, FileDown, Trash2, CheckSquare, ArrowLeft, Reply
} from 'lucide-react';
import CloseConversationIcon from '../ui/CloseConversationIcon';
import CloseDialog from './CloseDialog';
import { PresenceDots, othersIn } from './Presence';
import { exportAsText, exportAsPdf } from '../../lib/exportConversations';
import { Conversation } from '../../../../../shared/src/types';
import { useSnoozeOptions } from '../../lib/useSnoozeOptions';
import { computeSnoozeUntil, isSnoozed, formatSnoozeUntil } from '../../lib/snooze';
import { STATE_FILTERS, StateFilter, statusesFor, viewParams, matchesState } from '../../lib/inboxViews';
import { PRIORITY_OPTIONS, PriorityIcon, priorityLabel } from '../../lib/priority';
import { Agent } from '../../../../../shared/src/types';
import SlaChip, { slaState } from '../ui/SlaChip';
import { API_URL } from '../../lib/config';

type SortKey = 'last_activity' | 'date_started' | 'priority' | 'snoozed_until' | 'sla_due' | 'reports';

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] = [
  { key: 'last_activity', label: 'Last activity', icon: Bell },
  { key: 'date_started', label: 'Date started', icon: CalendarDays },
  { key: 'priority', label: 'Priority', icon: SignalHigh },
  { key: 'snoozed_until', label: 'Snoozed until', icon: AlarmClock },
  { key: 'sla_due', label: 'SLA due', icon: Timer },
  { key: 'reports', label: 'Most reports', icon: Wrench }, // Issues view only
];

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

const BACKEND_URL = API_URL;

interface InboxListProps {
  currentQueue: string; // inbox view id: yours | created | all | unassigned | agent:<id> | kind:<kind>
  viewTitle: string;    // shown as the panel title
  agents?: Agent[];     // for the row menu's Assign submenu
}

export const InboxList: React.FC<InboxListProps> = ({ currentQueue, viewTitle, agents = [] }) => {
  const snoozeOptions = useSnoozeOptions();
  const conversations = useStore((state) => state.conversations);
  const setConversations = useStore((state) => state.setConversations);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const setActiveConversationId = useStore((state) => state.setActiveConversationId);
  const isLight = useStore((state) => state.agent?.role === 'light');
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  const presence = useStore((state) => state.presence);
  const tags = useStore((state) => state.tags);
  const setCurrentQueue = useStore((state) => (state as any).setCurrentQueue);

  // Sync active queue state in store
  useEffect(() => {
    if (setCurrentQueue) {
      setCurrentQueue(currentQueue);
    }
  }, [currentQueue, setCurrentQueue]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // List presentation: search toggle, sort, and Open/Snoozed/All view
  const [showSearch, setShowSearch] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('last_activity');
  // The Issues view starts sorted by how many conversations report each issue
  useEffect(() => {
    if (currentQueue === 'kind:issue') setSortBy('reports');
    else setSortBy(s => (s === 'reports' ? 'last_activity' : s));
  }, [currentQueue]);
  const [sortDesc, setSortDesc] = useState(true);
  const stateView = useStore((state) => state.stateFilter);
  const setStateView = useStore((state) => state.setStateFilter);
  const searchRequest = useStore((state) => state.searchRequest);

  // "Search" in the inbox nav opens and focuses the search box
  useEffect(() => {
    if (searchRequest > 0) {
      setShowSearch(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [searchRequest]);
  const [openPopover, setOpenPopover] = useState<null | 'sort' | 'view'>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inboxNavOpen = useStore((state) => state.inboxNavOpen);
  const setInboxNavOpen = useStore((state) => state.setInboxNavOpen);

  // Re-evaluate snooze expiry every minute so woken conversations reappear
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Track which conversation card has its action menu open
  const [openMenuConvId, setOpenMenuConvId] = useState<string | null>(null);
  const [rowMenuView, setRowMenuView] = useState<'main' | 'snooze' | 'assign'>('main');
  const [rowMenuPos, setRowMenuPos] = useState<{ top: number; left: number } | null>(null);
  const openRowMenu = (convId: string, anchor: HTMLElement) => {
    if (openMenuConvId === convId) { setOpenMenuConvId(null); return; }
    const r = anchor.getBoundingClientRect();
    const width = 256, height = 380;
    const top = r.bottom + height + 8 > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    setRowMenuPos({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    setRowMenuView('main');
    setOpenMenuConvId(convId);
  };
  const updateConversationInStore = useStore((state) => state.updateConversation);
  const putTicket = async (url: string, body: any) => {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (res.ok) updateConversationInStore(await res.json());
    } catch (e) {
      console.error('Failed to update conversation:', e);
    }
  };
  const handleSetPriority = (convId: string, priority: string) => putTicket(`${BACKEND_URL}/api/tickets/${convId}`, { priority });
  const handleAssignTo = (convId: string, agentId: string | null) => putTicket(`${BACKEND_URL}/api/tickets/${convId}/assign`, { agentId });
  const setConversationStatus = (convId: string, status: string) => putTicket(`${BACKEND_URL}/api/tickets/${convId}`, { status });
  // Row close icon: ask Resolved vs close without resolving
  const [closingConv, setClosingConv] = useState<{ id: string; status: string; ticketNumber: string } | null>(null);

  // Which view/state/filters the current list was loaded for. Auto-selecting the first
  // conversation waits until the list matches what's on screen, so a deep link (or a just-created
  // conversation) isn't replaced by a row from the previous view.
  const listKey = [currentQueue, stateView, filterPriority, filterCategory, filterTag, searchTerm].join('|');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Fetch conversations based on queue and filters
  useEffect(() => {
    if (!token) return;
    const requestKey = listKey;

    const fetchConvs = async () => {
      try {
        let url = `${BACKEND_URL}/api/tickets?`;
        
        // View (who) + state (which statuses); snooze is applied client-side
        url += `status=${statusesFor(stateView).join(',')}`;
        const vp = viewParams(currentQueue, agent?.id);
        if (vp) url += `&${vp}`;

        // Apply filters
        if (filterPriority !== 'all') url += `&priority=${filterPriority}`;
        if (filterCategory !== 'all') url += `&category=${filterCategory}`;
        if (filterTag !== 'all') url += `&tag=${filterTag}`;
        if (searchTerm.trim()) url += `&search=${encodeURIComponent(searchTerm)}`;

        const headers: HeadersInit = {
          'Authorization': `Bearer ${token}`
        };

        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          setConversations(data);
          setLoadedKey(requestKey);
        }
      } catch (err) {
        console.error('Failed to load tickets:', err);
      }
    };

    fetchConvs();
  }, [currentQueue, stateView, filterPriority, filterCategory, filterTag, searchTerm, token, agent, setConversations]);

  // Apply the Open/Snoozed/All view and the chosen sort order
  const visibleConversations = useMemo(() => {
    // The open conversation stays in the list after you close/resolve/snooze it, until you open another
    const byView = conversations.filter((c: Conversation) => c.id === activeConversationId || matchesState(c, stateView, now));
    const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);
    const keyOf = (c: Conversation): number => {
      switch (sortBy) {
        case 'date_started': return time(c.createdAt);
        case 'priority': return PRIORITY_RANK[c.priority] || 0;
        case 'snoozed_until': return isSnoozed(c, now) ? time(c.snoozedUntil) : 0;
        // Soonest due first (when "descending"); conversations without a clock go last
        case 'sla_due': { const st = slaState(c, now); return st ? -st.dueAt : -Number.MAX_SAFE_INTEGER; }
        case 'reports': return c.reportCount || 0;
        default: return time(c.updatedAt || c.createdAt);
      }
    };
    return [...byView].sort((a, b) => {
      const diff = keyOf(b) - keyOf(a);
      if (diff !== 0) return sortDesc ? diff : -diff;
      return time(b.updatedAt) - time(a.updatedAt); // stable tie-break: most recent first
    });
  }, [conversations, stateView, sortBy, sortDesc, now, activeConversationId]);

  // J / K (from the keyboard shortcuts): open the next / previous conversation in this list
  useEffect(() => {
    const onNav = (e: Event) => {
      const step = (e as CustomEvent<number>).detail;
      if (!visibleConversations.length) return;
      const i = visibleConversations.findIndex(c => c.id === activeConversationId);
      const next = visibleConversations[Math.max(0, Math.min(visibleConversations.length - 1, i < 0 ? 0 : i + step))];
      if (next && next.id !== activeConversationId) {
        setActiveConversationId(next.id);
        requestAnimationFrame(() => document.querySelector(`[data-conv-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
      }
    };
    window.addEventListener('inbox:step', onNav);
    return () => window.removeEventListener('inbox:step', onNav);
  }, [visibleConversations, activeConversationId, setActiveConversationId]);

  // Auto-select the first conversation if none is selected, or if the selected one is not in the visible list
  useEffect(() => {
    if (loadedKey !== listKey) return; // list still shows the previous view
    if (visibleConversations.length > 0) {
      const currentActiveExists = visibleConversations.some(c => c.id === activeConversationId);
      if (!activeConversationId || !currentActiveExists) {
        setActiveConversationId(visibleConversations[0].id);
      }
    } else if (activeConversationId) {
      // Nothing in this view: don't keep showing a conversation from another view
      setActiveConversationId(null);
    }
  }, [visibleConversations, activeConversationId, setActiveConversationId, loadedKey, listKey]);


  // ── Counts for every state in the "N Open" menu (same view + filters, all states) ──
  const socket = useStore((state) => state.socket);
  const [stateCounts, setStateCounts] = useState<Record<string, number> | null>(null);
  const filterQuery = useMemo(() => {
    const parts: string[] = [];
    const vp = viewParams(currentQueue, agent?.id);
    if (vp) parts.push(vp);
    if (filterPriority !== 'all') parts.push(`priority=${filterPriority}`);
    if (filterCategory !== 'all') parts.push(`category=${filterCategory}`);
    if (filterTag !== 'all') parts.push(`tag=${encodeURIComponent(filterTag)}`);
    if (searchTerm.trim()) parts.push(`search=${encodeURIComponent(searchTerm)}`);
    return parts.join('&');
  }, [currentQueue, agent?.id, filterPriority, filterCategory, filterTag, searchTerm]);
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetch(`${BACKEND_URL}/api/tickets/state-counts?${filterQuery}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(c => c && setStateCounts(c))
        .catch(() => {});
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 400); };
    load();
    const events = ['conversation:new', 'conversation:update', 'conversation:deleted'];
    events.forEach(ev => socket?.on(ev, schedule));
    return () => { if (timer) clearTimeout(timer); events.forEach(ev => socket?.off(ev, schedule)); };
  }, [filterQuery, token, socket]);

  // ── Bulk selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIndex = useRef<number | null>(null);
  const [bulkView, setBulkView] = useState<null | 'root' | 'state' | 'snooze' | 'assign' | 'priority' | 'edit' | 'category' | 'tag' | 'delete'>(null);
  const [bulkQuery, setBulkQuery] = useState('');
  const [bulkIndex, setBulkIndex] = useState(0);
  const [bulkNotice, setBulkNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const allTags = useStore((state) => state.tags);

  useEffect(() => { setSelectedIds(new Set()); lastSelectedIndex.current = null; }, [listKey]);
  useEffect(() => {
    // drop selections that left the list (closed, deleted, filtered out)
    setSelectedIds(prev => {
      const visible = new Set(visibleConversations.map(c => c.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleConversations]);

  const selectionMode = selectedIds.size > 0;
  const selectedConvs = visibleConversations.filter(c => selectedIds.has(c.id));
  const allSelected = selectionMode && selectedIds.size === visibleConversations.length;

  const toggleSelect = (id: string, index: number, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedIndex.current !== null) {
        // Shift-click selects the whole range
        const [a, b] = [lastSelectedIndex.current, index].sort((x, y) => x - y);
        visibleConversations.slice(a, b + 1).forEach(c => next.add(c.id));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIndex.current = index;
  };
  const selectAll = () => setSelectedIds(new Set(visibleConversations.map(c => c.id)));
  const clearSelection = () => { setSelectedIds(new Set()); lastSelectedIndex.current = null; };

  const flashNotice = (text: string, error = false) => {
    setBulkNotice({ text, error });
    setTimeout(() => setBulkNotice(n => (n && n.text === text ? null : n)), 3000);
  };

  const runBulk = async (action: string, value: any, doneText: (n: number) => string) => {
    if (!token || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ids: [...selectedIds], action, value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk action failed');
      flashNotice(doneText(data.updated) + (data.failed?.length ? ` (${data.failed.length} failed)` : ''), !!data.failed?.length);
      setBulkView(null);
      clearSelection();
    } catch (e: any) {
      flashNotice(e.message, true);
    } finally {
      setBulkBusy(false);
    }
  };

  const openBulk = (view: NonNullable<typeof bulkView>) => { setBulkQuery(''); setBulkIndex(0); setBulkView(view); };

  // Esc clears the selection when no palette is open
  useEffect(() => {
    if (!selectionMode || bulkView) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, bulkView]);

  // Soft pastel avatar fills (Intercom-style), keyed by category as before
  const getAvatarColors = (category: string) => {
    switch (category) {
      case 'bug': return 'bg-pink-100 text-pink-900 dark:bg-pink-500/20 dark:text-pink-200';
      case 'payment': return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200';
      case 'subscription': return 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200';
      case 'refund': return 'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-200';
      case 'feature_request': return 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200';
      default: return 'bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-200';
    }
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.round(diffMs / (1000 * 60));
    const diffHrs = Math.round(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 60) {
      return `${Math.max(1, diffMins)}m`;
    } else if (diffHrs < 24) {
      return `${diffHrs}h`;
    } else {
      const diffDays = Math.round(diffHrs / 24);
      if (diffDays < 7) {
        return `${diffDays}d`;
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const handleToggleStar = async (convId: string, currentStarred: boolean) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${convId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ starred: !currentStarred })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local store
        const next = conversations.map(c => c.id === convId ? updated : c);
        setConversations(next);
      }
    } catch (e) {
      console.error('Failed to toggle star:', e);
    }
  };

  // Snooze until a time (ISO string), or pass null to unsnooze
  const handleSnooze = async (convId: string, snoozedUntil: string | null) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${convId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ snoozedUntil })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local store
        const next = conversations.map(c => c.id === convId ? updated : c);
        setConversations(next);
      }
    } catch (e) {
      console.error('Failed to update snooze:', e);
    }
  };

  const queueTitle = viewTitle;
  const activeFilterCount = [filterPriority, filterCategory, filterTag].filter((v) => v !== 'all').length;
  // open and snoozed are fetched together, so both counts are known while viewing either
  const sameFetch = stateView === 'open' || stateView === 'snoozed';
  const snoozedCount = sameFetch ? conversations.filter((c: Conversation) => isSnoozed(c, now)).length : null;
  const viewLabel = STATE_FILTERS.find(o => o.key === stateView)?.label || 'Open';
  const viewOptions: { key: StateFilter; label: string; count: number | null }[] = STATE_FILTERS.map(o => ({
    ...o,
    count: o.key === stateView ? null
      : sameFetch && o.key === 'open' ? conversations.length - (snoozedCount || 0)
      : sameFetch && o.key === 'snoozed' ? snoozedCount
      : null,
  }));
  const sortOptions = SORT_OPTIONS.filter(o => o.key !== 'reports' || currentQueue === 'kind:issue');
  const currentSort = sortOptions.find(o => o.key === sortBy) || sortOptions[0];

  // Bulk palette entries for the current view (plain data; rendered below)
  type BulkItem = { key: string; label: string; icon?: React.ReactNode; run: () => void; sub?: boolean; danger?: boolean; hint?: string };
  const n = selectedIds.size;
  const plural = (k: number) => `${k} conversation${k === 1 ? '' : 's'}`;
  const bulkItems: BulkItem[] = (() => {
    switch (bulkView) {
      case 'root': return [
        { key: 'close', label: `Close ${plural(n)}`, icon: <CloseConversationIcon className="w-4 h-4" />, run: () => runBulk('status', 'closed', k => `Closed ${plural(k)}`) },
        { key: 'state', label: 'Change state', icon: <CircleDot className="w-4 h-4" />, run: () => openBulk('state'), sub: true },
        { key: 'snooze', label: 'Snooze', icon: <AlarmClock className="w-4 h-4" />, run: () => openBulk('snooze'), sub: true },
        { key: 'assign', label: 'Assign to', icon: <UserCheck className="w-4 h-4" />, run: () => openBulk('assign'), sub: true },
        { key: 'priority', label: 'Priority', icon: <PriorityIcon priority="medium" />, run: () => openBulk('priority'), sub: true },
        { key: 'edit', label: `Edit ${n} item${n === 1 ? '' : 's'}`, icon: <PenLine className="w-4 h-4" />, run: () => openBulk('edit'), sub: true },
        allSelected
          ? { key: 'clear', label: 'Clear selection', icon: <X className="w-4 h-4" />, run: () => { clearSelection(); setBulkView(null); } }
          : { key: 'all', label: `Select all ${visibleConversations.length} items`, icon: <CheckSquare className="w-4 h-4" />, run: () => { selectAll(); setBulkView(null); } },
        { key: 'txt', label: 'Export as text', icon: <FileText className="w-4 h-4" />, run: () => { setBulkView(null); if (token) exportAsText(selectedConvs, token); } },
        { key: 'pdf', label: 'Export as PDF', icon: <FileDown className="w-4 h-4" />, run: () => { setBulkView(null); if (token) exportAsPdf(selectedConvs, token); } },
        ...(agent?.role === 'admin' ? [{ key: 'delete', label: `Delete ${plural(n)}`, icon: <Trash2 className="w-4 h-4" />, run: () => openBulk('delete'), sub: true, danger: true }] : []),
      ];
      case 'state': return [
        { key: 'open', label: 'In progress', icon: <CircleDot className="w-4 h-4 text-accent" />, run: () => runBulk('status', 'open', k => `Moved ${plural(k)} to In progress`) },
        { key: 'waiting', label: 'Waiting on customer', icon: <Hourglass className="w-4 h-4 text-red-500" />, run: () => runBulk('status', 'waiting', k => `${plural(k)} waiting on customer`) },
        { key: 'resolved', label: 'Resolved', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, run: () => runBulk('status', 'resolved', k => `Resolved ${plural(k)}`) },
        { key: 'closed', label: 'Close', icon: <CloseConversationIcon className="w-4 h-4" />, run: () => runBulk('status', 'closed', k => `Closed ${plural(k)}`) },
        { key: 'archived', label: 'Archive', icon: <Archive className="w-4 h-4 text-muted" />, run: () => runBulk('status', 'archived', k => `Archived ${plural(k)}`) },
      ];
      case 'snooze': return [
        ...snoozeOptions.map(o => ({ key: o.value, label: o.label, hint: o.sub, icon: <AlarmClock className="w-4 h-4" />, run: () => runBulk('snooze', computeSnoozeUntil(o.value), k => `Snoozed ${plural(k)}`) })),
        { key: 'unsnooze', label: 'Unsnooze', icon: <X className="w-4 h-4" />, run: () => runBulk('snooze', null, k => `Unsnoozed ${plural(k)}`) },
      ];
      case 'assign': return [
        { key: 'none', label: 'Unassigned', icon: <User className="w-4 h-4" />, run: () => runBulk('assign', null, k => `Unassigned ${plural(k)}`) },
        ...agents.map(a => ({
          key: a.id, label: a.id === agent?.id ? `${a.name} (you)` : a.name,
          icon: a.avatar ? <img src={a.avatar} alt="" className="w-4 h-4 rounded-full object-cover" /> : <span className="w-4 h-4 rounded-full bg-subtle text-[9px] font-semibold flex items-center justify-center">{a.name.charAt(0)}</span>,
          run: () => runBulk('assign', a.id, k => `Assigned ${plural(k)} to ${a.name}`),
        })),
      ];
      case 'priority': return PRIORITY_OPTIONS.map(o => ({ key: o.value, label: o.label, icon: <PriorityIcon priority={o.value} />, run: () => runBulk('priority', o.value, k => `Set ${plural(k)} to ${o.label}`) }));
      case 'edit': return [
        { key: 'category', label: 'Category', icon: <Layers className="w-4 h-4" />, run: () => openBulk('category'), sub: true },
        { key: 'tag', label: 'Add tag', icon: <TagIcon className="w-4 h-4" />, run: () => openBulk('tag'), sub: true },
        { key: 'priority', label: 'Priority', icon: <PriorityIcon priority="medium" />, run: () => openBulk('priority'), sub: true },
      ];
      case 'category': return [
        ['general', 'General'], ['bug', 'Bug'], ['payment', 'Payment'], ['subscription', 'Subscription'],
        ['refund', 'Refund'], ['feature_request', 'Feature request'], ['other', 'Other'],
      ].map(([v, l]) => ({ key: v, label: l, run: () => runBulk('category', v, k => `Set category of ${plural(k)} to ${l}`) }));
      case 'tag': return allTags.map(t => ({
        key: t.id, label: t.name, icon: <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />,
        run: () => runBulk('addTag', t.name, k => `Tagged ${plural(k)} ${t.name}`),
      }));
      default: return [];
    }
  })();
  const bulkFiltered = bulkItems.filter(i => i.label.toLowerCase().includes(bulkQuery.trim().toLowerCase()));
  const bulkTitles: Record<string, string> = {
    root: 'Bulk actions', state: 'Change state', snooze: 'Snooze', assign: 'Assign to', priority: 'Priority',
    edit: `Edit ${n} item${n === 1 ? '' : 's'}`, category: 'Category', tag: 'Add tag', delete: `Delete ${plural(n)}`,
  };
  const bulkParent: Record<string, NonNullable<typeof bulkView>> = { category: 'edit', tag: 'edit' };
  const searchVisible = showSearch || searchTerm.trim() !== '';

  return (
    <div className="ic-panel-side w-[340px] 2xl:w-[380px] h-full shrink-0 flex flex-col relative">
      {closingConv && (
        <CloseDialog
          currentStatus={closingConv.status}
          ticketLabel={closingConv.ticketNumber}
          onClose={() => setClosingConv(null)}
          onPick={status => { const c = closingConv; setClosingConv(null); setConversationStatus(c.id, status); }}
        />
      )}
      
      {/* Click outside overlay to close card menus and popovers */}
      {(openMenuConvId || openPopover) && (
        <div 
          className="fixed inset-0 z-20" 
          onClick={() => { setOpenMenuConvId(null); setOpenPopover(null); }}
        />
      )}

      {/* Header */}
      <div className="ic-panel-header px-4 border-dashed">
        <button
          onClick={() => setInboxNavOpen(!inboxNavOpen)}
          className="ic-icon-btn-ghost -ml-1"
          title={inboxNavOpen ? 'Hide inbox navigation' : 'Show inbox navigation'}
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>
        <h2 className="ic-title flex-1 min-w-0">{queueTitle}</h2>
        <button
          onClick={() => {
            const next = !searchVisible;
            setShowSearch(next);
            if (!next) setSearchTerm('');
            else setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          className={`ic-icon-btn ${searchVisible ? 'bg-ink/10' : ''}`}
          title={searchVisible ? 'Close search' : 'Search'}
        >
          {searchVisible ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {/* Search + filter controls */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2.5 shrink-0">
        {searchVisible && (
          <div className="relative animate-fade-in">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchTerm(''); setShowSearch(false); } }}
              placeholder="Search tickets, customers..."
              className="ic-input h-9 pl-9 rounded-full bg-surface"
            />
          </div>
        )}

        {/* Bulk selection bar (replaces the chip row while conversations are selected) */}
        {selectionMode && (
          <div className="flex items-center gap-0.5 min-w-0 h-8">
            <button
              onClick={() => (allSelected ? clearSelection() : selectAll())}
              className="w-[18px] h-[18px] rounded-[5px] bg-ink text-on-ink flex items-center justify-center shrink-0 mr-1"
              title={allSelected ? 'Clear selection (Esc)' : 'Select all'}
            >
              {allSelected ? <Check className="w-3 h-3" strokeWidth={3} /> : <Minus className="w-3 h-3" strokeWidth={3} />}
            </button>
            <span className="flex min-w-0 text-[14px] font-medium text-ink whitespace-nowrap" title={`${n} of ${visibleConversations.length} selected`}>
              <span className="tabular-nums shrink-0">{n}/{visibleConversations.length}</span>
              <span className="truncate">&nbsp;selected</span>
            </span>
            <div className="flex-1 min-w-1" />
            <button onClick={() => openBulk('root')} className="ic-icon-btn-ghost w-7 h-7" title="More bulk actions"><MoreHorizontal className="w-4 h-4" /></button>
            <button onClick={() => openBulk('assign')} className="ic-icon-btn-ghost w-7 h-7" title="Assign"><UserCheck className="w-4 h-4" /></button>
            <button onClick={() => openBulk('edit')} className="ic-icon-btn-ghost w-7 h-7" title={`Edit ${n} item${n === 1 ? '' : 's'}`}><PenLine className="w-4 h-4" /></button>
            <button onClick={() => openBulk('snooze')} className="ic-icon-btn-ghost w-7 h-7" title="Snooze"><AlarmClock className="w-4 h-4" /></button>
            <button
              onClick={() => runBulk('status', 'closed', k => `Closed ${plural(k)}`)}
              disabled={bulkBusy}
              className="w-7 h-7 ml-0.5 shrink-0 inline-flex items-center justify-center rounded-full bg-ink text-on-ink hover:bg-ink/85 disabled:opacity-50"
              title={`Close ${plural(n)}`}
            >
              <InboxIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        {bulkNotice && (
          <div className={`text-[13px] px-3 py-1.5 rounded-lg animate-fade-in ${bulkNotice.error ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-subtle text-ink'}`}>
            {bulkNotice.text}
          </div>
        )}

        {/* Chip row: state view + sort + filters */}
        <div className={`flex items-center gap-1.5 min-w-0 ${selectionMode ? 'hidden' : ''}`}>
          {/* "N Open" state view chip */}
          <div className="relative shrink-0">
            <button
              onClick={() => setOpenPopover(openPopover === 'view' ? null : 'view')}
              className={`ic-chip px-2.5 ${openPopover === 'view' ? 'bg-subtle' : ''}`}
              title="Filter by state (open, waiting, snoozed, resolved, closed...)"
            >
              {stateView === 'snoozed' && <AlarmClock className="w-3.5 h-3.5 text-muted shrink-0" />}
              <span className="tabular-nums shrink-0">{visibleConversations.length}</span>
              <span className="whitespace-nowrap">{viewLabel}</span>
            </button>
            {openPopover === 'view' && (
              <div className="ic-menu absolute left-0 top-full mt-1.5 w-56 animate-fade-in">
                {viewOptions.map(o => (
                  <button
                    key={o.key}
                    onClick={() => { setStateView(o.key); setOpenPopover(null); }}
                    className="ic-menu-item"
                  >
                    {o.key === 'snoozed' ? <AlarmClock className="w-4 h-4 text-muted" /> : <span className="w-4" />}
                    <span className="flex-1 truncate">{o.label}</span>
                    <span className="text-[13px] text-faint tabular-nums">{stateCounts ? stateCounts[o.key] ?? '' : (o.key === stateView ? visibleConversations.length : o.count ?? '')}</span>
                    <span className="w-4 flex justify-end">{stateView === o.key && <Check className="w-4 h-4 text-accent" />}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Sort chip (gives up space first on narrow panels) */}
          <div className="relative min-w-0">
            <button
              onClick={() => setOpenPopover(openPopover === 'sort' ? null : 'sort')}
              className={`ic-chip px-2.5 max-w-full min-w-0 ${openPopover === 'sort' ? 'bg-subtle' : ''}`}
              title={`Sort conversations (${currentSort.label})`}
            >
              <span className="truncate">{currentSort.label}</span>
            </button>
            {openPopover === 'sort' && (
              <div className="ic-menu absolute right-0 top-full mt-1.5 w-56 animate-fade-in">
                {sortOptions.map(o => (
                  <button
                    key={o.key}
                    onClick={() => { setSortBy(o.key); setOpenPopover(null); }}
                    className="ic-menu-item"
                  >
                    <o.icon className={`w-4 h-4 ${sortBy === o.key ? 'text-accent' : 'text-muted'}`} />
                    <span className="flex-1">{o.label}</span>
                    {sortBy === o.key && <Check className="w-4 h-4 text-accent" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort direction */}
          <button
            onClick={() => setSortDesc(d => !d)}
            className="w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle transition-colors"
            title={sortDesc ? 'Descending (newest / highest first)' : 'Ascending (oldest / lowest first)'}
          >
            {sortDesc ? <ArrowDownWideNarrow className="w-4 h-4" /> : <ArrowUpNarrowWide className="w-4 h-4" />}
          </button>

          {/* Filters toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            title="Filters"
            className={`relative w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full border border-line bg-surface hover:bg-subtle transition-colors ${showFilters ? 'bg-subtle border-ink/20' : ''}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Expandable filters drawer */}
        {showFilters && (
          <div className="flex flex-col gap-2.5 p-3.5 bg-surface rounded-xl border border-line animate-slide-up">
            <div className="flex justify-between items-center">
              <span className="text-[13px] font-semibold text-ink">Filters</span>
              <button 
                onClick={() => {
                  setFilterPriority('all');
                  setFilterCategory('all');
                  setFilterTag('all');
                  setStateView('open');
                }}
                className="ic-link text-[13px] font-medium"
              >
                Clear
              </button>
            </div>

            {/* State filter (same as the "N Open" chip) */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">State</span>
              <select
                value={stateView}
                onChange={(e) => setStateView(e.target.value as StateFilter)}
                className="ic-select h-8 w-40 text-[13px]"
              >
                {STATE_FILTERS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>

            {/* Priority filter */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Priority</span>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="ic-select h-8 w-40 text-[13px]"
              >
                <option value="all">All</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Urgent</option>
                <option value="none">No priority</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Category</span>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="ic-select h-8 w-40 text-[13px]"
              >
                <option value="all">All</option>
                <option value="general">General</option>
                <option value="bug">Bug</option>
                <option value="payment">Payment</option>
                <option value="subscription">Subscription</option>
                <option value="refund">Refund</option>
                <option value="feature_request">Feature Request</option>
              </select>
            </div>

            {/* Tags Filter */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Tag</span>
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="ic-select h-8 w-40 text-[13px]"
              >
                <option value="all">All</option>
                {tags.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Conversations feed */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1 flex flex-col gap-0.5">
        {visibleConversations.length === 0 ? (
          <div className="ic-empty p-8 h-64">
            {stateView === 'snoozed'
              ? <AlarmClock className="w-10 h-10 text-muted" strokeWidth={1.5} />
              : <AlertCircle className="w-10 h-10 text-muted" strokeWidth={1.5} />}
            <span className="text-[15px] font-semibold text-ink/80">
              {stateView === 'snoozed' ? 'No snoozed conversations' : `No ${viewLabel.toLowerCase()} ${currentQueue === 'kind:issue' ? 'issues' : currentQueue === 'kind:ticket' ? 'tickets' : 'conversations'}`}
            </span>
            <span className="text-[13px]">
              {stateView === 'snoozed'
                ? 'Snoozed conversations show up here until they wake up.'
                : currentQueue === 'kind:issue'
                  ? 'Issues track one problem many customers report. Link conversations to an issue from their ⋯ menu.'
                  : currentQueue === 'kind:ticket'
                    ? 'Customer tickets are requests your team follows up on. Convert a conversation from its ⋯ menu, or create one.'
                    : 'Try adjusting filters or seeding mock testing data.'}
            </span>
            {(currentQueue === 'kind:issue' || currentQueue === 'kind:ticket') && !isLight && (
              <button
                className="ic-btn-primary mt-3"
                onClick={() => useStore.getState().setComposer({ kind: currentQueue === 'kind:issue' ? 'issue' : 'ticket' })}
              >
                <Plus className="w-4 h-4" /> {currentQueue === 'kind:issue' ? 'Create issue' : 'Create ticket'}
              </button>
            )}
          </div>
        ) : (
          visibleConversations.map((c, rowIndex) => {
            const isActive = c.id === activeConversationId;
            const isSelected = selectedIds.has(c.id);
            const snoozed = isSnoozed(c, now);
            const hasUnread = c.unreadCountAgent > 0;

            return (
              <div key={c.id} className="relative group/card">
                <div
                  role="button"
                  tabIndex={0}
                  data-conv-row
                  data-conv-id={c.id}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setActiveConversationId(c.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveConversationId(c.id);
                    }
                  }}
                  className={`w-full px-3 py-2.5 rounded-xl text-left flex items-start gap-3 relative cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-link/40 ${
                    isActive 
                      ? 'bg-surface shadow-card' 
                      : isSelected ? 'bg-link/[0.06]' : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  {/* Avatar: ticket / issue icon, ↩ when the team sent the last message, otherwise the customer's initial.
                      Swapped for a checkbox on hover or while selecting. */}
                  <div className="relative w-6 h-6 shrink-0 mt-px">
                  <div className={selectionMode || isSelected ? 'invisible' : 'group-hover/card:invisible'}>
                  {c.kind === 'ticket' || c.kind === 'issue' ? (
                    <div className="ic-avatar w-6 h-6 bg-ink/[0.08] text-ink" title={c.kind === 'issue' ? 'Tracker issue' : 'Customer ticket'}>
                      {c.kind === 'issue' ? <Wrench className="w-3.5 h-3.5" strokeWidth={2.4} /> : <Ticket className="w-3.5 h-3.5" strokeWidth={2.4} />}
                    </div>
                  ) : c.lastMessageFrom === 'team' ? (
                    <div className="ic-avatar w-6 h-6 bg-ink/[0.06] text-ink" title="Your team sent the last message">
                      <Reply className="w-3.5 h-3.5" strokeWidth={2.4} />
                    </div>
                  ) : (
                    <div className={`ic-avatar w-6 h-6 text-[12px] font-semibold uppercase ${getAvatarColors(c.category)}`}>
                      {c.customer.name.charAt(0) || 'G'}
                    </div>
                  )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(c.id, rowIndex, e.shiftKey); }}
                    className={`absolute inset-0 flex items-center justify-center ${isLight ? 'hidden' : ''} ${selectionMode || isSelected ? '' : 'opacity-0 group-hover/card:opacity-100 focus:opacity-100'}`}
                    title={isSelected ? 'Deselect' : 'Select (Shift-click to select a range)'}
                    aria-pressed={isSelected}
                  >
                    <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-ink border-ink text-on-ink' : 'border-ink/30 bg-surface hover:border-ink/60'}`}>
                      {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                  </button>
                  </div>

                  {/* Body: name line, then (tickets/issues) "#number • title", then the latest message */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex justify-between items-center gap-2 min-w-0 h-6">
                      <span className={`text-[15px] truncate ${
                        hasUnread ? 'font-semibold text-ink' : 'font-normal text-ink/70'
                      }`}>
                        {c.channel === 'email' && <Mail className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-muted" aria-label="Email" />}
                        {c.kind === 'issue' ? (c.title || c.ticketNumber) : c.customer.name}
                      </span>
                      {/* Teammates who have it open right now */}
                      <PresenceDots viewers={othersIn(presence[c.id], agent?.id)} />
                      {/* Right side, Intercom-style:
                          normal: priority · time — hovered: close · ⋯ · time — open conversation: close · ⋯ · priority · time.
                          Every icon sits in the same 22px slot, so the gaps are even. */}
                      <div className="flex items-center shrink-0 z-30 -mr-1">
                        {c.status !== 'closed' && !isLight && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setClosingConv({ id: c.id, status: c.status, ticketNumber: c.ticketNumber }); }}
                            title="Close conversation"
                            className={`${isActive || openMenuConvId === c.id ? 'inline-flex' : 'hidden group-hover/card:inline-flex'} w-[22px] h-[22px] items-center justify-center rounded-full text-ink hover:bg-ink/[0.08] transition-colors shrink-0`}
                          >
                            <CloseConversationIcon className="w-4 h-4" />
                          </button>
                        )}
                        {!isLight && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openRowMenu(c.id, e.currentTarget); }}
                            title="More actions"
                            className={`${isActive || openMenuConvId === c.id ? 'inline-flex' : 'hidden group-hover/card:inline-flex'} w-[22px] h-[22px] items-center justify-center rounded-full text-ink hover:bg-ink/[0.08] transition-colors shrink-0 ${openMenuConvId === c.id ? 'bg-ink/[0.08]' : ''}`}
                          >
                            <MoreHorizontal className="w-4 h-4" strokeWidth={3} />
                          </button>
                        )}
                        {/* Status icons: hidden while hovering a row that isn't open (the actions take their place) */}
                        {c.starred && (
                          <span className={`w-[22px] h-[22px] items-center justify-center shrink-0 ${isActive || openMenuConvId === c.id ? 'inline-flex' : 'inline-flex group-hover/card:hidden'}`}>
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" aria-label="Starred" />
                          </span>
                        )}
                        {c.priority && c.priority !== 'none' && (
                          <span title={priorityLabel(c.priority)} className={`w-[22px] h-[22px] items-center justify-center shrink-0 ${isActive || openMenuConvId === c.id ? 'inline-flex' : 'inline-flex group-hover/card:hidden'}`}>
                            <PriorityIcon priority={c.priority} className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="text-[13px] text-faint tabular-nums pl-1 pr-1">
                          {formatTime(c.updatedAt || c.createdAt)}
                        </span>
                      </div>
                    </div>

                    {(c.kind === 'ticket' || c.kind === 'issue') && (
                      <p className="text-[14px] leading-5 truncate text-muted">
                        {c.ticketNumber} • {c.kind === 'issue'
                          ? `${c.reportCount ?? 0} report${c.reportCount === 1 ? '' : 's'}`
                          : (c.title || 'Ticket')}
                      </p>
                    )}

                    {/* Latest message, with SLA and unread count */}
                    <div className="flex justify-between items-center gap-2.5 min-w-0">
                      <p className={`text-[14px] leading-5 truncate flex-1 ${hasUnread ? 'text-ink font-medium' : 'text-muted'}`}>
                        {c.kind === 'issue'
                          ? (c.description || c.lastMessageSnippet || 'Tracker issue')
                          : (c.lastMessageSnippet || (c.kind === 'ticket' ? c.description : '') || 'No messages in conversation')}
                      </p>
                      <SlaChip conv={c} />
                      {hasUnread && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center tabular-nums shrink-0">
                          {c.unreadCountAgent}
                        </span>
                      )}
                    </div>

                    {snoozed && c.snoozedUntil && (
                      <span className="mt-1 self-start inline-flex items-center gap-1 h-5 px-2 rounded-full text-[12px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 min-w-0 max-w-full">
                        <AlarmClock className="w-3 h-3 shrink-0" />
                        <span className="truncate">{formatSnoozeUntil(c.snoozedUntil)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Dropdown Menu on Card */}
                {openMenuConvId === c.id && rowMenuPos && (
                  <div
                    className="ic-menu fixed w-64 animate-fade-in"
                    style={{ top: rowMenuPos.top, left: rowMenuPos.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowMenuView === 'main' && (
                      <>
                        <button onClick={() => setRowMenuView('snooze')} className="ic-menu-item">
                          <AlarmClock className="w-4 h-4 text-muted" />
                          <span className="flex-1">{snoozed ? 'Snoozed' : 'Snooze'}</span>
                          <ChevronRight className="w-4 h-4 text-muted" />
                        </button>
                        <button onClick={() => setRowMenuView('assign')} className="ic-menu-item">
                          <UserCheck className="w-4 h-4 text-muted" />
                          <span className="flex-1">Assign</span>
                          <ChevronRight className="w-4 h-4 text-muted" />
                        </button>
                        <div className="my-1.5 border-t border-line" />
                        <div className="px-3.5 pt-0.5 pb-1 text-[12px] font-medium text-faint">Priority</div>
                        {PRIORITY_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            onClick={() => { handleSetPriority(c.id, o.value); setOpenMenuConvId(null); }}
                            className="ic-menu-item"
                          >
                            <PriorityIcon priority={o.value} />
                            <span className="flex-1">{o.label}</span>
                            {(c.priority || 'none') === o.value && <Check className="w-4 h-4 text-accent" />}
                          </button>
                        ))}
                        <div className="my-1.5 border-t border-line" />
                        <button
                          onClick={() => { handleToggleStar(c.id, c.starred || false); setOpenMenuConvId(null); }}
                          className="ic-menu-item"
                        >
                          <Star className={`w-4 h-4 ${c.starred ? 'fill-amber-400 text-amber-400' : 'text-muted'}`} />
                          <span>{c.starred ? 'Remove star' : 'Star conversation'}</span>
                        </button>
                      </>
                    )}

                    {rowMenuView === 'snooze' && (
                      <>
                        <button onClick={() => setRowMenuView('main')} className="ic-menu-item text-muted">
                          <ChevronLeft className="w-4 h-4" /> Snooze
                        </button>
                        <div className="my-1 border-t border-line" />
                        {snoozed && (
                          <button onClick={() => { handleSnooze(c.id, null); setOpenMenuConvId(null); }} className="ic-menu-item">
                            <AlarmClock className="w-4 h-4 text-muted" /> Unsnooze
                          </button>
                        )}
                        {snoozeOptions.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => { handleSnooze(c.id, computeSnoozeUntil(opt.value)); setOpenMenuConvId(null); }}
                            className="ic-menu-item justify-between"
                          >
                            <span>{opt.label}</span>
                            <span className="text-[12px] text-faint">{opt.sub}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {rowMenuView === 'assign' && (
                      <>
                        <button onClick={() => setRowMenuView('main')} className="ic-menu-item text-muted">
                          <ChevronLeft className="w-4 h-4" /> Assign
                        </button>
                        <div className="my-1 border-t border-line" />
                        <div className="max-h-64 overflow-y-auto">
                          <button onClick={() => { handleAssignTo(c.id, null); setOpenMenuConvId(null); }} className="ic-menu-item">
                            <User className="w-4 h-4 text-muted" />
                            <span className="flex-1">Unassigned</span>
                            {!c.assignedAgentId && <Check className="w-4 h-4 text-accent" />}
                          </button>
                          {agents.map(a => (
                            <button key={a.id} onClick={() => { handleAssignTo(c.id, a.id); setOpenMenuConvId(null); }} className="ic-menu-item">
                              {a.avatar
                                ? <img src={a.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                                : <span className="w-4 h-4 rounded-full bg-subtle text-[9px] font-semibold flex items-center justify-center">{a.name.charAt(0)}</span>}
                              <span className="flex-1 truncate">{a.id === agent?.id ? `${a.name} (you)` : a.name}</span>
                              {c.assignedAgentId === a.id && <Check className="w-4 h-4 text-accent" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bulk actions command palette */}
      {bulkView && (
        <div className="fixed inset-0 z-[60] bg-black/30 flex items-start justify-center px-4 pt-[14vh] animate-fade-in" onClick={() => setBulkView(null)}>
          <div className="w-full max-w-[560px] bg-surface rounded-2xl shadow-pop overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bulk actions">
            <div className="flex items-center gap-2 px-3 h-12 border-b border-line">
              {bulkView !== 'root' && (
                <button onClick={() => openBulk(bulkParent[bulkView] || 'root')} className="ic-icon-btn-ghost" title="Back"><ArrowLeft className="w-4 h-4" /></button>
              )}
              <span className="text-[15px] font-semibold text-ink pl-1">{bulkTitles[bulkView]}</span>
              <span className="ml-auto text-[13px] text-muted">{n} selected</span>
            </div>

            {bulkView === 'delete' ? (
              <div className="p-5 flex flex-col gap-4">
                <p className="text-[14px] text-ink leading-relaxed">
                  Permanently delete <b>{plural(n)}</b> and all of their messages, notes and events? This can't be undone.
                  Closing or archiving keeps the history instead.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => openBulk('root')} className="ic-btn-ghost">Cancel</button>
                  <button
                    onClick={() => runBulk('delete', null, k => `Deleted ${plural(k)}`)}
                    disabled={bulkBusy}
                    className="ic-btn-danger"
                  >
                    {bulkBusy ? 'Deleting…' : `Delete ${plural(n)}`}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
                  <Search className="w-4 h-4 text-faint shrink-0" />
                  <input
                    autoFocus
                    value={bulkQuery}
                    onChange={(e) => { setBulkQuery(e.target.value); setBulkIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setBulkIndex(i => Math.min(i + 1, Math.max(bulkFiltered.length - 1, 0))); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setBulkIndex(i => Math.max(i - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); bulkFiltered[bulkIndex]?.run(); }
                      else if (e.key === 'Escape') { e.preventDefault(); bulkView === 'root' ? setBulkView(null) : openBulk(bulkParent[bulkView] || 'root'); }
                    }}
                    placeholder="Type a command or search..."
                    className="flex-1 min-w-0 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
                  />
                </div>
                <div className="p-2 flex flex-col gap-0.5 max-h-[50vh] overflow-y-auto">
                  {bulkView === 'root' && <div className="px-3 pt-1 pb-1.5 text-[12px] font-medium text-faint">Bulk actions</div>}
                  {bulkFiltered.length === 0 && (
                    <div className="px-3 py-6 text-center text-[14px] text-muted">{bulkView === 'tag' && allTags.length === 0 ? 'No tags yet — create tags in a conversation first' : 'No matching actions'}</div>
                  )}
                  {bulkFiltered.map((item, i) => (
                    <button
                      key={item.key}
                      onMouseEnter={() => setBulkIndex(i)}
                      onClick={item.run}
                      disabled={bulkBusy}
                      className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left transition-colors disabled:opacity-50 ${i === bulkIndex ? 'bg-subtle' : ''} ${item.danger ? 'text-red-600 dark:text-red-400' : 'text-ink'}`}
                    >
                      <span className="w-4 flex justify-center shrink-0">{item.icon}</span>
                      <span className="text-[15px] truncate flex-1">{item.label}</span>
                      {item.hint && <span className="text-[13px] text-faint">{item.hint}</span>}
                      {item.sub && <ChevronRight className="w-4 h-4 text-muted" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="px-4 h-10 flex items-center border-t border-line text-[12px] text-muted">
              ↑↓ navigate · ↵ select · esc {bulkView === 'root' ? 'close' : 'back'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InboxList;
