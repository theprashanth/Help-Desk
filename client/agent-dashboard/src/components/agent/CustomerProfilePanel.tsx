import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { Customer } from '../../../../../shared/src/types';
import { 
  Mail, Phone, Globe, Monitor, Tag as TagIcon, Plus, X, Edit2, Check, 
  FileText, ChevronDown, ChevronUp, User, Users, ExternalLink, 
  Sidebar, Link2, ShieldAlert, Sparkles, MessageSquare, Copy, Eye, Layers, UserRound
} from 'lucide-react';
import { Conversation } from '../../../../../shared/src/types';
import { timeAgo, shortAgo } from '../../lib/timeAgo';
import TimeHover from '../ui/TimeHover';
import { StatusPill, statusOf, aboutText } from './mergeUi';
import AskAiPanel from './AskAiPanel';

const BACKEND_URL = 'http://localhost:3000';

const InstantTooltip: React.FC<{ children: React.ReactNode; text: string }> = ({ children, text }) => {
  return (
    <div className="relative group/tooltip min-w-0">
      {children}
      {text && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-ink text-on-ink text-[12px] font-medium rounded-md shadow-pop opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity duration-100 whitespace-nowrap">
          {text}
        </div>
      )}
    </div>
  );
};

/**
 * Details sidebar for a conversation. By default it follows the active conversation; with `conversationId`
 * it shows another one, and `embedded` drops its own frame and tabs (used inside the side conversation view).
 */
