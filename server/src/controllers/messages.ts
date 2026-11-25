import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { CUSTOMER_SYSTEM_TYPES, AGENTS_ROOM } from '../services/socket';
import { Message, Attachment, Conversation } from '../../../shared/src/types';
import path from 'path';
import { recordEvent, getActor } from '../services/events';
import { refreshSla } from '../services/sla';
import { refreshConversationSnippets, plainText, toCustomerView } from '../services/conversationView';
import { notifyIntegrations } from '../services/notifications';
import { deliverAgentReply } from '../services/email';
import { inBackground, translateCustomerMessage, onCustomerTyped } from '../services/aiAssist';

/** Customers may only touch their own conversation: the Messenger sends its User id (an unguessable UUID). */
async function customerOwnsConversation(req: AuthenticatedRequest, conversationId: string): Promise<boolean> {
  const customerId = req.headers['x-customer-id'];
  if (typeof customerId !== 'string' || !customerId) return false;
  const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
  return !!conv && conv.customer.id === customerId;
}

export async function getMessages(req: AuthenticatedRequest, res: Response) {
  const { conversationId } = req.params;
  const limit = Math.min(1000, Math.max(1, req.query.limit ? parseInt(req.query.limit as string) || 300 : 300));

  try {
    if (!req.user && !(await customerOwnsConversation(req, conversationId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const msgRepo = RepositoryFactory.getMessageRepository();
    // The newest `limit` messages, oldest first (an explicit ?skip= still pages from the start)
    const skip = req.query.skip !== undefined
      ? Math.max(0, parseInt(req.query.skip as string) || 0)
      : Math.max(0, (await msgRepo.countMessages(conversationId)) - limit);
    const list = await msgRepo.findByConversationId(conversationId, limit, skip);
    // Customers (no agent token) never see internal notes or conversation events
    const visible = req.user ? list : list.filter(m => !m.isInternalNote && (m.sender?.type !== 'system' || CUSTOMER_SYSTEM_TYPES.includes(m.metadata?.type)));
    return res.json(visible);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createMessage(req: AuthenticatedRequest, res: Response) {
  const { conversationId, content, attachments, isInternalNote } = req.body;
  let sender = req.body.sender;

  if (!conversationId || !sender || (!content && (!attachments || attachments.length === 0))) {
    return res.status(400).json({ error: 'conversationId, sender, and content/attachments are required' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const convRepo = RepositoryFactory.getConversationRepository();

    const conv = await convRepo.findById(conversationId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (sender?.type !== 'customer' || isInternalNote) {
      // Agent replies and internal notes: only a logged-in teammate, and always as themselves
      if (!req.user) return res.status(401).json({ error: 'Only teammates can send replies or notes' });
      if (req.user.role === 'light' && !isInternalNote) return res.status(403).json({ error: 'Your Light seat can add internal notes but not reply to customers.', code: 'light_seat' });
      const me = await RepositoryFactory.getUserRepository().findById(req.user.id);
      sender = { type: 'agent', id: req.user.id, name: me?.name || sender?.name || 'Agent', ...(me?.avatar ? { avatar: me.avatar } : {}) };
    } else if (!req.user && sender.id !== conv.customer.id) {
      // Customers can only post into their own conversation
      return res.status(403).json({ error: 'Not your conversation' });
    }
    if (sender.type === 'customer' && !isInternalNote) {
      const who = await RepositoryFactory.getCustomerRepository().findById(conv.customer.id);
      if (who?.blocked) return res.status(403).json({ error: "You can't send messages to this team right now.", code: 'blocked' });
    }

    // Only known metadata from clients (system types like events, CSAT or bot messages are server-made):
    // device info from the Messenger, @mentions in notes, and the original text of a translated reply.
    const raw = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    let metadata: Record<string, any> | undefined = {};
    for (const k of ['platform', 'channel', 'browser', 'os']) if (raw[k] !== undefined) metadata[k] = str(raw[k], 60);
    if (raw.sourceUrl !== undefined) metadata.sourceUrl = str(raw.sourceUrl, 2000);
    // @mentions only live in internal notes, as a short list of teammate ids
    if (Array.isArray(raw.mentions) && isInternalNote && req.user) {
      const ids = Array.from(new Set(raw.mentions.filter((x: unknown) => typeof x === 'string').slice(0, 20)));
      if (ids.length) metadata.mentions = ids;
    }
    // A teammate's reply sent in the customer's language: keep what they wrote
    if (raw.original && typeof raw.original === 'object' && req.user && sender?.type !== 'customer' && !isInternalNote) {
      metadata.original = { text: str(raw.original.text, 20_000) || '', language: str(raw.original.language, 40) || '' };
    }
    for (const k of Object.keys(metadata)) if (metadata[k] === undefined) delete metadata[k];
    if (!Object.keys(metadata).length) metadata = undefined;

    const createdMsg = await msgRepo.create({
      conversationId,
      sender,
      content: content || '',
      attachments: attachments || [],
      isInternalNote: !!isInternalNote,
      seen: false,
      delivered: true,
      reactions: [],
      metadata
    });

    // Tell mentioned teammates (their dashboards alert them and update the Mentions count)
    const mentions: string[] = createdMsg.metadata?.mentions || [];
    if (mentions.length) {
      SocketService.emitToRoom(AGENTS_ROOM, 'mention:new', {
        conversationId, ticketNumber: conv.ticketNumber, messageId: createdMsg.id,
        mentions, from: { id: sender.id, name: sender.name },
        snippet: plainText(content || '').slice(0, 140),
      });
    }

    // Update unread count based on sender type
    const updateData: any = {};
    // A customer writing into a resolved or closed ticket reopens it, so the team sees the reply.
    // (Not merged tickets: their conversation continues in the primary. Not while the bot is still
    // handling the chat: bot chats sit in "resolved" until someone asks for a person.)
    const botStillHandling = !!conv.bot && conv.bot.state !== 'handoff';
    const reopenedByCustomer = sender.type === 'customer' && !isInternalNote && !conv.mergedInto && !botStillHandling
      && (conv.status === 'resolved' || conv.status === 'closed');
    if (sender.type === 'customer') {
      updateData.unreadCountAgent = conv.unreadCountAgent + 1;
      // A customer reply wakes the conversation up (Intercom-style)
      if (conv.snoozedUntil) updateData.snoozedUntil = null;
      if (conv.status === 'waiting' || reopenedByCustomer) updateData.status = 'open';
    } else if (sender.type === 'agent' && !isInternalNote) {
      updateData.unreadCountCustomer = conv.unreadCountCustomer + 1;
    }
    // A person stepped into a chat the bot was handling (a teammate replied, or the customer typed
    // after the chat flow was turned off): the bot steps back and the conversation is open again
    if (conv.bot && conv.bot.state !== 'handoff' && !isInternalNote && (sender.type === 'agent' || sender.type === 'customer')) {
      updateData.bot = { ...conv.bot, state: 'handoff' };
      if (conv.status === 'resolved' || conv.status === 'closed') updateData.status = 'open';
    }

    // Refresh conversation snippet
    let snippet = plainText(content || '');
    if (attachments && attachments.length > 0) {
      snippet = snippet ? `${snippet} (Attachment)` : 'Sent an attachment';
    }
    if (isInternalNote) {
      snippet = `[Note] ${snippet}`;
    }
    updateData.lastMessageSnippet = snippet;
    if (!isInternalNote) {
      // Customers only ever see previews of public messages
      updateData.customerSnippet = snippet;
    }

    const updatedConv = await convRepo.update(conversationId, updateData);

    // Customer reply woke the conversation up: record why it moved
    if (sender.type === 'customer') {
      if (conv.snoozedUntil && new Date(conv.snoozedUntil).getTime() > Date.now()) {
        await recordEvent(conversationId, 'status', 'Unsnoozed because the customer replied', undefined, { field: 'snoozedUntil', to: null });
      }
      if (conv.status === 'waiting') {
        await recordEvent(conversationId, 'status', 'State changed to In progress because the customer replied', undefined,
          { field: 'status', from: 'waiting', to: 'open' });
      }
      if (reopenedByCustomer) {
        await recordEvent(conversationId, 'status', `Reopened because the customer replied (was ${conv.status === 'resolved' ? 'Resolved' : 'Closed'})`, undefined,
          { field: 'status', from: conv.status, to: 'open' });
      }
    }

    // Emit live updates
    SocketService.broadcastMessageNew(createdMsg);
    if (sender.type === 'customer') {
      // Slack / webhook integrations subscribed to "every new customer message"
      notifyIntegrations(req.workspaceId || 'default_workspace', 'message.customer', { conversation: updatedConv || conv, message: createdMsg });
    }
    if (updatedConv) {
      SocketService.broadcastConversationUpdate(updatedConv);
    }
    // Email conversations: the teammate's reply goes out by email (threaded); failures become an event
    if (sender.type === 'agent' && !isInternalNote && sender.id !== 'bot' && (updatedConv || conv).channel === 'email') {
      deliverAgentReply(updatedConv || conv, createdMsg).catch(() => {});
    }
    // AI translation of the customer's message for the team (Settings › AI assistant)
    if (sender.type === 'customer' && !isInternalNote && content) {
      inBackground('translation', () => translateCustomerMessage(conversationId, createdMsg.id));
      // Bot chats: the customer's first typed message is when the hand-off summary and triage can say something useful
      if (conv.bot) inBackground('hand-off', () => onCustomerTyped(conversationId, createdMsg.id));
    }
    // Customer wrote → their clock may start; a teammate replied → it stops
    if (!isInternalNote && (sender.type === 'customer' || sender.type === 'agent')) await refreshSla(conversationId);

    return res.status(201).json(createdMsg);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * A teammate's public reply created by the server (for example an issue update sent to every linked
 * conversation): the same effects as a reply typed in the composer — previews, the customer's unread
 * count, live updates, email delivery for email conversations, and the SLA clock.
 */
export async function sendAgentReply(
  conv: Conversation,
  sender: { id: string; name: string; avatar?: string },
  content: string,
  metadata?: Record<string, any>,
): Promise<Message> {
  const msgRepo = RepositoryFactory.getMessageRepository();
  const convRepo = RepositoryFactory.getConversationRepository();
  const msg = await msgRepo.create({
    conversationId: conv.id,
    sender: { type: 'agent', ...sender },
    content,
    attachments: [],
    isInternalNote: false,
    seen: false,
    delivered: true,
    reactions: [],
    ...(metadata ? { metadata } : {}),
  });
  const snippet = plainText(content);
  const update: any = { unreadCountCustomer: (conv.unreadCountCustomer || 0) + 1, lastMessageSnippet: snippet, customerSnippet: snippet };
  if (conv.bot && conv.bot.state !== 'handoff') update.bot = { ...conv.bot, state: 'handoff' };
  const updated = await convRepo.update(conv.id, update);
  SocketService.broadcastMessageNew(msg);
  if (updated) SocketService.broadcastConversationUpdate(updated);
  if ((updated || conv).channel === 'email') deliverAgentReply(updated || conv, msg).catch(() => {});
  await refreshSla(conv.id);
  return msg;
}

export async function addReaction(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!emoji) {
    return res.status(400).json({ error: 'emoji is required' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const msg = await msgRepo.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const reactions = msg.reactions ? [...msg.reactions] : [];
    const existingIdx = reactions.findIndex(
      r => r.agentId === req.user!.id && r.emoji === emoji
    );

    if (existingIdx > -1) {
      // Toggle off
      reactions.splice(existingIdx, 1);
    } else {
      // Add reaction (allow user name placeholder or fetch from repo)
      const userRepo = RepositoryFactory.getUserRepository();
      const agent = await userRepo.findById(req.user.id);
      reactions.push({
        agentId: req.user.id,
        agentName: agent ? agent.name : 'Agent',
        emoji
      });
    }

    const updated = await msgRepo.update(messageId, { reactions });
    if (!updated) {
      return res.status(404).json({ error: 'Message update failed' });
    }

    SocketService.broadcastMessageUpdate(updated);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateMessageTags(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;
  const { tags } = req.body;

  if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const uniqueTags = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)));
    const before = await msgRepo.findById(messageId);
    const updated = await msgRepo.update(messageId, { tags: uniqueTags });
    if (!updated) {
      return res.status(404).json({ error: 'Message not found' });
    }
    SocketService.broadcastMessageUpdate(updated);

    const prev = before?.tags || [];
    const added = uniqueTags.filter(t => !prev.includes(t));
    const removed = prev.filter(t => !uniqueTags.includes(t));
    const actor = await getActor(req);
    for (const t of added) await recordEvent(updated.conversationId, 'tags', `${actor?.name || 'A teammate'} tagged a message with ${t}`, actor, { tag: t, action: 'added' });
    for (const t of removed) await recordEvent(updated.conversationId, 'tags', `${actor?.name || 'A teammate'} removed tag ${t} from a message`, actor, { tag: t, action: 'removed' });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteMessage(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const msg = await msgRepo.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const deleted = await msgRepo.delete(messageId);
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    SocketService.broadcastMessageDeleted(messageId, msg.conversationId);

    if (msg.sender?.type !== 'system') {
      const actor = await getActor(req);
      await recordEvent(msg.conversationId, 'other',
        `${actor?.name || 'A teammate'} deleted ${msg.isInternalNote ? 'a note' : msg.sender.type === 'customer' ? "a customer's message" : 'a message'}`,
        actor, { field: 'deleted' });
    }

    // Don't let the deleted text live on in previews or unread counts
    const refreshed = await refreshConversationSnippets(msg.conversationId);
    if (refreshed) SocketService.broadcastConversationUpdate(refreshed);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function uploadFiles(req: AuthenticatedRequest, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let type: 'image' | 'pdf' | 'file' = 'file';
    
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
      type = 'image';
    } else if (ext === '.pdf') {
      type = 'pdf';
    }

    const fileUrl = `http://localhost:3000/uploads/${req.file.filename}`;
    const attachment: Attachment = {
      name: req.file.originalname,
      url: fileUrl,
      type,
      size: req.file.size
    };

    return res.json(attachment);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markSeen(req: AuthenticatedRequest, res: Response) {
  const { conversationId } = req.params;
  const { role } = req.body; // 'agent' or 'customer'

  if (!conversationId || !role) {
    return res.status(400).json({ error: 'conversationId and role are required' });
  }
  if (role === 'agent' ? !req.user : (!req.user && !(await customerOwnsConversation(req, conversationId)))) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    
    await msgRepo.markConversationSeen(conversationId, role);
    const updated = await convRepo.findById(conversationId);

    const seenAt = new Date().toISOString();
    SocketService.emitToRoom(conversationId, 'message:seen', { conversationId, seenAt, role });
    if (updated) {
      SocketService.broadcastConversationUpdate(updated);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


/**
 * POST /api/conversations/:id/rating { score: 1-5, comment? } — the customer rates a resolved
 * conversation from the Messenger (X-Customer-Id must own it). Teammates see an event and the score.
 */
export async function rateConversation(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    if (!(await customerOwnsConversation(req, id))) return res.status(404).json({ error: 'Conversation not found' });
    const score = Number(req.body?.score);
    if (![1, 2, 3, 4, 5].includes(score)) return res.status(400).json({ error: 'score must be 1 to 5' });
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!conv.csatRequestedAt) return res.status(409).json({ error: 'This conversation has no rating request' });
    const rating = { score: score as 1 | 2 | 3 | 4 | 5, ...(comment ? { comment } : {}), at: new Date().toISOString() };
    const updated = await convRepo.update(id, { rating });
    const label = ['', 'Terrible', 'Bad', 'OK', 'Great', 'Amazing'][score];
    await recordEvent(id, 'other', `${conv.customer.name} rated the conversation ${score}/5 (${label})${comment ? `: “${comment}”` : ''}`, undefined,
      { field: 'rating', score });
    if (updated) SocketService.broadcastConversationUpdate(updated);
    return res.json(toCustomerView(updated || { ...conv, rating }));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
