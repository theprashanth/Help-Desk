import { RepositoryFactory } from '../repositories/factory';
import { RecordRepository } from '../repositories/records';
import { SocketService } from './socket';
import { plainText } from './conversationView';
import { sendMail, layout, textToHtml, esc, InboundMail, stripQuoted } from './email';
import { Conversation, Message, SideConversation } from '../../../shared/src/types';

/**
 * Side conversations: from a customer conversation, email someone outside the team (a supplier, the
 * warehouse, another department) and keep that thread inside the conversation as internal notes.
 * The customer never sees it. Replies are matched by Message-ID headers or the "[#41153/2]" subject tag,
 * and only from the address the side conversation was started with.
 */
export const sideRepo = new RecordRepository<SideConversation>('side_conversations', 'side');

export const sideTag = (conv: Pick<Conversation, 'ticketNumber'>, n: number) => `[#${String(conv.ticketNumber).replace(/^#/, '')}/${n}]`;
const SIDE_TAG_RE = /\[#(\d{3,})\/(\d+)\]/;
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s);

type Who = { id: string; name: string; avatar?: string };

/** A side-conversation message, as an internal note in the conversation. */
async function addNote(rec: SideConversation, conv: Conversation, sender: Message['sender'], content: string, direction: 'out' | 'in', email?: Record<string, any>): Promise<Message> {
  const msgRepo = RepositoryFactory.getMessageRepository();
  const msg = await msgRepo.create({
    conversationId: conv.id,
    sender,
    content,
    attachments: [],
    isInternalNote: true,
    seen: direction === 'out',
    delivered: true,
    reactions: [],
    metadata: { side: { id: rec.id, number: rec.number, direction, address: rec.to, subject: rec.subject }, ...(email ? { email } : {}) },
  });
  const now = new Date().toISOString();
  await sideRepo.update(rec.id, { lastMessageAt: now, messageCount: (rec.messageCount || 0) + 1 });
  const updated = await RepositoryFactory.getConversationRepository().update(conv.id, {
    lastMessageSnippet: `[Note] ${plainText(content).slice(0, 180)}`,
    ...(direction === 'in' ? { unreadCountAgent: (conv.unreadCountAgent || 0) + 1 } : {}),
  });
  SocketService.broadcastMessageNew(msg);
  if (updated) SocketService.broadcastConversationUpdate(updated);
  return msg;
}

async function send(rec: SideConversation, conv: Conversation, from: Who, content: string): Promise<string> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(conv.workspaceId || 'default_workspace');
  if (!ws) throw new Error('Workspace not found');
  const base = /^re:/i.test(rec.subject) || !rec.threadIds.length ? rec.subject : `Re: ${rec.subject}`;
  return sendMail(ws, {
    to: rec.to,
    subject: `${base} ${sideTag(conv, rec.number)}`,
    text: `${plainText(content)}\n\n— ${from.name}`,
    html: layout(ws, `<div style="font-size:15px;line-height:1.55">${textToHtml(content)}</div><p style="margin-top:18px;font-size:14px;color:#555">— ${esc(from.name)}</p>`),
    inReplyTo: rec.threadIds[rec.threadIds.length - 1],
    references: rec.threadIds,
  });
}

export async function listSideConversations(conversationId: string): Promise<SideConversation[]> {
  return (await sideRepo.list()).filter(r => r.conversationId === conversationId);
}

/** Start one: email `to` and record the first message as a note. Throws if email isn't set up. */
export async function startSideConversation(conv: Conversation, from: Who, input: { to: string; subject: string; content: string }): Promise<SideConversation> {
  const existing = await listSideConversations(conv.id);
  const number = existing.reduce((m, r) => Math.max(m, r.number), 0) + 1;
  // Send first, so nothing is recorded when the email can't go out
  const draft: SideConversation = { id: 'pending', conversationId: conv.id, number, to: input.to, subject: input.subject, threadIds: [] };
  const messageId = await send(draft, conv, from, input.content);
  const rec = await sideRepo.create({
    conversationId: conv.id, number, to: input.to, subject: input.subject, threadIds: [messageId],
    createdBy: { id: from.id, name: from.name }, messageCount: 0,
  });
  await addNote(rec, conv, { type: 'agent', ...from }, input.content, 'out', { messageId });
  return (await sideRepo.get(rec.id)) || rec;
}

export async function replySideConversation(rec: SideConversation, conv: Conversation, from: Who, content: string): Promise<Message> {
  const messageId = await send(rec, conv, from, content);
  await sideRepo.update(rec.id, { threadIds: [...rec.threadIds, messageId].slice(-50) });
  return addNote({ ...rec, threadIds: [...rec.threadIds, messageId] }, conv, { type: 'agent', ...from }, content, 'out', { messageId });
}

/**
 * Inbound email: if it answers a side conversation, file it there (as a note) and return that conversation's id.
 * Runs before normal threading, inside the workspace's context.
 */
export async function fileSideReply(mail: InboundMail): Promise<string | null> {
  const all = await sideRepo.list();
  if (!all.length) return null;
  const dup = mail.messageId ? all.find(r => r.threadIds.includes(mail.messageId!)) : undefined;
  if (dup) return dup.conversationId; // already filed
  const ids = new Set([mail.inReplyTo, ...(mail.references || [])].filter(Boolean) as string[]);
  const tag = SIDE_TAG_RE.exec(mail.subject);
  const convRepo = RepositoryFactory.getConversationRepository();
  let rec = all.find(r => r.to === mail.from.address && r.threadIds.some(id => ids.has(id)));
  if (!rec && tag) {
    const candidates = all.filter(r => r.to === mail.from.address && r.number === Number(tag[2]));
    for (const r of candidates) {
      const c = await convRepo.findById(r.conversationId);
      if (c && String(c.ticketNumber).replace(/^#/, '') === tag[1]) { rec = r; break; }
    }
  }
  if (!rec) return null;
  const conv = await convRepo.findById(rec.conversationId);
  if (!conv) return null;
  const body = stripQuoted(mail.text || '').slice(0, 20_000) || '(empty email)';
  await sideRepo.update(rec.id, { threadIds: [...rec.threadIds, ...(mail.messageId ? [mail.messageId] : [])].slice(-50) });
  await addNote({ ...rec }, conv, { type: 'agent', id: `side:${mail.from.address}`, name: mail.from.name || mail.from.address }, body, 'in',
    { messageId: mail.messageId, subject: mail.subject, from: mail.from.address });
  return conv.id;
}

/** Conversations were deleted: their side conversations go too. */
export async function deleteSideConversationsFor(conversationIds: Iterable<string>): Promise<void> {
  const gone = new Set(conversationIds);
  for (const r of await sideRepo.list()) if (gone.has(r.conversationId)) await sideRepo.delete(r.id);
}
