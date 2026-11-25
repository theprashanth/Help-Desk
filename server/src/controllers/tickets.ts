import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Conversation, Customer, Tag, SavedReply, MacroActions } from '../../../shared/src/types';
import { recordEvent, recordUpdateEvents, getActor } from '../services/events';
import { refreshSla } from '../services/sla';
import { routeNewConversation, teamsRepo, pickFromTeam } from '../services/teams';
import { companiesRepo, cleanAttributeValues } from './org';
import { logAudit } from '../services/audit';
import { outboundForReply, markOutboundReplied } from './outbound';
import { toCustomerView, isCustomerVisible, computeCustomerSnippet, plainText } from '../services/conversationView';
import { sendReplyTimeNotice } from '../services/autoReply';
import { notifyIntegrations } from '../services/notifications';
import { resolveCustomerId } from '../services/customerIdentity';
import { verifyUserHash } from '../services/messenger';
import { inBackground, translateCustomerMessage, triageConversation, draftIssueUpdate, aiFor, translateReply } from '../services/aiAssist';
import { sendAgentReply } from './messages';
import { AiError } from '../services/ai';

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
    let list = await convRepo.findFiltered({
      status,
      priority,
      assignedAgentId,
      category,
      search,
      unread,
      tag,
      kind,
      createdByAgentId,
      bot: ['handled', 'active', 'resolved'].includes(req.query.bot as string) ? req.query.bot as 'handled' | 'active' | 'resolved' : undefined,
    });
    // Team inbox view
    if (typeof req.query.team === 'string' && req.query.team) list = list.filter(c => c.teamId === req.query.team);
    // Mentions view: conversations with a note that mentions you
    if (req.query.mentions === 'me' && req.user) {
      const ids = await mentionedConversationIds(req.user.id);
      list = list.filter(c => ids.has(c.id));
    }
    // Settings › AI Agent: its view lists every chat it answered; elsewhere, chats it's still answering are hidden
    if (req.query.ai === 'all') list = list.filter(c => !!c.aiAgent);
    else if (req.query.ai === 'active') list = list.filter(c => c.aiAgent?.state === 'active');
    else list = list.filter(c => c.aiAgent?.state !== 'active');
    // Who sent each conversation's latest public message (the list shows ↩ when it was the team)
    const lastFrom = await lastPublicSenders(new Set(list.map(c => c.id)));
    list = list.map(c => (lastFrom[c.id] ? { ...c, lastMessageFrom: lastFrom[c.id] } : c));
    // Issues: how many conversations are linked to each
    if (list.some(c => c.kind === 'issue')) {
      const counts = await reportCounts();
      list = list.map(c => (c.kind === 'issue' ? { ...c, reportCount: counts[c.id] || 0 } : c));
    }

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
  const { customerId: requestedId, externalUserId, userHash, name, email, phone, priority, category, initialMessage, initialAttachments, session, messageMetadata, outboundId } = req.body;
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
    const known = await custRepo.findById(customerId);
    if (known?.blocked) return res.status(403).json({ error: "You can't send messages to this team right now.", code: 'blocked' });

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

    // Settings › AI Agent: it answers first (no teammate is assigned until it hands over)
    const { takesNew, respond: aiRespond } = await import('../services/aiAgent');
    const aiAgent = initialMessage ? await takesNew('messenger') : null;
    // Auto-assign to online agent with the fewest open/waiting tickets
    // Team inbox + assignment rule (Settings › Teams); no teams = balanced across everyone
    const route = aiAgent ? { assignedAgentId: undefined, teamId: undefined, reason: undefined } as Awaited<ReturnType<typeof routeNewConversation>> : await routeNewConversation();
    const assignedAgentId = route.assignedAgentId;

    const newConv = await convRepo.create({
      customer,
      status: 'open',
      priority: priority || 'none',
      category: category || 'general',
      unreadCountAgent: 1, // Start with 1 unread message for agents
      unreadCountCustomer: 0,
      assignedAgentId,
      ...(route.teamId ? { teamId: route.teamId } : {}),
      ...(aiAgent ? { aiAgent } : {}),
    } as any);

    // Replying to a proactive chat message: that message opens the conversation, from its sender
    const outbound = typeof requestedId === 'string' ? await outboundForReply(outboundId, requestedId) : null;
    if (outbound) {
      const opener = await msgRepo.create({
        conversationId: newConv.id,
        sender: { type: 'agent', id: outbound.senderId, name: outbound.senderName, ...(outbound.senderAvatar ? { avatar: outbound.senderAvatar } : {}) },
        content: outbound.message.body, attachments: [], isInternalNote: false, seen: true, delivered: true, reactions: [],
        metadata: { outboundId: outbound.message.id },
      });
      SocketService.broadcastMessageNew(opener);
      await recordEvent(newConv.id, 'other', `Started by replying to the proactive message “${outbound.message.name}”`, undefined, { field: 'outbound', outboundId: outbound.message.id });
      await markOutboundReplied(outbound.message.id, requestedId, newConv.id);
    }

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
        metadata: messageMetadata && typeof messageMetadata === 'object'
          ? Object.fromEntries(['platform', 'channel', 'browser', 'os', 'sourceUrl']
              .filter(k => typeof messageMetadata[k] === 'string').map(k => [k, String(messageMetadata[k]).slice(0, k === 'sourceUrl' ? 2000 : 60)]))
          : {
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
      // Tell the customer when to expect a reply (Settings > Office hours); the AI Agent answers right away instead
      if (aiAgent) {
        await recordEvent(newConv.id, 'other', 'The AI Agent is answering this conversation', undefined, { field: 'aiAgent', to: 'active' });
        const firstId = firstMessage.id;
        inBackground('ai agent', () => aiRespond(newConv.id, firstId));
      } else await sendReplyTimeNotice(newConv, req.workspaceId || 'default_workspace');
      await refreshSla(newConv.id);
      // AI (Settings › AI assistant): translate the first message, then set priority/tags
      if (initialMessage) inBackground('new conversation', async () => {
        await translateCustomerMessage(newConv.id, firstMessage.id);
        await triageConversation(newConv.id);
      });
      if (assignedAgentId) {
        const assignee = await RepositoryFactory.getUserRepository().findById(assignedAgentId);
        await recordEvent(newConv.id, 'assignment', `Auto-assigned to ${assignee?.name || 'a teammate'}${route.reason ? ` (${route.reason})` : ''}`, undefined,
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
    const body = { ...req.body };
    // Moving to a team inbox: the team must exist; null/'' takes it out of any team
    let newTeam = null as Awaited<ReturnType<typeof teamsRepo.get>>;
    if ('teamId' in body) {
      if (!body.teamId) body.teamId = undefined;
      else {
        newTeam = await teamsRepo.get(String(body.teamId));
        if (!newTeam) return res.status(400).json({ error: 'That team no longer exists' });
      }
    }
    let updated = await convRepo.update(id, body);
    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    // Unassigned and sent to a team that assigns automatically: its rule picks a teammate
    if (newTeam && before?.teamId !== newTeam.id && !updated.assignedAgentId && !('assignedAgentId' in body)) {
      const pick = await pickFromTeam(newTeam);
      if (pick) updated = (await convRepo.update(id, { assignedAgentId: pick })) || updated;
    }
    SocketService.broadcastConversationUpdate(updated);
    if (before) await recordUpdateEvents(before, updated, await getActor(req));
    // State or priority changes start, stop or move the SLA clock
    if (before && (before.status !== updated.status || before.priority !== updated.priority || before.snoozedUntil !== updated.snoozedUntil)) {
      await refreshSla(id);
    }
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
    await refreshSla(id); // assigning reopens the conversation
    
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
    const { conversationId, ...body } = req.body || {};
    // Only these fields can be changed from the dashboard
    const changes: Record<string, any> = {};
    for (const k of ['name', 'email', 'phone', 'tags', 'notes', 'blocked']) if (body[k] !== undefined) changes[k] = body[k];
    if (changes.blocked !== undefined) {
      if (typeof changes.blocked !== 'boolean') return res.status(400).json({ error: 'blocked must be true or false' });
      changes.blockedAt = changes.blocked ? new Date().toISOString() : undefined;
    }
    const beforeCustomer = await custRepo.findById(customerId);
    if (!beforeCustomer) return res.status(404).json({ error: 'Customer not found' });
    let companyName: string | null | undefined;
    if (body.companyId !== undefined) {
      if (body.companyId) {
        const company = await companiesRepo.get(String(body.companyId));
        if (!company) return res.status(400).json({ error: 'That company no longer exists' });
        changes.companyId = company.id;
        companyName = company.name;
      } else { changes.companyId = undefined; companyName = null; }
    }
    if (body.attributes !== undefined) {
      const checked = await cleanAttributeValues(body.attributes, beforeCustomer.attributes || {});
      if (checked.error) return res.status(400).json({ error: checked.error });
      changes.attributes = checked.value;
    }
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
      if (typeof changes.blocked === 'boolean' && !!beforeCustomer.blocked !== changes.blocked) {
        await recordEvent(conversationId, 'other', changes.blocked ? `${who} blocked ${beforeCustomer.name}` : `${who} unblocked ${beforeCustomer.name}`, actor, { field: 'blocked', to: changes.blocked });
      }
      if (Array.isArray(changes.notes) && changes.notes.length > (beforeCustomer.notes || []).length) {
        await recordEvent(conversationId, 'other', `${who} added a note to the customer`, actor, { field: 'notes' });
      }
      if (companyName !== undefined && (beforeCustomer.companyId || '') !== (changes.companyId || '')) {
        await recordEvent(conversationId, 'attributes', companyName ? `${who} set the customer's company to ${companyName}` : `${who} removed the customer's company`, actor, { field: 'companyId' });
      }
      if (changes.attributes) {
        const defs = (await RepositoryFactory.getWorkspaceRepository().findById(req.workspaceId || 'default_workspace'))?.customerAttributes || [];
        for (const d of defs) {
          const a = (beforeCustomer.attributes || {})[d.key], b = changes.attributes[d.key];
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            const shown = b === undefined ? '—' : typeof b === 'boolean' ? (b ? 'Yes' : 'No') : String(b);
            await recordEvent(conversationId, 'attributes', `${who} set ${d.label} to ${shown}`, actor, { field: `attr:${d.key}` });
          }
        }
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

/** Keep only well-formed macro actions; returns undefined when there are none. */
function cleanMacroActions(raw: any): MacroActions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: MacroActions = {};
  if (['open', 'waiting', 'resolved', 'closed'].includes(raw.status)) out.status = raw.status;
  if (['none', 'low', 'medium', 'high', 'critical'].includes(raw.priority)) out.priority = raw.priority;
  if (typeof raw.assignTo === 'string' && raw.assignTo.trim()) out.assignTo = raw.assignTo.trim().slice(0, 100);
  if (Array.isArray(raw.addTags)) {
    const tags = Array.from(new Set(raw.addTags.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().slice(0, 60)))).slice(0, 20) as string[];
    if (tags.length) out.addTags = tags;
  }
  const mins = Number(raw.snoozeMinutes);
  if (Number.isFinite(mins) && mins >= 1 && mins <= 60 * 24 * 90) out.snoozeMinutes = Math.round(mins);
  return Object.keys(out).length ? out : undefined;
}

export async function createSavedReply(req: AuthenticatedRequest, res: Response) {
  const { trigger, title, content, availableFor, availableWhen } = req.body;
  const actions = cleanMacroActions(req.body.actions);
  if (!trigger || !title || (!content && !actions)) {
    return res.status(400).json({ error: 'trigger, title, and a message or at least one action are required' });
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
      content: content || '',
      actions,
      availableFor: availableFor || 'everyone',
      availableWhen: availableWhen || ['starting_conversations', 'replying', 'adding_notes'],
      creator
    });
    await logAudit(req, 'macro.created', `Created the macro ${created.title}`, { target: created.trigger });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSavedReply(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const patch: Partial<SavedReply> = {};
    for (const k of ['trigger', 'title', 'content', 'availableFor', 'availableWhen'] as const) {
      if (req.body[k] !== undefined) (patch as any)[k] = req.body[k];
    }
    if ('actions' in req.body) patch.actions = cleanMacroActions(req.body.actions);
    if (patch.title === '' || patch.trigger === '') return res.status(400).json({ error: 'trigger and title are required' });
    const updated = await replyRepo.update(id, patch);
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
    const macro = (await replyRepo.findAll()).find(r => r.id === id);
    const deleted = await replyRepo.delete(id);
    if (!deleted) return res.status(404).json({ error: 'Saved reply not found' });
    await logAudit(req, 'macro.deleted', `Deleted the macro ${macro?.title || id}`, { target: macro?.trigger });
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
    if (source.mergedInto) return res.status(409).json({ error: `${source.ticketNumber} was already merged into ${source.mergedInto.ticketNumber}` });
    if (target.mergedInto) return res.status(409).json({ error: `${target.ticketNumber} was merged into ${target.mergedInto.ticketNumber}; merge into that one instead` });

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
      content: `↳ ${mergedBy} merged this conversation into ${target.ticketNumber}`,
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
      lastMessageSnippet: `[Merged into ${target.ticketNumber}]`,
      mergedInto: { id: targetId, ticketNumber: target.ticketNumber, at: new Date().toISOString(), by: req.user?.id },
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
    assignedAgentId, attributes, sharing, message, teamId
  } = req.body;
    const team = teamId ? await teamsRepo.get(String(teamId)) : null;
    if (teamId && !team) return res.status(400).json({ error: 'That team no longer exists' });

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
      priority: priority || 'none',
      category: category || 'general',
      unreadCountAgent: 0,
      unreadCountCustomer: 0,
      assignedAgentId: assignedAgentId || undefined,
      ...(team ? { teamId: team.id } : {}),
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
      if (!isNote) await convRepo.update(created.id, { unreadCountCustomer: 1, customerSnippet: plainText(String(message.content)) });
      SocketService.broadcastMessageNew(msg);
    }

    const fresh = (await convRepo.findById(created.id)) || created;
    SocketService.broadcastConversationNew(fresh);
    if (kind === 'ticket') import('../services/email').then(m => m.sendTicketUpdate(fresh, 'created')).catch(() => {});
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
      !(c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now) &&
      c.aiAgent?.state !== 'active' // the AI Agent is answering: not the team's yet
    );
    const byAgent: Record<string, number> = {};
    const byKind: Record<string, number> = { conversation: 0, ticket: 0, issue: 0 };
    const byTeam: Record<string, number> = {};
    for (const c of open) {
      if (c.assignedAgentId) byAgent[c.assignedAgentId] = (byAgent[c.assignedAgentId] || 0) + 1;
      if (c.teamId) byTeam[c.teamId] = (byTeam[c.teamId] || 0) + 1;
      byKind[c.kind || 'conversation'] = (byKind[c.kind || 'conversation'] || 0) + 1;
    }
    // Mentions: conversations mentioning you, and how many mentions arrived since you last looked
    let mentions = { unread: 0, conversationIds: [] as string[] };
    if (me) {
      const user = await RepositoryFactory.getUserRepository().findById(me);
      const mine = (await RepositoryFactory.getMessageRepository().findAll())
        .filter(m => m.isInternalNote && Array.isArray(m.metadata?.mentions) && m.metadata!.mentions.includes(me));
      mentions = {
        unread: mine.filter(m => !user?.mentionsSeenAt || m.createdAt > user.mentionsSeenAt).length,
        conversationIds: Array.from(new Set(mine.map(m => m.conversationId))),
      };
    }
    return res.json({
      mentions,
      yours: open.filter(c => me && c.assignedAgentId === me).length,
      yoursUnread: open.filter(c => me && c.assignedAgentId === me && c.unreadCountAgent > 0).length,
      createdByYou: open.filter(c => me && c.createdByAgentId === me).length,
      all: open.length,
      unassigned: open.filter(c => !c.assignedAgentId).length,
      byAgent,
      byKind,
      byTeam,
      // Chat-flow bot chats that never reached a person (they don't show in the views above)
      bot: {
        active: all.filter(c => c.bot && (c.bot.state === 'menu' || c.bot.state === 'confirm')).length,
        resolved: all.filter(c => c.bot?.state === 'done').length,
      },
      // Settings › AI Agent: chats it's answering now / resolved / handed to the team
      ai: {
        active: all.filter(c => c.aiAgent?.state === 'active').length,
        resolved: all.filter(c => c.aiAgent?.state === 'resolved').length,
        handoff: all.filter(c => c.aiAgent?.state === 'handoff').length,
      },
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


/** Conversations with a note that mentions this teammate. */
async function mentionedConversationIds(agentId: string): Promise<Set<string>> {
  const msgs = await RepositoryFactory.getMessageRepository().findAll();
  return new Set(msgs.filter(m => m.isInternalNote && Array.isArray(m.metadata?.mentions) && m.metadata!.mentions.includes(agentId)).map(m => m.conversationId));
}

const label = (c: Conversation) => {
  const n = `#${String(c.ticketNumber).replace(/^#/, '')}`;
  return c.kind === 'issue' ? `issue ${n}${c.title ? ` "${c.title}"` : ''}`
    : `${c.kind === 'ticket' ? 'ticket' : 'conversation'} ${n} (${c.customer?.name || 'customer'})`;
};

/** Turn a customer conversation into a customer ticket: same thread, now with a title and the ticket's place in the inbox. */
export async function convertToTicket(req: AuthenticatedRequest, res: Response) {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!title) return res.status(400).json({ error: 'A title is required' });
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if ((conv.kind || 'conversation') !== 'conversation') return res.status(400).json({ error: 'Only conversations can be converted to a ticket' });
    if (conv.mergedInto) return res.status(400).json({ error: 'This conversation was merged into another one' });
    // Stays shared: the customer keeps seeing their thread
    const updated = await convRepo.update(conv.id, { kind: 'ticket', title, description: description || undefined, sharing: 'shared' });
    if (!updated) return res.status(404).json({ error: 'Conversation not found' });
    SocketService.broadcastConversationUpdate(updated);
    const actor = await getActor(req);
    await recordEvent(conv.id, 'tickets', `${actor?.name || 'A teammate'} converted this conversation into a ticket`, actor,
      { field: 'kind', from: 'conversation', to: 'ticket' });
    import('../services/email').then(m => m.sendTicketUpdate(updated, 'created')).catch(() => {});
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Link a conversation or ticket to a tracker issue (issueId), or unlink it (issueId: null). */
export async function linkIssue(req: AuthenticatedRequest, res: Response) {
  const issueId: string | null = req.body?.issueId ? String(req.body.issueId) : null;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.kind === 'issue') return res.status(400).json({ error: 'An issue can\'t be linked to another issue' });
    const issue = issueId ? await convRepo.findById(issueId) : null;
    if (issueId && (!issue || issue.kind !== 'issue')) return res.status(404).json({ error: 'Issue not found' });
    if ((conv.linkedIssueId || null) === issueId) return res.json(conv);

    const previous = conv.linkedIssueId ? await convRepo.findById(conv.linkedIssueId) : null;
    const updated = await convRepo.update(conv.id, { linkedIssueId: (issueId || null) as any }, { touch: false });
    if (!updated) return res.status(404).json({ error: 'Conversation not found' });
    SocketService.broadcastConversationUpdate(updated);

    const actor = await getActor(req);
    const who = actor?.name || 'A teammate';
    const extra = (to: Conversation | null) => ({ field: 'linkedIssue', targetId: to?.id || null, targetTicket: to?.ticketNumber });
    if (previous) {
      await recordEvent(conv.id, 'tickets', `${who} unlinked this from ${label(previous)}`, actor, extra(null));
      await recordEvent(previous.id, 'tickets', `${who} unlinked ${label(conv)}`, actor, { field: 'linkedConversation', targetId: conv.id, removed: true });
    }
    if (issue) {
      await recordEvent(conv.id, 'tickets', `${who} linked this to ${label(issue)}`, actor, extra(issue));
      await recordEvent(issue.id, 'tickets', `${who} linked ${label(conv)}`, actor, { field: 'linkedConversation', targetId: conv.id });
    }
    // The issues' report counts changed
    const counts = await reportCounts();
    for (const i of [previous, issue]) if (i) SocketService.broadcastConversationUpdate({ ...i, reportCount: counts[i.id] || 0 });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** The conversations and tickets linked to an issue. */
export async function getLinkedConversations(req: AuthenticatedRequest, res: Response) {
  try {
    const list = (await RepositoryFactory.getConversationRepository().findAll())
      .filter(c => c.linkedIssueId === req.params.id)
      .map(c => ({
        id: c.id, ticketNumber: c.ticketNumber, kind: c.kind || 'conversation', title: c.title, status: c.status,
        customer: { id: c.customer.id, name: c.customer.name }, updatedAt: c.updatedAt,
      }));
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Number of conversations linked to each issue. */
async function reportCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const c of await RepositoryFactory.getConversationRepository().findAll()) {
    if (c.linkedIssueId && !c.mergedInto) counts[c.linkedIssueId] = (counts[c.linkedIssueId] || 0) + 1;
  }
  return counts;
}

/** POST /api/tickets/:id/broadcast/draft — an AI-written update for an issue's linked customers. */
export async function draftIssueBroadcast(req: AuthenticatedRequest, res: Response) {
  try { return res.json({ text: await draftIssueUpdate(req.params.id) }); }
  catch (e: any) { return res.status(e instanceof AiError ? e.status : 500).json({ error: e.message }); }
}

/**
 * POST /api/tickets/:id/broadcast { content, resolve? } — send one message to every conversation and
 * ticket linked to an issue, each in its own thread (translated when the customer writes in another
 * language and translation is on), and optionally resolve them.
 */
export async function broadcastIssueUpdate(req: AuthenticatedRequest, res: Response) {
  const content = String(req.body?.content || '').trim();
  const resolve = !!req.body?.resolve;
  if (!content) return res.status(400).json({ error: 'Write the message to send' });
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const issue = await convRepo.findById(req.params.id);
    if (!issue || issue.kind !== 'issue') return res.status(404).json({ error: 'Issue not found' });
    const targets = (await convRepo.findAll()).filter(c => c.linkedIssueId === issue.id && !c.mergedInto && c.status !== 'archived');
    if (!targets.length) return res.status(400).json({ error: 'No conversations are linked to this issue' });

    const actor = await getActor(req);
    const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
    const sender = { id: me?.id || actor?.id || 'agent', name: me?.name || actor?.name || 'Agent', ...(me?.avatar ? { avatar: me.avatar } : {}) };
    const translation = await aiFor('translation');
    let sent = 0, resolved = 0;
    const failed: { id: string; error: string }[] = [];

    for (const conv of targets) {
      try {
        let text = content;
        const metadata: Record<string, any> = { issueUpdate: issue.id };
        if (translation && conv.language) {
          try {
            const t = await translateReply(conv.id, content);
            text = t.text;
            metadata.original = { text: content, language: translation.features.teamLanguage };
          } catch { /* send it as written */ }
        }
        await sendAgentReply(conv, sender, text, metadata);
        sent++;
        if (resolve && conv.status !== 'resolved' && conv.status !== 'closed') {
          const before = (await convRepo.findById(conv.id)) || conv;
          const after = await convRepo.update(conv.id, { status: 'resolved', snoozedUntil: null });
          if (after) {
            SocketService.broadcastConversationUpdate(after);
            await recordUpdateEvents(before, after, actor);
            await refreshSla(conv.id);
            resolved++;
          }
        }
      } catch (e: any) {
        failed.push({ id: conv.id, error: e.message });
      }
    }
    const n = `${sent} linked conversation${sent === 1 ? '' : 's'}`;
    await recordEvent(issue.id, 'tickets', `${actor?.name || 'A teammate'} sent an update to ${n}${resolved ? ` and resolved ${resolved}` : ''}`, actor,
      { field: 'issueBroadcast', sent, resolved });
    return res.json({ sent, resolved, failed });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Messages that aren't someone talking: state lines, events, automatic notices, rating requests. */
const NOT_SPOKEN = new Set(['event', 'customer_event', 'csat_request', 'auto_reply', 'merged_indicator']);

/** For each conversation, whether its latest public message came from the customer or the team. */
async function lastPublicSenders(ids: Set<string>): Promise<Record<string, 'customer' | 'team'>> {
  const out: Record<string, { at: string; from: 'customer' | 'team' }> = {};
  for (const m of await RepositoryFactory.getMessageRepository().findAll()) {
    if (!ids.has(m.conversationId) || m.isInternalNote || NOT_SPOKEN.has(m.metadata?.type)) continue;
    if (m.sender.type !== 'customer' && m.sender.type !== 'agent') continue;
    const cur = out[m.conversationId];
    if (!cur || m.createdAt >= cur.at) out[m.conversationId] = { at: m.createdAt, from: m.sender.type === 'customer' ? 'customer' : 'team' };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.from]));
}
