import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { AgentSettings, SavedReply, MacroActions } from '../../../../../shared/src/types';
import Button from '../../components/ui/Button';
import {
  Bell, Calendar, User, ShieldAlert, Check,
  MessageSquare, Puzzle, Globe, ChevronRight,
  Home, Shield, Languages, CreditCard, Activity,
  Mail, Phone, ArrowLeft,
  Zap, Hash, Plus, X, Edit2, Trash2, Search, ChevronDown, PanelLeft, Users, Clock, SlidersHorizontal, Workflow, Sparkles, ArrowUpDown, Timer, UsersRound, ScrollText, Contact, BookOpen, Megaphone
} from 'lucide-react';
import TeammatesSettings from '../../components/settings/TeammatesSettings';
import MacroActionsEditor from '../../components/settings/MacroActionsEditor';
import { describeMacroActions } from '../../lib/macros';
import ProfileSettings from '../../components/settings/ProfileSettings';
import MultilingualSettings from '../../components/settings/MultilingualSettings';
import OfficeHoursSettings from '../../components/settings/OfficeHoursSettings';
import SlaSettings from '../../components/settings/SlaSettings';
import TeamsSettings from '../../components/settings/TeamsSettings';
import EmailSettings from '../../components/settings/EmailSettings';
import KnowledgeBaseSettings from '../../components/settings/KnowledgeBaseSettings';
import OutboundSettings from '../../components/settings/OutboundSettings';
import PeopleDataSettings from '../../components/settings/PeopleDataSettings';
import AuditLogSettings from '../../components/settings/AuditLogSettings';
import GeneralSettings from '../../components/settings/GeneralSettings';
import IntegrationsSettings from '../../components/settings/IntegrationsSettings';
import MessengerSettings, { MessengerTab } from '../../components/settings/MessengerSettings';
import ChatFlowSettings from '../../components/settings/ChatFlowSettings';
import AiSettings from '../../components/settings/AiSettings';
import DataSettings from '../../components/settings/DataSettings';
import { RichText, handleFormattedPaste } from '../../lib/richText';

const BACKEND_URL = 'http://localhost:3000';

type Section = 'home' | 'multilingual' | 'general' | 'workspace' | 'messenger' | 'chatFlow' | 'integrations' | 'ai' | 'data' | 'profile' | 'notifications' | 'teammates' | 'officeHours' | 'macros' | 'sla' | 'teams' | 'peopleData' | 'audit' | 'email' | 'help' | 'outbound';

// Pages that render their own header/tabs/scroll area (components/settings/*)
const SELF_CONTAINED: Section[] = ['multilingual', 'email', 'help', 'outbound', 'teams', 'peopleData', 'audit', 'sla', 'ai', 'data', 'profile', 'teammates', 'officeHours', 'general', 'integrations', 'messenger', 'chatFlow'];
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`ic-toggle ${checked ? 'ic-toggle-on' : ''}`}
    >
      <span className="ic-toggle-knob" />
    </button>
  );
}

