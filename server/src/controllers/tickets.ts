import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Conversation, Customer, Tag, SavedReply } from '../../../shared/src/types';
import { recordEvent, recordUpdateEvents, getActor } from '../services/events';
import { toCustomerView, isCustomerVisible, computeCustomerSnippet } from '../services/conversationView';
import { sendReplyTimeNotice } from '../services/autoReply';
import { notifyIntegrations } from '../services/notifications';
import { resolveCustomerId } from '../services/customerIdentity';
import { verifyUserHash } from '../services/messenger';

export async function getTickets(req: AuthenticatedRequest, res: Response) {
  try {
    const status = req.query.status ? (req.query.status as string).split(',') : undefined;
    const priority = req.query.priority ? (req.query.priority as string).split(',') : undefined;
    const category = req.query.category ? (req.query.category as string).split(',') : undefined;
    const assignedAgentId = req.query.assignedAgentId !== undefined ? (req.query.assignedAgentId as string) : undefined;
    const search = req.query.search as string;
    const unread = req.query.unread === 'true';
    const tag = req.query.tag as string;
    const kind = req.query.kind ? (req.query.kind as string).split(',') : undefined;
    const createdBy = req.query.createdBy as string | undefined;
    const createdByAgentId = createdBy === 'me' ? req.user?.id : createdBy;

    const convRepo = RepositoryFactory.getConversationRepository();
    const list = await convRepo.findFiltered({
      status,
      priority,
      assignedAgentId,
      category,
      search,
      unread,
      tag,
      kind,
      createdByAgentId
    });
    
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(id);
    if (!conv) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (req.user) return res.json(conv);

    // Customer (Messenger widget): only their own conversation, never internal-only tickets
    if (req.headers['x-customer-id'] !== conv.customer.id || !isCustomerVisible(conv)) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (conv.customerSnippet === undefined) {
      conv.customerSnippet = await computeCustomerSnippet(conv.id);
    }
    return res.json(toCustomerView(conv));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTicket(req: AuthenticatedRequest, res: Response) {
  const { customerId: requestedId, externalUserId, userHash, name, email, phone, priority, category, initialMessage, initialAttachments, session, messageMetadata } = req.body;
  // Files the customer attached to their first message (uploaded first via /api/attachments/upload)
  const firstAttachments = Array.isArray(initialAttachments)
    ? initialAttachments
        .filter((a: any) => a && typeof a.url === 'string' && /^https?:\/\//.test(a.url) && typeof a.name === 'string')
        .slice(0, 10)
        .map((a: any) => ({ name: String(a.name).slice(0, 200), url: a.url, type: ['image', 'pdf', 'file'].includes(a.type) ? a.type : 'file', size: Number(a.size) || 0 }))
    : [];

  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();

    // Identity verification: a logged-in user's id must be signed by your server (user_hash) when enforced
    if (typeof externalUserId === 'string' && externalUserId.trim()) {
      const ws = await RepositoryFactory.getWorkspaceRepository().findById(req.workspaceId || 'default_workspace');
      if (ws?.identityEnforced && !verifyUserHash(ws.identitySecret, externalUserId.trim(), userHash)) {
        return res.status(401).json({ error: 'Identity verification failed: user_hash is missing or wrong', code: 'identity_verification_failed' });
      }
    }

    // Every new customer gets a UUID User id (logged-in users keep their own id as externalId).
    // The response's conversation.customer.id tells the Messenger which id to use from now on.
    const { id: customerId, externalId } = await resolveCustomerId(requestedId, externalUserId);

    const customer = await custRepo.findOrCreate(customerId, {
      externalId,
      name: name || `Guest #${customerId.slice(-4)}`,
      email: email || '',
      phone: phone || '',
      session: session || { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), totalConversations: 1 },
      tags: [],
      notes: []
    });

    // Update customer session total conversations count
    const totalConvs = (customer.session.totalConversations || 0) + 1;
    await custRepo.update(customerId, {
      session: {
        ...customer.session,
        ...(session || {}),
        totalConversations: totalConvs,
        lastSeen: new Date().toISOString()
      }
    });

    // Auto-assign to online agent with the fewest open/waiting tickets
    let assignedAgentId = undefined;
    const onlineAgentIds = Array.from(SocketService.onlineAgents.keys());
    if (onlineAgentIds.length > 0) {
      // Get all open/waiting conversations to balance load
      const openConvs = await convRepo.findFiltered({ status: ['open', 'waiting'] });
      const openTicketCounts: Record<string, number> = {};
      onlineAgentIds.forEach(id => {
        openTicketCounts[id] = 0;
      });
      openConvs.forEach(c => {
        if (c.assignedAgentId && openTicketCounts[c.assignedAgentId] !== undefined) {
          openTicketCounts[c.assignedAgentId]++;
        }
      });
      
      // Find the agent with the minimum load
      let minCount = Infinity;
      let targetAgentId = onlineAgentIds[0];
      onlineAgentIds.forEach(id => {
        if (openTicketCounts[id] < minCount) {
          minCount = openTicketCounts[id];
          targetAgentId = id;
        }
      });
      assignedAgentId = targetAgentId;
      console.log(`[AutoAssign] Automatically assigned new ticket to online agent: ${targetAgentId} (current load: ${minCount} tickets)`);
    }

    const newConv = await convRepo.create({
      customer,
      status: 'open',
      priority: priority || 'medium',
      category: category || 'general',
      unreadCountAgent: 1, // Start with 1 unread message for agents
      unreadCountCustomer: 0,
      assignedAgentId
    });

    // Save initial message if provided (text and/or attachments)
    if (initialMessage || firstAttachments.length) {
      const firstMessage = await msgRepo.create({
        conversationId: newConv.id,
        sender: {
          type: 'customer',
          id: customer.id,
          name: customer.name
        },
        content: initialMessage || '',
        attachments: firstAttachments,
        isInternalNote: false,
        seen: false,
        delivered: true,
        // Device the customer wrote from (sent by the widget); fall back to the session info
        metadata: messageMetadata || {
          platform: /ios|ipad|iphone/i.test(session?.os || '') ? 'ios' : /android/i.test(session?.os || '') ? 'android' : 'web',
          sourceUrl: session?.currentPage,
          browser: session?.browser,
          os: session?.os
        }
      });
      // Retrieve updated conversation with correct last message snippet
      const updatedConv = await convRepo.findById(newConv.id);
      // Slack / webhook integrations: a customer started a new conversation
      notifyIntegrations(req.workspaceId || 'default_workspace', 'conversation.created', { conversation: updatedConv || newConv, message: firstMessage });
      // Tell the customer when to expect a reply (Settings > Office hours)
      await sendReplyTimeNotice(newConv, req.workspaceId || 'default_workspace');
      if (assignedAgentId) {
        const assignee = await RepositoryFactory.getUserRepository().findById(assignedAgentId);
        await recordEvent(newConv.id, 'assignment', `Auto-assigned to ${assignee?.name || 'a teammate'}`, undefined,
          { targetId: assignedAgentId, targetName: assignee?.name, auto: true });
      }
      if (updatedConv) {
        SocketService.broadcastConversationNew(updatedConv);
        return res.status(210).json(updatedConv);
      }
    }

    SocketService.broadcastConversationNew(newConv);
    notifyIntegrations(req.workspaceId || 'default_workspace', 'conversation.created', { conversation: newConv });
    return res.status(201).json(newConv);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const before = await convRepo.findById(id);
    const updated = await convRepo.update(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    SocketService.broadcastConversationUpdate(updated);
    if (before) await recordUpdateEvents(before, updated, await getActor(req));
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function assignTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { agentId } = req.body;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const userRepo = RepositoryFactory.getUserRepository();
    
    let agentName = undefined;
    if (agentId) {
      const agent = await userRepo.findById(agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Support Agent not found' });
      }
      agentName = agent.name;
    }

    const updated = await convRepo.update(id, { 
      assignedAgentId: agentId || undefined,
      status: 'open' // re-open if closed or change state
    });

    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    SocketService.broadcastConversationUpdate(updated);
    SocketService.emitGlobal('conversation:assigned', { conversationId: id, agentId, agentName });

    const actor = await getActor(req);
    const who = actor?.name || 'System';
    const text = !agentId
      ? `${who} unassigned this conversation`
      : actor && actor.id === agentId
        ? `${who} assigned themselves`
        : `${who} assigned ${agentName}`;
    await recordEvent(id, 'assignment', text, actor, { targetId: agentId || null, targetName: agentName });
    
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateCustomerProfile(req: AuthenticatedRequest, res: Response) {
  const { customerId } = req.params;
  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    
    // conversationId (optional) = the conversation the change was made from, for its event log
    const { conversationId, ...changes } = req.body || {};
    const beforeCustomer = await custRepo.findById(customerId);
    const updatedCustomer = await custRepo.update(customerId, changes);
    if (!updatedCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (conversationId && beforeCustomer) {
      const actor = await getActor(req);
      const who = actor?.name || 'A teammate';
      for (const field of ['name', 'email', 'phone'] as const) {
        if (changes[field] !== undefined && (beforeCustomer as any)[field] !== changes[field]) {
          const label = field === 'name' ? 'Name' : field === 'email' ? 'Email' : 'Phone';
          await recordEvent(conversationId, 'attributes', `${who} set the customer's ${label} to ${changes[field] || '—'}`, actor, { field });
        }
      }
      if (Array.isArray(changes.tags)) {
        const prev = beforeCustomer.tags || [];
        for (const t of changes.tags.filter((t: string) => !prev.includes(t))) {
          await recordEvent(conversationId, 'tags', `${who} tagged the customer ${t}`, actor, { tag: t, action: 'added', scope: 'customer' });
        }
        for (const t of prev.filter(t => !changes.tags.includes(t))) {
          await recordEvent(conversationId, 'tags', `${who} removed tag ${t} from the customer`, actor, { tag: t, action: 'removed', scope: 'customer' });
        }
      }
      if (Array.isArray(changes.notes) && changes.notes.length > (beforeCustomer.notes || []).length) {
        await recordEvent(conversationId, 'other', `${who} added a note to the customer`, actor, { field: 'notes' });
      }
    }

    // Refresh all tickets associated with this customer
    const allConvs = await convRepo.findAll();
    const customerConvs = allConvs.filter(c => c.customer.id === customerId);
    
    for (const c of customerConvs) {
      const updatedConv = { ...c, customer: updatedCustomer };
      SocketService.broadcastConversationUpdate(updatedConv);
    }

    return res.json(updatedCustomer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Saved Replies CRUD
export async function getSavedReplies(req: AuthenticatedRequest, res: Response) {
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const replies = await replyRepo.findAll();
    return res.json(replies);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createSavedReply(req: AuthenticatedRequest, res: Response) {
  const { trigger, title, content, availableFor, availableWhen } = req.body;
  if (!trigger || !title || !content) {
    return res.status(400).json({ error: 'trigger, title, and content are required' });
  }
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agentDoc = req.user ? await userRepo.findById(req.user.id) : null;
    const creator = agentDoc ? {
      id: agentDoc.id,
      name: agentDoc.name,
      avatar: agentDoc.avatar
    } : undefined;

    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const created = await replyRepo.create({
      trigger,
      title,
      content,
      availableFor: availableFor || 'everyone',
      availableWhen: availableWhen || ['starting_conversations', 'replying', 'adding_notes'],
      creator
    });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSavedReply(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const updated = await replyRepo.update(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Saved reply not found' });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteSavedReply(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const deleted = await replyRepo.delete(id);
    if (!deleted) return res.status(404).json({ error: 'Saved reply not found' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Tags CRUD
export async function getTags(req: AuthenticatedRequest, res: Response) {
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const tags = await tagRepo.findAll();
    return res.json(tags);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTag(req: AuthenticatedRequest, res: Response) {
  const { name, color } = req.body;
  if (!name || !color) {
    return res.status(400).json({ error: 'name and color are required' });
  }
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const existing = await tagRepo.findByName(name);
    if (existing) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    const created = await tagRepo.create({ name, color });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteTag(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const deleted = await tagRepo.delete(id);
    if (!deleted) return res.status(404).json({ error: 'Tag not found' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Get all conversations for a specific customer (for Recent Conversations panel)
export async function getCustomerTickets(req: AuthenticatedRequest, res: Response) {
  const { customerId } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const all = await convRepo.findAll();
    const customerConvs = all
      .filter(c => c.customer.id === customerId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20); // cap at 20 most recent
    return res.json(customerConvs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Merge sourceId ticket into targetId: move all messages from source into target, then close source
export async function mergeTickets(req: AuthenticatedRequest, res: Response) {
  const { id: targetId } = req.params;
  const { sourceId } = req.body;

  if (!sourceId || !targetId) {
    return res.status(400).json({ error: 'sourceId and targetId are required' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ error: 'Cannot merge a ticket with itself' });
  }

  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();

    const target = await convRepo.findById(targetId);
    const source = await convRepo.findById(sourceId);
    if (!target) return res.status(404).json({ error: 'Target ticket not found' });
    if (!source) return res.status(404).json({ error: 'Source ticket not found' });

    // Build smart summaries for the merge event card
    const summaryBullets: string[] = [];
    let question = '';

    const sourceMessages = await msgRepo.findByConversationId(sourceId, 200, 0);
    const customerMsgs = sourceMessages.filter(m => m.sender.type === 'customer' || (m.sender as any).type === 'customer');
    if (customerMsgs.length > 0) {
      question = customerMsgs[0].content;
    } else {
      question = source.lastMessageSnippet || 'No initial question provided.';
    }

    // Generate clear, dynamic bullet summaries from source conversation
    for (const msg of sourceMessages) {
      const text = msg.content.toLowerCase();
      const isCustomer = msg.sender.type === 'customer' || (msg.sender as any).type === 'customer';
      if (isCustomer) {
        if (text.includes('hi') || text.includes('hello')) {
          // Extract brand name from subsequent agent replies if available
          const agentReply = sourceMessages.find(m => m.sender.type === 'agent' && m.content.includes('reply as soon as they can'));
          let brand = 'the team';
          if (agentReply) {
            const match = agentReply.content.match(/(.+?) will reply/i);
            if (match) brand = match[1];
          }
          summaryBullets.push(`User greeted and was informed ${brand} would reply soon.`);
        } else if (text.includes('test')) {
          summaryBullets.push('User stated they were just testing.');
        } else {
          const excerpt = msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content;
          summaryBullets.push(`User stated: "${excerpt}"`);
        }
      } else {
        if (text.includes('reply as soon as they can')) {
          const match = msg.content.match(/(.+?) will reply/i);
          const brand = match ? match[1] : 'the team';
          summaryBullets.push(`User greeted and was informed ${brand} would reply soon.`);
        } else if (text.includes('way to reach you')) {
          summaryBullets.push('Teammate requested contact information for follow-up.');
        } else if (text.includes('assistance for feedback') || text.includes('help')) {
          summaryBullets.push('Teammate offered assistance for feedback, issues, or questions.');
        } else {
          const excerpt = msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content;
          summaryBullets.push(`Teammate: "${excerpt}"`);
        }
      }
    }

    // Deduplicate summaries and limit to max 5 bullets
    const uniqueBullets = Array.from(new Set(summaryBullets)).slice(0, 5);

    const mergedBy = req.user ? (req.user as any).name || 'Agent' : 'Agent';
    const customerLocation = source.customer.session?.country || 'Hyderabad - India';

    // Add a system note to the target conversation about the merge
    await msgRepo.create({
      conversationId: targetId,
      sender: {
        type: 'agent',
        id: req.user?.id || 'system',
        name: mergedBy
      },
      content: `🔀 Merged ticket **${source.ticketNumber}** into this conversation.`,
      isInternalNote: true,
      seen: false,
      delivered: true,
      metadata: {
        type: 'merge',
        mergeDetails: {
          sourceTicketNumber: source.ticketNumber,
          sourceConversationId: sourceId,
          customerName: source.customer.name,
          customerLocation: customerLocation,
          mergedBy: mergedBy,
          question: question,
          summary: uniqueBullets
        }
      }
    });

    // Add an indicator system message to the source conversation that it has been merged
    await msgRepo.create({
      conversationId: sourceId,
      sender: {
        type: 'agent',
        id: req.user?.id || 'system',
        name: mergedBy
      },
      content: `↳ ${mergedBy} merged this conversation into #${target.ticketNumber}`,
      isInternalNote: false,
      seen: true,
      delivered: true,
      metadata: {
        type: 'merged_indicator',
        mergedIntoTicketNumber: target.ticketNumber,
        mergedIntoConversationId: targetId
      }
    });

    // Update the source conversation status to 'closed' instead of deleting it
    const updatedSource = await convRepo.update(sourceId, {
      status: 'closed',
      lastMessageSnippet: `[Merged into ${target.ticketNumber}]`
    });

    // Broadcast update events for both conversations
    if (updatedSource) SocketService.broadcastConversationUpdate(updatedSource);
    const updatedTarget = await convRepo.findById(targetId);
    if (updatedTarget) SocketService.broadcastConversationUpdate(updatedTarget);

    return res.json({ success: true, target: updatedTarget, closedSource: updatedSource });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


/**
 * Manually create a conversation, customer ticket or tracker issue from the dashboard.
 * Body: { kind, customer?: { id } | { externalId, name?, email? }, title?, description?, category?,
 *         priority?, assignedAgentId?, attributes?, sharing?, message?: { content, isInternalNote } }
 */
export async function createManualTicket(req: AuthenticatedRequest, res: Response) {
  const {
    kind = 'conversation', customer: customerRef, title, description, category, priority,
    assignedAgentId, attributes, sharing, message
  } = req.body;

  if (!['conversation', 'ticket', 'issue'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be conversation, ticket or issue' });
  }
  if (kind !== 'issue' && !customerRef) {
    return res.status(400).json({ error: 'A customer is required' });
  }
  if (kind !== 'conversation' && !String(title || '').trim()) {
    return res.status(400).json({ error: 'A title is required' });
  }
  if (kind === 'conversation' && !String(message?.content || '').trim()) {
    return res.status(400).json({ error: 'A first message is required' });
  }

  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();
    const actor = await getActor(req);
    const now = new Date().toISOString();

    // Resolve the customer: an existing record, a user ID from your own database, or (issues) none
    let customer: Customer | null = null;
    if (customerRef?.id) {
      customer = await custRepo.findById(customerRef.id);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
    } else if (customerRef?.externalId) {
      const externalId = String(customerRef.externalId).trim();
      const resolved = await resolveCustomerId(undefined, externalId);
      customer = await custRepo.findOrCreate(resolved.id, {
        externalId,
        name: customerRef.name || `User ${externalId}`,
        email: customerRef.email || '',
        phone: '',
        session: { firstSeen: now, lastSeen: now, totalConversations: 0 },
        tags: [],
        notes: []
      });
    } else {
      // Tracker issues don't need a customer; attach them to an internal placeholder record
      customer = await custRepo.findOrCreate(INTERNAL_CUSTOMER_ID, {
        name: 'Internal',
        email: '',
        phone: '',
        session: { firstSeen: now, lastSeen: now, totalConversations: 0 },
        tags: [],
        notes: []
      });
    }

    const created = await convRepo.create({
      customer: customer!,
      status: 'open',
      priority: priority || 'medium',
      category: category || 'general',
      unreadCountAgent: 0,
      unreadCountCustomer: 0,
      assignedAgentId: assignedAgentId || undefined,
      kind,
      title: title ? String(title).trim() : undefined,
      description: description || undefined,
      createdByAgentId: actor?.id,
      attributes: attributes || {},
      sharing: kind === 'issue' ? 'internal' : (sharing || 'shared'),
      lastMessageSnippet: title ? String(title).trim() : '',
      customerSnippet: kind === 'ticket' && (sharing || 'shared') === 'shared' && title ? String(title).trim() : ''
    } as any);

    const label = kind === 'ticket' ? 'ticket' : kind === 'issue' ? 'issue' : 'conversation';
    await recordEvent(created.id, 'tickets', `${actor?.name || 'A teammate'} created this ${label}`, actor, { field: 'created', kind });
    if (assignedAgentId) {
      const assignee = await RepositoryFactory.getUserRepository().findById(assignedAgentId);
      await recordEvent(created.id, 'assignment',
        actor && actor.id === assignedAgentId ? `${actor.name} assigned themselves` : `${actor?.name || 'A teammate'} assigned ${assignee?.name || 'a teammate'}`,
        actor, { targetId: assignedAgentId, targetName: assignee?.name });
    }

    // Optional first message: a reply to the customer, or an internal note
    if (message && String(message.content || '').trim()) {
      const isNote = !!message.isInternalNote || kind === 'issue';
      const msg = await msgRepo.create({
        conversationId: created.id,
        sender: { type: 'agent', id: actor?.id || 'agent', name: actor?.name || 'Agent' },
        content: String(message.content),
        attachments: [],
        isInternalNote: isNote,
        seen: false,
        delivered: true,
        reactions: []
      });
      if (!isNote) await convRepo.update(created.id, { unreadCountCustomer: 1, customerSnippet: String(message.content) });
      SocketService.broadcastMessageNew(msg);
    }

    const fresh = (await convRepo.findById(created.id)) || created;
    SocketService.broadcastConversationNew(fresh);
    return res.status(201).json(fresh);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Placeholder customer record that tracker issues without a customer are attached to. */
export const INTERNAL_CUSTOMER_ID = 'internal';

/** Counts of open (not snoozed) conversations for each inbox view. */
export async function getInboxCounts(req: AuthenticatedRequest, res: Response) {
  try {
    const me = req.user?.id;
    const now = Date.now();
    const all = await RepositoryFactory.getConversationRepository().findAll();
    const open = all.filter(c =>
      (c.status === 'open' || c.status === 'waiting') &&
      !(c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now)
    );
    const byAgent: Record<string, number> = {};
    const byKind: Record<string, number> = { conversation: 0, ticket: 0, issue: 0 };
    for (const c of open) {
      if (c.assignedAgentId) byAgent[c.assignedAgentId] = (byAgent[c.assignedAgentId] || 0) + 1;
      byKind[c.kind || 'conversation'] = (byKind[c.kind || 'conversation'] || 0) + 1;
    }
    return res.json({
      yours: open.filter(c => me && c.assignedAgentId === me).length,
      yoursUnread: open.filter(c => me && c.assignedAgentId === me && c.unreadCountAgent > 0).length,
      createdByYou: open.filter(c => me && c.createdByAgentId === me).length,
      all: open.length,
      unassigned: open.filter(c => !c.assignedAgentId).length,
      byAgent,
      byKind
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Search customers (by name, email or user ID) for the "Add customer" picker. */
export async function searchCustomers(req: AuthenticatedRequest, res: Response) {
  try {
    const q = String(req.query.search || '').trim().toLowerCase();
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 50);
    const list = (await RepositoryFactory.getCustomerRepository().findAll())
      .filter(c => c.id !== INTERNAL_CUSTOMER_ID)
      .filter(c => !q ||
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.externalId || '').toLowerCase().includes(q))
      .slice(0, limit)
      .map(c => ({ id: c.id, externalId: c.externalId, name: c.name, email: c.email, phone: c.phone }));
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
