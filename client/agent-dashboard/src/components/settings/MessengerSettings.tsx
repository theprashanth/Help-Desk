import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, Copy, Eye, EyeOff, Globe, Inbox, MessageSquare, MoreHorizontal, Palette,
  RefreshCw, ShieldCheck, Smartphone, Trash2, X, Plus,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { MessengerAppearance, MessengerInstallation } from '../../../../../shared/src/types';
import Modal from '../ui/Modal';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection, relativeTime } from './shared';

export type MessengerTab = 'overview' | 'widget' | 'install' | 'mobile' | 'security';

const TABS: { id: MessengerTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'widget', label: 'Widget' },
  { id: 'install', label: 'Install' },
  { id: 'mobile', label: 'Mobile SDKs' },
  { id: 'security', label: 'Security' },
];

type MessengerSettingsData = {
  appId: string;
  appearance: MessengerAppearance;
  identityVerification: { enforced: boolean; secretConfigured: boolean };
  allowedDomains: string[];
  installations: MessengerInstallation[];
};

/** Mirrors the server's DEFAULT_APPEARANCE (server/src/services/messenger.ts). */
const DEFAULT_APPEARANCE: MessengerAppearance = {
  brandName: '',
  themeColor: '#8B5CF6',
  greeting: 'We reply in a few minutes',
  welcome: 'Ask us anything, or share your feedback.',
  launcherPosition: 'right',
  showLauncher: true,
};
/** The old browser-only defaults (store/useStore.ts widgetSettings). */
const OLD_LOCAL_DEFAULTS = { themeColor: '#8B5CF6', brandName: 'Chai Samosa', greeting: 'We reply in a few minutes', welcome: 'Ask us anything, or share your feedback.' };

const PRESET_COLORS = [
  '#8B5CF6', '#6366F1', '#3B82F6', '#0EA5E9', '#10B981',
  '#F59E0B', '#EF4444', '#EC4899', '#1D4ED8', '#111827',
];

const LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const isLive = (i: MessengerInstallation) => Date.now() - new Date(i.lastSeenAt).getTime() < LIVE_WINDOW_MS;

const sameAppearance = (a: MessengerAppearance, b: MessengerAppearance) =>
  a.brandName === b.brandName && a.themeColor.toLowerCase() === b.themeColor.toLowerCase() && a.greeting === b.greeting
  && a.welcome === b.welcome && a.launcherPosition === b.launcherPosition && a.showLauncher === b.showLauncher;

// ─── Small building blocks (module level so they never remount while typing) ──

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" /> <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ic-toggle ${checked ? 'ic-toggle-on' : ''} shrink-0 disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className="ic-toggle-knob" />
    </button>
  );
}

function Segmented<T extends string>({ options, value, onChange, disabled }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex self-start p-1 bg-subtle rounded-full text-[13px]">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`h-7 px-3.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed ${value === o.id ? 'bg-surface shadow-pill text-ink' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => {})}
      className={`ic-btn-outline ic-btn-sm ${className}`}
    >
      {done ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> {label}</>}
    </button>
  );
}

