import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage } from '../context/tenant.context';
import { SocketService, customerRoom } from './socket';
import { recordEvent } from './events';
import { plainText } from './conversationView';
import { notifyIntegrations } from './notifications';
import { routeNewConversation } from './teams';
import { refreshSla } from './sla';
import { Conversation, EmailSettings, Message, Workspace } from '../../../shared/src/types';

/**
 * Email: the email channel (agent replies go out by SMTP, customer emails come in by IMAP polling
 * or a forwarding webhook and are threaded into conversations), plus customer emails for the
 * Messenger: missed-reply alerts and transcripts when a conversation is closed.
 *
 * Threading: every email we send carries our own Message-ID and a "[#41153]" tag in the subject.
 * An incoming email joins a conversation when its In-Reply-To/References name one of that thread's
 * Message-IDs, or its subject carries the conversation's tag, and in both cases only when it comes
 * from that conversation's customer. Anything else starts a new conversation.
 */

export const DEFAULT_EMAIL: EmailSettings = { enabled: false, missedReplyAlerts: true, missedReplyDelayMinutes: 5, transcripts: true };
const ALERT_LOOKBACK_MS = 24 * 3600_000;

export function emailSettingsOf(ws?: Workspace | null): EmailSettings {
  return { ...DEFAULT_EMAIL, ...(ws?.email || {}) };
}

/** What the dashboard sees: never passwords; the webhook token only for admins. */
export function publicEmailSettings(ws: Workspace, admin: boolean) {
  const e = emailSettingsOf(ws);
  return {
    enabled: e.enabled,
    fromName: e.fromName || '',
    fromAddress: e.fromAddress || '',
    smtp: e.smtp ? { host: e.smtp.host, port: e.smtp.port, secure: e.smtp.secure, user: e.smtp.user || '', hasPassword: !!e.smtp.password } : null,
    inbound: {
      mode: e.inbound?.mode || 'none',
      imap: e.inbound?.imap ? { host: e.inbound.imap.host, port: e.inbound.imap.port, secure: e.inbound.imap.secure, user: e.inbound.imap.user, mailbox: e.inbound.imap.mailbox || 'INBOX', hasPassword: !!e.inbound.imap.password } : null,
      webhookToken: admin ? e.inbound?.webhookToken || null : null,
      lastPolledAt: e.inbound?.lastPolledAt || null,
      lastError: e.inbound?.lastError || null,
    },
    missedReplyAlerts: e.missedReplyAlerts !== false,
    missedReplyDelayMinutes: e.missedReplyDelayMinutes || 5,
    transcripts: e.transcripts !== false,
    lastSentAt: e.lastSentAt || null,
    lastError: e.lastError || null,
    ready: canSend(e),
  };
}

export const canSend = (e: EmailSettings) => !!(e.enabled && e.smtp?.host && e.fromAddress);
export const newWebhookToken = () => crypto.randomBytes(18).toString('base64url');

async function patchEmail(wsId: string, patch: Partial<EmailSettings>) {
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsId);
  if (!ws) return;
  await repo.update(wsId, { email: { ...emailSettingsOf(ws), ...patch } });
}

// ── Sending ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Markdown-ish text → simple, safe HTML (bold, italic, links, line breaks). */
export function textToHtml(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\n/g, '<br>');
}

function layout(ws: Workspace, inner: string): string {
  const brand = esc(ws.customerFacingName?.trim() || ws.name);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e6e9;border-radius:14px;padding:24px">${inner}</div>
<p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#8a8a93;text-align:center">${brand}</p></body></html>`;
}

const domainOf = (addr?: string) => (addr && addr.includes('@') ? addr.split('@')[1] : 'helpdesk.local');
export const tagFor = (conv: Pick<Conversation, 'ticketNumber'>) => `[${conv.ticketNumber}]`;

