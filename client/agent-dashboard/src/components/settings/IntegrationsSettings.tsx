import React, { useEffect, useState } from 'react';
import {
  CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Copy, Check, Webhook, Github, Twitter, Mail, HelpCircle, Send,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { IntegrationEvent } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader, relativeTime } from './shared';

type SlackStatus = {
  connected: boolean; enabled: boolean; events: IntegrationEvent[]; webhookHint?: string;
  connectedAt?: string; lastDeliveryAt?: string; lastError?: string | null;
};
type WebhookStatus = {
  connected: boolean; enabled: boolean; events: IntegrationEvent[]; urlHint?: string; hasSecret: boolean;
  connectedAt?: string; lastDeliveryAt?: string; lastError?: string | null;
};
type IntegrationsState = { slack: SlackStatus; webhook: WebhookStatus };
type TestResult = { ok: boolean; status?: number; error?: string };

const EVENT_OPTIONS: { id: IntegrationEvent; label: string; help: string }[] = [
  { id: 'conversation.created', label: 'New conversation', help: 'When a customer starts a new conversation' },
  { id: 'message.customer', label: 'Every new customer message', help: 'Each time a customer sends a message' },
];

const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//;
const SIGNATURE_HEADER = 'X-ChaiSamosa-Signature';
const EVENT_HEADER = 'X-ChaiSamosa-Event';

const PAYLOAD_EXAMPLE = `{
  "event": "conversation.created",
  "workspaceId": "default_workspace",
  "createdAt": "2026-01-01T10:00:00.000Z",
  "conversation": {
    "id": "conv_123",
    "ticketNumber": "#41042",
    "status": "open",
    "priority": "none",
    "category": "general",
    "customer": { "id": "cust_1", "name": "Asha", "email": "asha@example.com" }
  },
  "message": { "id": "msg_1", "content": "Hi! I need help with…", "createdAt": "2026-01-01T10:00:00.000Z" }
}`;

function randomSecret(length = 32): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function SlackLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 122.8 122.8" className={className} aria-hidden="true">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e" />
    </svg>
  );
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`ic-toggle ${checked ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}>
        <span className="ic-toggle-knob" />
      </button>
      <span className="text-[14px] text-ink">{label}</span>
    </label>
  );
}

function EventCheckboxes({ value, onChange, disabled }: { value: IntegrationEvent[]; onChange: (v: IntegrationEvent[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="ic-label mb-0">Notify me about</p>
      {EVENT_OPTIONS.map(o => (
        <label key={o.id} className={`flex items-start gap-2.5 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          <input type="checkbox" className="mt-[3px] w-4 h-4 accent-[#e5622d]" disabled={disabled}
            checked={value.includes(o.id)}
            onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(v => v !== o.id))} />
          <span>
            <span className="block text-[14px] text-ink">{o.label}</span>
            <span className="block text-[13px] text-muted">{o.help}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" /> <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function ConnectedBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
      <CheckCircle2 className="w-3.5 h-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-medium bg-subtle text-muted">
      Connected · Paused
    </span>
  );
}

