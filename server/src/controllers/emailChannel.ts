import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage, getActiveWorkspaceId } from '../context/tenant.context';
import { logAudit } from '../services/audit';
import {
  emailSettingsOf, publicEmailSettings, sendMail, newWebhookToken, handleInbound, parseRaw, pollImap, textToHtml, InboundMail,
} from '../services/email';
import { EmailSettings } from '../../../shared/src/types';

/** Settings › Channels › Email: SMTP (outgoing), IMAP or forwarding webhook (incoming), customer emails. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOST_RE = /^[a-z0-9.-]{1,253}$/i;

export async function getEmailSettings(req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  return res.json(publicEmailSettings(ws, req.user?.role === 'admin'));
}

function port(v: unknown, fallback: number): number | null {
  const n = v === undefined || v === '' ? fallback : Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export async function saveEmailSettings(req: AuthenticatedRequest, res: Response) {
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(getActiveWorkspaceId());
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const cur = emailSettingsOf(ws);
  const b = req.body || {};
  const next: EmailSettings = { ...cur };

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    if (b.enabled && !cur.enabled) next.enabledAt = new Date().toISOString(); // alerts only cover replies from now on
    next.enabled = b.enabled;
  }
  if (b.fromName !== undefined) next.fromName = String(b.fromName || '').trim().slice(0, 80) || undefined;
  if (b.fromAddress !== undefined) {
    const a = String(b.fromAddress || '').trim().toLowerCase();
    if (a && !EMAIL_RE.test(a)) return res.status(400).json({ error: 'From address must be a valid email address' });
    next.fromAddress = a || undefined;
  }
  if (b.smtp !== undefined) {
    if (b.smtp === null) next.smtp = undefined;
    else {
      const host = String(b.smtp.host || '').trim();
      if (!HOST_RE.test(host)) return res.status(400).json({ error: 'Enter the SMTP server host, e.g. smtp.gmail.com' });
      const p = port(b.smtp.port, 587);
      if (!p) return res.status(400).json({ error: 'SMTP port must be a number like 587 or 465' });
      next.smtp = {
        host, port: p, secure: !!b.smtp.secure,
        user: String(b.smtp.user || '').trim() || undefined,
        // Empty password field = keep the saved one
        password: typeof b.smtp.password === 'string' && b.smtp.password ? b.smtp.password : cur.smtp?.password,
      };
    }
  }
  if (b.inbound !== undefined) {
    const mode = b.inbound?.mode;
    if (!['none', 'imap', 'webhook'].includes(mode)) return res.status(400).json({ error: 'Incoming mail must be none, imap or webhook' });
    const inbound: NonNullable<EmailSettings['inbound']> = { ...(cur.inbound || { mode: 'none' }), mode };
    if (mode === 'imap') {
      const i = b.inbound.imap || {};
      const host = String(i.host || '').trim();
      if (!HOST_RE.test(host)) return res.status(400).json({ error: 'Enter the IMAP server host, e.g. imap.gmail.com' });
      const p = port(i.port, 993);
      if (!p) return res.status(400).json({ error: 'IMAP port must be a number like 993' });
      if (!String(i.user || '').trim()) return res.status(400).json({ error: 'Enter the IMAP username (usually the mailbox address)' });
      inbound.imap = {
        host, port: p, secure: i.secure !== false, user: String(i.user).trim(),
        password: typeof i.password === 'string' && i.password ? i.password : cur.inbound?.imap?.password,
        mailbox: String(i.mailbox || 'INBOX').trim().slice(0, 100) || 'INBOX',
      };
    }
    if (mode === 'webhook' && !inbound.webhookToken) inbound.webhookToken = newWebhookToken();
    next.inbound = inbound;
  }
  if (b.missedReplyAlerts !== undefined) next.missedReplyAlerts = !!b.missedReplyAlerts;
  if (b.missedReplyDelayMinutes !== undefined) {
    const m = Number(b.missedReplyDelayMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) return res.status(400).json({ error: 'The delay must be 1 to 1440 minutes' });
    next.missedReplyDelayMinutes = m;
  }
  if (b.transcripts !== undefined) next.transcripts = !!b.transcripts;
  if (b.rotateWebhookToken) next.inbound = { ...(next.inbound || { mode: 'webhook' }), webhookToken: newWebhookToken() };

  const updated = await repo.update(ws.id, { email: next });
  const what = [
    b.enabled !== undefined && b.enabled !== cur.enabled ? (b.enabled ? 'turned email on' : 'turned email off') : '',
    b.smtp !== undefined ? 'SMTP' : '', b.inbound !== undefined ? 'incoming mail' : '',
    b.rotateWebhookToken ? 'rotated the forwarding address' : '',
    b.missedReplyAlerts !== undefined || b.transcripts !== undefined || b.missedReplyDelayMinutes !== undefined ? 'customer emails' : '',
  ].filter(Boolean);
  if (what.length) await logAudit(req, 'settings.email', `Changed email settings: ${what.join(', ')}`);
  return res.json(publicEmailSettings(updated || ws, true));
}

export async function sendTestEmail(req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const to = String(req.body?.to || '').trim();
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter an email address to send the test to' });
  try {
    await sendMail(ws, {
      to, subject: `Test email from ${ws.customerFacingName || ws.name}`,
      text: 'Your email settings work. Replies to email conversations will be sent like this.',
      html: `<p>${textToHtml('Your email settings work. Replies to email conversations will be sent like this.')}</p>`,
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(502).json({ error: `Sending failed: ${err.message}` });
  }
}

/** Admins: check the IMAP mailbox right now. */
export async function pollNow(_req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const filed = await pollImap(ws);
  const after = await RepositoryFactory.getWorkspaceRepository().findById(ws.id);
  return res.json({ filed, settings: publicEmailSettings(after || ws, true) });
}