function SettingsNavItem({ icon: Icon, label, active, onClick, badge, soon }: {
  icon: any; label: string; active: boolean; onClick: () => void; badge?: string; soon?: boolean;
}) {
  return (
    <button
      onClick={soon ? undefined : onClick}
      disabled={soon}
      title={soon ? 'Coming soon' : undefined}
      className={`ic-nav-item ${active ? 'ic-nav-item-active' : ''} ${soon ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0 text-ink/80" strokeWidth={2.2} />
      <span className="flex-1 truncate">{label}</span>
      {soon ? <span className="text-[11px] font-medium text-muted">Soon</span> : badge && <span className="ic-count">{badge}</span>}
    </button>
  );
}

// Purely visual collapsible group in the settings sidebar
function SettingsNavGroup({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onToggle} className="ic-nav-group w-full rounded-lg hover:bg-ink/[0.04] transition-colors">
        <span>{label}</span>
        {open
          ? <ChevronDown className="w-4 h-4 text-muted" />
          : <ChevronRight className="w-4 h-4 text-muted" />}
      </button>
      {open && <div className="flex flex-col gap-0.5 pl-2 pb-2">{children}</div>}
    </div>
  );
}

function FormSection({ title, description, icon: Icon, children, cols = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' }: {
  title: string; description?: React.ReactNode; icon?: any; children: React.ReactNode; cols?: string;
}) {
  return (
    <div className={`ic-card p-8 grid grid-cols-1 gap-6 lg:gap-10 ${cols}`}>
      <div className="flex flex-col gap-1.5">
        <h3 className="ic-section-title flex items-center gap-2">
          {Icon && <Icon className="w-[18px] h-[18px] text-ink/80" />}
          {title}
        </h3>
        {description && <p className="text-[14px] text-muted leading-relaxed">{description}</p>}
      </div>
      <div className="flex flex-col gap-4 min-w-0">{children}</div>
    </div>
  );
}

// ─── MAIN SETTINGS PAGE ─────────────────────────────────────────────────────
export const Settings: React.FC = () => {
  // Macro editor dropdowns (kept here, not inside MacrosSection, so the section can be rendered
  // as part of this component's tree instead of remounting on every keystroke)
  const [showForDropdown, setShowForDropdown] = useState(false);
  const [showWhenDropdown, setShowWhenDropdown] = useState(false);
  const token = useStore((state) => state.token);

  const [section, setSection] = useState<Section>(() => {
    // Another screen can ask Settings to open a section (e.g. the profile menu's Workspace row)
    const wanted = sessionStorage.getItem('settings_open_section') as Section | null;
    sessionStorage.removeItem('settings_open_section');
    return wanted || 'home';
  });
  const [messengerTab, setMessengerTab] = useState<MessengerTab>('overview');
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Macros (Saved Replies) state ─────────────────────────────────────────
  const [macros, setMacros] = useState<SavedReply[]>([]);
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macroSearch, setMacroSearch] = useState('');
  const [selectedMacro, setSelectedMacro] = useState<SavedReply | null>(null);
  const [macroForm, setMacroForm] = useState<{
    trigger: string;
    title: string;
    content: string;
    availableFor: 'everyone' | 'myself' | 'teams';
    availableWhen: ('starting_conversations' | 'replying' | 'adding_notes')[];
    actions: MacroActions;
  }>({
    trigger: '',
    title: '',
    content: '',
    availableFor: 'everyone',
    availableWhen: ['starting_conversations', 'replying', 'adding_notes'],
    actions: {}
  });
  const [macroEditing, setMacroEditing] = useState(false);
  const [macroSaving, setMacroSaving] = useState(false);

  // Fetch agent settings
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setAgentSettings(data))
      .catch(err => console.error('Failed to load settings:', err));
  }, [token]);

  // ── Macros CRUD ───────────────────────────────────────────────────────────
  const fetchMacros = useCallback(async () => {
    if (!token) return;
    setMacrosLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/saved-replies`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setMacros(await res.json());
    } finally {
      setMacrosLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (section === 'macros') fetchMacros();
  }, [section, fetchMacros]);

  const handleCreateMacro = async () => {
    if (!token || !macroForm.trigger || !macroForm.title || (!macroForm.content.trim() && !Object.keys(macroForm.actions).length)) return;
    setMacroSaving(true);
    try {
      const trigger = macroForm.trigger.startsWith('/') ? macroForm.trigger : '/' + macroForm.trigger;
      const res = await fetch(`${BACKEND_URL}/api/saved-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...macroForm, trigger })
      });
      if (res.ok) {
        const created = await res.json();
        setMacros(prev => [...prev, created]);
        setSelectedMacro(created);
        setMacroForm({
          trigger: '',
          title: '',
          content: '',
          availableFor: 'everyone',
          availableWhen: ['starting_conversations', 'replying', 'adding_notes'],
          actions: {}
        });
        setMacroEditing(false);
      }
    } finally {
      setMacroSaving(false);
    }
  };

  const handleUpdateMacro = async () => {
    if (!token || !selectedMacro) return;
    setMacroSaving(true);
    try {
      const trigger = macroForm.trigger.startsWith('/') ? macroForm.trigger : '/' + macroForm.trigger;
      const res = await fetch(`${BACKEND_URL}/api/saved-replies/${selectedMacro.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...macroForm, trigger })
      });
      if (res.ok) {
        const updated = await res.json();
        setMacros(prev => prev.map(m => m.id === updated.id ? updated : m));
        setSelectedMacro(updated);
        setMacroEditing(false);
      }
    } finally {
      setMacroSaving(false);
    }
  };

  const handleDeleteMacro = async (id: string) => {
    if (!token) return;
    const res = await fetch(`${BACKEND_URL}/api/saved-replies/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      setMacros(prev => prev.filter(m => m.id !== id));
      if (selectedMacro?.id === id) setSelectedMacro(null);
    }
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !agentSettings) return;
    setLoading(true);
    setSaved(false);
    try {
      // Save agent settings (theme, notifications, etc)
      const res = await fetch(`${BACKEND_URL}/api/auth/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(agentSettings)
      });

      // (Name and other profile fields are edited on the Details page — components/settings/ProfileSettings.)

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Home Hub ─────────────────────────────────────────────────────────────
  const HomeSection = () => (
    <div className="flex flex-col gap-10 max-w-6xl">
      <p className="text-[14px] text-muted -mb-4">Manage your workspace, messenger, and integrations.</p>

      {/* Workspace Group */}
      <div>
        <h2 className="ic-section-title mb-4">Workspace</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[
            { icon: SlidersHorizontal, label: 'General', desc: 'Workspace name, time zone and snooze options', target: 'general' as Section },
            { icon: Shield, label: 'Security', desc: 'Identity verification and allowed domains for the Messenger', target: 'messenger' as Section, tab: 'security' },
            { icon: Calendar, label: 'Office Hours', desc: 'Set your support availability', target: 'officeHours' as Section },
            { icon: Languages, label: 'Multilingual', desc: 'Show the Messenger in each visitor’s language', target: 'multilingual' as Section },
            { icon: Globe, label: 'Brands', desc: 'Manage your brand identity', target: 'home' as Section, soon: true },
            { icon: Activity, label: 'Teammates', desc: 'Invite and manage agents', target: 'teammates' as Section },
          ].map((item: { icon: any; label: string; desc: string; target: Section; badge?: string; tab?: string; soon?: boolean }) => (
            <button
              key={item.label}
              disabled={item.soon}
              onClick={() => { if (item.soon) return; if (item.tab) setMessengerTab(item.tab as MessengerTab); setSection(item.target); }}
              className={`${item.soon ? 'ic-card opacity-60 cursor-default' : 'ic-card-hover'} p-5 flex items-start gap-4 text-left`}
            >
              <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200">
                <item.icon className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink flex items-center gap-1.5">
                  {item.label} {item.badge && <span className="text-[13px]">{item.badge}</span>}
                  {item.soon && <span className="ic-badge text-[11px]">Coming soon</span>}
                </p>
                <p className="text-[14px] text-muted mt-0.5 leading-snug">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Subscription Group */}
      <div>
        <h2 className="ic-section-title mb-4">Subscription</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[
            { icon: CreditCard, label: 'Billing', desc: 'Manage your plan and payment details' },
            { icon: Activity, label: 'Usage', desc: 'View billed usage and set limits', disabled: true },
          ].map(item => (
            <button
              key={item.label}
              disabled={(item as any).disabled}
              className={`p-5 flex items-start gap-4 text-left ${(item as any).disabled ? 'ic-card opacity-50 cursor-not-allowed' : 'ic-card-hover'}`}
            >
              <div className="ic-tile-icon bg-emerald-200/70 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200">
                <item.icon className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{item.label}</p>
                <p className="text-[14px] text-muted mt-0.5 leading-snug">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Channels Group */}
      <div>
        <h2 className="ic-section-title mb-4">Channels</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[
            { icon: MessageSquare, label: 'Messenger Live Chat', desc: 'Install and customize your Messenger', onClick: () => { setMessengerTab('overview'); setSection('messenger'); } },
            { icon: Workflow, label: 'Chat flow', desc: 'Greet visitors, collect details and answer common questions', onClick: () => setSection('chatFlow') },
            { icon: Mail, label: 'Email', desc: 'Forwarding, domains, and routing', onClick: () => {}, soon: true },
            { icon: Phone, label: 'Phone', desc: 'Set up phone and SMS support', onClick: () => {}, soon: true },
          ].map((item: { icon: any; label: string; desc: string; onClick: () => void; soon?: boolean }) => (
            <button
              key={item.label}
              disabled={item.soon}
              onClick={item.onClick}
              className={`${item.soon ? 'ic-card opacity-60 cursor-default' : 'ic-card-hover'} p-5 flex items-start gap-4 text-left`}
            >
              <div className="ic-tile-icon bg-pink-200/70 text-pink-900 dark:bg-pink-400/20 dark:text-pink-200">
                <item.icon className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink flex items-center gap-1.5">{item.label}{item.soon && <span className="ic-badge text-[11px]">Coming soon</span>}</p>
                <p className="text-[14px] text-muted mt-0.5 leading-snug">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Profile Section ───────────────────────────────────────────────────────
  // (The submit button lives in the panel header and targets this form via its id.)
  const ProfileSection = () => (
    <form id="settings-profile-form" onSubmit={handleSaveAgent} className="flex flex-col gap-4 max-w-5xl">
      {saved && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-[13px] font-medium text-emerald-700 dark:text-emerald-300 rounded-lg flex items-center gap-1.5">
          <Check className="w-4 h-4" /> Settings updated successfully!
        </div>
      )}

      {agentSettings && (
        <>
          <FormSection title="Notifications & theme" icon={Bell} description="Choose how the dashboard looks and how you get notified about new activity.">
            {[
              {
                label: 'Dark Mode', sub: 'Toggle dark styling for the dashboard.',
                checked: agentSettings.theme === 'dark',
                onChange: (v: boolean) => {
                  const val = v ? 'dark' : 'light';
                  setAgentSettings({ ...agentSettings, theme: val });
                  if (val === 'dark') document.documentElement.classList.add('dark');
                  else document.documentElement.classList.remove('dark');
                }
              },
              {
                label: 'Desktop Notifications', sub: 'Push system notices when a customer replies.',
                checked: agentSettings.notifications.desktop,
                onChange: (v: boolean) => setAgentSettings({ ...agentSettings, notifications: { ...agentSettings.notifications, desktop: v } })
              },
              {
                label: 'Sound Alerts', sub: 'Play a chime on new inbound conversations.',
                checked: agentSettings.notifications.sound,
                onChange: (v: boolean) => setAgentSettings({ ...agentSettings, notifications: { ...agentSettings.notifications, sound: v } })
              },
            ].map(item => (
              <div key={item.label} className="flex items-start gap-3">
                <ToggleSwitch checked={item.checked} onChange={item.onChange} />
                <div>
                  <p className="text-[14px] font-medium text-ink">{item.label}</p>
                  <p className="ic-help">{item.sub}</p>
                </div>
              </div>
            ))}
          </FormSection>

          <FormSection title="Auto-assign engine" icon={ShieldAlert} description="Automatically route new conversations to available teammates.">
            <div className="flex items-start gap-3">
              <ToggleSwitch
                checked={agentSettings.autoAssign}
                onChange={v => setAgentSettings({ ...agentSettings, autoAssign: v })}
              />
              <div>
                <p className="text-[14px] font-medium text-ink">Automatic ticket routing</p>
                <p className="ic-help">Distribute new incoming tickets round-robin to online agents.</p>
              </div>
            </div>
          </FormSection>

          <FormSection title="Business support hours" icon={Calendar} description="Let customers know when your team is available to reply.">
            <div className="flex items-start gap-3">
              <ToggleSwitch
                checked={agentSettings.businessHours.enabled}
                onChange={v => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, enabled: v } })}
              />
              <div>
                <p className="text-[14px] font-medium text-ink">Restrict hours</p>
                <p className="ic-help">Customers will see an offline banner outside active hours.</p>
              </div>
            </div>
            {agentSettings.businessHours.enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="ic-label">Start time</label>
                  <input type="time" value={agentSettings.businessHours.start}
                    onChange={e => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, start: e.target.value } })}
                    className="ic-input"
                  />
                </div>
                <div>
                  <label className="ic-label">End time</label>
                  <input type="time" value={agentSettings.businessHours.end}
                    onChange={e => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, end: e.target.value } })}
                    className="ic-input"
                  />
                </div>
              </div>
            )}
          </FormSection>
        </>
      )}
    </form>
  );

  // ── Macros Section ────────────────────────────────────────────────────────
  const MacrosSection = () => {

    const AVAILABLE_FOR_LABELS: Record<'everyone' | 'myself' | 'teams', string> = {
      everyone: 'Everyone',
      myself: 'Myself only',
      teams: 'Specific team(s)'
    };

    const AVAILABLE_WHEN_LABELS: Record<'starting_conversations' | 'replying' | 'adding_notes', string> = {
      starting_conversations: 'Starting conversations',
      replying: 'Replying',
      adding_notes: 'Adding notes'
    };

    const filtered = macros.filter(m =>
      m.title.toLowerCase().includes(macroSearch.toLowerCase()) ||
      m.trigger.toLowerCase().includes(macroSearch.toLowerCase()) ||
      m.content.toLowerCase().includes(macroSearch.toLowerCase())
    );

    const startCreate = () => {
      setSelectedMacro(null);
      setMacroForm({
        trigger: '',
        title: '',
        content: '',
        availableFor: 'everyone',
        availableWhen: ['starting_conversations', 'replying', 'adding_notes'],
        actions: {}
      });
      setMacroEditing(true);
    };

    const startEdit = (m: SavedReply) => {
      setSelectedMacro(m);
      setMacroForm({
        trigger: m.trigger,
        title: m.title,
        content: m.content,
        availableFor: m.availableFor || 'everyone',
        availableWhen: m.availableWhen || ['starting_conversations', 'replying', 'adding_notes'],
        actions: m.actions || {}
      });
      setMacroEditing(true);
    };

    return (
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <p className="text-[14px] text-muted">Type <kbd className="ic-kbd font-mono px-1.5">/trigger</kbd> in the chat to insert a macro instantly.</p>
          <button
            onClick={startCreate}
            className="ic-btn-primary"
          >
            <Plus className="w-4 h-4" /> New macro
          </button>
        </div>

        <div className="flex gap-5 flex-1 min-h-0">
          {/* Left: Macro list */}
          <div className="w-72 shrink-0 flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={macroSearch}
                onChange={e => setMacroSearch(e.target.value)}
                placeholder="Search macros..."
                className="ic-input pl-9"
              />
            </div>

            {/* List */}
            <div className="ic-card overflow-hidden">
              <div className="px-4 h-10 flex items-center border-b border-line">
                <span className="text-[13px] font-medium text-muted">Shared macros <span className="text-faint">· {filtered.length}</span></span>
              </div>
              {macrosLoading ? (
                <div className="p-6 text-center text-faint text-[13px]">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 ic-empty">
                  <Zap className="w-8 h-8 text-faint" strokeWidth={1.5} />
                  <p className="text-[14px] text-muted">{macroSearch ? 'No results found.' : 'No macros yet.'}</p>
                  {!macroSearch && (
                    <button onClick={startCreate} className="text-[13px] text-ink underline underline-offset-2 hover:text-ink/70">Create your first macro</button>
                  )}
                </div>
              ) : (
                <div className="p-1.5 flex flex-col gap-0.5">
                  {filtered.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedMacro(m); setMacroEditing(false); }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-3 group ${
                        selectedMacro?.id === m.id
                          ? 'bg-subtle'
                          : 'hover:bg-ink/[0.03]'
                      }`}
                    >
                      <span className="text-lg shrink-0 leading-6">{m.title.match(/^[\p{Emoji}]/u)?.[0] || '⚡'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-ink truncate">{m.title.replace(/^[\p{Emoji}]\s*/u, '')}</p>
                        <p className="text-[12px] text-muted font-mono truncate">{m.trigger}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Detail / Edit panel */}
          <div className="flex-1 min-w-0">
            {macroEditing ? (
              /* ── Create / Edit Form ── */
              <div className="ic-card p-8 flex flex-col gap-6">
                <div className="flex items-center justify-between">
                  <h2 className="ic-section-title">
                    {selectedMacro ? 'Edit macro' : 'New macro'}
                  </h2>
                  <button onClick={() => { setMacroEditing(false); }} className="ic-icon-btn-ghost">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-5">
                  <div>
                    <label className="ic-label">Title</label>
                    <input
                      value={macroForm.title}
                      onChange={e => setMacroForm(f => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. 🙌 Feature Request"
                      className="ic-input"
                    />
                    <p className="ic-help mt-1.5">Give your macro a descriptive name. You can start with an emoji.</p>
                  </div>

                  <div>
                    <label className="ic-label">Shortcut trigger</label>
                    <div className="flex items-stretch">
                      <span className="h-10 px-3 flex items-center bg-subtle border border-r-0 border-line rounded-l-lg text-muted font-mono font-semibold text-[14px]">/</span>
                      <input
                        value={macroForm.trigger.replace(/^\//, '')}
                        onChange={e => setMacroForm(f => ({ ...f, trigger: e.target.value.replace(/\s/g, '-').replace(/^\//, '') }))}
                        placeholder="feature-request"
                        className="ic-input flex-1 rounded-l-none font-mono"
                      />
                    </div>
                    <p className="ic-help mt-1.5">Type this trigger in chat (e.g. <code className="bg-subtle px-1 rounded font-mono">/feature-request</code>) to insert this macro.</p>
                  </div>

                  <div>
                    <label className="ic-label">Message content</label>
                    <textarea
                      value={macroForm.content}
                      onChange={e => setMacroForm(f => ({ ...f, content: e.target.value }))}
                      onPaste={e => handleFormattedPaste(e, v => setMacroForm(f => ({ ...f, content: v })))}
                      placeholder="Type your macro message here. Use **bold**, *italic*, or plain text. Leave empty for an action-only macro."
                      rows={6}
                      className="ic-textarea"
                    />
                  </div>

                  <MacroActionsEditor value={macroForm.actions} onChange={actions => setMacroForm(f => ({ ...f, actions }))} />

                  <div className="grid grid-cols-2 gap-4">
                    {/* Available for Selector */}
                    <div className="relative">
                      <label className="ic-label">Available for</label>
                      <button
                        type="button"
                        onClick={() => { setShowForDropdown(!showForDropdown); setShowWhenDropdown(false); }}
                        className="ic-input flex items-center justify-between text-left"
                      >
                        <span>{AVAILABLE_FOR_LABELS[macroForm.availableFor || 'everyone']}</span>
                        <ChevronDown className="w-4 h-4 text-muted" />
                      </button>
                      {showForDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowForDropdown(false)} />
                          <div className="ic-menu absolute left-0 mt-1 w-full !z-20">
                            <button
                              type="button"
                              onClick={() => {
                                setMacroForm(f => ({ ...f, availableFor: 'everyone' }));
                                setShowForDropdown(false);
                              }}
                              className="ic-menu-item justify-between"
                            >
                              <span>Everyone</span>
                              {macroForm.availableFor === 'everyone' && <Check className="w-4 h-4 text-accent" />}
                            </button>
                            <div className="w-full flex items-center justify-between gap-3 px-3.5 h-9 text-[14px] text-faint cursor-not-allowed">
                              <span>Specific team(s)</span>
                              <span className="ic-badge">
                                <ArrowLeft className="w-3 h-3 rotate-90" /> Get feature
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setMacroForm(f => ({ ...f, availableFor: 'myself' }));
                                setShowForDropdown(false);
                              }}
                              className="ic-menu-item justify-between"
                            >
                              <span>Myself only</span>
                              {macroForm.availableFor === 'myself' && <Check className="w-4 h-4 text-accent" />}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Available when Selector */}
                    <div className="relative">
                      <label className="ic-label">Available when</label>
                      <button
                        type="button"
                        onClick={() => { setShowWhenDropdown(!showWhenDropdown); setShowForDropdown(false); }}
                        className="ic-input flex items-center justify-between gap-2 text-left"
                      >
                        <span className="truncate">
                          {macroForm.availableWhen && macroForm.availableWhen.length > 0
                            ? macroForm.availableWhen.map(w => AVAILABLE_WHEN_LABELS[w]).join(', ')
                            : 'Select scenarios...'}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                      </button>
                      {showWhenDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowWhenDropdown(false)} />
                          <div className="ic-menu absolute left-0 mt-1 w-full !z-20">
                            {(['starting_conversations', 'replying', 'adding_notes'] as const).map(option => {
                              const active = macroForm.availableWhen && macroForm.availableWhen.includes(option);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    setMacroForm(f => {
                                      const already = f.availableWhen && f.availableWhen.includes(option);
                                      const updated = already
                                        ? f.availableWhen.filter(o => o !== option)
                                        : [...(f.availableWhen || []), option];
                                      return { ...f, availableWhen: updated };
                                    });
                                  }}
                                  className="ic-menu-item justify-between"
                                >
                                  <span>{AVAILABLE_WHEN_LABELS[option]}</span>
                                  {active && <Check className="w-4 h-4 text-accent" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-5 border-t border-line">
                  <button
                    onClick={selectedMacro ? handleUpdateMacro : handleCreateMacro}
                    disabled={macroSaving || !macroForm.trigger || !macroForm.title || (!macroForm.content.trim() && !Object.keys(macroForm.actions).length)}
                    className="ic-btn-primary"
                  >
                    {macroSaving ? 'Saving...' : (selectedMacro ? 'Save changes' : 'Create macro')}
                  </button>
                  <button
                    onClick={() => setMacroEditing(false)}
                    className="ic-btn-ghost"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : selectedMacro ? (
              /* ── View Detail ── */
              <div className="ic-card overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
                  <h2 className="ic-section-title truncate">{selectedMacro.title}</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDeleteMacro(selectedMacro.id)}
                      className="ic-btn-ghost ic-btn-sm text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete macro
                    </button>
                    <button
                      onClick={() => startEdit(selectedMacro)}
                      className="ic-btn-secondary ic-btn-sm"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => startEdit(selectedMacro)}
                      className="ic-btn-primary ic-btn-sm"
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Trigger badge & Creator info */}
                <div className="px-6 pt-5 pb-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 h-7 px-3 bg-subtle text-ink text-[13px] font-medium font-mono rounded-full">
                      <Hash className="w-3.5 h-3.5 text-muted" /> {selectedMacro.trigger}
                    </span>
                  </div>
                  <div className="text-[13px] text-muted flex items-center gap-1.5 mt-1">
                    <span>Created by</span>
                    {selectedMacro.creator ? (
                      <>
                        <div className="ic-avatar w-5 h-5 bg-violet-200/70 dark:bg-violet-400/20 text-[11px] uppercase">
                          {selectedMacro.creator.name.slice(0, 1)}
                        </div>
                        <span className="font-medium text-ink">{selectedMacro.creator.name}</span>
                      </>
                    ) : (
                      <span className="font-medium text-ink">System</span>
                    )}
                    <span className="text-faint">· Not used yet</span>
                  </div>
                </div>

                {/* Content preview */}
                <div className="px-6 py-4">
                  <div className="p-4 border border-line rounded-xl bg-sidebar min-h-[120px]">
                    {selectedMacro.content?.trim()
                      ? <RichText className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed" text={selectedMacro.content} linkClass="text-link underline" />
                      : <p className="text-[14px] text-muted italic">No message: this macro only runs actions.</p>}
                  </div>
                  {describeMacroActions(selectedMacro.actions).length > 0 && (
                    <div className="mt-4">
                      <p className="text-[13px] text-muted font-medium mb-1.5">Actions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {describeMacroActions(selectedMacro.actions).map(a => (
                          <span key={a} className="ic-badge h-6 px-2.5 text-[13px] text-ink gap-1"><Zap className="w-3 h-3 text-amber-500" />{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div className="px-6 py-5 border-t border-line grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[13px] text-muted font-medium mb-1.5">Available for</p>
                    <div className="flex items-center gap-1.5">
                      <span className="ic-badge h-6 px-2.5 text-[13px] text-ink">
                        {AVAILABLE_FOR_LABELS[selectedMacro.availableFor || 'everyone']}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[13px] text-muted font-medium mb-1.5">Available when</p>
                    <div className="flex flex-wrap gap-1">
                      {(selectedMacro.availableWhen && selectedMacro.availableWhen.length > 0
                        ? selectedMacro.availableWhen
                        : ['starting_conversations', 'replying']
                      ).map(w => (
                        <span key={w} className="ic-badge h-6 px-2.5 text-[13px] text-ink">
                          {AVAILABLE_WHEN_LABELS[w as 'starting_conversations' | 'replying' | 'adding_notes']}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Empty state ── */
              <div className="ic-card p-12 ic-empty h-full min-h-[320px]">
                <Zap className="w-12 h-12 text-muted mb-2" strokeWidth={1.25} />
                <h3 className="ic-empty-title">Select a macro to preview</h3>
                <p className="text-[14px] text-muted max-w-xs">Pick a macro from the list, or create a new one to get started.</p>
                <button onClick={startCreate} className="ic-btn-primary mt-3">
                  <Plus className="w-4 h-4" /> Create new macro
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Purely visual: which sidebar groups are expanded
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    workspace: true, channels: true, engage: true, inbox: true, data: true, personal: true,
  });
  const toggleGroup = (key: string) => setOpenGroups(g => ({ ...g, [key]: !g[key] }));

  const PAGE_TITLES: Record<Section, string> = {
    home: 'Home',
    multilingual: 'Multilingual',
    general: 'General',
    workspace: 'Notifications & preferences',
    profile: 'Details',
    notifications: 'Notifications & preferences',
    teammates: 'Teammates',
    officeHours: 'Office hours',
    sla: 'SLAs',
    teams: 'Teams',
    peopleData: 'People data',
    audit: 'Audit log',
    email: 'Email',
    help: 'Knowledge base',
    outbound: 'Proactive messages',
    messenger: 'Messenger Live Chat',
    chatFlow: 'Chat flow',
    integrations: 'Integrations',
    ai: 'AI assistant',
    data: 'Imports & exports',
    macros: 'Macros',
  };

  return (
    <div className="flex gap-2 flex-1 min-w-0 h-full">
      {/* Left Nav */}
      <div className="ic-panel-side w-[300px] h-full shrink-0 flex flex-col">
        <div className="h-16 shrink-0 flex items-center px-5">
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">Settings</h1>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-1">
          <SettingsNavItem icon={Home} label="Home" active={section === 'home'} onClick={() => setSection('home')} />

          <div className="mt-2 flex flex-col gap-0.5">
            <SettingsNavGroup label="Workspace" open={openGroups.workspace} onToggle={() => toggleGroup('workspace')}>
              <SettingsNavItem icon={SlidersHorizontal} label="General" active={section === 'general'} onClick={() => setSection('general')} />
              <SettingsNavItem icon={Users} label="Teammates" active={section === 'teammates'} onClick={() => setSection('teammates')} />
              <SettingsNavItem icon={UsersRound} label="Teams" active={section === 'teams'} onClick={() => setSection('teams')} />
              <SettingsNavItem icon={Clock} label="Office hours" active={section === 'officeHours'} onClick={() => setSection('officeHours')} />
              <SettingsNavItem icon={Languages} label="Multilingual" active={section === 'multilingual'} onClick={() => setSection('multilingual')} />
              <SettingsNavItem icon={Timer} label="SLAs" active={section === 'sla'} onClick={() => setSection('sla')} />
              <SettingsNavItem icon={Puzzle} label="Integrations" active={section === 'integrations'} onClick={() => setSection('integrations')} />
              <SettingsNavItem icon={Sparkles} label="AI assistant" active={section === 'ai'} onClick={() => setSection('ai')} />
              <SettingsNavItem icon={Shield} label="Security" active={false} onClick={() => { setMessengerTab('security'); setSection('messenger'); }} />
              <SettingsNavItem icon={ScrollText} label="Audit log" active={section === 'audit'} onClick={() => setSection('audit')} />
              <SettingsNavItem icon={CreditCard} label="Billing" active={false} onClick={() => {}} soon />
            </SettingsNavGroup>

            <SettingsNavGroup label="Channels" open={openGroups.channels} onToggle={() => toggleGroup('channels')}>
              <SettingsNavItem icon={MessageSquare} label="Messenger Live Chat" active={section === 'messenger'} onClick={() => { setMessengerTab('overview'); setSection('messenger'); }} />
              <SettingsNavItem icon={Workflow} label="Chat flow" active={section === 'chatFlow'} onClick={() => setSection('chatFlow')} />
              <SettingsNavItem icon={Mail} label="Email" active={section === 'email'} onClick={() => setSection('email')} />
              <SettingsNavItem icon={Phone} label="Phone" active={false} onClick={() => {}} soon />
            </SettingsNavGroup>

            <SettingsNavGroup label="Self-service & outreach" open={openGroups.engage} onToggle={() => toggleGroup('engage')}>
              <SettingsNavItem icon={BookOpen} label="Knowledge base" active={section === 'help'} onClick={() => setSection('help')} />
              <SettingsNavItem icon={Megaphone} label="Proactive messages" active={section === 'outbound'} onClick={() => setSection('outbound')} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Inbox" open={openGroups.inbox} onToggle={() => toggleGroup('inbox')}>
              <SettingsNavItem icon={Zap} label="Macros" active={section === 'macros'} onClick={() => setSection('macros')} badge={macros.length > 0 ? String(macros.length) : undefined} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Data" open={openGroups.data} onToggle={() => toggleGroup('data')}>
              <SettingsNavItem icon={Contact} label="People data" active={section === 'peopleData'} onClick={() => setSection('peopleData')} />
              <SettingsNavItem icon={ArrowUpDown} label="Imports & exports" active={section === 'data'} onClick={() => setSection('data')} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Personal" open={openGroups.personal} onToggle={() => toggleGroup('personal')}>
              <SettingsNavItem icon={User} label="Details" active={section === 'profile'} onClick={() => setSection('profile')} />
              <SettingsNavItem icon={Bell} label="Notifications" active={section === 'notifications' || section === 'workspace'} onClick={() => setSection('notifications')} />
            </SettingsNavGroup>
          </div>
        </nav>
      </div>

      {/* Content Panel */}
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
        {section === 'teammates' && <TeammatesSettings onBack={() => setSection('home')} />}
        {section === 'officeHours' && <OfficeHoursSettings onBack={() => setSection('home')} />}
        {section === 'multilingual' && <MultilingualSettings onBack={() => setSection('home')} />}
        {section === 'sla' && <SlaSettings onBack={() => setSection('home')} />}
        {section === 'teams' && <TeamsSettings onBack={() => setSection('home')} />}
        {section === 'email' && <EmailSettings onBack={() => setSection('home')} />}
        {section === 'help' && <KnowledgeBaseSettings onBack={() => setSection('home')} />}
        {section === 'outbound' && <OutboundSettings onBack={() => setSection('home')} />}
        {section === 'peopleData' && <PeopleDataSettings onBack={() => setSection('home')} />}
        {section === 'audit' && <AuditLogSettings onBack={() => setSection('home')} />}
        {section === 'general' && <GeneralSettings onBack={() => setSection('home')} />}
        {section === 'integrations' && <IntegrationsSettings onBack={() => setSection('home')} />}
        {section === 'ai' && <AiSettings onBack={() => setSection('home')} />}
        {section === 'data' && <DataSettings onBack={() => setSection('home')} />}
        {section === 'messenger' && <MessengerSettings onBack={() => setSection('home')} tab={messengerTab} onTabChange={setMessengerTab} />}
        {section === 'chatFlow' && <ChatFlowSettings onBack={() => setSection('home')} />}
        {section === 'profile' && <ProfileSettings onBack={() => setSection('home')} onOpenNotifications={() => setSection('notifications')} />}
        {!SELF_CONTAINED.includes(section) && (<>
        <div className="ic-panel-header">
          {section === 'home' ? (
            <span className="ic-icon-btn-ghost pointer-events-none" aria-hidden="true">
              <PanelLeft className="w-[18px] h-[18px]" />
            </span>
          ) : (
            <button type="button" onClick={() => setSection('home')} className="ic-icon-btn-ghost" title="Back to settings home">
              <ArrowLeft className="w-[18px] h-[18px]" />
            </button>
          )}
          <h2 className="ic-title flex-1 min-w-0">{PAGE_TITLES[section]}</h2>

          {(section === 'notifications' || section === 'workspace') && agentSettings && (
            <Button type="submit" form="settings-profile-form" loading={loading}>
              Save
            </Button>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-8">
          {/* Called as functions on purpose: rendering these inner sections as <Section /> would
              remount them on every keystroke (inputs lose focus, color pickers close). */}
          {section === 'home' && HomeSection()}
          {(section === 'notifications' || section === 'workspace') && ProfileSection()}
          {section === 'macros' && MacrosSection()}
        </div>
        </>)}
      </div>
    </div>
  );
};

export default Settings;
