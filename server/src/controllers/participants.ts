import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { recordEvent, getActor } from '../services/events';
import { canSend, emailSettingsOf } from '../services/email';
import { sideRepo, listSideConversations, startSideConversation, replySideConversation, isEmail } from '../services/sideConversations';

/**
 * Settings on one conversation that go out by email:
 *  - participants: extra people CC'd on every teammate reply; their email replies come back into the conversation;
 *  - side conversations: separate email threads with people outside the team, kept as internal notes.
 */

async function sender(req: AuthenticatedRequest) {
  const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
  return { id: me?.id || req.user?.id || 'agent', name: me?.name || 'Agent', ...(me?.avatar ? { avatar: me.avatar } : {}) };
}

async function emailReady(): Promise<boolean> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById((await import('../context/tenant.context')).getActiveWorkspaceId());
  return canSend(emailSettingsOf(ws));
}
const NOT_READY = 'Email isn’t set up yet. An admin can add SMTP details in Settings › Channels › Email.';

/** PUT /api/tickets/:id/participants { participants: string[] } */
export async function setParticipants(req: AuthenticatedRequest, res: Response) {
  const raw: unknown = req.body?.participants;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'participants must be a list of email addresses' });
  const list = Array.from(new Set(raw.map(x => String(x || '').trim().toLowerCase()).filter(Boolean)));
  const bad = list.find(a => !isEmail(a));
  if (bad) return res.status(400).json({ error: `“${bad}” isn’t an email address` });
  if (list.length > 10) return res.status(400).json({ error: 'Up to 10 participants' });
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.kind === 'issue') return res.status(400).json({ error: 'Issues are internal; they have no participants' });
    const customerAddr = (conv.email?.address || conv.customer.email || '').toLowerCase();
    const next = list.filter(a => a !== customerAddr);
    if (next.length && !(await emailReady())) return res.status(409).json({ error: NOT_READY });
    const before = conv.participants || [];
    const updated = await convRepo.update(conv.id, { participants: (next.length ? next : null) as any }, { touch: false });
    if (!updated) return res.status(404).json({ error: 'Conversation not found' });
    SocketService.broadcastConversationUpdate(updated);
    const actor = await getActor(req);
    const who = actor?.name || 'A teammate';
    for (const a of next.filter(a => !before.includes(a))) await recordEvent(conv.id, 'other', `${who} added ${a} as a participant`, actor, { field: 'participants', added: a });
    for (const a of before.filter(a => !next.includes(a))) await recordEvent(conv.id, 'other', `${who} removed participant ${a}`, actor, { field: 'participants', removed: a });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/tickets/:id/side-conversations */
export async function getSideConversations(req: AuthenticatedRequest, res: Response) {
  try {
    const list = await listSideConversations(req.params.id);
    return res.json(list.sort((a, b) => a.number - b.number));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/tickets/:id/side-conversations { to, subject, content } */
export async function createSideConversation(req: AuthenticatedRequest, res: Response) {
  const to = String(req.body?.to || '').trim().toLowerCase();
  const subject = String(req.body?.subject || '').trim().slice(0, 200);
  const content = String(req.body?.content || '').trim();
  if (!isEmail(to)) return res.status(400).json({ error: 'Enter the email address to write to' });
  if (!subject) return res.status(400).json({ error: 'Add a subject' });
  if (!content) return res.status(400).json({ error: 'Write a message' });
  try {
    const conv = await RepositoryFactory.getConversationRepository().findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await emailReady())) return res.status(409).json({ error: NOT_READY });
    const rec = await startSideConversation(conv, await sender(req), { to, subject, content });
    const actor = await getActor(req);
    await recordEvent(conv.id, 'other', `${actor?.name || 'A teammate'} started a side conversation with ${to}`, actor, { field: 'sideConversation', id: rec.id });
    return res.status(201).json(rec);
  } catch (err: any) {
    return res.status(502).json({ error: `Couldn’t send the email: ${err.message}` });
  }
}

/** POST /api/side-conversations/:sid/reply { content } */
export async function replySide(req: AuthenticatedRequest, res: Response) {
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Write a message' });
  try {
    const rec = await sideRepo.get(req.params.sid);
    if (!rec) return res.status(404).json({ error: 'Side conversation not found' });
    const conv = await RepositoryFactory.getConversationRepository().findById(rec.conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await emailReady())) return res.status(409).json({ error: NOT_READY });
    const msg = await replySideConversation(rec, conv, await sender(req), content);
    return res.status(201).json(msg);
  } catch (err: any) {
    return res.status(502).json({ error: `Couldn’t send the email: ${err.message}` });
  }
}
