import { useEffect, useState } from 'react';
import { Check, AlertCircle, Copy, RefreshCw, Send, Mail, Inbox as InboxIcon } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';

type Settings = {
  enabled: boolean; fromName: string; fromAddress: string;
  smtp: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean } | null;
  inbound: {
    mode: 'none' | 'imap' | 'webhook';
    imap: { host: string; port: number; secure: boolean; user: string; mailbox: string; hasPassword: boolean } | null;
    webhookToken: string | null; lastPolledAt: string | null; lastError: string | null;
  };
  missedReplyAlerts: boolean; missedReplyDelayMinutes: number; transcripts: boolean;
  lastSentAt: string | null; lastError: string | null; ready: boolean;
};

type Draft = {
  enabled: boolean; fromName: string; fromAddress: string;
  smtpHost: string; smtpPort: string; smtpSecure: boolean; smtpUser: string; smtpPassword: string;
  mode: 'none' | 'imap' | 'webhook';
  imapHost: string; imapPort: string; imapSecure: boolean; imapUser: string; imapPassword: string; imapMailbox: string;
  missedReplyAlerts: boolean; missedReplyDelayMinutes: string; transcripts: boolean;
};

const toDraft = (s: Settings): Draft => ({
  enabled: s.enabled, fromName: s.fromName, fromAddress: s.fromAddress,
  smtpHost: s.smtp?.host || '', smtpPort: String(s.smtp?.port || 587), smtpSecure: s.smtp?.secure || false, smtpUser: s.smtp?.user || '', smtpPassword: '',
  mode: s.inbound.mode,
  imapHost: s.inbound.imap?.host || '', imapPort: String(s.inbound.imap?.port || 993), imapSecure: s.inbound.imap?.secure ?? true,
  imapUser: s.inbound.imap?.user || '', imapPassword: '', imapMailbox: s.inbound.imap?.mailbox || 'INBOX',
  missedReplyAlerts: s.missedReplyAlerts, missedReplyDelayMinutes: String(s.missedReplyDelayMinutes), transcripts: s.transcripts,
});

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

/**
 * Settings › Channels › Email: send replies by SMTP, receive email by IMAP or a forwarding
 * webhook, and email Messenger customers their missed replies and transcripts.
 */