/**
 * POST /api/email/inbound/:token — public. For mail forwarding / inbound-parse services:
 *   JSON { from, fromName?, subject, text, html?, messageId?, inReplyTo?, references? }
 *   or   JSON { raw: "<the whole MIME message>" }   or a text/plain or message/rfc822 body.
 */
export async function inboundWebhook(req: AuthenticatedRequest, res: Response) {
  const token = String(req.params.token || '');
  if (token.length < 16) return res.status(404).json({ error: 'Unknown address' });
  const ws = (await RepositoryFactory.getWorkspaceRepository().findAll()).find(w => w.email?.inbound?.webhookToken === token);
  if (!ws || !ws.email?.enabled || ws.email.inbound?.mode !== 'webhook') return res.status(404).json({ error: 'Unknown address' });

  let mail: InboundMail | null = null;
  try {
    const b = req.body;
    if (typeof b === 'string' || Buffer.isBuffer(b)) mail = await parseRaw(b);
    else if (b?.raw) mail = await parseRaw(String(b.raw));
    else if (b?.from) {
      const m = /<([^>]+)>/.exec(String(b.from));
      const address = (m ? m[1] : String(b.from)).trim().toLowerCase();
      if (!EMAIL_RE.test(address)) return res.status(400).json({ error: 'from must be an email address' });
      const refs = Array.isArray(b.references) ? b.references : typeof b.references === 'string' ? b.references.split(/\s+/) : [];
      mail = {
        from: { address, name: b.fromName || (m ? String(b.from).replace(/<[^>]+>/, '').replace(/"/g, '').trim() : undefined) || undefined },
        subject: String(b.subject || '(no subject)').slice(0, 300),
        text: String(b.text || '').slice(0, 100_000) || String(b.html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
        messageId: b.messageId ? String(b.messageId) : undefined,
        inReplyTo: b.inReplyTo ? String(b.inReplyTo) : undefined,
        references: refs.map(String).filter(Boolean),
      };
    }
  } catch (err: any) {
    return res.status(400).json({ error: `Couldn’t read the email: ${err.message}` });
  }
  if (!mail) return res.status(400).json({ error: 'Send JSON with from, subject and text, or the raw message' });
  const result = await tenantStorage.run(ws.id, () => handleInbound(mail!));
  return res.status(result ? 201 : 200).json(result || { ignored: true });
}
