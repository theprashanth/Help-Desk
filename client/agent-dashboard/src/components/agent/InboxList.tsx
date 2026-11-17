import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Search, SlidersHorizontal, AlertCircle, Star, MoreHorizontal, Clock } from 'lucide-react';

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

  // Auto-select the first conversation if none is selected, or if the selected one is not in the list
  useEffect(() => {
    if (conversations.length > 0) {
      const currentActiveExists = conversations.some(c => c.id === activeConversationId);
      if (!activeConversationId || !currentActiveExists) {
        setActiveConversationId(conversations[0].id);
      }
    }
  }, [conversations, activeConversationId, setActiveConversationId]);


  const getAvatarColors = (category: string) => {
    switch (category) {
      case 'bug': return 'bg-red-50 text-red-600 border-red-200/50 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30';
      case 'payment': return 'bg-emerald-55 text-emerald-600 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30';
      case 'subscription': return 'bg-indigo-50 text-indigo-600 border-indigo-200/50 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30';
      case 'refund': return 'bg-purple-50 text-purple-600 border-purple-200/50 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30';
      case 'feature_request': return 'bg-amber-50 text-amber-600 border-amber-200/55 dark:bg-amber-955/20 dark:text-amber-400 dark:border-amber-900/30';
      default: return 'bg-blue-50 text-blue-600 border-blue-200/50 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30';
    }
  };

  const getCategoryBadgeStyles = (category: string) => {
    switch (category) {
      case 'bug':
        return 'bg-rose-50 text-rose-600 border-rose-200/50 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30';
      case 'payment':
      case 'refund':
        return 'bg-emerald-50 text-emerald-600 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30';
      case 'subscription':
        return 'bg-violet-50 text-violet-600 border-violet-200/50 dark:bg-violet-950/20 dark:text-violet-400 dark:border-violet-900/30';
      case 'feature_request':
        return 'bg-blue-50 text-blue-600 border-blue-200/50 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/50';
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

  const handleToggleSnooze = async (convId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'waiting' ? 'open' : 'waiting';
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${convId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local store
        const next = conversations.map(c => c.id === convId ? updated : c);
        setConversations(next);
      }
    } catch (e) {
      console.error('Failed to toggle snooze status:', e);
    }
  };

  return (
    <div className="w-80 h-full border-r border-slate-200 dark:border-[#1f212a] bg-[#fcfcfd] dark:bg-[#060a13] flex flex-col overflow-hidden relative">
      
      {/* Click outside overlay to close card menus */}
      {openMenuConvId && (
        <div 
          className="fixed inset-0 z-20" 
          onClick={() => setOpenMenuConvId(null)}
        />
      )}

      {/* Search Input */}
      <div className="p-4 border-b border-slate-200 dark:border-[#1f212a] flex flex-col gap-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search tickets, customers..."
            className="w-full text-xs pl-9 pr-9 py-2.5 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-400 dark:placeholder-slate-500 font-medium transition-all"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`absolute right-2.5 top-2.5 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
              showFilters ? 'text-violet-500' : 'text-slate-400'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>

        {/* Expandable filters drawer */}
        {showFilters && (
          <div className="flex flex-col gap-2.5 p-3.5 bg-slate-100/50 dark:bg-slate-900/40 rounded-xl border border-slate-200/50 dark:border-slate-800/80 animate-slide-up">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <span>Filter Options</span>
              <button 
                onClick={() => {
                  setFilterPriority('all');
                  setFilterCategory('all');
                  setFilterTag('all');
                }}
                className="text-violet-500 dark:text-violet-400 hover:underline"
              >
                Clear
              </button>
            </div>
            
            {/* Priority filter */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-505 dark:text-slate-400 font-semibold">Priority:</span>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="all">All</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-505 dark:text-slate-400 font-semibold">Category:</span>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-505 dark:text-slate-400 font-semibold">Tag:</span>
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="text-xs bg-white dark:bg-slate-955 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 dark:text-slate-550 h-64 gap-2">
            <AlertCircle className="w-8 h-8 opacity-40 text-violet-500" />
            <span className="font-semibold text-sm">No tickets found</span>
            <span className="text-xs">Try adjusting filters or seeding mock testing data.</span>
          </div>
        ) : (
          conversations.map((c) => {
            const isActive = c.id === activeConversationId;
            const hasUnread = c.unreadCountAgent > 0;

            return (
              <div key={c.id} className="relative group/card">
                <button
                  onClick={() => setActiveConversationId(c.id)}
                  className={`w-full px-3 py-3 rounded-2xl text-left flex items-start gap-2.5 relative transition-all duration-200 active:scale-[0.98] border ${
                    isActive 
                      ? 'bg-slate-100/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800/80 shadow-sm' 
                      : 'bg-white dark:bg-slate-950/20 border-transparent hover:bg-slate-50/80 dark:hover:bg-slate-950/40 hover:border-slate-200/50 dark:hover:border-slate-800/40'
                  }`}
                >
                  {/* Avatar Circle */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[13px] shrink-0 border uppercase ${getAvatarColors(c.category)}`}>
                    {c.customer.name.charAt(0) || 'G'}
                  </div>

                  {/* Body info */}
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex justify-between items-center gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-extrabold text-slate-950 dark:text-slate-100 text-xs truncate">
                          {c.customer.name}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shrink-0 border ${getCategoryBadgeStyles(c.category)}`}>
                          {c.category.replace('_', ' ')}
                        </span>
                      </div>
                      {/* Icons Action container */}
                      <div className="flex items-center gap-1 shrink-0 z-30">
                        {c.starred && (
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuConvId(openMenuConvId === c.id ? null : c.id);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-all shrink-0 opacity-0 group-hover/card:opacity-100 focus:opacity-100"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Bottom Row: Snippet & Time / Unread */}
                    <div className="flex justify-between items-end gap-2.5">
                      <p className={`text-[11px] truncate flex-1 leading-normal ${
                        hasUnread 
                          ? 'text-slate-950 dark:text-white font-extrabold font-black' 
                          : 'text-slate-500 dark:text-slate-400 font-medium'
                      }`}>
                        {c.lastMessageSnippet || 'No messages in conversation'}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                          {formatTime(c.updatedAt || c.createdAt)}
                        </span>
                        {hasUnread && (
                          <span className="bg-gradient-to-tr from-violet-600 to-indigo-600 text-white font-black text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-sm shrink-0">
                            {c.unreadCountAgent}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Dropdown Menu on Card */}
                {openMenuConvId === c.id && (
                  <div className="absolute top-10 right-4 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-30 py-1 animate-slide-up">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStar(c.id, c.starred || false);
                        setOpenMenuConvId(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left transition-colors"
                    >
                      <Star className={`w-3.5 h-3.5 ${c.starred ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
                      <span>{c.starred ? 'Remove priority' : 'Mark as priority'}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSnooze(c.id, c.status);
                        setOpenMenuConvId(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left transition-colors"
                    >
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{c.status === 'waiting' ? 'Un-snooze' : 'Snooze'}</span>
                    </button>
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