export async function sendMail(ws: Workspace, opts: {
  to: string; subject: string; text: string; html: string; inReplyTo?: string; references?: string[];
}): Promise<string> {
  const e = emailSettingsOf(ws);
  if (!canSend(e)) throw new Error('Email isn’t set up. Add SMTP details in Settings › Channels › Email.');
  const transport = nodemailer.createTransport({
    host: e.smtp!.host, port: e.smtp!.port, secure: e.smtp!.secure,
    ...(e.smtp!.user ? { auth: { user: e.smtp!.user, pass: e.smtp!.password || '' } } : {}),
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  const messageId = `<${crypto.randomUUID()}@${domainOf(e.fromAddress)}>`;
  try {
    await transport.sendMail({
      from: { name: e.fromName || ws.customerFacingName || ws.name, address: e.fromAddress! },
      to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, messageId,
      ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts.references?.length ? { references: opts.references.slice(-20) } : {}),
    });
    await patchEmail(ws.id, { lastSentAt: new Date().toISOString(), lastError: null });
    return messageId;
  } catch (err: any) {
    await patchEmail(ws.id, { lastError: `${new Date().toISOString().slice(0, 16).replace('T', ' ')}: ${err.message}` });
    throw err;
  } finally {
    transport.close();
  }
}

/** A teammate replied in an email conversation: email it to the customer, threaded. */
export async function deliverAgentReply(conv: Conversation, msg: Message): Promise<void> {
  if (conv.channel !== 'email' || !conv.email?.address || msg.isInternalNote) return;
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(conv.workspaceId || tenantStorage.getStore() || 'default_workspace');
  if (!ws) return;
  const subject = /^re:/i.test(conv.email.subject) ? conv.email.subject : `Re: ${conv.email.subject}`;
  const files = (msg.attachments || []).map(a => `\n${a.name}: ${absoluteUrl(a.url)}`).join('');
  try {
    const id = await sendMail(ws, {
      to: conv.email.address,
      subject: subject.includes(tagFor(conv)) ? subject : `${subject} ${tagFor(conv)}`,
      text: `${plainText(msg.content)}${files}\n\n— ${msg.sender.name}`,
      html: layout(ws, `<div style="font-size:15px;line-height:1.55">${textToHtml(msg.content)}</div>${files ? `<p style="font-size:13px;color:#555">${textToHtml(files.trim())}</p>` : ''}<p style="margin-top:18px;font-size:14px;color:#555">— ${esc(msg.sender.name)}</p>`),
      inReplyTo: conv.email.threadIds[conv.email.threadIds.length - 1],
      references: conv.email.threadIds,
    });
    await RepositoryFactory.getMessageRepository().update(msg.id, { metadata: { ...(msg.metadata || {}), email: { messageId: id, sentAt: new Date().toISOString() } } });
    await RepositoryFactory.getConversationRepository().update(conv.id, { email: { ...conv.email, threadIds: [...conv.email.threadIds, id].slice(-50) } }, { touch: false });
  } catch (err: any) {
    await recordEvent(conv.id, 'other', `Couldn’t email this reply to ${conv.email.address}: ${err.message}`, undefined, { field: 'email', error: true });
  }
}

const absoluteUrl = (u: string) => (/^https?:/i.test(u) ? u : `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}${u}`);

// ── Receiving ──────────────────────────────────────────────────────────────

export type InboundMail = {
  from: { address: string; name?: string };
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
};

/** Keep only the new part of a reply: drop quoted text and common reply headers. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .+wrote:\s*$/i.test(l) || (/^On .+/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] || ''))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{5,}/.test(l)) break;
    if (/^From: .+/i.test(l) && /^(Sent|Date): /i.test(lines[i + 1] || '')) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function fromParsed(p: ParsedMail): InboundMail | null {
  const from = p.from?.value?.[0];
  if (!from?.address) return null;
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  return {
    from: { address: from.address.toLowerCase(), name: from.name || undefined },
    subject: (p.subject || '(no subject)').trim(),
    text: p.text || (typeof p.html === 'string' ? plainText(p.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')) : ''),
    messageId: p.messageId,
    inReplyTo: p.inReplyTo,
    references: refs,
  };
}

export async function parseRaw(raw: string | Buffer): Promise<InboundMail | null> {
  return fromParsed(await simpleParser(raw));
}

const TAG_RE = /\[#(\d{3,})\]/;

/** File an incoming email into its conversation (or a new one). Runs inside the workspace's context. */
export async function handleInbound(mail: InboundMail): Promise<{ conversationId: string; created: boolean } | null> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(tenantStorage.getStore() || 'default_workspace');
  if (!ws) return null;
  const own = emailSettingsOf(ws).fromAddress?.toLowerCase();
  if (own && mail.from.address === own) return null; // our own mail looping back
  const body = stripQuoted(mail.text || '').slice(0, 20_000) || '(empty email)';
  const convRepo = RepositoryFactory.getConversationRepository();
  const msgRepo = RepositoryFactory.getMessageRepository();
  const custRepo = RepositoryFactory.getCustomerRepository();

  // Duplicate delivery (IMAP + webhook, retries): ignore a Message-ID we've already filed
  const all = await convRepo.findAll();
  if (mail.messageId && all.some(c => c.email?.threadIds.includes(mail.messageId!))) return null;

  // 1) Thread by headers, 2) by "[#41153]" in the subject; only for that conversation's customer
  const ids = new Set([mail.inReplyTo, ...(mail.references || [])].filter(Boolean) as string[]);
  const tag = TAG_RE.exec(mail.subject)?.[1];
  const sameCustomer = (c: Conversation) => (c.email?.address || c.customer.email || '').toLowerCase() === mail.from.address;
  let conv = all.find(c => !c.mergedInto && c.email?.threadIds.some(id => ids.has(id)) && sameCustomer(c))
    || (tag ? all.find(c => !c.mergedInto && c.ticketNumber === `#${tag}` && sameCustomer(c)) : undefined);

  if (conv) {
    const msg = await msgRepo.create({
      conversationId: conv.id,
      sender: { type: 'customer', id: conv.customer.id, name: conv.customer.name },
      content: body, attachments: [], isInternalNote: false, seen: false, delivered: true, reactions: [],
      metadata: { email: { messageId: mail.messageId, subject: mail.subject, from: mail.from.address } },
    });
    const reopen = conv.status === 'resolved' || conv.status === 'closed' || conv.status === 'waiting';
    const updated = await convRepo.update(conv.id, {
      unreadCountAgent: (conv.unreadCountAgent || 0) + 1,
      lastMessageSnippet: plainText(body).slice(0, 200),
      customerSnippet: plainText(body).slice(0, 200),
      ...(reopen ? { status: 'open' } : {}),
      ...(conv.snoozedUntil ? { snoozedUntil: null } : {}),
      // An email reply to a Messenger conversation turns it into an email thread from here on
      channel: conv.channel || 'email',
      email: {
        subject: conv.email?.subject || mail.subject.replace(TAG_RE, '').trim(),
        address: mail.from.address,
        threadIds: [...(conv.email?.threadIds || []), ...(mail.messageId ? [mail.messageId] : [])].slice(-50),
      },
    });
    SocketService.broadcastMessageNew(msg);
    if (updated) SocketService.broadcastConversationUpdate(updated);
    if (reopen) await recordEvent(conv.id, 'status', `Reopened because the customer replied by email (was ${conv.status === 'waiting' ? 'Waiting on customer' : conv.status === 'resolved' ? 'Resolved' : 'Closed'})`, undefined, { field: 'status', from: conv.status, to: 'open' });
    notifyIntegrations(ws.id, 'message.customer', { conversation: updated || conv, message: msg });
    await refreshSla(conv.id);
    return { conversationId: conv.id, created: false };
  }

  // New conversation from this sender (find them by email, or create a person)
  let customer = (await custRepo.findAll()).find(c => (c.email || '').toLowerCase() === mail.from.address);
  if (!customer) {
    customer = await custRepo.findOrCreate(crypto.randomUUID(), {
      name: mail.from.name || mail.from.address.split('@')[0],
      email: mail.from.address, phone: '',
      session: { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), totalConversations: 0 },
      tags: [], notes: [],
    });
  }
  if (customer.blocked) return null;
  const route = await routeNewConversation();
  const subject = mail.subject.replace(TAG_RE, '').trim() || '(no subject)';
  conv = await convRepo.create({
    customer, status: 'open', priority: 'none', category: 'general',
    unreadCountAgent: 1, unreadCountCustomer: 0,
    assignedAgentId: route.assignedAgentId,
    ...(route.teamId ? { teamId: route.teamId } : {}),
    title: subject,
    channel: 'email',
    email: { subject, address: mail.from.address, threadIds: mail.messageId ? [mail.messageId] : [] },
  } as any);
  const msg = await msgRepo.create({
    conversationId: conv.id,
    sender: { type: 'customer', id: customer.id, name: customer.name },
    content: body, attachments: [], isInternalNote: false, seen: false, delivered: true, reactions: [],
    metadata: { email: { messageId: mail.messageId, subject, from: mail.from.address } },
  });
  const fresh = (await convRepo.update(conv.id, { lastMessageSnippet: plainText(body).slice(0, 200), customerSnippet: plainText(body).slice(0, 200) })) || conv;
  await recordEvent(conv.id, 'other', `Received by email from ${mail.from.address}`, undefined, { field: 'channel', to: 'email' });
  if (route.assignedAgentId) {
    const assignee = await RepositoryFactory.getUserRepository().findById(route.assignedAgentId);
    await recordEvent(conv.id, 'assignment', `Auto-assigned to ${assignee?.name || 'a teammate'}${route.reason ? ` (${route.reason})` : ''}`, undefined, { targetId: route.assignedAgentId, targetName: assignee?.name, auto: true });
  }
  SocketService.broadcastConversationNew(fresh);
  notifyIntegrations(ws.id, 'conversation.created', { conversation: fresh, message: msg });
  await refreshSla(conv.id);
  return { conversationId: conv.id, created: true };
}

