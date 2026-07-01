import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Customer } from '../../../../../shared/src/types';
import { 
  Mail, Phone, Globe, Monitor, 
  Tag as TagIcon, Plus, X, Edit2, Check, FileText
} from 'lucide-react';
import Button from '../ui/Button';

const BACKEND_URL = 'http://localhost:3000';

export const CustomerProfilePanel: React.FC = () => {
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const token = useStore((state) => state.token);
  const tags = useStore((state) => state.tags);
  const setTags = useStore((state) => state.setTags);

  const [customer, setCustomer] = useState<Customer | null>(null);
  
  // Editable fields
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');

  // Notes
  const [newNote, setNewNote] = useState('');
  
  // Tags select dropdown
  const [showAddTag, setShowAddTag] = useState(false);

  // Retrieve current active conversation's customer
  useEffect(() => {
    if (!activeConversationId) return;
    const conv = conversations.find(c => c.id === activeConversationId);
    if (conv?.customer) {
      setCustomer(conv.customer);
      setEmail(conv.customer.email || '');
      setPhone(conv.customer.phone || '');
      setName(conv.customer.name || '');
    }
  }, [activeConversationId, conversations]);

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

  if (!customer) {
    return (
      <div className="w-80 h-full border-l border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 p-6 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs text-center shrink-0">
        No active user profile details loaded.
      </div>
    );
  }

  return (
    <div className="w-80 h-full border-l border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 flex flex-col overflow-y-auto shrink-0 select-none">
      {/* Customer Avatar & Bio */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-xl uppercase shadow-md shadow-brand-500/10 shrink-0">
          {customer.name.slice(0, 2)}
        </div>
        
        <div className="text-center w-full">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-sm font-semibold border rounded px-2 py-1 text-center bg-slate-50 focus:ring-1 focus:ring-brand-500 w-full dark:bg-slate-800"
              />
            </div>
          ) : (
            <h3 className="font-bold text-slate-900 dark:text-slate-50 text-base leading-tight">
              {customer.name}
            </h3>
          )}
          <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mt-1 inline-block">
            {customer.id.startsWith('guest_') ? 'Guest Client' : 'Registered Member'}
          </span>
        </div>

        {/* Profile controls */}
        {isEditing ? (
          <div className="flex gap-2">
            <Button size="sm" variant="success" onClick={handleProfileSave} className="!text-xs py-1">
              <Check className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="!text-xs border py-1">
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setIsEditing(true)} className="!text-xs py-1">
            <Edit2 className="w-3 h-3 mr-1" /> Edit Profile
          </Button>
        )}
      </div>

      {/* Profile Details Contact info */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Contact Details</h4>
        
        {/* Email */}
        <div className="flex items-center gap-3">
          <Mail className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="No email registered"
                className="text-xs border rounded p-1 w-full bg-slate-50 dark:bg-slate-800 focus:outline-none"
              />
            ) : (
              <span className="text-xs text-slate-700 dark:text-slate-300 truncate block font-medium">
                {customer.email || <span className="text-slate-400 italic">No email registered</span>}
              </span>
            )}
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-3">
          <Phone className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="No phone registered"
                className="text-xs border rounded p-1 w-full bg-slate-50 dark:bg-slate-800 focus:outline-none"
              />
            ) : (
              <span className="text-xs text-slate-700 dark:text-slate-300 truncate block font-medium">
                {customer.phone || <span className="text-slate-400 italic">No phone registered</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Session Metadata details */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Session Details</h4>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] font-semibold">Location</span>
            <span className="text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-slate-400" /> {customer.session?.country || 'United States'}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] font-semibold">Device / Browser</span>
            <span className="text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1 truncate">
              <Monitor className="w-3.5 h-3.5 text-slate-400 shrink-0" /> 
              {customer.session?.browser} • {customer.session?.os}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] font-semibold">IP Address</span>
            <span className="text-slate-700 dark:text-slate-200 font-medium font-mono">
              {customer.session?.ip || '127.0.0.1'}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] font-semibold">Session Duration</span>
            <span className="text-slate-700 dark:text-slate-200 font-medium">
              {customer.session?.sessionDuration 
                ? `${Math.round(customer.session.sessionDuration / 60)} mins`
                : 'Active now'}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 col-span-2 border-t pt-2 border-slate-100 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] font-semibold">Active Current Page</span>
            <span className="text-slate-700 dark:text-slate-200 font-medium font-mono text-[11px] truncate block" title={customer.session?.currentPage}>
              {customer.session?.currentPage || '/'}
            </span>
          </div>
        </div>
      </div>

      {/* Tags Section */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
            <TagIcon className="w-3.5 h-3.5" /> Tags
          </h4>
          <button 
            onClick={() => setShowAddTag(!showAddTag)}
            className="text-slate-400 hover:text-brand-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 p-0.5 transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Dropdown to add tags */}
        {showAddTag && (
          <div className="flex flex-col gap-1 p-2 bg-slate-50 dark:bg-slate-850 rounded-xl border animate-slide-up">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">Select Tag</span>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {tags.filter(t => !customer.tags.includes(t.name)).map(t => (
                <button
                  key={t.id}
                  onClick={() => handleAddTag(t.name)}
                  style={{ backgroundColor: t.color + '15', color: t.color, borderColor: t.color + '40' }}
                  className="px-2 py-0.5 rounded text-xs font-semibold border hover:scale-105 active:scale-95 transition-all"
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
                className="inline-flex items-center gap-1 px-2 py-0.5 border text-xs font-semibold rounded-full"
              >
                {t}
                <button onClick={() => handleRemoveTag(t)} className="opacity-60 hover:opacity-100">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-400 italic">No tags associated.</span>
          )}
        </div>
      </div>

      {/* Internal customer Profile Notes */}
      <div className="p-6 flex flex-col gap-3">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Customer Notes
        </h4>

        {/* Create inline note */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a customer note..."
            className="flex-1 text-xs border rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 focus:outline-none dark:border-slate-800"
          />
          <Button size="sm" onClick={handleAddNote} className="!p-2.5">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Note history */}
        <div className="flex flex-col gap-2 mt-2">
          {customer.notes && customer.notes.length > 0 ? (
            customer.notes.map((note, index) => (
              <div key={index} className="p-3 bg-amber-50/20 dark:bg-amber-950/5 border border-amber-200/50 dark:border-amber-900/30 rounded-xl relative group">
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed pr-6">{note}</p>
                <button
                  onClick={() => handleRemoveNote(index)}
                  className="absolute top-2.5 right-2.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
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
    </div>
  );
};

export default CustomerProfilePanel;
