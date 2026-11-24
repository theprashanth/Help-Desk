import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { RecordRepository, StoredRecord } from '../repositories/records';
import { logAudit } from '../services/audit';
import { Customer, OutboundMessage } from '../../../shared/src/types';

/**
 * Proactive messages (Settings › Outbound): chat messages that pop up from the Messenger launcher,
 * and banners across the top of the page, shown to people matching an audience (page URL, leads
 * vs users, a custom attribute). Each person gets a "once" message only once; dismissing hides it.
 */
export const outboundRepo = new RecordRepository<OutboundMessage>('outbound_messages', 'out');
type Receipt = StoredRecord & { messageId: string; customerId: string; openedAt?: string; dismissedAt?: string; repliedAt?: string; conversationId?: string };
export const receiptsRepo = new RecordRepository<Receipt>('outbound_receipts', 'orc');

const OPS = ['contains', 'equals', 'starts_with'];

async function clean(b: any, cur?: OutboundMessage): Promise<{ value?: Omit<OutboundMessage, 'id'>; error?: string }> {
  const name = b.name !== undefined ? String(b.name).trim() : cur?.name;
  if (!name) return { error: 'Give the message a name' };
  const kind = b.kind ?? cur?.kind ?? 'chat';
  if (!['chat', 'banner'].includes(kind)) return { error: 'kind must be chat or banner' };
  const body = b.body !== undefined ? String(b.body).trim() : cur?.body || '';
  if (!body) return { error: 'Write the message' };
  if (body.length > (kind === 'banner' ? 300 : 2000)) return { error: kind === 'banner' ? 'Banners can be up to 300 characters' : 'Messages can be up to 2000 characters' };
  let senderId = b.senderId !== undefined ? b.senderId || undefined : cur?.senderId;
  if (kind === 'chat' && senderId && !(await RepositoryFactory.getUserRepository().findById(senderId))) return { error: 'That teammate no longer exists' };
  let link = b.link !== undefined ? b.link : cur?.link;
  if (link) {
    const label = String(link.label || '').trim().slice(0, 40);
    const url = String(link.url || '').trim();
    if (!label && !url) link = undefined;
    else if (!label || !/^https?:\/\/\S+$/i.test(url)) return { error: 'A button needs a label and a link starting with https://' };
    else link = { label, url };
  }
  const a = b.audience ?? cur?.audience ?? { people: 'everyone' };
  if (!['everyone', 'leads', 'users'].includes(a.people)) return { error: 'Audience must be everyone, leads or users' };
  let pageUrl = a.pageUrl && String(a.pageUrl.value || '').trim() ? { op: a.pageUrl.op, value: String(a.pageUrl.value).trim().slice(0, 300) } : undefined;
  if (pageUrl && !OPS.includes(pageUrl.op)) return { error: 'Page rule must be contains, equals or starts_with' };
  const attribute = a.attribute && String(a.attribute.key || '').trim() ? { key: String(a.attribute.key).trim(), value: String(a.attribute.value ?? '').trim() } : undefined;
  if (attribute) {
    const defs = (await RepositoryFactory.getWorkspaceRepository().findById((await import('../context/tenant.context')).getActiveWorkspaceId()))?.customerAttributes || [];
    if (!defs.some(d => d.key === attribute.key)) return { error: 'Unknown attribute in the audience' };
  }
  const frequency = b.frequency ?? cur?.frequency ?? 'once';
  if (!['once', 'every_page'].includes(frequency)) return { error: 'frequency must be once or every_page' };
  const state = b.state ?? cur?.state ?? 'paused';
  if (!['live', 'paused'].includes(state)) return { error: 'state must be live or paused' };
  return {
    value: {
      name: name.slice(0, 80), kind, body, ...(kind === 'chat' && senderId ? { senderId } : {}),
      ...(kind === 'banner' && link ? { link } : {}),
      ...(kind === 'banner' ? { bannerStyle: (b.bannerStyle ?? cur?.bannerStyle) === 'promo' ? 'promo' as const : 'info' as const } : {}),
      audience: { people: a.people, ...(pageUrl ? { pageUrl } : {}), ...(attribute ? { attribute } : {}) },
      frequency, state, stats: cur?.stats || { sent: 0, opened: 0, replied: 0, dismissed: 0 },
    },
  };
}

