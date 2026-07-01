import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { TicketPriority } from '../../../../../shared/src/types';
import { Search, SlidersHorizontal, AlertCircle, Circle, User } from 'lucide-react';
import Badge from '../ui/Badge';

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

  const [searchTerm, setSearchTerm] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

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

  const getPriorityBadgeVariant = (priority: TicketPriority) => {
    switch (priority) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'primary';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'bug': return 'text-red-500 bg-red-50 dark:bg-red-950/20';
      case 'payment': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20';
      case 'subscription': return 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/20';
      case 'refund': return 'text-purple-500 bg-purple-50 dark:bg-purple-950/20';
      default: return 'text-slate-500 bg-slate-50 dark:bg-slate-800/40';
    }
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-80 h-full border-r border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 flex flex-col overflow-hidden">
      {/* Search Input */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search tickets, customers..."
            className="w-full text-sm pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-400"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`absolute right-2.5 top-2.5 hover:text-brand-500 transition-colors ${
              showFilters ? 'text-brand-500' : 'text-slate-400'
            }`}
          >
            <SlidersHorizontal className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Expandable filters drawer */}
        {showFilters && (
          <div className="flex flex-col gap-2.5 p-3 bg-slate-50 dark:bg-slate-950/30 rounded-xl border border-slate-100 dark:border-slate-800 animate-slide-up">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
              <span>Filter Options</span>
              <button 
                onClick={() => {
                  setFilterPriority('all');
                  setFilterCategory('all');
                  setFilterTag('all');
                }}
                className="text-brand-500 hover:underline"
              >
                Clear
              </button>
            </div>
            
            {/* Priority filter */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Priority:</span>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Category:</span>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Tag:</span>
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 dark:text-slate-500 h-64 gap-2">
            <AlertCircle className="w-8 h-8 opacity-40 text-brand-500" />
            <span className="font-semibold text-sm">No tickets found</span>
            <span className="text-xs">Try adjusting filters or seeding mock testing data.</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {conversations.map((c) => {
              const isActive = c.id === activeConversationId;
              const hasUnread = c.unreadCountAgent > 0;
              const isOnline = c.customer.session?.currentPage !== undefined; // Online flag fallback

              return (
                <button
                  key={c.id}
                  onClick={() => setActiveConversationId(c.id)}
                  className={`w-full p-4 border-b border-slate-100 dark:border-slate-800 text-left transition-colors flex flex-col gap-2 relative ${
                    isActive 
                      ? 'bg-brand-50/50 dark:bg-brand-950/20 border-r-2 border-r-brand-500' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 bg-white dark:bg-slate-900/10'
                  }`}
                >
                  {/* Row 1: Customer Name and Time */}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate max-w-[140px]">
                        {c.customer.name}
                      </span>
                      {isOnline && (
                        <Circle className="w-1.5 h-1.5 bg-emerald-500 text-emerald-500 rounded-full shrink-0" />
                      )}
                    </div>
                    <span className="text-xs text-slate-400 font-medium shrink-0">
                      {formatTime(c.updatedAt || c.createdAt)}
                    </span>
                  </div>

                  {/* Row 2: Ticket Number */}
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                    <span>{c.ticketNumber}</span>
                    <span className={`px-1.5 py-0.5 rounded capitalize ${getCategoryColor(c.category)}`}>
                      {c.category}
                    </span>
                  </div>

                  {/* Row 3: Message Snippet */}
                  <p className={`text-xs truncate ${
                    hasUnread 
                      ? 'text-slate-950 dark:text-slate-50 font-bold' 
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    {c.lastMessageSnippet || 'No messages in conversation'}
                  </p>

                  {/* Row 4: Priority & Assignee / Unread */}
                  <div className="flex justify-between items-center mt-1">
                    <Badge variant={getPriorityBadgeVariant(c.priority)}>
                      {c.priority}
                    </Badge>

                    <div className="flex items-center gap-1.5">
                      {c.assignedAgentId ? (
                        <div className="p-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border" title="Assigned">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-1 py-0.5 rounded border border-amber-100/50">Unassigned</span>
                      )}

                      {hasUnread && (
                        <span className="bg-brand-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-sm shadow-brand-500/10">
                          {c.unreadCountAgent}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default InboxList;