function Collapsible({ title, icon: Icon = ChevronRight, children }: { title: string; icon?: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} className="ic-link text-[13px] inline-flex items-center gap-1">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />} {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Delivery status lines + test button + disconnect (shared by both cards). */
function ConnectedFooter({ status, isAdmin, onTest, onDisconnect, testLabel }: {
  status: { lastDeliveryAt?: string; lastError?: string | null; connectedAt?: string };
  isAdmin: boolean;
  onTest: () => Promise<TestResult>;
  onDisconnect: () => Promise<void>;
  testLabel: string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try { setResult(await onTest()); } finally { setTesting(false); }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-col gap-1 text-[13px] text-muted">
        {status.connectedAt && <span>Connected {relativeTime(status.connectedAt)}</span>}
        <span>
          Last delivery:{' '}
          {status.lastDeliveryAt
            ? <span className="text-ink" title={new Date(status.lastDeliveryAt).toLocaleString()}>{relativeTime(status.lastDeliveryAt)}</span>
            : 'none yet'}
        </span>
        {status.lastError && <span className="text-red-600 dark:text-red-400 break-words">Last error: {status.lastError}</span>}
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="ic-btn-outline ic-btn-sm" onClick={runTest} disabled={testing}>
            <Send className="w-3.5 h-3.5" /> {testing ? 'Sending…' : testLabel}
          </button>
          {result && (
            result.ok
              ? <span className="inline-flex items-center gap-1 text-[13px] text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> Delivered{result.status ? ` (HTTP ${result.status})` : ''}</span>
              : <span className="inline-flex items-center gap-1 text-[13px] text-red-600 dark:text-red-400 min-w-0 break-words"><AlertCircle className="w-4 h-4 shrink-0" /> {result.error || 'Delivery failed'}</span>
          )}
          <span className="flex-1" />
          {!confirming ? (
            <button type="button" className="ic-btn-ghost ic-btn-sm text-red-600 dark:text-red-400" onClick={() => setConfirming(true)}>Disconnect</button>
          ) : (
            <span className="inline-flex items-center gap-2 text-[13px] text-ink">
              Disconnect this integration?
              <button type="button" className="ic-btn-danger ic-btn-sm" disabled={busy}
                onClick={async () => { setBusy(true); try { await onDisconnect(); } finally { setBusy(false); setConfirming(false); } }}>
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
              <button type="button" className="ic-btn-secondary ic-btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CardShell({ logo, name, description, right, children }: {
  logo: React.ReactNode; name: string; description: string; right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="ic-card p-6 flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <div className="ic-tile-icon bg-subtle">{logo}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-ink">{name}</p>
          <p className="text-[14px] text-muted mt-0.5 leading-snug">{description}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">{right}</div>
      </div>
      {children}
    </div>
  );
}

type Api = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;

// ─── Slack ───────────────────────────────────────────────────────────────────

function SlackCard({ status, isAdmin, api, onChange }: { status: SlackStatus; isAdmin: boolean; api: Api; onChange: (s: IntegrationsState) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<IntegrationEvent[]>(['conversation.created']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changingUrl, setChangingUrl] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api('/api/integrations/slack', { method: 'PUT', body }));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLACK_URL_RE.test(url.trim())) { setError('Paste a Slack incoming webhook URL — it starts with https://hooks.slack.com/services/'); return; }
    const ok = await save(status.connected ? { webhookUrl: url.trim() } : { webhookUrl: url.trim(), events, enabled: true });
    if (ok) { setFormOpen(false); setChangingUrl(false); setUrl(''); }
  };

  const urlForm = (
    <form onSubmit={submitUrl} className="flex flex-col gap-4 border-t border-line pt-5">
      <div>
        <label className="ic-label" htmlFor="slack-url">Webhook URL</label>
        <input id="slack-url" className="ic-input font-mono text-[13px]" value={url} autoFocus autoComplete="off" spellCheck={false}
          placeholder="https://hooks.slack.com/services/T000/B000/XXXX" onChange={e => setUrl(e.target.value)} />
        <div className="mt-2">
          <Collapsible title="How to get a webhook URL" icon={HelpCircle}>
            <ol className="list-decimal pl-5 text-[13px] text-muted flex flex-col gap-1 bg-subtle rounded-lg p-3 pl-8">
              <li>In Slack, open <span className="text-ink font-medium">Apps</span> (or Tools → Apps).</li>
              <li>Search for <span className="text-ink font-medium">Incoming Webhooks</span> and open it.</li>
              <li>Click <span className="text-ink font-medium">Add to Slack</span>.</li>
              <li>Pick the channel where notifications should be posted.</li>
              <li>Copy the <span className="text-ink font-medium">Webhook URL</span> and paste it here.</li>
            </ol>
          </Collapsible>
        </div>
      </div>
      {!status.connected && <EventCheckboxes value={events} onChange={setEvents} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <button type="submit" className="ic-btn-primary" disabled={saving || !url.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="ic-btn-secondary" onClick={() => { setFormOpen(false); setChangingUrl(false); setError(null); setUrl(''); }}>Cancel</button>
      </div>
    </form>
  );

  return (
    <CardShell
      logo={<SlackLogo />}
      name="Slack"
      description="Get notified in a Slack channel when a new conversation arrives"
      right={status.connected
        ? <ConnectedBadge enabled={status.enabled} />
        : isAdmin && !formOpen && <button type="button" className="ic-btn-outline ic-btn-sm" onClick={() => { setFormOpen(true); setError(null); }}>Connect</button>}
    >
      {!status.connected && formOpen && urlForm}
      {status.connected && (
        <>
          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
              <span className="text-muted">Posting to</span>
              <code className="font-mono text-[13px] bg-subtle rounded px-1.5 py-0.5 text-ink">{status.webhookHint}</code>
              {isAdmin && !changingUrl && (
                <button type="button" className="ic-link text-[13px]" onClick={() => { setChangingUrl(true); setError(null); }}>Change URL</button>
              )}
            </div>
            <Toggle checked={status.enabled} disabled={!isAdmin || saving} onChange={v => save({ enabled: v })} label="Send notifications to Slack" />
            <EventCheckboxes value={status.events} disabled={!isAdmin || saving} onChange={v => save({ events: v })} />
            {!changingUrl && error && <ErrorBox>{error}</ErrorBox>}
          </div>
          {changingUrl && urlForm}
          <ConnectedFooter
            status={status}
            isAdmin={isAdmin}
            testLabel="Send test message"
            onTest={async () => {
              try {
                const r = await api('/api/integrations/slack/test', { method: 'POST' });
                onChange(await api('/api/integrations'));
                return r;
              } catch (err: any) { return { ok: false, error: err.message }; }
            }}
            onDisconnect={async () => {
              try { onChange(await api('/api/integrations/slack', { method: 'DELETE' })); } catch (err: any) { setError(err.message); }
            }}
          />
        </>
      )}
    </CardShell>
  );
}

// ─── Generic webhook ─────────────────────────────────────────────────────────

function SecretField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="ic-label" htmlFor="wh-secret">Signing secret <span className="text-faint font-normal">(optional)</span></label>
      <div className="flex items-stretch">
        <input id="wh-secret" className="ic-input rounded-r-none font-mono text-[13px]" value={value} autoComplete="off" spellCheck={false}
          type={generated ? 'text' : 'password'} placeholder="8–128 characters" maxLength={128}
          onChange={e => { onChange(e.target.value); setGenerated(false); }} />
        {generated && value ? (
          <button type="button" className="shrink-0 inline-flex items-center gap-1.5 px-3.5 border border-l-0 border-line text-[13px] font-medium text-ink hover:bg-subtle"
            onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {})}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        ) : null}
        <button type="button" className="shrink-0 inline-flex items-center px-3.5 border border-l-0 border-line rounded-r-lg text-[13px] font-medium text-ink hover:bg-subtle"
          onClick={() => { onChange(randomSecret()); setGenerated(true); }}>
          Generate
        </button>
      </div>
      <p className="ic-help mt-1.5">
        {generated ? 'Copy this secret now — it won’t be shown again after you save.' : `When set, each request includes an ${SIGNATURE_HEADER} header so you can verify it came from us.`}
      </p>
    </div>
  );
}