function CodeBox({ code, title }: { code: string; title?: string }) {
  return (
    <div className="rounded-lg border border-line bg-subtle overflow-hidden">
      <div className="flex items-center justify-between gap-3 h-11 px-3.5 border-b border-line">
        <span className="text-[13px] font-medium text-muted truncate">{title || ''}</span>
        <CopyButton text={code} />
      </div>
      <pre className="text-ink text-[13px] font-mono p-4 overflow-x-auto leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

function StatusDot({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const dot = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-faint';
  const text = tone === 'green' ? 'text-emerald-700 dark:text-emerald-300' : tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${text}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} /> {children}
    </span>
  );
}

function CustomerDataStatus({ inst }: { inst: MessengerInstallation }) {
  if (inst.verifiedAt) return <StatusDot tone="green">Connected</StatusDot>;
  if (inst.identifiedAt) return <StatusDot tone="amber">Connected (unverified)</StatusDot>;
  return <StatusDot tone="gray">Not connected</StatusDot>;
}

/** Static mock of the Messenger home screen, driven by the (unsaved) draft. */
function WidgetPreview({ a, brandName }: { a: MessengerAppearance; brandName: string }) {
  const left = a.launcherPosition === 'left';
  return (
    <div className="flex flex-col gap-3" style={{ alignItems: left ? 'flex-start' : 'flex-end' }}>
      <div className="w-72 rounded-3xl overflow-hidden shadow-card border border-line bg-[#f8fafc]">
        <div className="p-5 text-white" style={{ background: a.themeColor }}>
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-[12px] font-semibold uppercase">
              {(brandName || '?').trim().charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{brandName}</p>
              <p className="text-[11px] text-white/80 flex items-center gap-1 truncate">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0" />{a.greeting || '—'}
              </p>
            </div>
          </div>
          <p className="text-xs text-white/90 mt-3 leading-relaxed break-words">{a.welcome}</p>
        </div>
        <div className="p-4 flex flex-col gap-2.5">
          <button type="button" tabIndex={-1} className="w-full py-2.5 text-xs font-semibold text-white rounded-xl" style={{ background: a.themeColor }}>
            Start a new chat
          </button>
          <div className="text-[11px] font-semibold mt-1 text-[#64748b]">Recent conversations</div>
          {[
            { t: 'Order #1042', s: 'Thanks for your help!', unread: 1 },
            { t: 'Billing question', s: 'I need help with billing.', unread: 0 },
          ].map(c => (
            <div key={c.t} className="flex items-center justify-between p-2.5 rounded-xl border border-[#e2e8f0] bg-white">
              <div>
                <p className="text-[11px] font-semibold text-[#64748b]">{c.t}</p>
                <p className="text-xs text-[#0f172a]">{c.s}</p>
              </div>
              {c.unread > 0 && (
                <span className="text-white text-[11px] font-semibold w-4 h-4 rounded-full flex items-center justify-center" style={{ background: a.themeColor }}>{c.unread}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {a.showLauncher ? (
        <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-card" style={{ background: a.themeColor }}>
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
      ) : (
        <p className="text-[12px] text-faint w-72" style={{ textAlign: left ? 'left' : 'right' }}>Launcher hidden — opened from your own button</p>
      )}
    </div>
  );
}

type Confirm = { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; action: () => Promise<void> | void };

// ─── Snippets ────────────────────────────────────────────────────────────────

type WebFramework = 'web' | 'react' | 'next' | 'vue';
type ServerLang = 'node' | 'python' | 'php' | 'ruby';
type MobilePlatform = 'ios' | 'android' | 'react-native';

const STUB = 'window.ChaiSamosa=window.ChaiSamosa||function(){(ChaiSamosa.q=ChaiSamosa.q||[]).push(arguments)};';

function webSnippet(fw: WebFramework, appId: string, origin: string): string {
  const src = `${origin}/messenger.js`;
  if (fw === 'react') return `import { useEffect } from 'react';

// Render once near the root of your app, e.g. <ChaiSamosaMessenger user={currentUser} />
export function ChaiSamosaMessenger({ user }) {
  useEffect(() => {
    const settings = {
      app_id: "${appId}",
      // For logged-in users (optional); user_hash comes from YOUR server:
      ...(user ? { user_id: user.id, name: user.name, email: user.email, user_hash: user.chaiSamosaHash } : {}),
    };
    if (document.getElementById('chai-samosa-messenger')) {
      window.ChaiSamosa('boot', settings); // the user changed (logged in / switched account)
      return;
    }
    window.ChaiSamosaSettings = settings;
    ${STUB}
    const script = document.createElement('script');
    script.id = 'chai-samosa-messenger';
    script.async = true;
    script.src = "${src}";
    document.body.appendChild(script);
  }, [user?.id]);
  return null;
}

// In your logout handler:
window.ChaiSamosa('shutdown');`;
  if (fw === 'next') return `// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script id="chai-samosa-settings" strategy="afterInteractive">
          {\`window.ChaiSamosaSettings = { app_id: "${appId}" };
          ${STUB}\`}
        </Script>
        <Script src="${src}" strategy="afterInteractive" />
      </body>
    </html>
  );
}

// After a user logs in (in a client component):
// window.ChaiSamosa('boot', { app_id: "${appId}", user_id, name, email, user_hash });
// In your logout handler:
// window.ChaiSamosa('shutdown');`;
  if (fw === 'vue') return `<!-- App.vue -->
<script setup>
import { onMounted } from 'vue';

onMounted(() => {
  window.ChaiSamosaSettings = {
    app_id: "${appId}",
    // For logged-in users (optional); user_hash comes from YOUR server:
    // user_id: user.id, name: user.name, email: user.email, user_hash: user.chaiSamosaHash,
  };
  ${STUB}
  const script = document.createElement('script');
  script.async = true;
  script.src = "${src}";
  document.body.appendChild(script);
});

// In your logout handler:
// window.ChaiSamosa('shutdown');
</script>`;
  return `<script>
  window.ChaiSamosaSettings = {
    app_id: "${appId}",
    // For logged-in users (optional):
    // user_id: "123",            // your user id
    // name: "Asha Rao",
    // email: "asha@example.com",
    // user_hash: "<HMAC-SHA256 of user_id, computed on YOUR server>"
  };
</script>
<script async src="${src}"></script>`;
}

function jsApiSnippet(appId: string): string {
  return `// Put this before the Messenger script so calls made early are queued:
${STUB}

// Start (or restart) the Messenger, e.g. right after a user logs in
ChaiSamosa('boot', { app_id: "${appId}", user_id, name, email, user_hash });

// Update the current user's details
ChaiSamosa('update', { name, email });

// Call on logout, so the next person on this browser starts fresh
ChaiSamosa('shutdown');

// Open / close the Messenger (e.g. from your own "Help" button)
ChaiSamosa('show');
ChaiSamosa('hide');`;
}

function serverSnippet(lang: ServerLang): string {
  if (lang === 'python') return `import hmac, hashlib, os

# The identity secret from Settings > Messenger Live Chat > Security (server-side only)
SECRET = os.environ["CHAI_SAMOSA_IDENTITY_SECRET"]

def chai_samosa_user_hash(user_id: str) -> str:
    return hmac.new(SECRET.encode(), str(user_id).encode(), hashlib.sha256).hexdigest()

# Pass it to the page that loads the Messenger:
# user_hash = chai_samosa_user_hash(current_user.id)`;
  if (lang === 'php') return `<?php
// The identity secret from Settings > Messenger Live Chat > Security (server-side only)
$secret = getenv('CHAI_SAMOSA_IDENTITY_SECRET');

$userHash = hash_hmac('sha256', (string) $user->id, $secret);

// Pass it to the page that loads the Messenger:
// user_hash: "<?= htmlspecialchars($userHash) ?>"`;
  if (lang === 'ruby') return `require 'openssl'

# The identity secret from Settings > Messenger Live Chat > Security (server-side only)
secret = ENV.fetch('CHAI_SAMOSA_IDENTITY_SECRET')

user_hash = OpenSSL::HMAC.hexdigest('sha256', secret, current_user.id.to_s)

# Pass it to the page that loads the Messenger:
# user_hash: <%= user_hash.to_json %>`;
  return `const crypto = require('crypto');

// The identity secret from Settings > Messenger Live Chat > Security (server-side only)
const SECRET = process.env.CHAI_SAMOSA_IDENTITY_SECRET;

function chaiSamosaUserHash(userId) {
  return crypto.createHmac('sha256', SECRET).update(String(userId)).digest('hex');
}

// Pass it to the page that loads the Messenger:
// user_hash: chaiSamosaUserHash(currentUser.id)`;
}

function mobileSnippet(p: MobilePlatform, url: string): string {
  if (p === 'android') return `import android.net.Uri
import android.webkit.WebView

val webView = WebView(this)
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true

// Logged-in users: fetch userHash from YOUR backend (never compute it in the app).
// Identity goes in the URL fragment, so it never reaches server logs.
val fragment = listOf(
    "user_id" to user.id,
    "name" to user.name,
    "email" to user.email,
    "user_hash" to userHash,
).joinToString("&") { (key, value) -> key + "=" + Uri.encode(value) }

webView.loadUrl("${url}#" + fragment)
setContentView(webView)`;
  if (p === 'react-native') return `import { WebView } from 'react-native-webview';

const MESSENGER_URL = "${url}";

// userHash comes from YOUR backend (never compute it in the app).
export function SupportScreen({ user, userHash }) {
  const identity = user
    ? '#' + Object.entries({ user_id: user.id, name: user.name, email: user.email, user_hash: userHash })
        .map(([key, value]) => key + '=' + encodeURIComponent(value))
        .join('&')
    : '';
  return <WebView source={{ uri: MESSENGER_URL + identity }} style={{ flex: 1 }} />;
}`;
  return `import UIKit
import WebKit

class SupportViewController: UIViewController {
    let webView = WKWebView()
    var user: User?          // your logged-in user (optional)
    var userHash: String?    // fetched from YOUR backend, never computed in the app

    override func loadView() { view = webView }

    override func viewDidLoad() {
        super.viewDidLoad()
        var components = URLComponents(string: "${url}")!
        if let user = user, let userHash = userHash {
            // Identity goes in the URL fragment, so it never reaches server logs.
            var identity = URLComponents()
            identity.queryItems = [
                URLQueryItem(name: "user_id", value: user.id),
                URLQueryItem(name: "name", value: user.name),
                URLQueryItem(name: "email", value: user.email),
                URLQueryItem(name: "user_hash", value: userHash),
            ]
            components.percentEncodedFragment = identity.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
                .replacingOccurrences(of: "@", with: "%40")
        }
        webView.load(URLRequest(url: components.url!))
    }
}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MessengerSettings({ onBack, tab, onTabChange }: {
  onBack: () => void; tab: MessengerTab; onTabChange: (t: MessengerTab) => void;
}) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const widgetSettings = useStore(s => s.widgetSettings);
  const setWidgetSettings = useStore(s => s.setWidgetSettings);
  const chatColorTheme = useStore(s => s.chatColorTheme);
  const setChatColorTheme = useStore(s => s.setChatColorTheme);
  const isAdmin = me?.role === 'admin';
  const origin = window.location.origin;

  const [data, setData] = useState<MessengerSettingsData | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Widget (appearance) draft — saved with the header button
  const [draft, setDraft] = useState<MessengerAppearance>(DEFAULT_APPEARANCE);
  const [fromLocal, setFromLocal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Install / Mobile
  const [framework, setFramework] = useState<WebFramework>('web');
  const [serverLang, setServerLang] = useState<ServerLang>('node');
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>('ios');
  const [bundleId, setBundleId] = useState('com.example.app');
  const [scrollToIdentity, setScrollToIdentity] = useState(false);
  const identityRef = useRef<HTMLDivElement>(null);

  // Overview
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removeHelpOpen, setRemoveHelpOpen] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Security (changes here apply immediately)
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [enforceBusy, setEnforceBusy] = useState(false);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const authHeaders = useMemo(() => ({ 'Authorization': `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [r, w] = await Promise.all([
          fetch(`${BACKEND_URL}/api/messenger/settings`, { headers: authHeaders }),
          fetch(`${BACKEND_URL}/api/workspace`, { headers: authHeaders }).catch(() => null),
        ]);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not load Messenger settings');
        const ws = w && w.ok ? await w.json().catch(() => null) : null;
        if (cancelled) return;
        setData(d);
        setWorkspaceName(ws?.customerFacingName || ws?.name || '');
        // First visit after the move to server-side settings: suggest the look that was saved in this browser.
        const local = widgetSettings;
        const localCustomised = local && (['themeColor', 'brandName', 'greeting', 'welcome'] as const)
          .some(k => (local[k] || '') !== OLD_LOCAL_DEFAULTS[k]);
        if (isAdmin && sameAppearance(d.appearance, DEFAULT_APPEARANCE) && localCustomised) {
          setDraft({
            ...d.appearance,
            themeColor: /^#[0-9a-f]{6}$/i.test(local.themeColor) ? local.themeColor : d.appearance.themeColor,
            brandName: local.brandName !== OLD_LOCAL_DEFAULTS.brandName ? (local.brandName || '').slice(0, 60) : '',
            greeting: (local.greeting || '').slice(0, 80),
            welcome: (local.welcome || '').slice(0, 200),
          });
          setFromLocal(true);
        } else {
          setDraft(d.appearance);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // "Connect customer data" jumps to the identity section of the Install tab
  useEffect(() => {
    if (scrollToIdentity && tab === 'install' && identityRef.current) {
      identityRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollToIdentity(false);
    }
  }, [scrollToIdentity, tab]);

  // Close the row menu / popover on outside click
  useEffect(() => {
    if (!menuFor && !removeHelpOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-popover]')) return;
      setMenuFor(null);
      setRemoveHelpOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor, removeHelpOpen]);

  const appearanceDirty = !!data && !sameAppearance(draft, data.appearance);
  const setA = <K extends keyof MessengerAppearance>(k: K, v: MessengerAppearance[K]) => setDraft(d => ({ ...d, [k]: v }));
  const previewName = draft.brandName.trim() || workspaceName || 'Your company';

  const putSettings = async (body: Record<string, unknown>): Promise<MessengerSettingsData> => {
    const res = await fetch(`${BACKEND_URL}/api/messenger/settings`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Could not save Messenger settings');
    setData(d);
    return d;
  };

  const saveAppearance = async () => {
    if (!data || !appearanceDirty) return;
    if (!/^#[0-9a-f]{6}$/i.test(draft.themeColor)) { setSaveError('Theme color must be a hex color like #8B5CF6'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const d = await putSettings({ appearance: draft });
      setDraft(d.appearance);
      setFromLocal(false);
      // Keep the dashboard's own copy in step (used by the in-app Messenger preview until it reads the server).
      setWidgetSettings({
        themeColor: d.appearance.themeColor,
        brandName: d.appearance.brandName || workspaceName || OLD_LOCAL_DEFAULTS.brandName,
        greeting: d.appearance.greeting,
        welcome: d.appearance.welcome,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err: any) {
      setSaveError(err.message);
      onTabChange('widget');
    } finally {
      setSaving(false);
    }
  };

  const goInstallIdentity = () => { onTabChange('install'); setScrollToIdentity(true); };

  const removeLocation = (inst: MessengerInstallation) => {
    setMenuFor(null);
    setConfirm({
      title: 'Remove location?',
      body: (
        <>
          <span className="font-medium text-ink">{inst.host}</span> will be removed from this list. If the Messenger loads there again it
          reappears automatically — remove the code from that {inst.kind === 'mobile' ? 'app' : 'site'} (or use Allowed domains in Security) to stop it.
        </>
      ),
      confirmLabel: 'Remove',
      danger: true,
      action: async () => {
        setOverviewError(null);
        const res = await fetch(`${BACKEND_URL}/api/messenger/installations/${encodeURIComponent(inst.id)}`, { method: 'DELETE', headers: authHeaders });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setOverviewError(d.error || 'Could not remove the location'); return; }
        setData(d);
      },
    });
  };

  // ── Security actions ──
  const revealSecret = async () => {
    if (!isAdmin) return;
    if (secret) { setRevealed(r => !r); return; }
    setSecretBusy(true);
    setSecurityError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/messenger/identity-secret`, { headers: authHeaders });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not load the identity secret');
      setSecret(d.secret);
      setRevealed(true);
      setData(prev => prev ? { ...prev, identityVerification: { ...prev.identityVerification, secretConfigured: true } } : prev);
    } catch (err: any) {
      setSecurityError(err.message);
    } finally {
      setSecretBusy(false);
    }
  };

  const copySecret = async () => {
    if (!isAdmin) return;
    let s = secret;
    if (!s) {
      setSecretBusy(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/messenger/identity-secret`, { headers: authHeaders });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Could not load the identity secret');
        s = d.secret as string;
        setSecret(s);
        setData(prev => prev ? { ...prev, identityVerification: { ...prev.identityVerification, secretConfigured: true } } : prev);
      } catch (err: any) {
        setSecurityError(err.message);
        return;
      } finally {
        setSecretBusy(false);
      }
    }
    navigator.clipboard?.writeText(s!).then(() => { setSecretCopied(true); setTimeout(() => setSecretCopied(false), 1800); }).catch(() => {});
  };

  const rotateSecret = () => setConfirm({
    title: 'Rotate identity secret?',
    body: 'A new secret is created right away. Existing user_hash values stop working until your server uses the new secret.',
    confirmLabel: 'Rotate secret',
    danger: true,
    action: async () => {
      setSecurityError(null);
      const res = await fetch(`${BACKEND_URL}/api/messenger/identity-secret/rotate`, { method: 'POST', headers: authHeaders });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSecurityError(d.error || 'Could not rotate the secret'); return; }
      setSecret(d.secret);
      setRevealed(true);
      setData(prev => prev ? { ...prev, identityVerification: { ...prev.identityVerification, secretConfigured: true } } : prev);
    },
  });

  const setEnforced = async (on: boolean) => {
    const apply = async () => {
      setEnforceBusy(true);
      setSecurityError(null);
      try { await putSettings({ enforced: on }); } catch (err: any) { setSecurityError(err.message); } finally { setEnforceBusy(false); }
    };
    if (!on) { await apply(); return; }
    const unverified = (data?.installations || []).filter(i => i.identifiedAt && !i.verifiedAt);
    setConfirm({
      title: 'Enforce identity verification?',
      body: (
        <div className="flex flex-col gap-3">
          <p>Once this is on, logged-in users whose <code className="font-mono text-[13px]">user_hash</code> is missing or wrong can’t start conversations. Anonymous visitors are not affected.</p>
          <p>Make sure every site and app where you pass <code className="font-mono text-[13px]">user_id</code> already sends a valid <code className="font-mono text-[13px]">user_hash</code> computed with your identity secret.</p>
          {unverified.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 text-[13px]">
              Recently sending unverified users: {unverified.map(i => i.host).join(', ')}
            </div>
          )}
        </div>
      ),
      confirmLabel: 'Turn on',
      action: apply,
    });
  };

  const saveDomains = async (list: string[]) => {
    setDomainBusy(true);
    setDomainError(null);
    try {
      await putSettings({ allowedDomains: list });
      return true;
    } catch (err: any) {
      setDomainError(err.message);
      return false;
    } finally {
      setDomainBusy(false);
    }
  };
  const addDomain = async () => {
    const v = domainInput.trim();
    if (!v || !data) return;
    if (await saveDomains([...data.allowedDomains, v])) setDomainInput('');
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try { await confirm.action(); } finally { setConfirmBusy(false); setConfirm(null); }
  };

  const websites = (data?.installations || []).filter(i => i.kind !== 'mobile');
  const mobiles = (data?.installations || []).filter(i => i.kind === 'mobile');
  const hostedUrl = data
    ? `${origin}/messenger/${encodeURIComponent(data.appId)}?mode=fullscreen&platform=${mobilePlatform}&app=${encodeURIComponent(bundleId.trim() || 'com.example.app')}`
    : '';

  // ── Overview ──────────────────────────────────────────────────────────────
  const installationsTable = (list: MessengerInstallation[], kind: 'website' | 'mobile') => (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[13px] text-muted border-b border-line">
            <th className="font-medium py-2.5 pr-4">{kind === 'website' ? 'Website name' : 'App'}</th>
            <th className="font-medium py-2.5 pr-4">Messenger</th>
            <th className="font-medium py-2.5 pr-4">Customer data</th>
            <th className="font-medium py-2.5 pr-4">Last seen</th>
            <th className="py-2.5" />
          </tr>
        </thead>
        <tbody>
          {list.map(inst => (
            <tr key={inst.id} className="border-b border-line last:border-0">
              <td className="py-3 pr-4 max-w-[260px]">
                <p className="text-ink font-medium truncate" title={inst.host}>{inst.host}</p>
                {inst.lastUrl && <p className="text-[12px] text-faint truncate" title={inst.lastUrl}>{inst.lastUrl}</p>}
              </td>
              <td className="py-3 pr-4 whitespace-nowrap">
                {isLive(inst) ? <StatusDot tone="green">Live</StatusDot> : <StatusDot tone="gray">Inactive</StatusDot>}
              </td>
              <td className="py-3 pr-4 whitespace-nowrap"><CustomerDataStatus inst={inst} /></td>
              <td className="py-3 pr-4 whitespace-nowrap text-muted" title={new Date(inst.lastSeenAt).toLocaleString()}>{relativeTime(inst.lastSeenAt)}</td>
              <td className="py-3">
                <div className="flex items-center justify-end gap-1.5">
                  {!inst.verifiedAt && (
                    <button type="button" onClick={kind === 'mobile' ? () => onTabChange('mobile') : goInstallIdentity} className="ic-btn-outline ic-btn-sm whitespace-nowrap">
                      Connect customer data
                    </button>
                  )}
                  {isAdmin && (
                    <div className="relative" data-popover>
                      <button type="button" className="ic-icon-btn-ghost" title="More" onClick={() => setMenuFor(m => (m === inst.id ? null : inst.id))}>
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {menuFor === inst.id && (
                        <div className="ic-menu absolute right-0 top-9">
                          <button type="button" className="ic-menu-item text-red-600 dark:text-red-400" onClick={() => removeLocation(inst)}>
                            <Trash2 className="w-4 h-4" /> Remove location
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderOverview = () => data && (
    <div className="flex flex-col gap-8 max-w-5xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="ic-card p-5 flex items-start gap-4">
          <div className="ic-tile-icon bg-pink-200/70 text-pink-900 dark:bg-pink-400/20 dark:text-pink-200"><Inbox className="w-5 h-5" /></div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">Conversations that come in through Messenger arrive in your Inbox</p>
            <button type="button" onClick={() => onTabChange('install')} className="ic-link text-[14px] mt-1">Install the Messenger</button>
          </div>
        </div>
        <div className="ic-card p-5 flex items-start gap-4">
          <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200"><Palette className="w-5 h-5" /></div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">Make it look like your brand — name, color, greeting and launcher</p>
            <button type="button" onClick={() => onTabChange('widget')} className="ic-link text-[14px] mt-1">Customize the widget</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="ic-section-title">Installation locations</h3>
        {overviewError && <ErrorBox>{overviewError}</ErrorBox>}

        <div className="ic-card p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Globe className="w-[18px] h-[18px] text-muted" />
            <p className="text-[15px] font-semibold text-ink flex-1">Website</p>
            {websites.length > 0 && <span className="ic-badge">{websites.length}</span>}
          </div>
          {websites.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-[14px] text-muted">No websites yet — the Messenger appears here automatically the first time it loads on your site.</p>
              <button type="button" onClick={() => onTabChange('install')} className="ic-btn-primary">Install on your website</button>
            </div>
          ) : installationsTable(websites, 'website')}
          {websites.length > 0 && (
            <button type="button" onClick={() => onTabChange('install')} className="ic-add-link self-start text-[14px]">
              <Plus className="w-4 h-4" /> Add another location
            </button>
          )}
        </div>

        <div className="ic-card p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-[18px] h-[18px] text-muted" />
            <p className="text-[15px] font-semibold text-ink flex-1">Mobile app</p>
            {mobiles.length > 0 && <span className="ic-badge">{mobiles.length}</span>}
          </div>
          {mobiles.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-[14px] text-muted">Install Messenger in your iOS, Android, or React Native app.</p>
              <button type="button" onClick={() => onTabChange('mobile')} className="ic-btn-primary">Install on mobile app</button>
            </div>
          ) : installationsTable(mobiles, 'mobile')}
          {mobiles.length > 0 && (
            <button type="button" onClick={() => onTabChange('mobile')} className="ic-add-link self-start text-[14px]">
              <Plus className="w-4 h-4" /> Add another app
            </button>
          )}
        </div>

        <div className="relative self-start" data-popover>
          <button
            type="button"
            onClick={() => setRemoveHelpOpen(o => !o)}
            className="text-[13px] text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            Need to remove Messenger?
          </button>
          {removeHelpOpen && (
            <div className="absolute left-0 bottom-8 w-[360px] bg-surface rounded-xl shadow-pop border border-line p-4 z-40 text-[13px] text-muted leading-relaxed flex flex-col gap-2">
              <p className="text-[14px] font-semibold text-ink">Removing the Messenger</p>
              <p>Delete the Messenger <code className="font-mono">&lt;script&gt;</code> tag (or the framework code) from your site, or remove the WebView from your app. The location turns “Inactive” after 7 days.</p>
              <p>
                To block it immediately, add your allowed domains in{' '}
                <button type="button" className="ic-link" onClick={() => { setRemoveHelpOpen(false); onTabChange('security'); }}>Security</button>
                {' '}— the Messenger won’t load on any other site.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Widget ────────────────────────────────────────────────────────────────
  const renderWidget = () => (
    <div className="flex gap-8">
      <div className="flex-1 flex flex-col gap-4 max-w-3xl min-w-0">
        {fromLocal && appearanceDirty && (
          <div className="p-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 text-[13px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" />
            <span>We filled in the look you set up earlier in this browser. Click <b>Save and set live</b> to apply it everywhere the Messenger is installed.</span>
          </div>
        )}
        {saveError && <ErrorBox>{saveError}</ErrorBox>}

        <SettingsFormSection title="Brand identity" description="The name, greeting and welcome message customers see when they open the Messenger.">
          <div>
            <label className="ic-label" htmlFor="msg-brand">Brand name</label>
            <input
              id="msg-brand"
              value={draft.brandName}
              maxLength={60}
              disabled={!isAdmin}
              onChange={e => setA('brandName', e.target.value)}
              className="ic-input"
              placeholder={workspaceName ? `Use workspace customer-facing name (${workspaceName})` : 'Use workspace customer-facing name'}
            />
            <p className="ic-help">Leave empty to use the customer-facing name from General settings.</p>
          </div>
          <div>
            <label className="ic-label" htmlFor="msg-greeting">Availability greeting</label>
            <input
              id="msg-greeting"
              value={draft.greeting}
              maxLength={80}
              disabled={!isAdmin}
              onChange={e => setA('greeting', e.target.value)}
              className="ic-input"
              placeholder="e.g. We reply in a few minutes"
            />
            <p className="ic-help">Shown under the name when no reply time is set in Office hours.</p>
          </div>
          <div>
            <label className="ic-label" htmlFor="msg-welcome">Welcome message</label>
            <textarea
              id="msg-welcome"
              value={draft.welcome}
              maxLength={200}
              disabled={!isAdmin}
              onChange={e => setA('welcome', e.target.value)}
              rows={3}
              className="ic-textarea"
              placeholder="e.g. Ask us anything, or share your feedback."
            />
          </div>
        </SettingsFormSection>

        <SettingsFormSection title="Theme color" description="Used for the Messenger header, buttons and launcher.">
          <div className="flex flex-wrap items-center gap-2.5">
            {PRESET_COLORS.map(color => (
              <button
                key={color}
                type="button"
                disabled={!isAdmin}
                onClick={() => setA('themeColor', color)}
                className={`w-8 h-8 rounded-full transition-shadow ring-offset-2 ring-offset-surface disabled:cursor-not-allowed ${draft.themeColor.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line'}`}
                style={{ background: color }}
                title={color}
              />
            ))}
            <label className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(draft.themeColor) ? draft.themeColor : '#8B5CF6'}
                disabled={!isAdmin}
                onChange={e => setA('themeColor', e.target.value.toUpperCase())}
                className="w-8 h-8 rounded-full border border-dashed border-line bg-surface cursor-pointer disabled:cursor-not-allowed"
                title="Custom color"
              />
              <span className="text-[13px] text-muted">Custom</span>
            </label>
          </div>
          <div className="flex items-center gap-2 h-10 px-3 bg-subtle rounded-lg">
            <div className="w-5 h-5 rounded-full border border-line" style={{ background: draft.themeColor }} />
            <code className="text-[13px] font-mono text-ink/80">{draft.themeColor}</code>
          </div>
        </SettingsFormSection>

        <SettingsFormSection title="Launcher" description="The round button that opens the Messenger on your site.">
          <div>
            <p className="ic-label">Position</p>
            <Segmented
              options={[{ id: 'right', label: 'Right' }, { id: 'left', label: 'Left' }]}
              value={draft.launcherPosition}
              disabled={!isAdmin}
              onChange={v => setA('launcherPosition', v)}
            />
          </div>
          <div className="flex items-start gap-3">
            <Toggle checked={draft.showLauncher} disabled={!isAdmin} onChange={v => setA('showLauncher', v)} />
            <div>
              <p className="text-[14px] font-medium text-ink">Show the launcher</p>
              <p className="ic-help">Turn off to open the Messenger from your own button with <code className="font-mono">ChaiSamosa('show')</code></p>
            </div>
          </div>
        </SettingsFormSection>

        <SettingsFormSection title="Chat bubble colors" description="How message bubbles look in your Inbox and in the Messenger preview. Saved in this browser only.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { id: 'sky-blue', label: 'Sky blue', desc: 'Blue sender bubbles, soft grey recipient bubbles.', recipient: 'bg-subtle text-muted', sender: 'bg-[#0284c7] text-white' },
              { id: 'classic', label: 'Classic violet', desc: 'Violet sender bubbles, bordered white recipient bubbles.', recipient: 'bg-surface border border-line text-muted', sender: 'bg-violet-600 text-white' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChatColorTheme(opt.id)}
                className={`p-4 rounded-xl border text-left transition-colors ${chatColorTheme === opt.id ? 'border-ink ring-1 ring-ink bg-surface' : 'border-line hover:border-ink/30'}`}
              >
                <span className="text-[14px] font-medium text-ink block mb-1">{opt.label}</span>
                <span className="text-[13px] text-muted block mb-3">{opt.desc}</span>
                <div className="flex flex-col gap-1.5 p-2 bg-subtle rounded-lg">
                  <div className={`${opt.recipient} w-2/3 px-1.5 py-1 rounded text-[11px]`}>Recipient bubble</div>
                  <div className={`${opt.sender} w-2/3 px-1.5 py-1 rounded text-[11px] self-end text-right`}>Sender bubble</div>
                </div>
              </button>
            ))}
          </div>
        </SettingsFormSection>
      </div>

      <div className="hidden xl:flex flex-col gap-3 sticky top-0 self-start w-80">
        <p className="text-[13px] font-medium text-muted">Live preview{appearanceDirty ? ' · unsaved changes' : ''}</p>
        <WidgetPreview a={draft} brandName={previewName} />
      </div>
    </div>
  );

  // ── Install ───────────────────────────────────────────────────────────────
  const renderInstall = () => data && (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="ic-card p-8 flex flex-col gap-5">
        <div>
          <h3 className="ic-section-title">Install the Messenger on your website</h3>
          <p className="text-[14px] text-muted mt-1">
            Paste this just before the closing <code className="font-mono text-[13px]">&lt;/body&gt;</code> tag on every page where you want the Messenger.
            Your site shows up under Overview the first time it loads.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            options={[{ id: 'web', label: 'Web' }, { id: 'react', label: 'React' }, { id: 'next', label: 'Next.js' }, { id: 'vue', label: 'Vue' }]}
            value={framework}
            onChange={setFramework}
          />
          <span className="text-[13px] text-muted">App ID <code className="font-mono text-ink">{data.appId}</code></span>
        </div>
        <CodeBox
          code={webSnippet(framework, data.appId, origin)}
          title={framework === 'web' ? 'HTML' : framework === 'react' ? 'ChaiSamosaMessenger.jsx' : framework === 'next' ? 'app/layout.tsx' : 'App.vue'}
        />
      </div>

      <div className="ic-card p-8 flex flex-col gap-4">
        <div>
          <h3 className="ic-section-title">JavaScript API for single-page apps</h3>
          <p className="text-[14px] text-muted mt-1">
            If users log in or out without a full page load, tell the Messenger with these calls. Always call <code className="font-mono text-[13px]">shutdown</code> on
            logout so the next person on the same browser doesn’t see the previous user’s conversations.
          </p>
        </div>
        <CodeBox code={jsApiSnippet(data.appId)} title="JavaScript" />
      </div>

      <div ref={identityRef} id="messenger-identity" className="ic-card p-8 flex flex-col gap-4 scroll-mt-4">
        <div className="flex items-start gap-3">
          <div className="ic-tile-icon bg-emerald-200/70 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200"><ShieldCheck className="w-5 h-5" /></div>
          <div>
            <h3 className="ic-section-title">Identity verification</h3>
            <p className="text-[14px] text-muted mt-1">
              When you pass a logged-in user’s <code className="font-mono text-[13px]">user_id</code>, anyone could edit the page and pretend to be that user to read their conversations.
              Identity verification prevents this: your server signs the user id with a secret (<code className="font-mono text-[13px]">user_hash</code>), and we only trust identities that carry a valid signature.
              Compute it on your server — never in the browser or app.
            </p>
          </div>
        </div>
        <Segmented
          options={[{ id: 'node', label: 'Node.js' }, { id: 'python', label: 'Python' }, { id: 'php', label: 'PHP' }, { id: 'ruby', label: 'Ruby' }]}
          value={serverLang}
          onChange={setServerLang}
        />
        <CodeBox code={serverSnippet(serverLang)} title="Server" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
          <span className="text-muted">Enforcement:</span>
          {data.identityVerification.enforced
            ? <StatusDot tone="green">On — unverified logged-in users are blocked</StatusDot>
            : <StatusDot tone="gray">Off — unverified users can still chat</StatusDot>}
          <button type="button" onClick={() => onTabChange('security')} className="ic-link">
            {isAdmin ? 'Get your secret and manage enforcement in Security' : 'View in Security'}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Mobile ────────────────────────────────────────────────────────────────
  const renderMobile = () => data && (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="ic-card p-8 flex flex-col gap-5">
        <div>
          <h3 className="ic-section-title">Install the Messenger in your mobile app</h3>
          <p className="text-[14px] text-muted mt-1">
            Open the hosted Messenger page in a WebView. Your app appears under Overview the first time it loads, named by its bundle id.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-3">
          <div>
            <label className="ic-label" htmlFor="msg-platform">Platform</label>
            <select id="msg-platform" className="ic-select" value={mobilePlatform} onChange={e => setMobilePlatform(e.target.value as MobilePlatform)}>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="react-native">React Native</option>
            </select>
          </div>
          <div>
            <label className="ic-label" htmlFor="msg-bundle">Bundle / application id</label>
            <input id="msg-bundle" className="ic-input" value={bundleId} onChange={e => setBundleId(e.target.value)} placeholder="com.example.app" />
          </div>
        </div>
        <div>
          <p className="ic-label">Messenger URL</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 h-10 flex items-center text-[13px] font-mono text-ink bg-subtle border border-line rounded-lg px-3 overflow-x-auto whitespace-nowrap">{hostedUrl}</code>
            <CopyButton text={hostedUrl} className="h-10" />
          </div>
          <p className="ic-help mt-1.5">
            For logged-in users, add their identity in the URL fragment so it never reaches server logs:{' '}
            <code className="font-mono break-all">#user_id=123&amp;name=Asha&amp;email=asha%40example.com&amp;user_hash=…</code> (URL-encoded).
            Fetch <code className="font-mono">user_hash</code> from your backend — never compute it in the app, or the secret would ship inside it.
          </p>
        </div>
      </div>

      <div className="ic-card p-8 flex flex-col gap-4">
        <h3 className="ic-section-title">Code</h3>
        <Segmented
          options={[{ id: 'ios', label: 'iOS (Swift)' }, { id: 'android', label: 'Android (Kotlin)' }, { id: 'react-native', label: 'React Native' }]}
          value={mobilePlatform}
          onChange={setMobilePlatform}
        />
        <CodeBox
          code={mobileSnippet(mobilePlatform, hostedUrl)}
          title={mobilePlatform === 'ios' ? 'SupportViewController.swift' : mobilePlatform === 'android' ? 'SupportActivity.kt' : 'SupportScreen.jsx'}
        />
        {mobilePlatform === 'react-native' && (
          <p className="ic-help">Requires <code className="font-mono">react-native-webview</code> (<code className="font-mono">npm install react-native-webview</code>).</p>
        )}
        <p className="ic-help">
          Compute <code className="font-mono">user_hash</code> on your server with the snippets under{' '}
          <button type="button" className="ic-link" onClick={goInstallIdentity}>Install › Identity verification</button>.
        </p>
      </div>
    </div>
  );

  // ── Security ──────────────────────────────────────────────────────────────
  const renderSecurity = () => data && (
    <div className="flex flex-col gap-4 max-w-5xl">
      {securityError && <ErrorBox>{securityError}</ErrorBox>}
      <SettingsFormSection
        title="Identity verification"
        description={<>Your server signs each logged-in user’s id with this secret to create their <code className="font-mono text-[13px]">user_hash</code>. Keep it on your server only. <button type="button" className="ic-link" onClick={goInstallIdentity}>See the code</button></>}
      >
        <div>
          <p className="ic-label">Identity secret</p>
          {isAdmin ? (
            <>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 h-10 flex items-center text-[13px] font-mono bg-subtle border border-line rounded-lg px-3 overflow-x-auto whitespace-nowrap text-ink">
                  {revealed && secret ? secret : (data.identityVerification.secretConfigured || secret ? '••••••••••••••••••••••••••••••••' : 'No secret yet')}
                </code>
                <button type="button" onClick={revealSecret} disabled={secretBusy} className="ic-btn-outline h-10 disabled:opacity-50">
                  {revealed ? <><EyeOff className="w-4 h-4" /> Hide</> : <><Eye className="w-4 h-4" /> {data.identityVerification.secretConfigured || secret ? 'Reveal' : 'Create secret'}</>}
                </button>
                <button type="button" onClick={copySecret} disabled={secretBusy} className="ic-btn-outline h-10 disabled:opacity-50">
                  {secretCopied ? <><Check className="w-4 h-4 text-emerald-600" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
                </button>
              </div>
              {(data.identityVerification.secretConfigured || secret) && (
                <button type="button" onClick={rotateSecret} disabled={secretBusy} className="ic-btn-ghost ic-btn-sm mt-2 text-red-600 dark:text-red-400">
                  <RefreshCw className="w-3.5 h-3.5" /> Rotate secret
                </button>
              )}
            </>
          ) : (
            <p className="text-[14px] text-muted">
              {data.identityVerification.secretConfigured ? 'A secret is configured.' : 'No secret has been created yet.'} Only admins can view or rotate it.
            </p>
          )}
        </div>
        <div className="flex items-start gap-3 pt-1">
          <Toggle checked={data.identityVerification.enforced} disabled={!isAdmin || enforceBusy} onChange={setEnforced} />
          <div>
            <p className="text-[14px] font-medium text-ink">Enforce identity verification</p>
            <p className="ic-help">Logged-in users without a valid user_hash can't start conversations. Anonymous visitors are not affected.</p>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection
        title="Allowed domains"
        description="Only load the Messenger on these websites. Changes apply immediately."
      >
        {data.allowedDomains.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data.allowedDomains.map(d => (
              <span key={d} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full border border-line bg-surface text-[14px] text-ink">
                <code className="font-mono text-[13px]">{d}</code>
                {isAdmin && (
                  <button
                    type="button"
                    title={`Remove ${d}`}
                    disabled={domainBusy}
                    onClick={() => saveDomains(data.allowedDomains.filter(x => x !== d))}
                    className="w-6 h-6 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-subtle disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">Any website can load the Messenger.</p>
        )}
        {isAdmin && (
          <form className="flex items-stretch gap-2" onSubmit={e => { e.preventDefault(); addDomain(); }}>
            <input
              id="msg-domain"
              className="ic-input flex-1"
              value={domainInput}
              onChange={e => { setDomainInput(e.target.value); setDomainError(null); }}
              placeholder="shop.com, *.shop.com, localhost:3000 or https://shop.com"
            />
            <button type="submit" disabled={!domainInput.trim() || domainBusy} className="ic-btn-primary h-10 disabled:opacity-40 disabled:pointer-events-none">
              {domainBusy ? 'Saving…' : 'Add'}
            </button>
          </form>
        )}
        {domainError && <ErrorBox>{domainError}</ErrorBox>}
        <p className="ic-help">Leave empty to allow the Messenger on any website. The dashboard preview is always allowed.</p>
      </SettingsFormSection>
    </div>
  );

  return (
    <>
      <SettingsPageHeader title="Messenger Live Chat" onBack={onBack}>
        {savedFlash && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="w-4 h-4" /> Live
          </span>
        )}
        {isAdmin ? (
          <button
            type="button"
            onClick={saveAppearance}
            disabled={!appearanceDirty || saving || loading}
            className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none"
            title={appearanceDirty ? 'Save the widget changes and apply them everywhere' : 'No unsaved widget changes'}
          >
            {saving ? 'Saving…' : 'Save and set live'}
          </button>
        ) : (
          <span className="ic-badge">View only</span>
        )}
      </SettingsPageHeader>

      <div className="ic-tabs pt-4 px-8 shrink-0">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => onTabChange(t.id)} className={`ic-tab ${tab === t.id ? 'ic-tab-active' : ''}`}>
            {t.label}{t.id === 'widget' && appearanceDirty ? ' •' : ''}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        {!isAdmin && <p className="ic-help mb-4">Only admins can change Messenger settings. You’re viewing them read-only.</p>}
        {loading && <p className="text-[14px] text-muted">Loading…</p>}
        {loadError && <ErrorBox>{loadError}</ErrorBox>}
        {data && (
          <>
            {tab === 'overview' && renderOverview()}
            {tab === 'widget' && renderWidget()}
            {tab === 'install' && renderInstall()}
            {tab === 'mobile' && renderMobile()}
            {tab === 'security' && renderSecurity()}
          </>
        )}
      </div>

      <Modal isOpen={!!confirm} onClose={() => !confirmBusy && setConfirm(null)} title={confirm?.title} size="sm">
        {confirm && (
          <div className="flex flex-col gap-5">
            <div className="text-[14px] text-muted leading-relaxed">{confirm.body}</div>
            <div className="flex justify-end gap-2">
              <button type="button" className="ic-btn-secondary" disabled={confirmBusy} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={`${confirm.danger ? 'ic-btn-danger' : 'ic-btn-primary'} disabled:opacity-50`} disabled={confirmBusy} onClick={runConfirm}>
                {confirmBusy ? 'Working…' : confirm.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
