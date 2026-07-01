import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { AgentSettings } from '../../../../../shared/src/types';
import Button from '../../components/ui/Button';
import {
  Settings as SettingsIcon, Bell, Calendar, User, ShieldAlert, Check,
  MessageSquare, Puzzle, Globe, Smartphone, ChevronRight, Copy,
  Moon, Sun, Palette, Home, Shield, Languages, CreditCard, Activity,
  Mail, Phone, Slack, Twitter, Github, CheckCircle2, AlertCircle, ArrowLeft
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

type Section = 'home' | 'workspace' | 'messenger' | 'integrations' | 'profile';
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
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SettingsNavItem({ icon: Icon, label, active, onClick, badge }: {
  icon: any; label: string; active: boolean; onClick: () => void; badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
        active
          ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge && <span className="text-[10px] font-bold bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 px-1.5 py-0.5 rounded">{badge}</span>}
    </button>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
      {children}
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
    <div className="w-72 rounded-3xl overflow-hidden shadow-2xl border border-slate-200/60 dark:border-slate-700/60" style={{ background: bg }}>
      {/* Widget Header */}
      <div className="p-5 text-white relative" style={{ background: `linear-gradient(135deg, ${themeColor}ee, ${themeColor})` }}>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1.5">
            <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop" className="w-7 h-7 rounded-full border-2 border-white/40 object-cover" alt="" />
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=50&h=50&fit=crop" className="w-7 h-7 rounded-full border-2 border-white/40 object-cover" alt="" />
          </div>
          <div>
            <p className="font-bold text-sm">{brandName}</p>
            <p className="text-[10px] text-white/70 flex items-center gap-1">
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
        <div className="text-[10px] font-bold uppercase tracking-wider mt-1" style={{ color: textSecondary }}>Recent Conversations</div>
        {[
          { ticket: 'TICKET-1042', snippet: 'Thanks for your help!', unread: 1 },
          { ticket: 'TICKET-1023', snippet: 'I need help with billing.', unread: 0 },
        ].map(c => (
          <div key={c.ticket} className="flex items-center justify-between p-2.5 rounded-xl border" style={{ background: cardBg, borderColor: darkTheme ? '#334155' : '#e2e8f0' }}>
            <div>
              <p className="text-[10px] font-bold" style={{ color: textSecondary }}>{c.ticket}</p>
              <p className="text-xs" style={{ color: textPrimary }}>{c.snippet}</p>
            </div>
            {c.unread > 0 && (
              <span className="text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center" style={{ background: themeColor }}>{c.unread}</span>
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
  const widgetSettings = useStore((state) => state.widgetSettings);
  const setWidgetSettings = useStore((state) => state.setWidgetSettings);

  const [section, setSection] = useState<Section>('home');
  const [messengerTab, setMessengerTab] = useState<MessengerTab>('widget');
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [installPlatform, setInstallPlatform] = useState('code');
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');

  // Local copy for live editing (committed to store on change)
  const [localWidget, setLocalWidget] = useState(widgetSettings);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setAgentSettings(data))
      .catch(err => console.error('Failed to load settings:', err));
  }, [token]);

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
      const res = await fetch(`${BACKEND_URL}/api/auth/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(agentSettings)
      });
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
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your workspace, messenger, and integrations.</p>
      </div>

      {/* Workspace Group */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Workspace</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: User, label: 'General', desc: 'Profile and name settings', color: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300' },
            { icon: Shield, label: 'Security', desc: 'Authentication and permissions', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300', badge: '⚠️' },
            { icon: Calendar, label: 'Office Hours', desc: 'Set your support availability', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' },
            { icon: Languages, label: 'Multilingual', desc: 'Manage language settings', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
            { icon: Globe, label: 'Brands', desc: 'Manage your brand identity', color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' },
            { icon: Activity, label: 'Teammates', desc: 'Invite and manage agents', color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300' },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => setSection('profile')}
              className="flex items-start gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-sm transition-all text-left group"
            >
              <div className={`p-2 rounded-xl ${item.color} shrink-0`}>
                <item.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  {item.label} {item.badge && <span>{item.badge}</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Channels Group */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Channels</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: MessageSquare, label: 'Messenger', desc: 'Install and customize your widget', color: 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300', onClick: () => setSection('messenger') },
            { icon: Mail, label: 'Email', desc: 'Forwarding, domains, and routing', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300', onClick: () => setSection('profile') },
            { icon: Phone, label: 'Phone', desc: 'Set up phone and SMS support', color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300', onClick: () => setSection('profile') },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="flex items-start gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-sm transition-all text-left"
            >
              <div className={`p-2 rounded-xl ${item.color} shrink-0`}>
                <item.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Subscription Group */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Subscription</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: CreditCard, label: 'Billing', desc: 'Manage your plan and payment details', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
            { icon: Activity, label: 'Usage', desc: 'View billed usage and set limits', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', disabled: true },
          ].map(item => (
            <button
              key={item.label}
              disabled={(item as any).disabled}
              className={`flex items-start gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-left transition-all ${(item as any).disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-sm'}`}
            >
              <div className={`p-2 rounded-xl ${item.color} shrink-0`}>
                <item.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Messenger Section ─────────────────────────────────────────────────────
  const MessengerSection = () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setSection('home')} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-500" /> Messenger
          </h1>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            {saved ? <><CheckCircle2 className="w-4 h-4" /> Saved!</> : <><Check className="w-4 h-4" /> Save and set live</>}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(['widget', 'appearance', 'install', 'security'] as MessengerTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setMessengerTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
              messengerTab === tab
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Widget Tab */}
      {messengerTab === 'widget' && (
        <div className="flex gap-6">
          <div className="flex-1 flex flex-col gap-4 max-w-xl">
            <SectionCard>
              <SectionHeader>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Content</span>
              </SectionHeader>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {[
                  { label: 'Spaces', desc: 'Configure chat spaces and homepage content' },
                  { label: 'Launch directly into Conversation', desc: 'Skip the home screen and start chat immediately' },
                  { label: 'Show the Messenger Launcher', desc: 'Control visibility of the floating chat button' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => setMessengerTab('appearance')}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Install Status Cards */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Install for web', sub: 'Not installed', icon: Globe, status: false },
                { label: 'Install for mobile', sub: 'Not installed', icon: Smartphone, status: false },
              ].map(card => (
                <button
                  key={card.label}
                  onClick={() => setMessengerTab('install')}
                  className="flex flex-col items-center gap-2 p-5 bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl hover:border-brand-300 dark:hover:border-brand-700 transition-all"
                >
                  <card.icon className="w-7 h-7 text-slate-400" />
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{card.label}</p>
                    <p className="text-[10px] text-slate-400">{card.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview Panel */}
          <div className="hidden xl:flex flex-col gap-3 items-center">
            <div className="flex gap-2 text-xs">
              <button onClick={() => setPreviewMode('light')} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border font-medium ${previewMode === 'light' ? 'bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-600 text-slate-800 dark:text-slate-200' : 'border-transparent text-slate-400'}`}>
                <Sun className="w-3.5 h-3.5" /> Light
              </button>
              <button onClick={() => setPreviewMode('dark')} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border font-medium ${previewMode === 'dark' ? 'bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-600 text-slate-800 dark:text-slate-200' : 'border-transparent text-slate-400'}`}>
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
        <div className="flex gap-6">
          <div className="flex-1 flex flex-col gap-4 max-w-xl">

            {/* Brand Info */}
            <SectionCard>
              <SectionHeader>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Brand Identity</span>
              </SectionHeader>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Brand Name</label>
                  <input
                    value={localWidget.brandName}
                    onChange={e => updateWidget({ brandName: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    placeholder="e.g. SplitAny Support"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Availability Greeting</label>
                  <input
                    value={localWidget.greeting}
                    onChange={e => updateWidget({ greeting: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    placeholder="e.g. We reply in a few minutes"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Welcome Message</label>
                  <textarea
                    value={localWidget.welcome}
                    onChange={e => updateWidget({ welcome: e.target.value })}
                    rows={2}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
                    placeholder="e.g. Ask us anything, or share your feedback."
                  />
                </div>
              </div>
            </SectionCard>

            {/* Theme Color */}
            <SectionCard>
              <SectionHeader>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-brand-500" /> Theme Color
                </span>
              </SectionHeader>
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-wrap gap-2.5">
                  {PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => updateWidget({ themeColor: color })}
                      className={`w-8 h-8 rounded-full transition-all border-2 ${localWidget.themeColor === color ? 'border-slate-900 dark:border-white scale-110 shadow-md' : 'border-transparent hover:scale-110'}`}
                      style={{ background: color }}
                      title={color}
                    />
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={localWidget.themeColor}
                      onChange={e => updateWidget({ themeColor: e.target.value })}
                      className="w-8 h-8 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer"
                      title="Custom color"
                    />
                    <span className="text-xs text-slate-400">Custom</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-950/40 rounded-xl">
                  <div className="w-5 h-5 rounded-full" style={{ background: localWidget.themeColor }} />
                  <code className="text-xs font-mono text-slate-600 dark:text-slate-400">{localWidget.themeColor}</code>
                </div>
              </div>
            </SectionCard>

            {/* Messenger Preview Mode */}
            <SectionCard>
              <SectionHeader>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Widget Theme</span>
              </SectionHeader>
              <div className="p-6 flex flex-col gap-2">
                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-950/40 rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <Moon className="w-4 h-4 text-slate-500" />
                    <div>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Dark Widget Theme</p>
                      <p className="text-[11px] text-slate-400">Show widget in dark mode to customers</p>
                    </div>
                  </div>
                  <ToggleSwitch checked={localWidget.darkTheme} onChange={v => updateWidget({ darkTheme: v })} />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Live Preview */}
          <div className="hidden xl:flex flex-col gap-3 items-center sticky top-6">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Live Preview</p>
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
        <div className="flex flex-col gap-5 max-w-2xl">
          {/* Status Cards */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Install for web', icon: Globe, installed: false },
              { label: 'Install for mobile', icon: Smartphone, installed: false },
            ].map(card => (
              <div key={card.label} className={`flex flex-col items-center gap-2.5 p-5 rounded-2xl border-2 ${card.installed ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-dashed border-slate-200 dark:border-slate-700'}`}>
                <card.icon className={`w-8 h-8 ${card.installed ? 'text-emerald-500' : 'text-slate-400'}`} />
                <div className="text-center">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{card.label}</p>
                  <p className={`text-[10px] font-semibold ${card.installed ? 'text-emerald-500' : 'text-slate-400'}`}>{card.installed ? 'Installed' : 'Not installed'}</p>
                </div>
              </div>
            ))}
          </div>

          <SectionCard>
            <SectionHeader>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Install the messenger on your site or app</p>
                <p className="text-xs text-slate-400 mt-0.5">The messenger helps you support your customers and learn more about them.</p>
              </div>
            </SectionHeader>

            <div className="p-6 flex flex-col gap-5">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">1. Choose how to install the messenger</p>
                <div className="flex flex-wrap gap-2">
                  {INSTALL_PLATFORMS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setInstallPlatform(p.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        installPlatform === p.id
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <span>{p.icon}</span> {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">2. Configure your code snippet</p>
                <div className="relative">
                  <pre className="bg-slate-950 text-emerald-400 text-xs font-mono p-4 rounded-xl overflow-x-auto leading-relaxed border border-slate-800">
                    {getInstallSnippet()}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(getInstallSnippet(), 'snippet')}
                    className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
                  >
                    {copied === 'snippet' ? <><Check className="w-3 h-3 text-emerald-400" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </button>
                </div>
              </div>

              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Replace <code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 py-0.5 rounded">YOUR_API_KEY</code> with your actual workspace API key before deploying to production.
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Security Tab */}
      {messengerTab === 'security' && (
        <SectionCard className="max-w-xl">
          <SectionHeader>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-brand-500" /> Identity Verification
            </span>
          </SectionHeader>
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Identity verification ensures that conversations are tied to real, authenticated users in your system — preventing impersonation.
            </p>
            <div className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border">
              <p className="text-xs font-bold text-slate-500 mb-2">Your Secret Key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2">
                  sk_live_••••••••••••••••••••••••••••••••
                </code>
                <button
                  onClick={() => copyToClipboard('sk_live_demo_key', 'secret')}
                  className="px-3 py-2 bg-brand-500 text-white rounded-lg text-xs font-semibold hover:bg-brand-600 transition-colors flex items-center gap-1"
                >
                  {copied === 'secret' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Reveal
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-950/40 rounded-xl border">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Enforce Identity Verification</p>
                <p className="text-[11px] text-slate-400">Require HMAC signatures for all new conversations</p>
              </div>
              <ToggleSwitch checked={false} onChange={() => {}} />
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );

  // ── Integrations Section ──────────────────────────────────────────────────
  const IntegrationsSection = () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setSection('home')} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-brand-500" /> Integrations
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Connect your tools to supercharge your support workflow.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {INTEGRATIONS.map(intg => (
          <div key={intg.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-start gap-4 hover:border-slate-300 dark:hover:border-slate-700 transition-all">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${intg.color}22` }}>
              <intg.icon className="w-5 h-5" style={{ color: intg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{intg.name}</p>
                {intg.connected
                  ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/50">Connected</span>
                  : <button className="text-[10px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-950/30 dark:text-brand-400 px-2 py-0.5 rounded-full border border-brand-200 dark:border-brand-800/50 hover:bg-brand-100 transition-colors">Connect</button>
                }
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{intg.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Profile Section ───────────────────────────────────────────────────────
  const ProfileSection = () => (
    <form onSubmit={handleSaveAgent} className="flex flex-col gap-6 max-w-xl">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setSection('home')} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-brand-500" /> Account &amp; Preferences
        </h1>
      </div>

      {saved && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 text-xs font-semibold text-emerald-700 dark:text-emerald-400 rounded-xl flex items-center gap-1.5">
          <Check className="w-4 h-4" /> Settings updated successfully!
        </div>
      )}

      {agentSettings && (
        <>
          <SectionCard>
            <SectionHeader>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <User className="w-4 h-4 text-brand-500" /> Agent Profile
              </span>
            </SectionHeader>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 font-bold block mb-1">Full Name</span>
                <span className="text-slate-800 dark:text-slate-200 font-semibold font-mono text-sm bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-lg border block">{agent?.name}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block mb-1">Email Address</span>
                <span className="text-slate-800 dark:text-slate-200 font-semibold font-mono text-sm bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-lg border block">{agent?.email}</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Bell className="w-4 h-4 text-brand-500" /> Notifications &amp; Theme
              </span>
            </SectionHeader>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
                <div key={item.label} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{item.label}</p>
                    <p className="text-[11px] text-slate-400">{item.sub}</p>
                  </div>
                  <ToggleSwitch checked={item.checked} onChange={item.onChange} />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-brand-500" /> Auto-Assign Engine
              </span>
            </SectionHeader>
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Automatic Ticket Routing</p>
                <p className="text-[11px] text-slate-400">Distribute new incoming tickets round-robin to online agents.</p>
              </div>
              <ToggleSwitch
                checked={agentSettings.autoAssign}
                onChange={v => setAgentSettings({ ...agentSettings, autoAssign: v })}
              />
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-brand-500" /> Business Support Hours
              </span>
            </SectionHeader>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Restrict Hours</p>
                  <p className="text-[11px] text-slate-400">Customers will see an offline banner outside active hours.</p>
                </div>
                <ToggleSwitch
                  checked={agentSettings.businessHours.enabled}
                  onChange={v => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, enabled: v } })}
                />
              </div>
              {agentSettings.businessHours.enabled && (
                <div className="grid grid-cols-2 gap-4 text-xs p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border">
                  <div>
                    <label className="text-slate-500 font-bold block mb-1">Start Time</label>
                    <input type="time" value={agentSettings.businessHours.start}
                      onChange={e => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, start: e.target.value } })}
                      className="border rounded px-2.5 py-1.5 w-full bg-white dark:bg-slate-900 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500 font-bold block mb-1">End Time</label>
                    <input type="time" value={agentSettings.businessHours.end}
                      onChange={e => setAgentSettings({ ...agentSettings, businessHours: { ...agentSettings.businessHours, end: e.target.value } })}
                      className="border rounded px-2.5 py-1.5 w-full bg-white dark:bg-slate-900 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <Button type="submit" loading={loading} className="w-48 py-2.5 shadow-brand-500/10 font-bold">
            Save All Preferences
          </Button>
        </>
      )}
    </form>
  );

  return (
    <div className="flex h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Left Nav */}
      <div className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-col gap-1 overflow-y-auto">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Settings</p>
        <SettingsNavItem icon={Home} label="Home" active={section === 'home'} onClick={() => setSection('home')} />
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1">Channels</p>
        <SettingsNavItem icon={MessageSquare} label="Messenger" active={section === 'messenger'} onClick={() => setSection('messenger')} />
        <SettingsNavItem icon={Mail} label="Email" active={false} onClick={() => setSection('profile')} />
        <SettingsNavItem icon={Phone} label="Phone" active={false} onClick={() => setSection('profile')} />
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1">Workspace</p>
        <SettingsNavItem icon={User} label="Profile" active={section === 'profile'} onClick={() => setSection('profile')} />
        <SettingsNavItem icon={Puzzle} label="Integrations" active={section === 'integrations'} onClick={() => setSection('integrations')} />
        <SettingsNavItem icon={Shield} label="Security" active={false} onClick={() => setSection('messenger')} />
        <SettingsNavItem icon={CreditCard} label="Billing" active={false} onClick={() => setSection('home')} />
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        {section === 'home' && <HomeSection />}
        {section === 'messenger' && <MessengerSection />}
        {section === 'integrations' && <IntegrationsSection />}
        {(section === 'profile' || section === 'workspace') && <ProfileSection />}
      </div>
    </div>
  );
};

export default Settings;