function PayloadFormat() {
  return (
    <Collapsible title="Payload format">
      <div className="flex flex-col gap-2 text-[13px] text-muted">
        <p>
          We send a <code className="text-ink">POST</code> with a JSON body and these headers:{' '}
          <code className="text-ink">{EVENT_HEADER}</code> (the event name) and, when a signing secret is set,{' '}
          <code className="text-ink">{SIGNATURE_HEADER}: sha256=&lt;hex&gt;</code> — an HMAC-SHA256 of the raw request body using your secret.
        </p>
        <pre className="bg-subtle rounded-lg p-3 text-[12px] leading-relaxed text-ink overflow-x-auto">{PAYLOAD_EXAMPLE}</pre>
      </div>
    </Collapsible>
  );
}

function WebhookCard({ status, isAdmin, api, onChange }: { status: WebhookStatus; isAdmin: boolean; api: Api; onChange: (s: IntegrationsState) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false); // change URL / secret when connected
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<IntegrationEvent[]>(['conversation.created']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api('/api/integrations/webhook', { method: 'PUT', body }));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const closeForm = () => { setFormOpen(false); setEditing(false); setUrl(''); setSecret(''); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (url.trim()) {
      if (!/^https?:\/\//i.test(url.trim())) { setError('The URL must start with https://'); return; }
      body.url = url.trim();
    } else if (!status.connected) { setError('Enter the URL that should receive events'); return; }
    if (secret) {
      if (secret.length < 8 || secret.length > 128) { setError('The signing secret must be between 8 and 128 characters'); return; }
      body.secret = secret;
    }
    if (!status.connected) { body.events = events; body.enabled = true; }
    if (Object.keys(body).length === 0) { closeForm(); return; }
    if (await save(body)) closeForm();
  };

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-4 border-t border-line pt-5">
      <div>
        <label className="ic-label" htmlFor="wh-url">Endpoint URL</label>
        <input id="wh-url" className="ic-input font-mono text-[13px]" value={url} autoFocus autoComplete="off" spellCheck={false}
          placeholder={status.connected ? `Currently ${status.urlHint} — leave blank to keep` : 'https://example.com/webhooks/chai-samosa'}
          onChange={e => setUrl(e.target.value)} />
        <p className="ic-help mt-1.5">Must use https:// (http:// is allowed for localhost while testing).</p>
      </div>
      <SecretField value={secret} onChange={setSecret} />
      {!status.connected && <EventCheckboxes value={events} onChange={setEvents} />}
      <PayloadFormat />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <button type="submit" className="ic-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="ic-btn-secondary" onClick={closeForm}>Cancel</button>
      </div>
    </form>
  );

  return (
    <CardShell
      logo={<Webhook className="w-5 h-5 text-ink" />}
      name="Webhooks"
      description="Send a signed JSON request to your own endpoint when conversations and messages arrive"
      right={status.connected
        ? <ConnectedBadge enabled={status.enabled} />
        : isAdmin && !formOpen && <button type="button" className="ic-btn-outline ic-btn-sm" onClick={() => { setFormOpen(true); setError(null); }}>Connect</button>}
    >
      {!status.connected && formOpen && form}
      {status.connected && (
        <>
          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
              <span className="text-muted">Sending to</span>
              <code className="font-mono text-[13px] bg-subtle rounded px-1.5 py-0.5 text-ink">{status.urlHint || 'your endpoint'}</code>
              <span className="text-muted">·</span>
              <span className="text-muted">{status.hasSecret ? 'Signed with your secret' : 'Not signed'}</span>
              {isAdmin && !editing && (
                <button type="button" className="ic-link text-[13px]" onClick={() => { setEditing(true); setError(null); }}>Change URL or secret</button>
              )}
              {isAdmin && !editing && status.hasSecret && (
                <button type="button" className="ic-link text-[13px]" disabled={saving} onClick={() => save({ secret: null })}>Remove secret</button>
              )}
            </div>
            <Toggle checked={status.enabled} disabled={!isAdmin || saving} onChange={v => save({ enabled: v })} label="Send events to this endpoint" />
            <EventCheckboxes value={status.events} disabled={!isAdmin || saving} onChange={v => save({ events: v })} />
            {!editing && <PayloadFormat />}
            {!editing && error && <ErrorBox>{error}</ErrorBox>}
          </div>
          {editing && form}
          <ConnectedFooter
            status={status}
            isAdmin={isAdmin}
            testLabel="Send test event"
            onTest={async () => {
              try {
                const r = await api('/api/integrations/webhook/test', { method: 'POST' });
                onChange(await api('/api/integrations'));
                return r;
              } catch (err: any) { return { ok: false, error: err.message }; }
            }}
            onDisconnect={async () => {
              try { onChange(await api('/api/integrations/webhook', { method: 'DELETE' })); } catch (err: any) { setError(err.message); }
            }}
          />
        </>
      )}
    </CardShell>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

const COMING_SOON = [
  { id: 'github', name: 'GitHub', icon: Github, desc: 'Link GitHub issues to conversations and tickets' },
  { id: 'twitter', name: 'Twitter / X', icon: Twitter, desc: 'Reply to DMs and mentions from your inbox' },
  { id: 'email', name: 'Email forwarding', icon: Mail, desc: 'Forward your support mailbox into the inbox' },
];

export default function IntegrationsSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const [data, setData] = useState<IntegrationsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api: Api = async (path, init = {}) => {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: init.method || 'GET',
      headers: { 'Authorization': `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Something went wrong');
    return json;
  };

  useEffect(() => {
    if (!token) return;
    api('/api/integrations').then(setData).catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <>
      <SettingsPageHeader title="Integrations" onBack={onBack} />
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="flex flex-col gap-4 max-w-4xl">
          <p className="text-[14px] text-muted">Connect your tools so your team hears about new conversations wherever they work.</p>
          {!isAdmin && <p className="ic-help">Only admins can connect or change integrations. You’re viewing them read-only.</p>}
          {error && <ErrorBox>{error}</ErrorBox>}
          {!data && !error && <p className="text-[14px] text-muted">Loading…</p>}
          {data && (
            <>
              <SlackCard status={data.slack} isAdmin={isAdmin} api={api} onChange={setData} />
              <WebhookCard status={data.webhook} isAdmin={isAdmin} api={api} onChange={setData} />
            </>
          )}

          <h3 className="ic-section-title mt-6">Coming soon</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMING_SOON.map(intg => (
              <div key={intg.id} className="ic-card p-5 flex items-start gap-4 opacity-60 select-none" aria-disabled="true">
                <div className="ic-tile-icon bg-subtle"><intg.icon className="w-5 h-5 text-muted" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[15px] font-medium text-ink">{intg.name}</p>
                    <span className="ic-badge">Coming soon</span>
                  </div>
                  <p className="text-[14px] text-muted mt-1 leading-snug">{intg.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