/** IMAP: read unseen mail from the mailbox, file each one, mark it seen. */
export async function pollImap(ws: Workspace): Promise<number> {
  const e = emailSettingsOf(ws);
  const cfg = e.inbound?.imap;
  if (!e.enabled || e.inbound?.mode !== 'imap' || !cfg?.host || !cfg.user) return 0;
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password || '' },
    logger: false, socketTimeout: 30_000,
  } as any);
  let filed = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try {
      const unseen = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of unseen.slice(0, 50)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) {
          const mail = await parseRaw(msg.source);
          if (mail && await handleInbound(mail)) filed++;
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
    await patchEmail(ws.id, { inbound: { ...e.inbound!, lastPolledAt: new Date().toISOString(), lastError: null } });
  } catch (err: any) {
    await patchEmail(ws.id, { inbound: { ...e.inbound!, lastPolledAt: new Date().toISOString(), lastError: err.message } });
  } finally {
    await client.logout().catch(() => {});
  }
  return filed;
}

// ── Customer emails for the Messenger ──────────────────────────────────────

function customerOnline(customerId: string): boolean {
  try { return (SocketService.getIO().sockets.adapter.rooms.get(customerRoom(customerId))?.size || 0) > 0; } catch { return false; }
}

/**
 * Missed replies: a teammate replied in the Messenger, the customer hasn't seen it after the
 * delay and isn't in the Messenger right now → email it to them (once). Replying to that email
 * continues the same conversation.
 */
