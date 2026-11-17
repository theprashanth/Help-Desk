import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { AgentSettings, SavedReply } from '../../../../../shared/src/types';
import Button from '../../components/ui/Button';
import {
  Bell, Calendar, User, ShieldAlert, Check,
  MessageSquare, Puzzle, Globe, Smartphone, ChevronRight, Copy,
  Moon, Sun, Palette, Home, Shield, Languages, CreditCard, Activity,
  Mail, Phone, Slack, Twitter, Github, CheckCircle2, AlertCircle, ArrowLeft,
  Zap, Hash, Plus, X, Edit2, Trash2, Search, ChevronDown, PanelLeft
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

type Section = 'home' | 'workspace' | 'messenger' | 'integrations' | 'profile' | 'macros';
type MessengerTab = 'widget' | 'appearance' | 'install' | 'security';

const PRESET_COLORS = [
  '#8B5CF6', '#6366F1', '#3B82F6', '#0EA5E9', '#10B981',
  '#F59E0B', '#EF4444', '#EC4899', '#1d4ed8', '#111827'
];

const INSTALL_PLATFORMS = [
  { id: 'code', label: 'Code snippet', icon: '⌨️' },
  { id: 'react', label: 'React', icon: '⚛️' },
  { id: 'vue', label: 'Vue', icon: '💚' },
  { id: 'angular', label: 'Angular', icon: '🅰️' },
  { id: 'wordpress', label: 'WordPress', icon: '🗨️' },
  { id: 'shopify', label: 'Shopify', icon: '🛍️' },
  { id: 'nextjs', label: 'Next.js', icon: '▲' },
  { id: 'gtm', label: 'Google Tag Manager', icon: '🏷️' },
];

const INTEGRATIONS = [
  { id: 'slack', name: 'Slack', icon: Slack, desc: 'Get notified in Slack for new conversations', color: '#4A154B', connected: false },
  { id: 'github', name: 'GitHub', icon: Github, desc: 'Link GitHub issues to support tickets', color: '#181717', connected: false },
  { id: 'twitter', name: 'Twitter / X', icon: Twitter, desc: 'Reply to DMs & mentions from inbox', color: '#1DA1F2', connected: false },
  { id: 'email', name: 'Email', icon: Mail, desc: 'Forward email support to inbox', color: '#EA4335', connected: true },
];

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

function SettingsNavItem({ icon: Icon, label, active, onClick, badge }: {
  icon: any; label: string; active: boolean; onClick: () => void; badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`ic-nav-item ${active ? 'ic-nav-item-active' : ''}`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0 text-ink/80" strokeWidth={2.2} />
      <span className="flex-1 truncate">{label}</span>
      {badge && <span className="ic-count">{badge}</span>}
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

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`ic-card overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
      {children}
    </div>
  );
}

// Intercom-style settings block: description on the left, fields on the right
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

// ─── Live Widget Preview ────────────────────────────────────────────────────
function WidgetPreview({ themeColor, brandName, greeting, welcome, darkTheme }: {
  themeColor: string; brandName: string; greeting: string; welcome: string; darkTheme: boolean;
}) {
  const bg = darkTheme ? '#0f172a' : '#f8fafc';
  const cardBg = darkTheme ? '#1e293b' : '#ffffff';
  const textPrimary = darkTheme ? '#f1f5f9' : '#0f172a';
  const textSecondary = darkTheme ? '#94a3b8' : '#64748b';

  return (
    <div className="w-72 rounded-3xl overflow-hidden shadow-card border border-line" style={{ background: bg }}>
      {/* Widget Header */}
      <div className="p-5 text-white relative" style={{ background: `linear-gradient(135deg, ${themeColor}ee, ${themeColor})` }}>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1.5">
            <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop" className="w-7 h-7 rounded-full border-2 border-white/40 object-cover" alt="" />
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=50&h=50&fit=crop" className="w-7 h-7 rounded-full border-2 border-white/40 object-cover" alt="" />
          </div>
          <div>
            <p className="font-bold text-sm">{brandName}</p>
            <p className="text-[11px] text-white/70 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />{greeting}
            </p>
          </div>
        </div>
        <p className="text-xs text-white/80 mt-3 leading-relaxed">{welcome}</p>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-2.5" style={{ background: bg }}>
        <button className="w-full py-2.5 text-xs font-semibold text-white rounded-xl" style={{ background: themeColor }}>
          Start a new chat
        </button>
        <div className="text-[11px] font-semibold mt-1" style={{ color: textSecondary }}>Recent conversations</div>
        {[
          { ticket: 'TICKET-1042', snippet: 'Thanks for your help!', unread: 1 },
          { ticket: 'TICKET-1023', snippet: 'I need help with billing.', unread: 0 },
        ].map(c => (
          <div key={c.ticket} className="flex items-center justify-between p-2.5 rounded-xl border" style={{ background: cardBg, borderColor: darkTheme ? '#334155' : '#e2e8f0' }}>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: textSecondary }}>{c.ticket}</p>
              <p className="text-xs" style={{ color: textPrimary }}>{c.snippet}</p>
            </div>
            {c.unread > 0 && (
              <span className="text-white text-[11px] font-semibold w-4 h-4 rounded-full flex items-center justify-center" style={{ background: themeColor }}>{c.unread}</span>
            )}
          </div>
        ))}
      </div>

      {/* Launcher */}
      <div className="px-4 pb-4 flex justify-end">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg" style={{ background: themeColor }}>
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

// ─── MAIN SETTINGS PAGE ─────────────────────────────────────────────────────
export const Settings: React.FC = () => {
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  const setAgent = useStore((state) => (state as any).setAgent);
  const widgetSettings = useStore((state) => state.widgetSettings);
  const setWidgetSettings = useStore((state) => state.setWidgetSettings);
  const chatColorTheme = useStore((state) => (state as any).chatColorTheme);
  const setChatColorTheme = useStore((state) => (state as any).setChatColorTheme);

  const [section, setSection] = useState<Section>('home');
  const [messengerTab, setMessengerTab] = useState<MessengerTab>('widget');
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [agentName, setAgentName] = useState(agent?.name || '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [installPlatform, setInstallPlatform] = useState('code');
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');

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
  }>({
    trigger: '',
    title: '',
    content: '',
    availableFor: 'everyone',
    availableWhen: ['starting_conversations', 'replying', 'adding_notes']
  });
  const [macroEditing, setMacroEditing] = useState(false);
  const [macroSaving, setMacroSaving] = useState(false);

  // Local copy for live editing (committed to store on change)
  const [localWidget, setLocalWidget] = useState(widgetSettings);

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
    if (!token || !macroForm.trigger || !macroForm.content) return;
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
          availableWhen: ['starting_conversations', 'replying', 'adding_notes']
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

  useEffect(() => {
    setLocalWidget(widgetSettings);
  }, [widgetSettings]);

  const updateWidget = (updates: Partial<typeof widgetSettings>) => {
    const next = { ...localWidget, ...updates };
    setLocalWidget(next);
    setWidgetSettings(updates);
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

      // Save agent name if changed
      if (agentName.trim() && agentName.trim() !== agent?.name) {
        const profileRes = await fetch(`${BACKEND_URL}/api/auth/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name: agentName.trim() })
        });
        if (profileRes.ok) {
          const updated = await profileRes.json();
          // Update store so header/sidebar reflects new name immediately
          if (setAgent) setAgent(updated);
        }
      }

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

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const getInstallSnippet = () => {
    if (installPlatform === 'react') {
      return `// Install the package
npm install @helpdesk/react-widget

// Add to your app
import { MessengerWidget } from '@helpdesk/react-widget';

function App() {
  return (
    <>
      <YourApp />
      <MessengerWidget
        apiKey="YOUR_API_KEY"
        brandName="${localWidget.brandName}"
        themeColor="${localWidget.themeColor}"
      />
    </>
  );
}`;
    }
    return `<!-- Paste before </body> tag -->
<script>
  window.HelpDesk = window.HelpDesk || {};
  window.HelpDesk.apiKey = "YOUR_API_KEY";
  window.HelpDesk.brandName = "${localWidget.brandName}";
  window.HelpDesk.themeColor = "${localWidget.themeColor}";
  window.HelpDesk.greeting = "${localWidget.greeting}";
</script>
<script 
  async 
  src="http://localhost:3000/widget.js">
</script>`;
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
            { icon: User, label: 'General', desc: 'Profile and name settings' },
            { icon: Shield, label: 'Security', desc: 'Authentication and permissions', badge: '⚠️' },
            { icon: Calendar, label: 'Office Hours', desc: 'Set your support availability' },
            { icon: Languages, label: 'Multilingual', desc: 'Manage language settings' },
            { icon: Globe, label: 'Brands', desc: 'Manage your brand identity' },
            { icon: Activity, label: 'Teammates', desc: 'Invite and manage agents' },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => setSection('profile')}
              className="ic-card-hover p-5 flex items-start gap-4 text-left"
            >
              <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200">
                <item.icon className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink flex items-center gap-1.5">
                  {item.label} {item.badge && <span className="text-[13px]">{item.badge}</span>}
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
            { icon: MessageSquare, label: 'Messenger', desc: 'Install and customize your widget', onClick: () => setSection('messenger') },
            { icon: Mail, label: 'Email', desc: 'Forwarding, domains, and routing', onClick: () => setSection('profile') },
            { icon: Phone, label: 'Phone', desc: 'Set up phone and SMS support', onClick: () => setSection('profile') },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="ic-card-hover p-5 flex items-start gap-4 text-left"
            >
              <div className="ic-tile-icon bg-pink-200/70 text-pink-900 dark:bg-pink-400/20 dark:text-pink-200">
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
    </div>
  );

  // ── Messenger Section ─────────────────────────────────────────────────────
  // (Page title, "Save and set live" button and the tab row live in the panel header.)
  const MessengerSection = () => (
    <div className="flex flex-col gap-6">
      {/* Widget Tab */}
      {messengerTab === 'widget' && (
        <div className="flex gap-8">
          <div className="flex-1 flex flex-col gap-4 max-w-2xl min-w-0">
            <SectionCard>
              <SectionHeader>
                <span className="ic-section-title">Content</span>
              </SectionHeader>
              <div className="divide-y divide-line">
                {[
                  { label: 'Spaces', desc: 'Configure chat spaces and homepage content' },
                  { label: 'Launch directly into Conversation', desc: 'Skip the home screen and start chat immediately' },
                  { label: 'Show the Messenger Launcher', desc: 'Control visibility of the floating chat button' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setMessengerTab('appearance')}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-ink/[0.03] transition-colors text-left"
                  >
                    <div>
                      <p className="text-[14px] font-medium text-ink">{item.label}</p>
                      <p className="text-[13px] text-muted mt-0.5">{item.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-faint shrink-0" />
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Install Status Cards */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Install for web', sub: 'Not installed', icon: Globe, status: false },
                { label: 'Install for mobile', sub: 'Not installed', icon: Smartphone, status: false },
              ].map(card => (
                <button
                  key={card.label}
                  onClick={() => setMessengerTab('install')}
                  className="flex flex-col items-center gap-2 p-6 bg-surface border border-dashed border-line rounded-xl hover:border-ink/30 hover:bg-ink/[0.02] transition-colors"
                >
                  <card.icon className="w-7 h-7 text-muted" strokeWidth={1.75} />
                  <div className="text-center">
                    <p className="text-[14px] font-medium text-ink">{card.label}</p>
                    <p className="text-[13px] text-faint">{card.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview Panel */}
          <div className="hidden xl:flex flex-col gap-4 items-center">
            <div className="inline-flex p-1 bg-subtle rounded-full text-[13px]">
              <button onClick={() => setPreviewMode('light')} className={`flex items-center gap-1.5 h-7 px-3 rounded-full font-medium transition-colors ${previewMode === 'light' ? 'bg-surface shadow-pill text-ink' : 'text-muted hover:text-ink'}`}>
                <Sun className="w-3.5 h-3.5" /> Light
              </button>
              <button onClick={() => setPreviewMode('dark')} className={`flex items-center gap-1.5 h-7 px-3 rounded-full font-medium transition-colors ${previewMode === 'dark' ? 'bg-surface shadow-pill text-ink' : 'text-muted hover:text-ink'}`}>
                <Moon className="w-3.5 h-3.5" /> Dark
              </button>
            </div>
            <WidgetPreview
              themeColor={localWidget.themeColor}
              brandName={localWidget.brandName}
              greeting={localWidget.greeting}
              welcome={localWidget.welcome}
              darkTheme={previewMode === 'dark'}
            />
          </div>
        </div>
      )}

      {/* Appearance Tab */}
      {messengerTab === 'appearance' && (
        <div className="flex gap-8">
          <div className="flex-1 flex flex-col gap-4 max-w-3xl min-w-0">

            {/* Brand Info */}
            <FormSection
              title="Brand identity"
              description="The name, greeting and welcome message customers see when they open the Messenger."
              cols="2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <div>
                <label className="ic-label">Brand name</label>
                <input
                  value={localWidget.brandName}
                  onChange={e => updateWidget({ brandName: e.target.value })}
                  className="ic-input"
                  placeholder="e.g. SplitAny Support"
                />
              </div>
              <div>
                <label className="ic-label">Availability greeting</label>
                <input
                  value={localWidget.greeting}
                  onChange={e => updateWidget({ greeting: e.target.value })}
                  className="ic-input"
                  placeholder="e.g. We reply in a few minutes"
                />
              </div>
              <div>
                <label className="ic-label">Welcome message</label>
                <textarea
                  value={localWidget.welcome}
                  onChange={e => updateWidget({ welcome: e.target.value })}
                  rows={2}
                  className="ic-textarea"
                  placeholder="e.g. Ask us anything, or share your feedback."
                />
              </div>
            </FormSection>

            {/* Theme Color */}
            <FormSection
              title="Theme color"
              icon={Palette}
              description="Used for the Messenger header, buttons and launcher."
              cols="2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => updateWidget({ themeColor: color })}
                    className={`w-8 h-8 rounded-full transition-shadow ring-offset-2 ring-offset-surface ${localWidget.themeColor === color ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line'}`}
                    style={{ background: color }}
                    title={color}
                  />
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={localWidget.themeColor}
                    onChange={e => updateWidget({ themeColor: e.target.value })}
                    className="w-8 h-8 rounded-full border border-dashed border-line bg-surface cursor-pointer"
                    title="Custom color"
                  />
                  <span className="text-[13px] text-muted">Custom</span>
                </div>
              </div>
              <div className="flex items-center gap-2 h-10 px-3 bg-subtle rounded-lg">
                <div className="w-5 h-5 rounded-full border border-line" style={{ background: localWidget.themeColor }} />
                <code className="text-[13px] font-mono text-ink/80">{localWidget.themeColor}</code>
              </div>
            </FormSection>

            {/* Chat Bubble Colors */}
            <FormSection
              title="Chat bubble colors"
              icon={MessageSquare}
              description="Select the background styling for chat message bubbles in conversations."
              cols="2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setChatColorTheme('sky-blue')}
                  className={`p-4 rounded-xl border text-left transition-colors ${
                    chatColorTheme === 'sky-blue'
                      ? 'border-ink ring-1 ring-ink bg-surface'
                      : 'border-line hover:border-ink/30'
                  }`}
                >
                  <span className="text-[14px] font-medium text-ink block mb-1">Sky Blue (3rd Image Style)</span>
                  <span className="text-[13px] text-muted block mb-3">Vibrant blue sender bubbles, soft grey recipient bubbles.</span>
                  <div className="flex flex-col gap-1.5 p-2 bg-subtle rounded-lg">
                    <div className="bg-slate-200 dark:bg-slate-700 w-2/3 px-1.5 py-1 rounded text-[11px] text-slate-600 dark:text-slate-300">Recipient bubble</div>
                    <div className="bg-[#0284c7] w-2/3 px-1.5 py-1 rounded text-[11px] text-white self-end text-right">Sender bubble</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setChatColorTheme('classic')}
                  className={`p-4 rounded-xl border text-left transition-colors ${
                    chatColorTheme === 'classic'
                      ? 'border-ink ring-1 ring-ink bg-surface'
                      : 'border-line hover:border-ink/30'
                  }`}
                >
                  <span className="text-[14px] font-medium text-ink block mb-1">Classic Violet</span>
                  <span className="text-[13px] text-muted block mb-3">Rich purple-indigo sender bubbles, bordered white recipient bubbles.</span>
                  <div className="flex flex-col gap-1.5 p-2 bg-subtle rounded-lg">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-2/3 px-1.5 py-1 rounded text-[11px] text-slate-600 dark:text-slate-300">Recipient bubble</div>
                    <div className="bg-gradient-to-tr from-violet-600 to-indigo-600 w-2/3 px-1.5 py-1 rounded text-[11px] text-white self-end text-right">Sender bubble</div>
                  </div>
                </button>
              </div>
            </FormSection>

            {/* Messenger Preview Mode */}
            <FormSection
              title="Widget theme"
              description="Choose how the Messenger looks to your customers."
              cols="2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <div className="flex items-center gap-3">
                <ToggleSwitch checked={localWidget.darkTheme} onChange={v => updateWidget({ darkTheme: v })} />
                <div>
                  <p className="text-[14px] font-medium text-ink flex items-center gap-1.5"><Moon className="w-4 h-4 text-muted" /> Dark widget theme</p>
                  <p className="ic-help">Show widget in dark mode to customers</p>
                </div>
              </div>
            </FormSection>
          </div>

          {/* Live Preview */}
          <div className="hidden xl:flex flex-col gap-3 items-center sticky top-6 self-start">
            <p className="text-[13px] font-medium text-muted">Live preview</p>
            <WidgetPreview
              themeColor={localWidget.themeColor}
              brandName={localWidget.brandName}
              greeting={localWidget.greeting}
              welcome={localWidget.welcome}
              darkTheme={localWidget.darkTheme}
            />
          </div>
        </div>
      )}

      {/* Install Tab */}
      {messengerTab === 'install' && (
        <div className="flex flex-col gap-4 max-w-3xl">
          {/* Status Cards */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Install for web', icon: Globe, installed: false },
              { label: 'Install for mobile', icon: Smartphone, installed: false },
            ].map(card => (
              <div key={card.label} className={`flex flex-col items-center gap-2.5 p-6 rounded-xl border ${card.installed ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-dashed border-line bg-surface'}`}>
                <card.icon className={`w-8 h-8 ${card.installed ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted'}`} strokeWidth={1.75} />
                <div className="text-center">
                  <p className="text-[14px] font-medium text-ink">{card.label}</p>
                  <p className={`text-[13px] ${card.installed ? 'text-emerald-700 dark:text-emerald-300' : 'text-faint'}`}>{card.installed ? 'Installed' : 'Not installed'}</p>
                </div>
              </div>
            ))}
          </div>

          <SectionCard>
            <div className="px-8 pt-7 pb-5 border-b border-line">
              <p className="ic-section-title">Install the messenger on your site or app</p>
              <p className="text-[14px] text-muted mt-1">The messenger helps you support your customers and learn more about them.</p>
            </div>

            <div className="p-8 flex flex-col gap-6">
              <div>
                <p className="ic-label mb-3">1. Choose how to install the messenger</p>
                <div className="flex flex-wrap gap-2">
                  {INSTALL_PLATFORMS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setInstallPlatform(p.id)}
                      className={`ic-chip ${
                        installPlatform === p.id
                          ? 'border-ink ring-1 ring-ink'
                          : 'text-ink/80'
                      }`}
                    >
                      <span>{p.icon}</span> {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="ic-label mb-3">2. Configure your code snippet</p>
                <div className="relative">
                  <pre className="bg-subtle text-ink text-[13px] font-mono p-4 pr-24 rounded-lg overflow-x-auto leading-relaxed border border-line">
                    {getInstallSnippet()}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(getInstallSnippet(), 'snippet')}
                    className="ic-btn-outline ic-btn-sm absolute top-3 right-3"
                  >
                    {copied === 'snippet' ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
              </div>

              <div className="p-3.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                <p className="text-[13px] text-amber-800 dark:text-amber-200">
                  Replace <code className="font-mono bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded">YOUR_API_KEY</code> with your actual workspace API key before deploying to production.
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Security Tab */}
      {messengerTab === 'security' && (
        <div className="max-w-4xl">
          <FormSection
            title="Identity verification"
            icon={Shield}
            description="Identity verification ensures that conversations are tied to real, authenticated users in your system — preventing impersonation."
          >
            <div>
              <label className="ic-label">Your secret key</label>
              <div className="flex items-stretch">
                <code className="flex-1 min-w-0 h-10 flex items-center text-[13px] font-mono text-muted bg-subtle border border-line rounded-l-lg px-3 truncate">
                  sk_live_••••••••••••••••••••••••••••••••
                </code>
                <button
                  onClick={() => copyToClipboard('sk_live_demo_key', 'secret')}
                  className="h-10 px-3.5 border border-l-0 border-line rounded-r-lg bg-surface hover:bg-subtle text-[13px] font-medium text-ink transition-colors flex items-center gap-1.5"
                >
                  {copied === 'secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Reveal
                </button>
              </div>
            </div>
            <div className="flex items-start gap-3 pt-1">
              <ToggleSwitch checked={false} onChange={() => {}} />
              <div>
                <p className="text-[14px] font-medium text-ink">Enforce identity verification</p>
                <p className="ic-help">Require HMAC signatures for all new conversations</p>
              </div>
            </div>
          </FormSection>
        </div>
      )}
    </div>
  );

  // ── Integrations Section ──────────────────────────────────────────────────
  const IntegrationsSection = () => (
    <div className="flex flex-col gap-6">
      <p className="text-[14px] text-muted">Connect your tools to supercharge your support workflow.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
        {INTEGRATIONS.map(intg => (
          <div key={intg.id} className="ic-card p-5 flex items-start gap-4 hover:border-ink/20 transition-colors">
            <div className="ic-tile-icon" style={{ background: `${intg.color}22` }}>
              <intg.icon className="w-5 h-5" style={{ color: intg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-medium text-ink">{intg.name}</p>
                {intg.connected
                  ? <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" /> Connected</span>
                  : <button className="ic-btn-outline ic-btn-sm">Connect</button>
                }
              </div>
              <p className="text-[14px] text-muted mt-1 leading-snug">{intg.desc}</p>
            </div>
          </div>
        ))}
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
          <FormSection title="Agent profile" icon={User} description="Your name as it appears to teammates and customers.">
            <div>
              <label className="ic-label">Full name</label>
              <input
                type="text"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                className="ic-input"
                placeholder="Your display name"
              />
            </div>
            <div>
              <label className="ic-label">Email address</label>
              <span className="ic-input flex items-center bg-subtle text-muted font-mono text-[13px] truncate" title={agent?.email}>{agent?.email}</span>
            </div>
          </FormSection>

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
    const [showForDropdown, setShowForDropdown] = useState(false);
    const [showWhenDropdown, setShowWhenDropdown] = useState(false);

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
        availableWhen: ['starting_conversations', 'replying', 'adding_notes']
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
        availableWhen: m.availableWhen || ['starting_conversations', 'replying', 'adding_notes']
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
                      placeholder="Type your macro message here. Use **bold**, *italic*, or plain text."
                      rows={6}
                      className="ic-textarea"
                    />
                  </div>

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
                    disabled={macroSaving || !macroForm.trigger || !macroForm.content}
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
                    <p className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed">{selectedMacro.content}</p>
                  </div>
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
    workspace: true, channels: true, inbox: true, personal: true,
  });
  const toggleGroup = (key: string) => setOpenGroups(g => ({ ...g, [key]: !g[key] }));

  const PAGE_TITLES: Record<Section, string> = {
    home: 'Home',
    workspace: 'Account & preferences',
    profile: 'Account & preferences',
    messenger: 'Messenger',
    integrations: 'Integrations',
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
              <SettingsNavItem icon={Puzzle} label="Integrations" active={section === 'integrations'} onClick={() => setSection('integrations')} />
              <SettingsNavItem icon={Shield} label="Security" active={false} onClick={() => setSection('messenger')} />
              <SettingsNavItem icon={CreditCard} label="Billing" active={false} onClick={() => setSection('home')} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Channels" open={openGroups.channels} onToggle={() => toggleGroup('channels')}>
              <SettingsNavItem icon={MessageSquare} label="Messenger" active={section === 'messenger'} onClick={() => setSection('messenger')} />
              <SettingsNavItem icon={Mail} label="Email" active={false} onClick={() => setSection('profile')} />
              <SettingsNavItem icon={Phone} label="Phone" active={false} onClick={() => setSection('profile')} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Inbox" open={openGroups.inbox} onToggle={() => toggleGroup('inbox')}>
              <SettingsNavItem icon={Zap} label="Macros" active={section === 'macros'} onClick={() => setSection('macros')} badge={macros.length > 0 ? String(macros.length) : undefined} />
            </SettingsNavGroup>

            <SettingsNavGroup label="Personal" open={openGroups.personal} onToggle={() => toggleGroup('personal')}>
              <SettingsNavItem icon={User} label="Profile" active={section === 'profile'} onClick={() => setSection('profile')} />
            </SettingsNavGroup>
          </div>
        </nav>
      </div>

      {/* Content Panel */}
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
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

          {section === 'messenger' && (
            <button
              onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
              className="ic-btn-primary"
            >
              {saved ? <><CheckCircle2 className="w-4 h-4" /> Saved!</> : <><Check className="w-4 h-4" /> Save and set live</>}
            </button>
          )}

          {(section === 'profile' || section === 'workspace') && agentSettings && (
            <Button type="submit" form="settings-profile-form" loading={loading}>
              Save
            </Button>
          )}
        </div>

        {/* Messenger sub-tabs */}
        {section === 'messenger' && (
          <div className="ic-tabs pt-4 px-8 shrink-0">
            {(['widget', 'appearance', 'install', 'security'] as MessengerTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setMessengerTab(tab)}
                className={`ic-tab capitalize ${messengerTab === tab ? 'ic-tab-active' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-8">
          {section === 'home' && <HomeSection />}
          {section === 'messenger' && <MessengerSection />}
          {section === 'integrations' && <IntegrationsSection />}
          {(section === 'profile' || section === 'workspace') && <ProfileSection />}
          {section === 'macros' && <MacrosSection />}
        </div>
      </div>
    </div>
  );
};

export default Settings;