export async function listOutbound(_req: AuthenticatedRequest, res: Response) {
  return res.json((await outboundRepo.list()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
}
export async function createOutbound(req: AuthenticatedRequest, res: Response) {
  const { value, error } = await clean(req.body || {});
  if (error || !value) return res.status(400).json({ error });
  const m = await outboundRepo.create(value);
  await logAudit(req, 'outbound.created', `Created the ${m.kind} message “${m.name}”${m.state === 'live' ? ' (live)' : ''}`, { target: m.name });
  return res.status(201).json(m);
}
export async function updateOutbound(req: AuthenticatedRequest, res: Response) {
  const cur = await outboundRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Message not found' });
  const { value, error } = await clean(req.body || {}, cur);
  if (error || !value) return res.status(400).json({ error });
  const m = await outboundRepo.update(cur.id, value);
  if (cur.state !== value.state) await logAudit(req, 'outbound.state', `${value.state === 'live' ? 'Set live' : 'Paused'} the message “${value.name}”`, { target: value.name });
  return res.json(m);
}
export async function deleteOutbound(req: AuthenticatedRequest, res: Response) {
  const cur = await outboundRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Message not found' });
  await outboundRepo.delete(cur.id);
  await logAudit(req, 'outbound.deleted', `Deleted the message “${cur.name}”`, { target: cur.name });
  return res.json({ success: true });
}

// ── Messenger (public) ────────────────────────────────────────────────────

function pageMatches(rule: OutboundMessage['audience']['pageUrl'], url: string): boolean {
  if (!rule) return true;
  const u = url.toLowerCase(), v = rule.value.toLowerCase();
  // Match with or without the protocol, so "example.com/pricing" works
  const bare = u.replace(/^https?:\/\//, '');
  if (rule.op === 'equals') return u === v || bare === v.replace(/^https?:\/\//, '') || bare.replace(/\/$/, '') === v.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (rule.op === 'starts_with') return u.startsWith(v) || bare.startsWith(v.replace(/^https?:\/\//, ''));
  return u.includes(v);
}

function audienceMatches(m: OutboundMessage, customer: Customer | null, url: string): boolean {
  const isUser = !!(customer?.email || customer?.externalId);
  if (m.audience.people === 'users' && !isUser) return false;
  if (m.audience.people === 'leads' && isUser) return false;
  if (!pageMatches(m.audience.pageUrl, url)) return false;
  if (m.audience.attribute) {
    const v = customer?.attributes?.[m.audience.attribute.key];
    if (v === undefined || String(v).toLowerCase() !== m.audience.attribute.value.toLowerCase()) return false;
  }
  return true;
}

async function bumpStat(id: string, key: keyof NonNullable<OutboundMessage['stats']>) {
  const m = await outboundRepo.get(id);
  if (!m) return;
  const stats = { sent: 0, opened: 0, replied: 0, dismissed: 0, ...(m.stats || {}) };
  stats[key]++;
  await outboundRepo.update(id, { stats });
}

/** POST /api/messenger/outbound { customerId, url } → the live messages this person should see now. */
export async function matchOutbound(req: AuthenticatedRequest, res: Response) {
  const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId.slice(0, 100) : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.slice(0, 2000) : '';
  if (!customerId) return res.json([]);
  const live = (await outboundRepo.list()).filter(m => m.state === 'live');
  if (!live.length) return res.json([]);
  const customer = await RepositoryFactory.getCustomerRepository().findById(customerId);
  if (customer?.blocked) return res.json([]);
  const mine = (await receiptsRepo.list()).filter(r => r.customerId === customerId);
  const out = [];
  for (const m of live) {
    if (!audienceMatches(m, customer, url)) continue;
    const r = mine.find(x => x.messageId === m.id);
    if (r?.dismissedAt || r?.repliedAt) continue;
    if (r && m.frequency === 'once' && (m.kind === 'chat' ? r.openedAt : true)) continue;
    if (!r) { await receiptsRepo.create({ messageId: m.id, customerId }); await bumpStat(m.id, 'sent'); }
    const sender = m.senderId ? await RepositoryFactory.getUserRepository().findById(m.senderId) : null;
    out.push({
      id: m.id, kind: m.kind, body: m.body, link: m.link, bannerStyle: m.bannerStyle || 'info',
      sender: sender ? { name: sender.name, avatar: sender.avatar } : null,
    });
  }
  return res.json(out.slice(0, 3));
}

/** POST /api/messenger/outbound/:id/event { customerId, event: 'opened' | 'dismissed' } */
export async function outboundEvent(req: AuthenticatedRequest, res: Response) {
  const customerId = String(req.body?.customerId || '');
  const event = req.body?.event;
  if (!customerId || !['opened', 'dismissed'].includes(event)) return res.status(400).json({ error: 'customerId and event are required' });
  const r = (await receiptsRepo.list()).find(x => x.messageId === req.params.id && x.customerId === customerId);
  if (!r) return res.status(404).json({ error: 'Not shown to this person' });
  const key = event === 'opened' ? 'openedAt' : 'dismissedAt';
  if (!r[key]) {
    await receiptsRepo.update(r.id, { [key]: new Date().toISOString() } as any);
    await bumpStat(req.params.id, event as 'opened' | 'dismissed');
  }
  return res.json({ ok: true });
}

/** createTicket: the customer answered a chat message → it starts the conversation, from its sender. */
export async function outboundForReply(id: unknown, customerId: string): Promise<{ message: OutboundMessage; senderName: string; senderId: string; senderAvatar?: string } | null> {
  if (typeof id !== 'string' || !id) return null;
  const m = await outboundRepo.get(id);
  if (!m || m.kind !== 'chat') return null;
  const r = (await receiptsRepo.list()).find(x => x.messageId === id && x.customerId === customerId);
  if (!r) return null; // only someone it was shown to can reply to it
  const sender = m.senderId ? await RepositoryFactory.getUserRepository().findById(m.senderId) : null;
  return { message: m, senderName: sender?.name || 'Team', senderId: sender?.id || 'bot', senderAvatar: sender?.avatar };
}
export async function markOutboundReplied(id: string, customerId: string, conversationId: string) {
  const r = (await receiptsRepo.list()).find(x => x.messageId === id && x.customerId === customerId);
  if (r && !r.repliedAt) {
    await receiptsRepo.update(r.id, { repliedAt: new Date().toISOString(), conversationId });
    await bumpStat(id, 'replied');
  }
}