async function sendMissedReplyAlerts(ws: Workspace): Promise<void> {
  const e = emailSettingsOf(ws);
  if (!canSend(e) || e.missedReplyAlerts === false) return;
  const delay = (e.missedReplyDelayMinutes || 5) * 60_000;
  const now = Date.now();
  const since = new Date(Math.max(now - ALERT_LOOKBACK_MS, e.enabledAt ? Date.parse(e.enabledAt) : 0)).toISOString();
  const due = new Date(now - delay).toISOString();
  const msgs = (await RepositoryFactory.getMessageRepository().findAll()).filter(m =>
    m.sender.type === 'agent' && m.sender.id !== 'bot' && !m.isInternalNote && !m.seen
    && !m.metadata?.type && !m.metadata?.emailAlertAt && !m.metadata?.email
    && m.createdAt >= since && m.createdAt <= due);
  if (!msgs.length) return;
  const byConv = new Map<string, Message[]>();
  for (const m of msgs) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) || []), m]);
  const convRepo = RepositoryFactory.getConversationRepository();
  for (const [cid, list] of byConv) {
    const conv = await convRepo.findById(cid);
    const to = conv?.customer.email;
    if (!conv || !to || conv.channel === 'email' || conv.mergedInto || conv.sharing === 'internal' || conv.kind === 'issue') continue;
    if (customerOnline(conv.customer.id)) continue;
    const brand = ws.customerFacingName?.trim() || ws.name;
    const subject = `New reply from ${brand} ${tagFor(conv)}`;
    const blocks = list.map(m => `<p style="margin:0 0 4px;font-size:13px;color:#777">${esc(m.sender.name)}</p><div style="font-size:15px;line-height:1.55;margin-bottom:14px">${textToHtml(m.content)}</div>`).join('');
    try {
      const id = await sendMail(ws, {
        to, subject,
        text: `${list.map(m => `${m.sender.name}:\n${plainText(m.content)}`).join('\n\n')}\n\nReply to this email to continue the conversation.`,
        html: layout(ws, `<p style="margin:0 0 16px;font-size:15px">Hi ${esc(conv.customer.name.split(' ')[0] || 'there')}, you have a new reply:</p>${blocks}<p style="margin-top:20px;font-size:13px;color:#777">Reply to this email to continue the conversation.</p>`),
      });
      const at = new Date().toISOString();
      for (const m of list) await RepositoryFactory.getMessageRepository().update(m.id, { metadata: { ...(m.metadata || {}), emailAlertAt: at } });
      await convRepo.update(conv.id, { email: { subject: conv.email?.subject || `Your conversation with ${brand}`, address: to, threadIds: [...(conv.email?.threadIds || []), id].slice(-50) } }, { touch: false });
      await recordEvent(conv.id, 'other', `Emailed the customer ${list.length === 1 ? 'a reply' : `${list.length} replies`} they hadn’t seen (${to})`, undefined, { field: 'email' });
    } catch { /* recorded in settings (lastError); try again next round */ }
  }
}

