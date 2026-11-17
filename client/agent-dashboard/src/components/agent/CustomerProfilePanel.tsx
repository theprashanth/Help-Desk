import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { Customer } from '../../../../../shared/src/types';
import { 
  Mail, Phone, Globe, Monitor, Tag as TagIcon, Plus, X, Edit2, Check, 
  FileText, ChevronDown, ChevronRight, User, Users, ExternalLink, 
  Sidebar, Link2, ShieldAlert, Sparkles, Clock, GitMerge, MessageSquare, Copy
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

const InstantTooltip: React.FC<{ children: React.ReactNode; text: string }> = ({ children, text }) => {
  return (
    <div className="relative group/tooltip min-w-0">
      {children}
      {text && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-900 dark:bg-slate-950 text-white text-[11px] rounded-lg shadow-xl opacity-0 scale-95 pointer-events-none group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100 transition-all duration-100 origin-bottom whitespace-nowrap border border-slate-700/50 dark:border-slate-800/40">
          {text}
        </div>
      )}
    </div>
  );
};

export const CustomerProfilePanel: React.FC = () => {
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const tags = useStore((state) => state.tags);
  const setTags = useStore((state) => state.setTags);
  const updateConversation = useStore((state) => state.updateConversation);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  
  // Tabs: Details / Copilot
  const [activeTab, setActiveTab] = useState<'details' | 'copilot'>('details');

  // Accordion Expand/Collapse States
  const [linksOpen, setLinksOpen] = useState(true);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [userDataOpen, setUserDataOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);

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
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-violet-500 shrink-0"
      >
        {copiedText === key ? (
          <span className="text-[8px] font-bold text-emerald-500 flex items-center gap-0.5 whitespace-nowrap">
            <Check className="w-2.5 h-2.5" /> Copied
          </span>
        ) : (
          <Copy className="w-3 h-3" />
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
  const [recentOpen, setRecentOpen] = useState(true);
  const [mergeConfirm, setMergeConfirm] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
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

  // Retrieve current active conversation
  const conv = conversations.find(c => c.id === activeConversationId);

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
        body: JSON.stringify({ name, email, phone })
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
        body: JSON.stringify({ tags: updatedTags })
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
        body: JSON.stringify({ tags: updatedTags })
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
        body: JSON.stringify({ notes: updatedNotes })
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
        body: JSON.stringify({ notes: updatedNotes })
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
    return (
      <div className="w-80 h-full border-l border-slate-200 dark:border-[#1f212a] bg-[#fcfcfd] dark:bg-[#060a13] p-6 flex flex-col items-center justify-center text-slate-400 dark:text-slate-550 text-xs text-center shrink-0">
        <Sidebar className="w-8 h-8 mb-2 opacity-30" />
        No active user profile details loaded. Select a conversation to view customer stats.
      </div>
    );
  }

  // Find assigned agent object
  const assignedAgent = agents.find(a => a.id === conv.assignedAgentId);

  return (
    <div className="w-80 h-full border-l border-slate-200 dark:border-[#1f212a] bg-[#fcfcfd] dark:bg-[#060a13] flex flex-col shrink-0 overflow-hidden">
      
      {/* ═══ TABS HEADER ════════════════════════════════════════════════════ */}
      <div className="px-4 py-2 bg-white dark:bg-[#080d16] border-b border-slate-200 dark:border-[#1f212a] flex items-center justify-between shrink-0">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('details')}
            className={`text-xs font-bold pb-2 pt-1.5 border-b-2 transition-all relative ${
              activeTab === 'details'
                ? 'border-violet-600 dark:border-violet-500 text-slate-900 dark:text-slate-50'
                : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('copilot')}
            className={`text-xs font-bold pb-2 pt-1.5 border-b-2 transition-all flex items-center gap-1 ${
              activeTab === 'copilot'
                ? 'border-violet-600 dark:border-violet-500 text-slate-900 dark:text-slate-50'
                : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350'
            }`}
          >
            <Sparkles className="w-3 h-3 text-violet-500 animate-pulse" /> Copilot
          </button>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Open details link">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Collapse sidebar">
            <Sidebar className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ═══ SCROLLABLE CONTENT ═════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-150 dark:divide-slate-850">
        
        {activeTab === 'details' ? (
          <>
            {/* SECTION 1: ASSIGNEE & TEAM DETAILS */}
            <div className="p-4 bg-white dark:bg-[#080d16] flex flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-slate-505 dark:text-slate-400">
                <span className="font-semibold">Assignee</span>
                <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-bold">
                  {assignedAgent ? (
                    <>
                      <div className="w-4 h-4 rounded-full bg-violet-605 text-white flex items-center justify-center font-extrabold text-[8px] uppercase">
                        {assignedAgent.name.slice(0, 1)}
                      </div>
                      <span>{assignedAgent.name}</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-400 italic font-medium">Unassigned</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-505 dark:text-slate-400">
                <span className="font-semibold">Team Inbox</span>
                <div className="flex items-center gap-1.5 text-slate-805 dark:text-slate-200 font-bold">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>Support Team</span>
                </div>
              </div>
            </div>

            {/* SECTION 2: LINKS ACCORDION */}
            <div>
              <button
                onClick={() => setLinksOpen(!linksOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-black uppercase text-slate-400 dark:text-slate-550 tracking-wider hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Links
                </span>
                {linksOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {linksOpen && (
                <div className="px-4 pb-3.5 flex flex-col gap-2.5 text-xs">
                  <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Tracker ticket</span>
                    <button className="p-1 rounded border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 text-slate-405 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Back-office tickets</span>
                    <button className="p-1 rounded border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 text-slate-405 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center text-slate-605 dark:text-slate-400">
                    <span>Side conversations</span>
                    <button className="p-1 rounded border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 text-slate-405 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: CONVERSATION ATTRIBUTES ACCORDION */}
            <div>
              <button
                onClick={() => setAttrsOpen(!attrsOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-black uppercase text-slate-400 dark:text-slate-555 tracking-wider hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" /> Conversation Attributes
                </span>
                {attrsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {attrsOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-450 dark:text-slate-505 font-medium">Title</span>
                    <span className="text-slate-800 dark:text-slate-200 font-bold capitalize">{conv.category} Assistance</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-450 dark:text-slate-505 font-medium">ID</span>
                    <span className="text-slate-800 dark:text-slate-200 font-mono text-[10px] bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">{conv.id}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-450 dark:text-slate-505 font-medium">Ticket Number</span>
                    <span className="text-slate-800 dark:text-slate-200 font-black tracking-wider">{conv.ticketNumber}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-450 dark:text-slate-505 font-medium">Category</span>
                    <select
                      value={conv.category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="bg-transparent text-slate-800 dark:text-slate-200 font-bold capitalize text-right cursor-pointer hover:underline border-none focus:ring-0 focus:outline-none p-0 text-xs"
                    >
                      <option value="general" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">General</option>
                      <option value="bug" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Bug</option>
                      <option value="payment" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Payment</option>
                      <option value="subscription" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Subscription</option>
                      <option value="refund" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Refund</option>
                      <option value="feature_request" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Feature Request</option>
                      <option value="other" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Other</option>
                    </select>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-450 dark:text-slate-505 font-medium">Priority</span>
                    <select
                      value={conv.priority}
                      onChange={(e) => handlePriorityChange(e.target.value)}
                      className="bg-transparent text-slate-800 dark:text-slate-200 font-extrabold capitalize text-right cursor-pointer hover:underline border-none focus:ring-0 focus:outline-none p-0 text-xs"
                    >
                      <option value="low" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Low</option>
                      <option value="medium" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Medium</option>
                      <option value="high" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">High</option>
                      <option value="critical" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Critical</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 4: USER DATA ACCORDION */}
            <div>
              <button
                onClick={() => setUserDataOpen(!userDataOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-black uppercase text-slate-400 dark:text-slate-555 tracking-wider hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> User data
                </span>
                {userDataOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {userDataOpen && (
                <div className="px-4 pb-4 flex flex-col gap-4 text-xs">
                  {/* Name (Editable) */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                      <span>Customer Name</span>
                      {!isEditing && (
                        <button onClick={() => setIsEditing(true)} className="text-violet-500 hover:underline flex items-center gap-1">
                          <Edit2 className="w-2.5 h-2.5" /> Edit
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="text-xs font-bold border rounded-lg px-2 py-1 flex-1 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-violet-500 focus:outline-none"
                        />
                        <button onClick={handleProfileSave} className="p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setIsEditing(false)} className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-800 dark:text-slate-100 font-bold">{customer.name}</span>
                    )}
                  </div>

                  {/* User ID */}
                  <div className="flex flex-col gap-1 border-t border-slate-100 dark:border-slate-850 pt-2.5 group/userid relative">
                    <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                      <span>User ID</span>
                      <button
                        onClick={() => handleCopy(customer.id, 'userid')}
                        className="opacity-0 group-hover/userid:opacity-100 transition-opacity p-0.5 hover:bg-slate-105 dark:hover:bg-slate-800 rounded text-violet-500"
                      >
                        {copiedText === 'userid' ? (
                          <span className="text-[9px] font-bold text-emerald-500 flex items-center gap-0.5">
                            <Check className="w-2.5 h-2.5" /> Copied
                          </span>
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <InstantTooltip text={customer.id}>
                      <span className="text-slate-700 dark:text-slate-300 font-mono text-[11px] truncate block">
                        {customer.id}
                      </span>
                    </InstantTooltip>
                  </div>

                  {/* Email & Phone */}
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 dark:border-slate-850 pt-3">
                    <div className="flex flex-col gap-1 min-w-0 group relative">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                        <span>Email</span>
                        {renderCopyButton(customer.email, 'email')}
                      </div>
                      <InstantTooltip text={customer.email || 'No email'}>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold truncate flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {customer.email || 'N/A'}
                        </span>
                      </InstantTooltip>
                    </div>

                    <div className="flex flex-col gap-1 min-w-0 group relative">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                        <span>Phone</span>
                        {renderCopyButton(customer.phone, 'phone')}
                      </div>
                      <InstantTooltip text={customer.phone || 'No phone'}>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold truncate flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {customer.phone || 'N/A'}
                        </span>
                      </InstantTooltip>
                    </div>
                  </div>

                  {/* Session properties */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-slate-100 dark:border-slate-850 pt-3">

                    {/* Location */}
                    <div className="flex flex-col gap-1 min-w-0 group relative">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                        <span>Location</span>
                        {renderCopyButton(customer.session?.country, 'location')}
                      </div>
                      <InstantTooltip text={customer.session?.country || 'Unknown'}>
                        <span className="text-slate-700 dark:text-slate-200 font-bold flex items-center gap-1.5 min-w-0">
                          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{customer.session?.country || 'Unknown'}</span>
                        </span>
                      </InstantTooltip>
                    </div>

                    {/* Browser / OS */}
                    <div className="flex flex-col gap-1 min-w-0 group relative">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                        <span>Browser/OS</span>
                        {renderCopyButton(`${customer.session?.browser || ''} • ${customer.session?.os || ''}`, 'browser_os')}
                      </div>
                      <InstantTooltip text={`${customer.session?.browser || ''} • ${customer.session?.os || ''}`}>
                        <span className="text-slate-700 dark:text-slate-200 font-bold flex items-center gap-1.5 min-w-0">
                          <Monitor className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{customer.session?.browser} • {customer.session?.os}</span>
                        </span>
                      </InstantTooltip>
                    </div>

                    {/* IP Address */}
                    <div className="flex flex-col gap-1 min-w-0 group relative">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                        <span>IP Address</span>
                        {renderCopyButton(customer.session?.ip, 'ip_address')}
                      </div>
                      <InstantTooltip text={customer.session?.ip || '127.0.0.1'}>
                        <span className="text-slate-700 dark:text-slate-300 font-bold font-mono truncate block">
                          {customer.session?.ip || '127.0.0.1'}
                        </span>
                      </InstantTooltip>
                    </div>

                    {/* Total Chats */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">Total Chats</span>
                      <span className="text-slate-700 dark:text-slate-200 font-bold truncate">
                        {customer.session?.totalConversations || 1} conversations
                      </span>
                    </div>
                  </div>

                  {/* Current Page */}
                  <div className="flex flex-col gap-1 border-t border-slate-100 dark:border-slate-850 pt-3 group relative">
                    <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider">
                      <span>Current Page</span>
                      {renderCopyButton(customer.session?.currentPage, 'current_page')}
                    </div>
                    <InstantTooltip text={customer.session?.currentPage || '/'}>
                      <span className="text-slate-700 dark:text-slate-300 font-bold font-mono text-[10px] truncate block bg-slate-100 dark:bg-slate-900/60 px-2 py-1 rounded border border-slate-200/50 dark:border-slate-800/40">
                        {customer.session?.currentPage || '/'}
                      </span>
                    </InstantTooltip>
                  </div>

                  {/* Tags sub-section */}
                  <div className="flex flex-col gap-2.5 border-t border-slate-100 dark:border-slate-850 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-400 dark:text-slate-505 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <TagIcon className="w-3.5 h-3.5" /> Tags
                      </span>
                      <button 
                        onClick={() => setShowAddTag(!showAddTag)}
                        className="text-slate-400 hover:text-violet-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850 p-0.5 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {showAddTag && (
                      <div className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 animate-slide-up">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">Select Tag</span>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                          {tags.filter(t => !customer.tags.includes(t.name)).map(t => (
                            <button
                              key={t.id}
                              onClick={() => handleAddTag(t.name)}
                              style={{ backgroundColor: t.color + '15', color: t.color, borderColor: t.color + '40' }}
                              className="px-2.5 py-1 rounded-full text-[10px] font-bold border hover:scale-105 active:scale-95 transition-all"
                            >
                              {t.name}
                            </button>
                          ))}
                          {tags.filter(t => !customer.tags.includes(t.name)).length === 0 && (
                            <span className="text-[10px] text-slate-400 italic p-1">No tags available.</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {customer.tags && customer.tags.length > 0 ? (
                        customer.tags.map((t, i) => (
                          <span
                            key={i}
                            style={{ backgroundColor: getTagColor(t) + '15', color: getTagColor(t), borderColor: getTagColor(t) + '40' }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 border text-[10px] font-bold rounded-full transition-all"
                          >
                            {t}
                            <button onClick={() => handleRemoveTag(t)} className="opacity-60 hover:opacity-100 p-0.5 rounded-full hover:bg-black/5">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 italic">No tags associated.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 5: CUSTOMER NOTES ACCORDION */}
            <div>
              <button
                onClick={() => setNotesOpen(!notesOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-black uppercase text-slate-400 dark:text-slate-555 tracking-wider hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Customer Notes
                </span>
                {notesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {notesOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  {/* Create inline note */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add customer profile note..."
                      className="flex-1 text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-400 dark:placeholder-slate-600 transition-all"
                    />
                    <button 
                      onClick={handleAddNote} 
                      className="p-2.5 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold transition-all shadow-md shadow-violet-500/15 active:scale-95 flex items-center justify-center shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Note history */}
                  <div className="flex flex-col gap-2 mt-1">
                    {customer.notes && customer.notes.length > 0 ? (
                      customer.notes.map((note, index) => (
                        <div key={index} className="p-3 bg-[#fffbeb]/50 dark:bg-amber-955/5 border border-amber-200/50 dark:border-amber-900/25 rounded-xl relative group shadow-sm">
                          <p className="text-xs text-slate-700 dark:text-slate-350 leading-relaxed pr-6">{note}</p>
                          <button
                            onClick={() => handleRemoveNote(index)}
                            className="absolute top-2.5 right-2.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                            title="Delete Note"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 italic">No customer profile notes.</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 6: RECENT CONVERSATIONS FROM SAME CUSTOMER */}
            <div>
              <button
                onClick={() => setRecentOpen(!recentOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-black uppercase text-slate-400 dark:text-slate-555 tracking-wider hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Previous Conversations
                  {recentConvs.length > 1 && (
                    <span className="ml-1 bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">
                      {recentConvs.length}
                    </span>
                  )}
                </span>
                {recentOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {recentOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2">
                  {recentConvs.length <= 1 ? (
                    <span className="text-xs text-slate-400 italic">No other conversations found for this customer.</span>
                  ) : (
                    recentConvs
                      .filter(rc => rc.id !== activeConversationId)
                      .map(rc => {
                        const isMergeTarget = mergeConfirm === rc.id;
                        const statusColors: Record<string, string> = {
                          open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
                          waiting: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
                          resolved: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
                          closed: 'bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400',
                          merged: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
                        };
                        const statusClass = statusColors[rc.status] || statusColors.closed;
                        return (
                          <div
                            key={rc.id}
                            className="flex flex-col gap-1.5 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-950/20 text-xs font-semibold"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-700 dark:text-slate-350 truncate text-[11px]">{rc.ticketNumber}</span>
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${statusClass}`}>{rc.status}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-snug font-medium">
                              {rc.lastMessageSnippet || 'No messages'}
                            </p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[10px] text-slate-400 capitalize">{rc.category}</span>
                              {!isMergeTarget ? (
                                <div className="flex gap-2.5 items-center">
                                  <button
                                    onClick={() => useStore.getState().setViewingMergedConversationId(rc.id)}
                                    className="text-[10px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                  >
                                    View
                                  </button>
                                  {rc.status === 'open' && (
                                    <button
                                      onClick={() => setMergeConfirm(rc.id)}
                                      className="flex items-center gap-1 text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:text-violet-700 transition-colors"
                                    >
                                      <GitMerge className="w-3 h-3" /> Merge
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Confirm?</span>
                                  <button
                                    disabled={mergeLoading}
                                    onClick={async () => {
                                      if (!activeConversationId) return;
                                      setMergeLoading(true);
                                      try {
                                        const res = await fetch(`${BACKEND_URL}/api/tickets/${activeConversationId}/merge`, {
                                          method: 'POST',
                                          headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`
                                          },
                                          body: JSON.stringify({ sourceId: rc.id })
                                        });
                                        if (res.ok) {
                                          await fetchRecentConvs();
                                        } else {
                                          const err = await res.json();
                                          alert('Merge failed: ' + err.error);
                                        }
                                      } catch (e) {
                                        console.error(e);
                                      } finally {
                                        setMergeLoading(false);
                                        setMergeConfirm(null);
                                      }
                                    }}
                                    className="text-[10px] font-black text-white bg-violet-600 hover:bg-violet-700 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                                  >
                                    {mergeLoading ? '…' : 'Yes'}
                                  </button>
                                  <button
                                    onClick={() => setMergeConfirm(null)}
                                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-1"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* AI COPILOT VIEW */
          <div className="p-4 flex flex-col gap-4 animate-fade-in">
            <div className="p-4 bg-gradient-to-tr from-violet-500/10 to-indigo-500/10 border border-violet-200/50 dark:border-violet-900/30 rounded-2xl flex flex-col gap-2">
              <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                <Sparkles className="w-4.5 h-4.5" />
                <span className="font-extrabold text-xs uppercase tracking-wider">Live AI Copilot</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                AI is monitoring this conversation. I can recommend replies and summarize key ticket properties dynamically.
              </p>
            </div>

            {/* AI Summarization card */}
            <div className="flex flex-col gap-2 p-3.5 bg-white dark:bg-[#080d16] border border-slate-200 dark:border-slate-800/80 rounded-2xl shadow-sm">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-violet-500" /> Auto-Summary
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed mt-1 font-semibold">
                Customer is asking about the ticket category <span className="text-violet-500 font-extrabold">"{conv.category}"</span>. The ticket priority is flagged as <span className="font-black text-red-500 uppercase">{conv.priority}</span>.
              </p>
            </div>

            {/* Smart Actions checklist */}
            <div className="flex flex-col gap-2.5 p-3.5 bg-white dark:bg-[#080d16] border border-slate-200 dark:border-slate-800/80 rounded-2xl shadow-sm">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-violet-500" /> Recommended Actions
              </span>
              <ul className="text-xs text-slate-600 dark:text-slate-400 flex flex-col gap-2 font-medium mt-1">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full shrink-0" />
                  <span>Verify customer contact info.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full shrink-0" />
                  <span>Assign an agent to lock this ticket.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full shrink-0" />
                  <span>Respond using a relevant saved reply.</span>
                </li>
              </ul>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default CustomerProfilePanel;
