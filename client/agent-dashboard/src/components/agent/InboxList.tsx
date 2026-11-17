import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import {
  Search, SlidersHorizontal, AlertCircle, Star, MoreHorizontal, PanelLeft, X, Check,
  AlarmClock, Bell, CalendarDays, SignalHigh, ArrowDownWideNarrow, ArrowUpNarrowWide
} from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { SNOOZE_OPTIONS, computeSnoozeUntil, isSnoozed, formatSnoozeUntil } from '../../lib/snooze';

type SortKey = 'last_activity' | 'date_started' | 'priority' | 'snoozed_until';
type StateView = 'active' | 'snoozed' | 'all';

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] = [
  { key: 'last_activity', label: 'Last activity', icon: Bell },
  { key: 'date_started', label: 'Date started', icon: CalendarDays },
  { key: 'priority', label: 'Priority', icon: SignalHigh },
  { key: 'snoozed_until', label: 'Snoozed until', icon: AlarmClock },
];

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const BACKEND_URL = 'http://localhost:3000';

interface InboxListProps {
  currentQueue: string; // 'open' | 'assigned' | 'waiting' | 'resolved' | 'closed' | 'archived'
}

export const InboxList: React.FC<InboxListProps> = ({ currentQueue }) => {
  const conversations = useStore((state) => state.conversations);
  const setConversations = useStore((state) => state.setConversations);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const setActiveConversationId = useStore((state) => state.setActiveConversationId);
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
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
  const [sortDesc, setSortDesc] = useState(true);
  const [stateView, setStateView] = useState<StateView>('active');
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

  // Fetch conversations based on queue and filters
  useEffect(() => {
    if (!token) return;

    const fetchConvs = async () => {
      try {
        let url = `${BACKEND_URL}/api/tickets?`;
        
        // Map queue names to statuses
        if (currentQueue === 'open') {
          url += 'status=open';
        } else if (currentQueue === 'assigned') {
          url += `status=open,waiting&assignedAgentId=${agent?.id}`;
        } else if (currentQueue === 'waiting') {
          url += 'status=waiting';
        } else if (currentQueue === 'resolved') {
          url += 'status=resolved';
        } else if (currentQueue === 'closed') {
          url += 'status=closed';
        } else if (currentQueue === 'archived') {
          url += 'status=archived';
        }

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
        }
      } catch (err) {
        console.error('Failed to load tickets:', err);
      }
    };

    fetchConvs();
  }, [currentQueue, filterPriority, filterCategory, filterTag, searchTerm, token, agent, setConversations]);

  // Apply the Open/Snoozed/All view and the chosen sort order
  const visibleConversations = useMemo(() => {
    const byView = conversations.filter((c: Conversation) => {
      const snoozed = isSnoozed(c, now);
      if (stateView === 'snoozed') return snoozed;
      if (stateView === 'active') return !snoozed;
      return true;
    });
    const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);
    const keyOf = (c: Conversation): number => {
      switch (sortBy) {
        case 'date_started': return time(c.createdAt);
        case 'priority': return PRIORITY_RANK[c.priority] || 0;
        case 'snoozed_until': return isSnoozed(c, now) ? time(c.snoozedUntil) : 0;
        default: return time(c.updatedAt || c.createdAt);
      }
    };
    return [...byView].sort((a, b) => {
      const diff = keyOf(b) - keyOf(a);
      if (diff !== 0) return sortDesc ? diff : -diff;
      return time(b.updatedAt) - time(a.updatedAt); // stable tie-break: most recent first
    });
  }, [conversations, stateView, sortBy, sortDesc, now]);

  // Auto-select the first conversation if none is selected, or if the selected one is not in the visible list
  useEffect(() => {
    if (visibleConversations.length > 0) {
      const currentActiveExists = visibleConversations.some(c => c.id === activeConversationId);
      if (!activeConversationId || !currentActiveExists) {
        setActiveConversationId(visibleConversations[0].id);
      }
    }
  }, [visibleConversations, activeConversationId, setActiveConversationId]);


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

  // Quiet category badges: neutral by default, faint tint only where it carries meaning
  const getCategoryBadgeStyles = (category: string) => {
    switch (category) {
      case 'bug':
        return 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300';
      default:
        return '';
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

  const queueTitles: Record<string, string> = {
    open: 'Open',
    assigned: 'Assigned to me',
    waiting: 'Waiting',
    resolved: 'Resolved',
    closed: 'Closed',
    archived: 'Archived',
  };
  const queueTitle = queueTitles[currentQueue] || currentQueue;
  const activeFilterCount =
    [filterPriority, filterCategory, filterTag].filter((v) => v !== 'all').length + (stateView !== 'active' ? 1 : 0);
  const snoozedCount = conversations.filter((c: Conversation) => isSnoozed(c, now)).length;
  const viewLabel = stateView === 'snoozed' ? 'Snoozed' : stateView === 'all' ? 'All' : queueTitle;
  const viewOptions: { key: StateView; label: string; count: number }[] = [
    { key: 'active', label: queueTitle, count: conversations.length - snoozedCount },
    { key: 'snoozed', label: 'Snoozed', count: snoozedCount },
    { key: 'all', label: 'All', count: conversations.length },
  ];
  const currentSort = SORT_OPTIONS.find(o => o.key === sortBy) || SORT_OPTIONS[0];
  const searchVisible = showSearch || searchTerm.trim() !== '';

  return (
    <div className="ic-panel-side w-[300px] 2xl:w-[340px] h-full shrink-0 flex flex-col relative">
      
      {/* Click outside overlay to close card menus and popovers */}
      {(openMenuConvId || openPopover) && (
        <div 
          className="fixed inset-0 z-20" 
          onClick={() => { setOpenMenuConvId(null); setOpenPopover(null); }}
        />
      )}

      {/* Header */}
      <div className="ic-panel-header px-4">
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

        {/* Chip row: state view + sort + filters */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* "N Open" state view chip */}
          <div className="relative shrink-0">
            <button
              onClick={() => setOpenPopover(openPopover === 'view' ? null : 'view')}
              className={`ic-chip px-2.5 ${openPopover === 'view' ? 'bg-subtle' : ''}`}
              title="Show open, snoozed or all conversations"
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
                    <span className="text-[13px] text-faint tabular-nums">{o.count}</span>
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
                {SORT_OPTIONS.map(o => (
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
                  setStateView('active');
                }}
                className="ic-link text-[13px] font-medium"
              >
                Clear
              </button>
            </div>

            {/* State view filter (Open / Snoozed / All) */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-muted">Show</span>
              <div className="flex items-center p-0.5 rounded-full bg-subtle w-40">
                {viewOptions.map(o => (
                  <button
                    key={o.key}
                    onClick={() => setStateView(o.key)}
                    className={`flex-1 h-7 rounded-full text-[12px] font-medium truncate px-1.5 transition-colors ${
                      stateView === o.key ? 'bg-surface shadow-pill text-ink' : 'text-muted hover:text-ink'
                    }`}
                    title={`${o.label} (${o.count})`}
                  >
                    {o.key === 'active' ? 'Active' : o.label}
                  </button>
                ))}
              </div>
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
                <option value="critical">Critical</option>
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
              {stateView === 'snoozed' ? 'No snoozed conversations' : 'No tickets found'}
            </span>
            <span className="text-[13px]">
              {stateView === 'snoozed'
                ? 'Snoozed conversations show up here until they wake up.'
                : 'Try adjusting filters or seeding mock testing data.'}
            </span>
          </div>
        ) : (
          visibleConversations.map((c) => {
            const isActive = c.id === activeConversationId;
            const snoozed = isSnoozed(c, now);
            const hasUnread = c.unreadCountAgent > 0;
            const categoryBadge = getCategoryBadgeStyles(c.category);

            return (
              <div key={c.id} className="relative group/card">
                <div
                  role="button"
                  tabIndex={0}
                  data-conv-row
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setActiveConversationId(c.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveConversationId(c.id);
                    }
                  }}
                  className={`w-full px-3 py-3 rounded-xl text-left flex items-start gap-3 relative cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-link/40 ${
                    isActive 
                      ? 'bg-surface shadow-card' 
                      : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  {/* Avatar Circle */}
                  <div className={`ic-avatar w-8 h-8 text-[13px] uppercase ${getAvatarColors(c.category)}`}>
                    {c.customer.name.charAt(0) || 'G'}
                  </div>

                  {/* Body info */}
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex justify-between items-center gap-2 min-w-0 h-6">
                      <span className={`text-[15px] truncate ${
                        hasUnread ? 'font-semibold text-ink' : 'font-normal text-ink/70'
                      }`}>
                        {c.customer.name}
                      </span>
                      {/* Icons Action container */}
                      <div className="flex items-center gap-1 shrink-0 z-30">
                        {c.starred && (
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuConvId(openMenuConvId === c.id ? null : c.id);
                          }}
                          title="More actions"
                          className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-ink/[0.06] transition-colors shrink-0 focus:opacity-100 ${
                            openMenuConvId === c.id ? 'opacity-100 bg-ink/[0.06]' : 'opacity-0 group-hover/card:opacity-100'
                          }`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <span className="text-[13px] text-faint tabular-nums">
                          {formatTime(c.updatedAt || c.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Snippet & Unread */}
                    <div className="flex justify-between items-center gap-2.5">
                      <p className={`text-[14px] truncate flex-1 leading-snug ${
                        hasUnread 
                          ? 'text-ink font-medium' 
                          : 'text-muted'
                      }`}>
                        {c.lastMessageSnippet || 'No messages in conversation'}
                      </p>
                      {hasUnread && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center tabular-nums shrink-0">
                          {c.unreadCountAgent}
                        </span>
                      )}
                    </div>

                    {/* Category badge */}
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span className={`ic-badge capitalize shrink-0 ${categoryBadge}`}>
                        {c.category.replace('_', ' ')}
                      </span>
                      {snoozed && c.snoozedUntil && (
                        <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[12px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 min-w-0">
                          <AlarmClock className="w-3 h-3 shrink-0" />
                          <span className="truncate">{formatSnoozeUntil(c.snoozedUntil)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Dropdown Menu on Card */}
                {openMenuConvId === c.id && (
                  <div className="ic-menu absolute top-10 right-3 w-64 animate-slide-up">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStar(c.id, c.starred || false);
                        setOpenMenuConvId(null);
                      }}
                      className="ic-menu-item"
                    >
                      <Star className={`w-4 h-4 ${c.starred ? 'fill-amber-400 text-amber-400' : 'text-muted'}`} />
                      <span>{c.starred ? 'Remove priority' : 'Mark as priority'}</span>
                    </button>
                    <div className="my-1.5 border-t border-line" />
                    {snoozed ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSnooze(c.id, null);
                          setOpenMenuConvId(null);
                        }}
                        className="ic-menu-item"
                      >
                        <AlarmClock className="w-4 h-4 text-muted" />
                        <span>Unsnooze</span>
                      </button>
                    ) : (
                      <>
                        <div className="px-3.5 pt-0.5 pb-1 text-[12px] font-medium text-faint">Snooze until</div>
                        {SNOOZE_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSnooze(c.id, computeSnoozeUntil(opt.value));
                              setOpenMenuConvId(null);
                            }}
                            className="ic-menu-item justify-between"
                          >
                            <span className="flex items-center gap-3">
                              <AlarmClock className="w-4 h-4 text-muted" />
                              {opt.label}
                            </span>
                            <span className="text-[12px] text-faint">{opt.sub}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default InboxList;