export const CustomerProfilePanel: React.FC<{ conversationId?: string; embedded?: boolean }> = ({ conversationId, embedded }) => {
  const storeActiveId = useStore((state) => state.activeConversationId);
  const activeConversationId = conversationId ?? storeActiveId;
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const tags = useStore((state) => state.tags);
  const setTags = useStore((state) => state.setTags);
  const storeUpdateConversation = useStore((state) => state.updateConversation);

  // A conversation outside the loaded inbox list (e.g. an older or merged one) is fetched on its own
  const [fetchedConv, setFetchedConv] = useState<Conversation | null>(null);
  const inList = useStore((state) => state.conversations.some(c => c.id === activeConversationId));
  useEffect(() => {
    setFetchedConv(null);
    if (!activeConversationId || !token || inList) return;
    let live = true;
    fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (live && c) setFetchedConv(c); })
      .catch(() => {});
    return () => { live = false; };
  }, [activeConversationId, token, inList]);
  const updateConversation = (u: Conversation) => {
    storeUpdateConversation(u);
    setFetchedConv(prev => (prev && prev.id === u.id ? u : prev));
  };

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  
  // Tabs: Details / Copilot
  const [activeTab, setActiveTab] = useState<'details' | 'copilot'>('details');

  // Accordion Expand/Collapse States
  // Open by default: User data, Conversation attributes, Recent conversations
  const [linksOpen, setLinksOpen] = useState(false);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [userDataOpen, setUserDataOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);

  // Editable fields
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');

  // Copy state
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 1500);
  };

  const renderCopyButton = (value: string | undefined | null, key: string) => {
    if (!value) return null;
    return (
      <button
        type="button"
        onClick={() => handleCopy(value, key)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-subtle rounded-md text-muted hover:text-ink shrink-0"
      >
        {copiedText === key ? (
          <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 whitespace-nowrap">
            <Check className="w-3 h-3" /> Copied
          </span>
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    );
  };

  // Notes
  const [newNote, setNewNote] = useState('');
  
  // Tags select dropdown
  const [showAddTag, setShowAddTag] = useState(false);

  // Recent conversations from same customer
  const [recentConvs, setRecentConvs] = useState<any[]>([]);
  const [showAllUserData, setShowAllUserData] = useState(false);
  const [userTagsOpen, setUserTagsOpen] = useState(false);
  const [convTagsOpen, setConvTagsOpen] = useState(false);
  const [showAddConvTag, setShowAddConvTag] = useState(false);
  const [pageViewsOpen, setPageViewsOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [pageViews, setPageViews] = useState<{ url: string; at: string }[]>([]);
  const [similar, setSimilar] = useState<Conversation[]>([]);
  const setViewingMergedConversationId = useStore((state) => state.setViewingMergedConversationId);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [recentOpen, setRecentOpen] = useState(true);
  const handleCategoryChange = async (newCategory: string) => {
    if (!activeConversationId || !token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ category: newCategory })
      });
      if (res.ok) {
        const updated = await res.json();
        updateConversation(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (!activeConversationId || !token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ priority: newPriority })
      });
      if (res.ok) {
        const updated = await res.json();
        updateConversation(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Recent page views: pages the customer wrote from in this conversation (+ their current page)
  useEffect(() => {
    if (!activeConversationId || !token) return;
    fetch(`${BACKEND_URL}/api/messages/${activeConversationId}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((msgs: any[]) => {
        const seen = new Map<string, string>();
        msgs.filter(m => m.sender?.type === 'customer' && m.metadata?.sourceUrl)
          .forEach(m => seen.set(m.metadata.sourceUrl, m.createdAt));
        setPageViews([...seen.entries()].map(([url, at]) => ({ url, at })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8));
      })
      .catch(() => setPageViews([]));
  }, [activeConversationId, token]);

  // Similar conversations: same category, other customers
  const activeCategory = conversations.find(c => c.id === activeConversationId)?.category;
  const activeCustomerId = conversations.find(c => c.id === activeConversationId)?.customer.id;
  useEffect(() => {
    if (!activeConversationId || !token || !activeCategory) return;
    fetch(`${BACKEND_URL}/api/tickets?category=${activeCategory}&status=open,waiting,resolved,closed`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Conversation[]) => setSimilar(list.filter(c => c.id !== activeConversationId && c.customer.id !== activeCustomerId).slice(0, 5)))
      .catch(() => setSimilar([]));
  }, [activeConversationId, activeCategory, activeCustomerId, token]);

  // Conversation tags (separate from the customer's own tags)
  const handleConversationTags = async (nextTags: string[]) => {
    if (!activeConversationId || !token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tags: nextTags })
      });
      if (res.ok) updateConversation(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  // Assign the conversation (moved here from the chat toolbar; same endpoint)
  const handleAssigneeChange = async (agentId: string) => {
    if (!activeConversationId || !token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}/assign`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ agentId: agentId === 'unassigned' ? null : agentId })
      });
      if (res.ok) {
        const updated = await res.json();
        updateConversation(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Retrieve current active conversation
  const conv = conversations.find(c => c.id === activeConversationId) || (fetchedConv?.id === activeConversationId ? fetchedConv : undefined);

  // Retrieve current active conversation's customer
  useEffect(() => {
    if (!activeConversationId) return;
    if (conv?.customer) {
      setCustomer(conv.customer);
      setEmail(conv.customer.email || '');
      setPhone(conv.customer.phone || '');
      setName(conv.customer.name || '');
    }
  }, [activeConversationId, conversations, conv]);

  // Load tag options from backend
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/tags`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setTags(data))
      .catch(e => console.error(e));
  }, [token, setTags]);

  // Load recent conversations for this customer
  const fetchRecentConvs = useCallback(async () => {
    if (!token || !conv?.customer?.id) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/customers/${conv.customer.id}/tickets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRecentConvs(data);
      }
    } catch (e) {
      console.error('Failed to load recent convs:', e);
    }
  }, [token, conv?.customer?.id]);

  useEffect(() => {
    fetchRecentConvs();
  }, [fetchRecentConvs]);

  // Load agents list to find assignee name
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/agents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setAgents(data))
      .catch(e => console.error(e));
  }, [token]);

  const handleProfileSave = async () => {
    if (!customer) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, email, phone, conversationId: activeConversationId })
      });

      if (res.ok) {
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddTag = async (tagName: string) => {
    if (!customer) return;
    if (customer.tags.includes(tagName)) return;

    const updatedTags = [...customer.tags, tagName];
    try {
      await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tags: updatedTags, conversationId: activeConversationId })
      });
      setShowAddTag(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!customer) return;
    const updatedTags = customer.tags.filter(t => t !== tagName);
    try {
      await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tags: updatedTags, conversationId: activeConversationId })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async () => {
    if (!customer || !newNote.trim()) return;
    const updatedNotes = [newNote.trim(), ...(customer.notes || [])];
    try {
      const res = await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes: updatedNotes, conversationId: activeConversationId })
      });
      if (res.ok) {
        setNewNote('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveNote = async (indexToRemove: number) => {
    if (!customer) return;
    const updatedNotes = customer.notes.filter((_, i) => i !== indexToRemove);
    try {
      await fetch(`${BACKEND_URL}/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes: updatedNotes, conversationId: activeConversationId })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const getTagColor = (tagName: string) => {
    const matched = tags.find(t => t.name === tagName);
    return matched ? matched.color : '#6B7280'; // gray-500 fallback
  };

  if (!customer || !conv) {
    if (embedded) return <p className="px-6 py-6 text-[14px] text-muted">Loading details…</p>;
    return (
      <div className="ic-panel w-[320px] 2xl:w-[360px] h-full shrink-0 flex flex-col items-center justify-center p-8 text-center">
        <Sidebar className="w-10 h-10 mb-3 text-faint" />
        <p className="text-[14px] text-muted leading-relaxed max-w-[240px]">
          No active user profile details loaded. Select a conversation to view customer stats.
        </p>
      </div>
    );
  }

  // Find assigned agent object
  const assignedAgent = agents.find(a => a.id === conv.assignedAgentId);
  // Lead = anonymous visitor (guest id, no email); User = identified
  const isLead = !customer.email && !customer.externalId;
  // Customer's local time (timezone comes from the Messenger's geo lookup)
  const localTime = (() => {
    const tz = customer.session?.timezone;
    if (!tz) return '';
    try {
      return new Date(clock).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
    } catch { return ''; }
  })();

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'ic-panel w-[320px] 2xl:w-[360px] h-full shrink-0 flex flex-col overflow-hidden'}>
      
      {/* ═══ TABS HEADER ════════════════════════════════════════════════════ */}
      {!embedded && (
      <div className="ic-tabs pt-4 pr-3 justify-between shrink-0">
        <div className="flex items-end gap-7">
          <button
            onClick={() => setActiveTab('details')}
            className={`ic-tab ${activeTab === 'details' ? 'ic-tab-active' : ''}`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('copilot')}
            className={`ic-tab flex items-center gap-1.5 ${activeTab === 'copilot' ? 'ic-tab-active' : ''}`}
          >
            <Sparkles className="w-4 h-4" /> Ask AI
          </button>
        </div>
        <div className="flex items-center gap-0.5 pb-2 text-muted">
          <button className="ic-icon-btn-ghost" title="Open details link">
            <ExternalLink className="w-4 h-4" />
          </button>
          <button className="ic-icon-btn-ghost" title="Collapse sidebar">
            <Sidebar className="w-4 h-4" />
          </button>
        </div>
      </div>
      )}

      {/* ═══ SCROLLABLE CONTENT ═════════════════════════════════════════════ */}
      <div className={!embedded && activeTab === 'copilot' ? 'flex-1 min-h-0 flex flex-col' : 'flex-1 overflow-y-auto'}>
        
        {(embedded || activeTab === 'details') ? (
          <>
            {/* SECTION 1: ASSIGNEE & TEAM DETAILS */}
            <div className="ic-detail-section py-3">
              <div className="ic-detail-row">
                <span className="ic-detail-label">Assignee</span>
                <div className="ic-detail-value flex items-center gap-1 min-w-0">
                  {assignedAgent ? (
                    <div className="w-5 h-5 shrink-0 rounded-full bg-subtle text-ink flex items-center justify-center font-semibold text-[11px] uppercase">
                      {assignedAgent.name.slice(0, 1)}
                    </div>
                  ) : (
                    <User className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <select
                    value={conv.assignedAgentId || 'unassigned'}
                    onChange={(e) => handleAssigneeChange(e.target.value)}
                    className={`flex-1 min-w-0 truncate bg-transparent cursor-pointer px-1.5 h-8 rounded-lg hover:bg-subtle border-none focus:ring-0 focus:outline-none text-[14px] ${assignedAgent ? 'text-ink' : 'text-muted'}`}
                    title="Change assignee"
                  >
                    <option value="unassigned" className="bg-surface text-ink">Unassigned</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id} className="bg-surface text-ink">{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="ic-detail-row">
                <span className="ic-detail-label">State</span>
                <div className="ic-detail-value flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    conv.status === 'open' ? 'bg-accent'
                    : conv.status === 'waiting' ? 'bg-red-500'
                    : conv.status === 'resolved' ? 'bg-emerald-500'
                    : 'bg-faint'
                  }`} />
                  <span className="truncate">{
                    ({ open: 'In progress', waiting: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed', archived: 'Archived', merged: 'Merged' } as Record<string, string>)[conv.status] || conv.status
                  }</span>
                </div>
              </div>

              <div className="ic-detail-row">
                <span className="ic-detail-label">Team Inbox</span>
                <div className="ic-detail-value flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted shrink-0" />
                  <span className="truncate">Support Team</span>
                </div>
              </div>
            </div>

            {/* SECTION 2: LINKS ACCORDION */}
            <div className="ic-detail-section">
              <button
                onClick={() => setLinksOpen(!linksOpen)}
                className="w-full flex items-center justify-between"
              >
                <span className="ic-detail-section-title">
                  <Link2 className="w-[18px] h-[18px]" /> Links
                </span>
                {linksOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>

              {linksOpen && (
                <div className="mt-2 flex flex-col">
                  <div className="flex justify-between items-center min-h-[40px] text-[14px] text-muted">
                    <span>Tracker ticket</span>
                    <button className="ic-icon-btn w-8 h-8">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center min-h-[40px] text-[14px] text-muted">
                    <span>Back-office tickets</span>
                    <button className="ic-icon-btn w-8 h-8">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center min-h-[40px] text-[14px] text-muted">
                    <span>Side conversations</span>
                    <button className="ic-icon-btn w-8 h-8">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: CONVERSATION ATTRIBUTES ACCORDION */}
            <div className="ic-detail-section">
              <button
                onClick={() => setAttrsOpen(!attrsOpen)}
                className="w-full flex items-center justify-between"
              >
                <span className="ic-detail-section-title">
                  <ShieldAlert className="w-[18px] h-[18px]" /> Conversation attributes
                </span>
                {attrsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>

              {attrsOpen && (
                <div className="mt-2 flex flex-col">
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Title</span>
                    {conv.title ? (
                      <span className="ic-detail-value" title={conv.title}>{conv.title}</span>
                    ) : (
                      <span className="ic-detail-value capitalize">{conv.category.replace('_', ' ')} Assistance</span>
                    )}
                  </div>
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">ID</span>
                    <span className="ic-detail-value">{conv.id}</span>
                  </div>
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Ticket number</span>
                    <span className="ic-detail-value">{conv.ticketNumber}</span>
                  </div>
                  {(conv.rating || conv.csatRequestedAt) && (
                    <div className="ic-detail-row">
                      <span className="ic-detail-label">CX rating</span>
                      <span className="ic-detail-value" title={conv.rating?.comment || undefined}>
                        {conv.rating ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span>{['', '😞', '🙁', '😐', '🙂', '🤩'][conv.rating.score]}</span>
                            <span className="font-medium">{conv.rating.score}/5</span>
                            <span className="text-muted">{['', 'Terrible', 'Bad', 'OK', 'Great', 'Amazing'][conv.rating.score]}</span>
                          </span>
                        ) : <span className="text-faint">Requested, not rated yet</span>}
                      </span>
                    </div>
                  )}
                  {conv.rating?.comment && (
                    <p className="px-0 pb-2 text-[13px] text-muted italic leading-relaxed">“{conv.rating.comment}”</p>
                  )}
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Category</span>
                    <select
                      value={conv.category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="ic-detail-value w-full bg-transparent capitalize cursor-pointer -ml-2 px-2 h-8 rounded-lg hover:bg-subtle border-none focus:ring-0 focus:outline-none text-[14px]"
                    >
                      <option value="general" className="bg-surface text-ink">General</option>
                      <option value="bug" className="bg-surface text-ink">Bug</option>
                      <option value="payment" className="bg-surface text-ink">Payment</option>
                      <option value="subscription" className="bg-surface text-ink">Subscription</option>
                      <option value="refund" className="bg-surface text-ink">Refund</option>
                      <option value="feature_request" className="bg-surface text-ink">Feature Request</option>
                      <option value="other" className="bg-surface text-ink">Other</option>
                    </select>
                  </div>
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Priority</span>
                    <select
                      value={conv.priority}
                      onChange={(e) => handlePriorityChange(e.target.value)}
                      className="ic-detail-value w-full bg-transparent capitalize cursor-pointer -ml-2 px-2 h-8 rounded-lg hover:bg-subtle border-none focus:ring-0 focus:outline-none text-[14px]"
                    >
                      <option value="low" className="bg-surface text-ink">Low</option>
                      <option value="medium" className="bg-surface text-ink">Medium</option>
                      <option value="high" className="bg-surface text-ink">High</option>
                      <option value="critical" className="bg-surface text-ink">Urgent</option>
                      <option value="none" className="bg-surface text-ink">No priority</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 4: USER DATA ACCORDION */}
            <div className="ic-detail-section">
              <button
                onClick={() => setUserDataOpen(!userDataOpen)}
                className="w-full flex items-center justify-between"
              >
                <span className="ic-detail-section-title">
                  <User className="w-[18px] h-[18px]" /> User data
                </span>
                {userDataOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>

              {userDataOpen && (
                <div className="mt-2 flex flex-col">
                  {/* Name (Editable) */}
                  {isEditing ? (
                    <div className="flex flex-col gap-1.5 py-1.5">
                      <span className="text-[14px] text-muted">Name</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="ic-input h-9 flex-1 min-w-0"
                        />
                        <button onClick={handleProfileSave} className="ic-icon-btn-ghost text-emerald-600 dark:text-emerald-400" title="Save">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setIsEditing(false)} className="ic-icon-btn-ghost text-muted" title="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ic-detail-row group/name">
                      <span className="ic-detail-label">Name</span>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="ic-detail-value">{customer.name}</span>
                        <button onClick={() => setIsEditing(true)} className="shrink-0 flex items-center gap-1 text-[13px] text-muted hover:text-ink transition-colors">
                          <Edit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                      </div>
                    </div>
                  )}

                  {/* External id: the user's id in your own system (logged-in users) */}
                  {customer.externalId && (
                    <div className="ic-detail-row group relative">
                      <span className="ic-detail-label">External id</span>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <InstantTooltip text={customer.externalId}>
                          <span className="ic-detail-value block">{customer.externalId}</span>
                        </InstantTooltip>
                        {renderCopyButton(customer.externalId, 'external_id')}
                      </div>
                    </div>
                  )}

                  {/* User ID */}
                  <div className="ic-detail-row group/userid relative">
                    <span className="ic-detail-label">User id</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={customer.id}>
                        <span className="ic-detail-value block">
                          {customer.id}
                        </span>
                      </InstantTooltip>
                      <button
                        onClick={() => handleCopy(customer.id, 'userid')}
                        className="opacity-0 group-hover/userid:opacity-100 transition-opacity p-1 hover:bg-subtle rounded-md text-muted hover:text-ink shrink-0"
                      >
                        {copiedText === 'userid' ? (
                          <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 whitespace-nowrap">
                            <Check className="w-3 h-3" /> Copied
                          </span>
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Email & Phone */}
                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">Email</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={customer.email || 'No email'}>
                        <span className="ic-detail-value flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted shrink-0" />
                          <span className="truncate">{customer.email || 'N/A'}</span>
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(customer.email, 'email')}
                    </div>
                  </div>

                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">Phone</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={customer.phone || 'No phone'}>
                        <span className="ic-detail-value flex items-center gap-2">
                          <Phone className="w-4 h-4 text-muted shrink-0" />
                          <span className="truncate">{customer.phone || 'N/A'}</span>
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(customer.phone, 'phone')}
                    </div>
                  </div>

                  {/* Session properties */}

                  {/* Location */}
                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">Location</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={`${localTime ? localTime + ' local time · ' : ''}${customer.session?.country || 'Unknown'}`}>
                        <span className="ic-detail-value flex items-center gap-2">
                          <Globe className="w-4 h-4 text-muted shrink-0" />
                          <span className="truncate">{localTime ? `${localTime} · ` : ''}{customer.session?.country || 'Unknown'}</span>
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(customer.session?.country, 'location')}
                    </div>
                  </div>

                  {/* Type */}
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Type</span>
                    <span className="ic-detail-value" title={isLead ? 'Anonymous visitor (no email / account yet)' : 'Identified user'}>{isLead ? 'Lead' : 'User'}</span>
                  </div>

                  {showAllUserData && (<>
                  {/* Browser / OS */}
                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">Browser/OS</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={`${customer.session?.browser || ''} • ${customer.session?.os || ''}`}>
                        <span className="ic-detail-value flex items-center gap-2">
                          <Monitor className="w-4 h-4 text-muted shrink-0" />
                          <span className="truncate">{customer.session?.browser} • {customer.session?.os}</span>
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(`${customer.session?.browser || ''} • ${customer.session?.os || ''}`, 'browser_os')}
                    </div>
                  </div>

                  {/* IP Address */}
                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">IP address</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={customer.session?.ip || '127.0.0.1'}>
                        <span className="ic-detail-value block">
                          {customer.session?.ip || '127.0.0.1'}
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(customer.session?.ip, 'ip_address')}
                    </div>
                  </div>

                  {/* Total Chats */}
                  <div className="ic-detail-row">
                    <span className="ic-detail-label">Total chats</span>
                    <span className="ic-detail-value">
                      {customer.session?.totalConversations || 1} conversations
                    </span>
                  </div>

                  {/* Current Page */}
                  <div className="ic-detail-row group relative">
                    <span className="ic-detail-label">Current page</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <InstantTooltip text={customer.session?.currentPage || '/'}>
                        <span className="ic-detail-value block">
                          {customer.session?.currentPage || '/'}
                        </span>
                      </InstantTooltip>
                      {renderCopyButton(customer.session?.currentPage, 'current_page')}
                    </div>
                  </div>

                  </>)}

                  <button
                    onClick={() => setShowAllUserData(v => !v)}
                    className="self-start mt-1 px-1 h-8 text-[14px] font-semibold text-ink hover:underline underline-offset-2"
                  >
                    {showAllUserData ? 'See less' : 'See all'}
                  </button>
                </div>
              )}
            </div>

            {/* SECTION: USER TAGS */}
            <div className="ic-detail-section">
              <div className="w-full flex items-center justify-between">
                <button onClick={() => setUserTagsOpen(!userTagsOpen)} className="ic-detail-section-title">
                  <TagIcon className="w-[18px] h-[18px]" /> User tags
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setUserTagsOpen(true); setShowAddTag(!showAddTag); }} className="ic-icon-btn-ghost" title="Tag this person">
                    <Plus className="w-4 h-4" />
                  </button>
                  <button onClick={() => setUserTagsOpen(!userTagsOpen)} className="ic-icon-btn-ghost">
                    {userTagsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
                  </button>
                </div>
              </div>
              {userTagsOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  {showAddTag && (
                    <div className="flex flex-wrap gap-1.5 p-3 bg-surface rounded-xl border border-line shadow-pop animate-slide-up max-h-28 overflow-y-auto">
                      {tags.filter(t => !customer.tags.includes(t.name)).map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleAddTag(t.name)}
                          style={{ backgroundColor: t.color + '15', color: t.color, borderColor: t.color + '40' }}
                          className="px-2.5 h-6 rounded-full text-[12px] font-medium border hover:opacity-80 transition-opacity"
                        >
                          {t.name}
                        </button>
                      ))}
                      {tags.filter(t => !customer.tags.includes(t.name)).length === 0 && (
                        <span className="text-[13px] text-faint p-1">No more tags available.</span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {customer.tags && customer.tags.length > 0 ? customer.tags.map((t, i) => (
                      <span
                        key={i}
                        style={{ backgroundColor: getTagColor(t) + '15', color: getTagColor(t), borderColor: getTagColor(t) + '40' }}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 h-6 border text-[12px] font-medium rounded-full"
                      >
                        {t}
                        <button onClick={() => handleRemoveTag(t)} className="opacity-60 hover:opacity-100 p-0.5 rounded-full hover:bg-ink/5">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )) : <span className="text-[14px] text-faint">No tags yet</span>}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION: CONVERSATION TAGS */}
            <div className="ic-detail-section">
              <div className="w-full flex items-center justify-between">
                <button onClick={() => setConvTagsOpen(!convTagsOpen)} className="ic-detail-section-title">
                  <TagIcon className="w-[18px] h-[18px]" /> Conversation tags
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setConvTagsOpen(true); setShowAddConvTag(!showAddConvTag); }} className="ic-icon-btn-ghost" title="Tag this conversation">
                    <Plus className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConvTagsOpen(!convTagsOpen)} className="ic-icon-btn-ghost">
                    {convTagsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
                  </button>
                </div>
              </div>
              {convTagsOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  {showAddConvTag && (
                    <div className="flex flex-wrap gap-1.5 p-3 bg-surface rounded-xl border border-line shadow-pop animate-slide-up max-h-28 overflow-y-auto">
                      {tags.filter(t => !(conv.tags || []).includes(t.name)).map(t => (
                        <button
                          key={t.id}
                          onClick={() => { handleConversationTags([...(conv.tags || []), t.name]); setShowAddConvTag(false); }}
                          style={{ backgroundColor: t.color + '15', color: t.color, borderColor: t.color + '40' }}
                          className="px-2.5 h-6 rounded-full text-[12px] font-medium border hover:opacity-80 transition-opacity"
                        >
                          {t.name}
                        </button>
                      ))}
                      {tags.filter(t => !(conv.tags || []).includes(t.name)).length === 0 && (
                        <span className="text-[13px] text-faint p-1">No more tags available.</span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {(conv.tags || []).length > 0 ? (conv.tags || []).map(t => (
                      <span
                        key={t}
                        style={{ backgroundColor: getTagColor(t) + '15', color: getTagColor(t), borderColor: getTagColor(t) + '40' }}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 h-6 border text-[12px] font-medium rounded-full"
                      >
                        {t}
                        <button onClick={() => handleConversationTags((conv.tags || []).filter(x => x !== t))} className="opacity-60 hover:opacity-100 p-0.5 rounded-full hover:bg-ink/5">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )) : <span className="text-[14px] text-faint">No tags yet</span>}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 5: CUSTOMER NOTES ACCORDION */}
            <div className="ic-detail-section">
              <button
                onClick={() => setNotesOpen(!notesOpen)}
                className="w-full flex items-center justify-between"
              >
                <span className="ic-detail-section-title">
                  <FileText className="w-[18px] h-[18px]" /> User notes
                </span>
                {notesOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>

              {notesOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  {/* Create inline note */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add customer profile note..."
                      className="ic-input h-9 flex-1 min-w-0"
                    />
                    <button 
                      onClick={handleAddNote} 
                      className="ic-icon-btn-primary"
                      title="Add note"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Note history */}
                  <div className="flex flex-col gap-2">
                    {customer.notes && customer.notes.length > 0 ? (
                      customer.notes.map((note, index) => (
                        <div key={index} className="px-3.5 py-3 bg-note border border-note-line rounded-xl relative group">
                          <p className="text-[14px] text-ink leading-relaxed pr-6">{note}</p>
                          <button
                            onClick={() => handleRemoveNote(index)}
                            className="absolute top-2.5 right-2.5 text-muted hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                            title="Delete Note"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="text-[14px] text-faint">No customer profile notes.</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 6: RECENT CONVERSATIONS FROM SAME CUSTOMER */}
            <div className="ic-detail-section">
              <button
                onClick={() => setRecentOpen(!recentOpen)}
                className="w-full flex items-center justify-between"
              >
                <span className="ic-detail-section-title">
                  <MessageSquare className="w-[18px] h-[18px]" /> Recent conversations
                  {recentConvs.some(rc => rc.id !== activeConversationId) && (
                    <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-subtle text-accent text-[12px] font-semibold inline-flex items-center justify-center">
                      {recentConvs.filter(rc => rc.id !== activeConversationId).length}
                    </span>
                  )}
                </span>
                {recentOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>

              {recentOpen && (() => {
                const others = recentConvs
                  .filter(rc => rc.id !== activeConversationId)
                  .sort((x, y) => new Date(y.updatedAt || y.createdAt).getTime() - new Date(x.updatedAt || x.createdAt).getTime());
                if (!others.length) return <p className="mt-3 text-[14px] text-faint">No other conversations found for this customer.</p>;
                return (
                  <div className="mt-2 -mx-2 flex flex-col">
                    {others.map(rc => {
                      const started = timeAgo(rc.createdAt);
                      const about = rc.title || aboutText(rc) || 'No messages yet';
                      return (
                        <button
                          key={rc.id}
                          onClick={() => useStore.getState().setViewingMergedConversationId(rc.id)}
                          className="w-full flex items-start gap-3 px-2 py-2.5 rounded-xl text-left hover:bg-ink/[0.04] transition-colors"
                          title={`#${String(rc.ticketNumber).replace(/^#/, '')}`}
                        >
                          <span className="w-9 h-9 rounded-full bg-subtle text-faint flex items-center justify-center shrink-0 overflow-hidden">
                            <UserRound className="w-6 h-6 translate-y-1" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] font-semibold text-ink truncate"><TimeHover iso={rc.createdAt}>Started {started}</TimeHover></span>
                            <span className="block text-[13px] text-muted truncate">{about}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1 shrink-0">
                            <StatusPill status={statusOf(rc)} />
                            <TimeHover iso={rc.updatedAt} className="text-[12.5px] text-muted">{shortAgo(rc.updatedAt)}</TimeHover>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* SECTION: RECENT PAGE VIEWS */}
            <div className="ic-detail-section">
              <button onClick={() => setPageViewsOpen(!pageViewsOpen)} className="w-full flex items-center justify-between">
                <span className="ic-detail-section-title"><Eye className="w-[18px] h-[18px]" /> Recent page views</span>
                {pageViewsOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>
              {pageViewsOpen && (
                <div className="mt-2 flex flex-col">
                  {(pageViews.length > 0 ? pageViews : (customer.session?.currentPage ? [{ url: customer.session.currentPage, at: customer.session.lastSeen || '' }] : [])).map(v => (
                    <a key={v.url} href={v.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 min-h-[34px] text-[14px] group/pv">
                      <span className="truncate text-ink group-hover/pv:underline underline-offset-2" title={v.url}>{v.url.replace(/^https?:\/\//, '')}</span>
                      <span className="text-[12px] text-faint shrink-0">{v.at ? new Date(v.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
                    </a>
                  ))}
                  {pageViews.length === 0 && !customer.session?.currentPage && <span className="text-[14px] text-faint">No page views recorded</span>}
                </div>
              )}
            </div>

            {/* SECTION: SIMILAR CONVERSATIONS */}
            <div className="ic-detail-section">
              <button onClick={() => setSimilarOpen(!similarOpen)} className="w-full flex items-center justify-between">
                <span className="ic-detail-section-title"><Layers className="w-[18px] h-[18px]" /> Similar conversations</span>
                {similarOpen ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronUp className="w-4 h-4 text-muted" />}
              </button>
              {similarOpen && (
                <div className="mt-2 flex flex-col gap-1">
                  <span className="text-[12px] text-faint mb-1 capitalize">Same category: {conv.category.replace('_', ' ')}</span>
                  {similar.length === 0 && <span className="text-[14px] text-faint">No similar conversations</span>}
                  {similar.map(sc => (
                    <button
                      key={sc.id}
                      onClick={() => setViewingMergedConversationId(sc.id)}
                      className="text-left rounded-lg px-2 py-2 -mx-2 hover:bg-subtle transition-colors"
                      title="Preview this conversation"
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="font-medium text-ink truncate">{sc.title || sc.customer.name}</span>
                        <span className="text-faint shrink-0">{sc.ticketNumber}</span>
                      </div>
                      <div className="text-[13px] text-muted truncate">{sc.lastMessageSnippet || 'No messages'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* ASK AI: the teammate's own AI provider (Settings › AI assistant) */
          <AskAiPanel conversationId={conv.id} />
        )}

      </div>
    </div>
  );
};

export default CustomerProfilePanel;