export default function EmailSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const ro = !isAdmin;
  const [s, setS] = useState<Settings | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(me?.email || '');
  const [busy, setBusy] = useState<string | null>(null);

  const accept = (data: Settings) => { setS(data); const dd = toDraft(data); setD(dd); setOriginal(JSON.stringify(dd)); };
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/email/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => { const x = await r.json(); if (!r.ok) throw new Error(x.error); accept(x); })
      .catch(e => setError(e.message));
  }, [token]);

  const dirty = !!d && JSON.stringify(d) !== original;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => (p ? { ...p, [k]: v } : p));
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2500); };

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BACKEND_URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || 'Something went wrong');
    return x;
  };

  const save = async () => {
    if (!d) return;
    setSaving(true); setError(null);
    try {
      const body: any = {
        enabled: d.enabled, fromName: d.fromName, fromAddress: d.fromAddress,
        missedReplyAlerts: d.missedReplyAlerts, missedReplyDelayMinutes: Number(d.missedReplyDelayMinutes), transcripts: d.transcripts,
        inbound: { mode: d.mode, ...(d.mode === 'imap' ? { imap: { host: d.imapHost, port: Number(d.imapPort), secure: d.imapSecure, user: d.imapUser, password: d.imapPassword, mailbox: d.imapMailbox } } : {}) },
      };
      if (d.smtpHost.trim()) body.smtp = { host: d.smtpHost, port: Number(d.smtpPort), secure: d.smtpSecure, user: d.smtpUser, password: d.smtpPassword };
      accept(await call('PUT', '/email/settings', body));
      say('Saved');
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const test = async () => {
    setBusy('test'); setError(null);
    try { await call('POST', '/email/test', { to: testTo }); say(`Test email sent to ${testTo}`); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const poll = async () => {
    setBusy('poll'); setError(null);
    try { const r = await call('POST', '/email/poll'); accept(r.settings); say(r.filed ? `Filed ${r.filed} new email${r.filed === 1 ? '' : 's'}` : 'No new email'); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const rotate = async () => {
    if (!window.confirm('Create a new forwarding address? The current one will stop working.')) return;
    try { accept(await call('PUT', '/email/settings', { rotateWebhookToken: true })); say('New forwarding address created'); } catch (e: any) { setError(e.message); }
  };

  const webhookUrl = s?.inbound.webhookToken ? `${BACKEND_URL}/api/email/inbound/${s.inbound.webhookToken}` : '';
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('Copied')).catch(() => {});

  return (
    <>
      <SettingsPageHeader title="Email" onBack={onBack}>
        {flash && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> {flash}</span>}
        {isAdmin && <button type="button" onClick={save} disabled={!dirty || saving} className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none">{saving ? 'Saving…' : 'Save'}</button>}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="max-w-5xl flex flex-col gap-4">
          {ro && <p className="ic-help">Only admins can change email settings. You’re viewing them read-only.</p>}
          {error && <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
          {!d || !s ? <p className="text-[14px] text-muted">Loading…</p> : (
            <>
              <SettingsFormSection title="Email channel" description="Customers can email you, and teammates reply from the inbox. Replies go out from your address and stay threaded in the customer’s mail app.">
                <Toggle checked={d.enabled} disabled={ro} onChange={v => set('enabled', v)} label="Use email" />
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="ic-label">From name</label><input className="ic-input" disabled={ro} value={d.fromName} placeholder="Acme Support" onChange={e => set('fromName', e.target.value)} /></div>
                  <div><label className="ic-label">From address</label><input className="ic-input" disabled={ro} type="email" value={d.fromAddress} placeholder="support@yourcompany.com" onChange={e => set('fromAddress', e.target.value)} /></div>
                </div>
                <p className={`text-[13px] flex items-center gap-1.5 ${s.ready ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted'}`}>
                  {s.ready ? <><Check className="w-4 h-4" /> Ready to send{s.lastSentAt ? ` · last email ${new Date(s.lastSentAt).toLocaleString()}` : ''}</> : 'Turn email on and add the from address and SMTP server to start sending.'}
                </p>
                {s.lastError && <p className="text-[13px] text-red-600 dark:text-red-400">Last error: {s.lastError}</p>}
              </SettingsFormSection>

              <SettingsFormSection title="Outgoing mail (SMTP)" description="The mail server replies are sent through. For Gmail or Google Workspace use smtp.gmail.com, port 465 with SSL, and an app password.">
                <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
                  <div><label className="ic-label">SMTP server</label><input className="ic-input" disabled={ro} value={d.smtpHost} placeholder="smtp.gmail.com" onChange={e => set('smtpHost', e.target.value)} /></div>
                  <div><label className="ic-label">Port</label><input className="ic-input tabular-nums" disabled={ro} value={d.smtpPort} onChange={e => set('smtpPort', e.target.value)} /></div>
                </div>
                <Toggle checked={d.smtpSecure} disabled={ro} onChange={v => set('smtpSecure', v)} label="Use SSL/TLS (usually port 465)" />
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="ic-label">Username</label><input className="ic-input" disabled={ro} autoComplete="off" value={d.smtpUser} onChange={e => set('smtpUser', e.target.value)} /></div>
                  <div><label className="ic-label">Password</label><input className="ic-input" disabled={ro} type="password" autoComplete="new-password" value={d.smtpPassword} placeholder={s.smtp?.hasPassword ? 'Saved (leave empty to keep)' : ''} onChange={e => set('smtpPassword', e.target.value)} /></div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <input className="ic-input h-9 flex-1" type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send a test to…" aria-label="Test email address" />
                    <button type="button" onClick={test} disabled={busy === 'test' || dirty || !s.ready} title={dirty ? 'Save first' : undefined} className="ic-btn-ghost disabled:opacity-40"><Send className="w-4 h-4" /> {busy === 'test' ? 'Sending…' : 'Send test'}</button>
                  </div>
                )}
              </SettingsFormSection>

              <SettingsFormSection title="Incoming mail" description="How customer emails reach the inbox. New emails start a conversation; replies join theirs.">
                <div className="flex flex-col gap-2">
                  {([
                    ['none', 'Don’t receive email', 'Only send (replies, alerts and transcripts).'],
                    ['imap', 'Check a mailbox (IMAP)', 'Reads new mail from your support mailbox every minute and marks it read.'],
                    ['webhook', 'Forwarding address', 'Point your mail provider’s forwarding or inbound-parse webhook at a private URL.'],
                  ] as const).map(([v, label, hint]) => (
                    <label key={v} className={`flex items-start gap-3 p-3 rounded-xl border ${d.mode === v ? 'border-ink/40 bg-subtle' : 'border-line'} ${ro ? '' : 'cursor-pointer'}`}>
                      <input type="radio" className="mt-1" checked={d.mode === v} disabled={ro} onChange={() => set('mode', v)} />
                      <span><span className="block text-[14px] font-medium text-ink">{label}</span><span className="block text-[13px] text-muted">{hint}</span></span>
                    </label>
                  ))}
                </div>
                {d.mode === 'imap' && (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
                      <div><label className="ic-label">IMAP server</label><input className="ic-input" disabled={ro} value={d.imapHost} placeholder="imap.gmail.com" onChange={e => set('imapHost', e.target.value)} /></div>
                      <div><label className="ic-label">Port</label><input className="ic-input tabular-nums" disabled={ro} value={d.imapPort} onChange={e => set('imapPort', e.target.value)} /></div>
                    </div>
                    <Toggle checked={d.imapSecure} disabled={ro} onChange={v => set('imapSecure', v)} label="Use SSL/TLS" />
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="ic-label">Username</label><input className="ic-input" disabled={ro} autoComplete="off" value={d.imapUser} onChange={e => set('imapUser', e.target.value)} /></div>
                      <div><label className="ic-label">Password</label><input className="ic-input" disabled={ro} type="password" autoComplete="new-password" value={d.imapPassword} placeholder={s.inbound.imap?.hasPassword ? 'Saved' : ''} onChange={e => set('imapPassword', e.target.value)} /></div>
                      <div><label className="ic-label">Mailbox</label><input className="ic-input" disabled={ro} value={d.imapMailbox} onChange={e => set('imapMailbox', e.target.value)} /></div>
                    </div>
                    {s.inbound.mode === 'imap' && (
                      <div className="flex items-center gap-3 text-[13px] text-muted">
                        <InboxIcon className="w-4 h-4" />
                        {s.inbound.lastPolledAt ? `Checked ${new Date(s.inbound.lastPolledAt).toLocaleString()}` : 'Not checked yet'}
                        {s.inbound.lastError && <span className="text-red-600 dark:text-red-400">· {s.inbound.lastError}</span>}
                        {isAdmin && <button type="button" onClick={poll} disabled={busy === 'poll' || dirty} className="ic-btn-ghost h-8 ml-auto"><RefreshCw className={`w-4 h-4 ${busy === 'poll' ? 'animate-spin' : ''}`} /> Check now</button>}
                      </div>
                    )}
                  </>
                )}
                {d.mode === 'webhook' && (
                  s.inbound.mode === 'webhook' && webhookUrl ? (
                    <div className="flex flex-col gap-2">
                      <label className="ic-label">Forwarding URL (keep it private)</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate rounded-lg border border-line bg-sidebar px-3 h-9 flex items-center text-[12.5px] font-mono text-ink">{webhookUrl}</code>
                        <button type="button" onClick={() => copy(webhookUrl)} className="ic-icon-btn-ghost" title="Copy"><Copy className="w-4 h-4" /></button>
                        {isAdmin && <button type="button" onClick={rotate} className="ic-icon-btn-ghost" title="Create a new URL"><RefreshCw className="w-4 h-4" /></button>}
                      </div>
                      <p className="ic-help">POST JSON <code className="font-mono">{'{ from, subject, text, messageId?, inReplyTo?, references? }'}</code>, or <code className="font-mono">{'{ raw }'}</code> with the whole message, or the raw message as <code className="font-mono">message/rfc822</code>.</p>
                    </div>
                  ) : <p className="ic-help">Save to create your private forwarding URL.</p>
                )}
              </SettingsFormSection>

              <SettingsFormSection title="Customer emails" description="For Messenger conversations, when the customer left an email address. They can reply to these emails to continue the same conversation.">
                <Toggle checked={d.missedReplyAlerts} disabled={ro} onChange={v => set('missedReplyAlerts', v)} label="Email replies the customer hasn’t seen" />
                {d.missedReplyAlerts && (
                  <div className="flex items-center gap-2 pl-[52px] text-[14px] text-muted">
                    after <input className="ic-input h-9 w-20 tabular-nums" type="number" min={1} max={1440} disabled={ro} value={d.missedReplyDelayMinutes} onChange={e => set('missedReplyDelayMinutes', e.target.value)} aria-label="Delay in minutes" /> minutes, if they’re not in the Messenger
                  </div>
                )}
                <Toggle checked={d.transcripts} disabled={ro} onChange={v => set('transcripts', v)} label="Email the transcript when a conversation is closed" />
                <p className="ic-help flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Needs outgoing mail (SMTP) to be set up.</p>
              </SettingsFormSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