/** Closing a Messenger conversation emails the customer its transcript (Settings › Email). */
export async function sendTranscript(conv: Conversation): Promise<void> {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(tenantStorage.getStore() || 'default_workspace');
    const e = emailSettingsOf(ws);
    const to = conv.customer.email;
    if (!ws || !canSend(e) || e.transcripts === false || !to || conv.channel === 'email' || conv.mergedInto || conv.kind === 'issue' || conv.sharing === 'internal') return;
    const msgs = (await RepositoryFactory.getMessageRepository().findByConversationId(conv.id, 100_000))
      .filter(m => !m.isInternalNote && m.sender.type !== 'system' && (m.content || m.attachments?.length));
    if (!msgs.length) return;
    const brand = ws.customerFacingName?.trim() || ws.name;
    const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const rows = msgs.map(m => `<div style="margin-bottom:14px"><p style="margin:0 0 2px;font-size:12px;color:#777">${esc(m.sender.type === 'customer' ? 'You' : m.sender.name)} · ${when(m.createdAt)}</p><div style="font-size:14px;line-height:1.5">${textToHtml(m.content || '(attachment)')}</div></div>`).join('');
    const id = await sendMail(ws, {
      to,
      subject: `Your conversation with ${brand} ${tagFor(conv)}`,
      text: msgs.map(m => `${m.sender.type === 'customer' ? 'You' : m.sender.name} (${when(m.createdAt)}):\n${plainText(m.content || '(attachment)')}`).join('\n\n') + '\n\nReply to this email if you need anything else.',
      html: layout(ws, `<p style="margin:0 0 18px;font-size:15px">Here’s a copy of your conversation with ${esc(brand)}.</p>${rows}<p style="margin-top:20px;font-size:13px;color:#777">Reply to this email if you need anything else.</p>`),
    });
    await RepositoryFactory.getConversationRepository().update(conv.id, { email: { subject: conv.email?.subject || `Your conversation with ${brand}`, address: to, threadIds: [...(conv.email?.threadIds || []), id].slice(-50) } }, { touch: false });
    await recordEvent(conv.id, 'other', `Emailed the transcript to ${to}`, undefined, { field: 'email' });
  } catch (err: any) {
    await recordEvent(conv.id, 'other', `Couldn’t email the transcript: ${err.message}`, undefined, { field: 'email', error: true });
  }
}

/** Scheduler: IMAP polling (every minute) and missed-reply alerts, for every workspace. */
let lastPoll = 0;
export async function checkEmail(): Promise<void> {
  const pollNow = Date.now() - lastPoll >= 55_000;
  if (pollNow) lastPoll = Date.now();
  for (const ws of await RepositoryFactory.getWorkspaceRepository().findAll()) {
    if (!ws.email?.enabled) continue;
    await tenantStorage.run(ws.id, async () => {
      if (pollNow) await pollImap(ws).catch(() => {});
      await sendMissedReplyAlerts(ws).catch(err => console.error('[Email] alerts failed:', err.message));
    });
  }
}
