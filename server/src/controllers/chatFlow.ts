import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { recordEvent } from '../services/events';
import { refreshSla } from '../services/sla';
import { notifyIntegrations } from '../services/notifications';
import { sendReplyTimeNotice } from '../services/autoReply';
import { resolveCustomerId } from '../services/customerIdentity';
import { verifyUserHash } from '../services/messenger';
import { toCustomerView } from '../services/conversationView';
import {
  chatFlowSettingsOf, defaultChatFlow, validateChatFlow, liveChatFlow, optionsAt, findOption, hasOptionActions, fillName, validPhone, validEmail,
} from '../services/chatFlow';
import { ChatFlow, ChatFlowOptionActions, Conversation, ConversationBotState, Message } from '../../../shared/src/types';
import { teamsRepo, pickFromTeam } from '../services/teams';
import { logAudit } from '../services/audit';
import { inBackground, afterBotHandoff } from '../services/aiAssist';

const wsIdOf = (req: AuthenticatedRequest) => req.workspaceId || req.user?.workspaceId || 'default_workspace';
const isAdmin = (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Only admins can change the chat flow' }); return false; }
  return true;
};

// ── Settings (dashboard) ────────────────────────────────────────────────────

/** GET /api/chat-flow — draft + live version (any teammate can view). */
export async function getChatFlow(req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  return res.json(chatFlowSettingsOf(ws));
}

/** PUT /api/chat-flow { draft } — save edits (not live until published). */
export async function saveChatFlowDraft(req: AuthenticatedRequest, res: Response) {
  if (!isAdmin(req, res)) return;
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  let draft: ChatFlow;
  try { draft = validateChatFlow(req.body?.draft); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  const current = chatFlowSettingsOf(ws);
  const next = { ...current, draft, updatedAt: new Date().toISOString() };
  await repo.update(ws.id, { chatFlow: next });
  return res.json(next);
}

/** POST /api/chat-flow/publish — make the draft live in the Messenger. */
export async function publishChatFlow(req: AuthenticatedRequest, res: Response) {
  if (!isAdmin(req, res)) return;
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const current = chatFlowSettingsOf(ws);
  let live: ChatFlow;
  try { live = validateChatFlow(current.draft); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  const now = new Date().toISOString();
  const next = { ...current, draft: live, published: live, version: (current.version || 0) + 1, publishedAt: now, updatedAt: now };
  await repo.update(ws.id, { chatFlow: next });
  try { SocketService.getIO().emit('chatflow:updated', { workspaceId: ws.id, version: next.version }); } catch { /* sockets not ready */ }
  await logAudit(req, 'settings.chat_flow', `Published chat flow version ${next.version}`);
  return res.json(next);
}

/** POST /api/chat-flow/discard — throw away draft edits (back to the live version, or the starting template). */
export async function discardChatFlowDraft(req: AuthenticatedRequest, res: Response) {
  if (!isAdmin(req, res)) return;
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const current = chatFlowSettingsOf(ws);
  const next = { ...current, draft: current.published || defaultChatFlow(), updatedAt: new Date().toISOString() };
  await repo.update(ws.id, { chatFlow: next });
  return res.json(next);
}

// ── Messenger (public) ──────────────────────────────────────────────────────

const BOT = (flow: ChatFlow) => ({ type: 'agent' as const, id: 'bot', name: flow.botName });

async function say(conversationId: string, flow: ChatFlow, content: string, broadcast: boolean): Promise<Message> {
  const msg = await RepositoryFactory.getMessageRepository().create({
    conversationId, sender: BOT(flow), content, attachments: [], isInternalNote: false,
    seen: false, delivered: true, reactions: [], metadata: { type: 'bot' },
  });
  if (broadcast) SocketService.broadcastMessageNew(msg);
  return msg;
}

async function customerSays(conv: Conversation, content: string, broadcast: boolean, extra: Record<string, any> = {}): Promise<Message> {
  const msg = await RepositoryFactory.getMessageRepository().create({
    conversationId: conv.id, sender: { type: 'customer', id: conv.customer.id, name: conv.customer.name }, content,
    attachments: [], isInternalNote: false, seen: true, delivered: true, reactions: [], metadata: { type: 'bot_choice', ...extra },
  });
  if (broadcast) SocketService.broadcastMessageNew(msg);
  return msg;
}

/**
 * POST /api/chat-flow/start — the visitor finished the details form.
 * Body: { customerId?, externalUserId?, userHash?, answers: { [questionId]: string | null }, session?, messageMetadata? }
 * Creates the customer + a bot-handled conversation with the transcript so far, ending at the main menu.
 */
export async function startChatFlow(req: AuthenticatedRequest, res: Response) {
  try {
    const wsId = wsIdOf(req);
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsId);
    const live = liveChatFlow(ws);
    if (!ws || !live) return res.status(409).json({ error: 'The chat flow is turned off' });
    const { flow, version } = live;
    const { customerId: requestedId, externalUserId, userHash, session } = req.body || {};
    const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : {};

    const ident = await import('../services/customerIdentity');
    const identityCheck = ident.checkIdentity(ws, externalUserId, userHash);
    if (identityCheck === 'rejected') {
      return res.status(401).json({ error: 'Identity verification failed', code: 'identity_verification_failed' });
    }

    // Details the visitor doesn't have to type: what your app passed (ChaiShotsSettings name/email/phone,
    // sent as `known`) and, for verified signed-in users, what your user database has. The Messenger skips
    // those questions, so they're accepted as given (your app's format, e.g. a phone without +country code)
    // and aren't shown in the transcript as if the visitor had typed them.
    const knownRaw = (req.body?.known && typeof req.body.known === 'object') ? req.body.known : {};
    const directory = identityCheck === 'verified' && flow.askDetails
      ? await ident.trustedProfile(ws, externalUserId, identityCheck, {})
      : { fromDirectory: false } as { name?: unknown; email?: unknown; phone?: unknown; fromDirectory: boolean };
    const knownValue = (type: string): string => {
      const fromApp = knownRaw[type];
      if (typeof fromApp === 'string' && fromApp.trim()) return fromApp.trim().slice(0, 200);
      const fromDb = directory.fromDirectory ? (directory as any)[type] : undefined;
      return typeof fromDb === 'string' && fromDb.trim() ? fromDb.trim().slice(0, 200) : '';
    };

    // Validate every answer against the live questions
    const given: { label: string; value: string | null }[] = [];
    const profile: { name?: string; phone?: string; email?: string } = {};
    if (flow.askDetails) {
      for (const q of flow.questions) {
        const raw = answers[q.id];
        let value = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
        let alreadyKnown = false;
        if (!value && (q.type === 'name' || q.type === 'email' || q.type === 'phone')) {
          value = knownValue(q.type);
          alreadyKnown = !!value;
        }
        if (!value) {
          if (q.required) return res.status(400).json({ error: `"${q.label}" is required`, questionId: q.id });
          given.push({ label: q.label, value: null });
          continue;
        }
        if (!alreadyKnown) {
          if (q.type === 'phone' && !validPhone(value)) return res.status(400).json({ error: 'Enter a valid mobile number with country code', questionId: q.id });
          if (q.type === 'email' && !validEmail(value)) return res.status(400).json({ error: 'Enter a valid email address', questionId: q.id });
        }
        if (q.type === 'name') profile.name = value;
        if (q.type === 'phone') profile.phone = value.replace(/[\s()-]/g, '');
        if (q.type === 'email') profile.email = value.toLowerCase();
        if (!alreadyKnown) given.push({ label: q.label, value: q.type === 'phone' ? value.replace(/[\s()-]/g, '') : value });
      }
    }

    const custRepo = RepositoryFactory.getCustomerRepository();
    const { id: customerId, externalId } = await resolveCustomerId(requestedId, externalUserId);
    if ((await custRepo.findById(customerId))?.blocked) return res.status(403).json({ error: "You can't send messages to this team right now.", code: 'blocked' });
    const now = new Date().toISOString();
    const existing = await custRepo.findOrCreate(customerId, {
      externalId,
      name: profile.name || `Guest #${customerId.slice(-4)}`,
      email: profile.email || '', phone: profile.phone || '',
      session: session || { firstSeen: now, lastSeen: now, totalConversations: 0 },
      tags: [], notes: [],
    });
    let customer = await custRepo.update(customerId, {
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.phone ? { phone: profile.phone } : {}),
      session: { ...existing.session, ...(session || {}), totalConversations: (existing.session?.totalConversations || 0) + 1, lastSeen: now },
    }) || existing;
    // A verified signed-in user: details from your user database (Settings › Security) win
    if (externalId) {
      customer = await ident.syncProfile(customer, await ident.trustedProfile(ws, externalUserId, identityCheck, profile));
    }

    const bot: ConversationBotState = { state: 'menu', node: null, path: [], version };
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.create({
      customer, status: 'resolved', priority: 'none', category: 'general',
      unreadCountAgent: 0, unreadCountCustomer: 0, bot,
    });

    // Transcript: welcome, each question + answer, then the main menu
    await say(conv.id, flow, flow.welcome, false);
    for (const g of given) {
      await say(conv.id, flow, g.label, false);
      await customerSays(conv, g.value ?? 'Skipped', false, { field: true });
    }
    await say(conv.id, flow, fillName(flow.menuPrompt, customer.name !== `Guest #${customerId.slice(-4)}` ? customer.name : ''), false);
    await recordEvent(conv.id, 'status', `${flow.botName} (chat flow) started this conversation`, undefined, { bot: true });

    const fresh = (await convRepo.findById(conv.id)) || conv;
    SocketService.broadcastConversationNew(fresh);
    return res.status(201).json(toCustomerView(fresh));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/chat-flow/action — a button tap in the flow.
 * Body: { conversationId, action: 'choose' | 'yes' | 'no' | 'back' | 'restart', optionId? }
 * The customer must own the conversation (X-Customer-Id). The server writes both sides of the exchange.
 */
const PRIORITY_NAMES: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Urgent' };

/**
 * What a tapped button does besides its message (Settings › Chat flow › an option's "Also, when tapped"):
 * make the chat a ticket, set its priority, add tags, send it to a team. Returns the conversation changes;
 * each one is recorded in the conversation as done by the bot.
 */
async function applyOptionActions(conv: Conversation, acts: ChatFlowOptionActions, path: string[], botName: string): Promise<Partial<Conversation>> {
  const patch: Partial<Conversation> = {};
  const by = `${botName} (chat flow)`;
  if (acts.createTicket && (conv.kind || 'conversation') === 'conversation' && !conv.mergedInto) {
    patch.kind = 'ticket';
    patch.title = path.join(' › ').slice(0, 200) || 'Ticket';
    patch.sharing = 'shared';
    await recordEvent(conv.id, 'tickets', `${by} turned this into a ticket: ${patch.title}`, undefined, { bot: true, field: 'kind', from: 'conversation', to: 'ticket' });
  }
  if (acts.priority && acts.priority !== 'none' && acts.priority !== conv.priority) {
    patch.priority = acts.priority;
    await recordEvent(conv.id, 'priority', `${by} set the priority to ${PRIORITY_NAMES[acts.priority] || acts.priority}`, undefined, { bot: true, field: 'priority', from: conv.priority, to: acts.priority });
  }
  if (acts.tags?.length) {
    const added = acts.tags.filter(t => !(conv.tags || []).includes(t));
    if (added.length) {
      patch.tags = [...(conv.tags || []), ...added];
      await recordEvent(conv.id, 'tags', `${by} added ${added.length === 1 ? 'tag' : 'tags'} ${added.join(', ')}`, undefined, { bot: true, field: 'tags', added });
    }
  }
  if (acts.teamId) {
    const team = await teamsRepo.get(acts.teamId);
    if (team && team.id !== conv.teamId) {
      patch.teamId = team.id;
      const who = conv.assignedAgentId || acts.assigneeId ? undefined : await pickFromTeam(team);
      if (who) patch.assignedAgentId = who;
      await recordEvent(conv.id, 'assignment', `${by} sent this to the ${team.name} team`, undefined, { bot: true, field: 'teamId', from: conv.teamId || null, to: team.id });
    }
  }
  if (acts.assigneeId && acts.assigneeId !== conv.assignedAgentId) {
    // A teammate who was removed, or a Light seat (can't reply), is skipped: the chat stays with the team
    const agent = await RepositoryFactory.getUserRepository().findById(acts.assigneeId);
    if (agent && agent.role !== 'light') {
      patch.assignedAgentId = agent.id;
      await recordEvent(conv.id, 'assignment', `${by} assigned this to ${agent.name}`, undefined, { bot: true, field: 'assignedAgentId', from: conv.assignedAgentId || null, to: agent.id });
    }
  }
  return patch;
}

// One tap at a time per conversation: two quick taps (or two tabs) can't both act on the same position
const conversationQueues = new Map<string, Promise<unknown>>();
export function chatFlowAction(req: AuthenticatedRequest, res: Response) {
  const key = typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';
  const prev = conversationQueues.get(key) || Promise.resolve();
  const run = prev.then(() => runChatFlowAction(req, res));
  const tail = run.catch(() => {});
  conversationQueues.set(key, tail);
  tail.then(() => { if (conversationQueues.get(key) === tail) conversationQueues.delete(key); });
  return run;
}

async function runChatFlowAction(req: AuthenticatedRequest, res: Response) {
  try {
    const { conversationId, action, optionId } = req.body || {};
    if (typeof conversationId !== 'string') return res.status(400).json({ error: 'conversationId is required' });
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(conversationId);
    if (!conv || req.headers['x-customer-id'] !== conv.customer.id) return res.status(404).json({ error: 'Conversation not found' });
    if (!conv.bot) return res.status(409).json({ error: 'This conversation isn\'t handled by the chat flow' });
    if (conv.bot.state === 'handoff') return res.status(409).json({ error: 'You\'re already connected to our team' });

    const wsId = wsIdOf(req);
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsId);
    const live = liveChatFlow(ws);
    if (!live) return res.status(409).json({ error: 'The chat flow is turned off' });
    const { flow } = live;
    let bot: ConversationBotState = { ...conv.bot };
    let convUpdate: Partial<Conversation> = {};
    let handedOff = false;

    // Hand the conversation to the team: it opens in the Inbox and the visitor can type
    const handOff = async (customerText: string, botText: string, why: string) => {
      await customerSays(conv, customerText, true, { handoff: true });
      await say(conv.id, flow, botText, true);
      bot = { ...bot, state: 'handoff' };
      convUpdate = { status: 'open', unreadCountAgent: (conv.unreadCountAgent || 0) + 1, assignedAgentId: conv.assignedAgentId };
      handedOff = true;
      await recordEvent(conv.id, 'status', `${why}: ${bot.path.join(' › ') || 'chat flow'}`, undefined,
        { bot: true, field: 'status', from: conv.status, to: 'open' });
    };

    const toMenu = async (customerText: string, botTexts: string[]) => {
      await customerSays(conv, customerText, true);
      for (const t of botTexts) await say(conv.id, flow, t, true);
      bot = { ...bot, state: 'menu', node: null, path: [] };
    };

    switch (action) {
      case 'choose': {
        if (bot.state !== 'menu') return res.status(409).json({ error: 'Pick Yes or No first' });
        const showing = optionsAt(flow, bot.node);
        const opt = showing.find(o => o.id === optionId) || null;
        if (!opt) return res.status(400).json({ error: 'That option is no longer available', resync: true });
        if (opt.kind === 'agent') {
          bot = { ...bot, path: [...bot.path, opt.label] };
          await handOff(opt.label, opt.answer?.trim() || flow.noReply, 'Customer asked for a person via');
          if (hasOptionActions(opt)) Object.assign(convUpdate, await applyOptionActions(conv, opt.actions!, bot.path, flow.botName));
          break;
        }
        await customerSays(conv, opt.label, true);
        if (opt.kind === 'menu') {
          await say(conv.id, flow, opt.prompt || opt.label, true);
          bot = { ...bot, node: opt.id, path: [...bot.path, opt.label] };
        } else {
          await say(conv.id, flow, opt.answer || '', true);
          bot = { ...bot, path: [...bot.path, opt.label] };
          if (hasOptionActions(opt)) {
            // A button that makes a ticket / sets priority / sends to a team: the team takes it from here
            bot = { ...bot, state: 'handoff' };
            convUpdate = { status: 'open', unreadCountAgent: (conv.unreadCountAgent || 0) + 1, ...(await applyOptionActions(conv, opt.actions!, bot.path, flow.botName)) };
            handedOff = true;
            await recordEvent(conv.id, 'status', `Sent to the team by ${flow.botName}: ${bot.path.join(' › ')}`, undefined,
              { bot: true, field: 'status', from: conv.status, to: 'open' });
          } else if (flow.askResolved) {
            await say(conv.id, flow, flow.resolvedQuestion, true);
            bot = { ...bot, state: 'confirm' };
          }
        }
        break;
      }
      case 'yes': {
        if (bot.state !== 'confirm') return res.status(409).json({ error: 'Nothing to confirm' });
        await customerSays(conv, flow.yesLabel, true);
        await say(conv.id, flow, flow.yesReply, true);
        bot = { ...bot, state: 'done' };
        convUpdate.status = 'resolved';
        await recordEvent(conv.id, 'status', `Resolved by ${flow.botName}: ${bot.path.join(' › ') || 'chat flow'}`, undefined, { bot: true });
        break;
      }
      case 'no': {
        if (bot.state !== 'confirm' && bot.state !== 'done') return res.status(409).json({ error: 'Nothing to confirm' });
        await handOff(flow.noLabel, flow.noReply, 'Customer asked for a person after');
        break;
      }
      case 'back':
        if (!flow.showBack) return res.status(400).json({ error: 'Not available' });
        await toMenu(flow.backLabel, [fillName(flow.menuPrompt, conv.customer.name)]);
        break;
      case 'restart':
        if (!flow.showRestart) return res.status(400).json({ error: 'Not available' });
        await toMenu(flow.restartLabel, [flow.restartMessage, flow.restartPrompt]);
        break;
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

    // A conversation that finished ("done") and is restarted goes back to being bot-handled
    if (action === 'back' || action === 'restart') convUpdate.status = 'resolved';
    const updated = await convRepo.update(conv.id, { ...convUpdate, bot });
    if (updated) {
      SocketService.broadcastConversationUpdate(updated);
      if (convUpdate.kind === 'ticket') import('../services/email').then(m => m.sendTicketUpdate(updated, 'created')).catch(() => {});
      if (handedOff) {
        // Settings › AI Agent: it answers the customer's next message before a teammate does
        const aiState = await (await import('../services/aiAgent')).takesNew('chatflow');
        if (aiState) {
          const taken = await convRepo.update(updated.id, { aiAgent: aiState });
          if (taken) SocketService.broadcastConversationUpdate(taken);
          await recordEvent(updated.id, 'other', 'The AI Agent is answering this conversation', undefined, { field: 'aiAgent', to: 'active' });
          return res.json(toCustomerView(taken || updated));
        }
        notifyIntegrations(wsId, 'conversation.created', { conversation: updated });
        await sendReplyTimeNotice(updated, wsId);
        await refreshSla(updated.id); // the customer now waits for a person
        // AI: a summary note and priority/tags, once the customer has said what they need
        const id = updated.id;
        inBackground('hand-off', () => afterBotHandoff(id));
      }
    }
    return res.json(toCustomerView(updated || conv));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


/**
 * POST /api/tickets/:id/chat-flow { node: optionId | null } — a teammate hands the conversation to the
 * chat flow (reply box ⋯ › Workflows): the bot shows that menu and the customer picks from its buttons.
 * Choosing "talk to a person" hands it straight back; the conversation stays in the inbox meanwhile.
 */
export async function passToChatFlow(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
    const live = liveChatFlow(ws);
    if (!live) return res.status(409).json({ error: 'Publish a chat flow first (Settings › Channels › Chat flow).' });
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.channel === 'email') return res.status(409).json({ error: 'The chat flow runs in the Messenger, not over email.' });
    const { flow, version } = live;
    const node = typeof req.body?.node === 'string' && req.body.node ? req.body.node : null;
    const opt = node ? findOption(flow.options, node) : null;
    if (node && (!opt || opt.kind !== 'menu')) return res.status(400).json({ error: 'That menu is no longer in the chat flow' });

    await say(conv.id, flow, opt ? (opt.prompt || opt.label) : (flow.restartPrompt || fillName(flow.menuPrompt, conv.customer.name)), true);
    const updated = await convRepo.update(conv.id, { bot: { state: 'menu', node: opt ? opt.id : null, path: opt ? [opt.label] : [], version } });
    const me = await RepositoryFactory.getUserRepository().findById(req.user.id);
    await recordEvent(conv.id, 'status', `${me?.name || 'A teammate'} passed this conversation to ${flow.botName} (chat flow${opt ? `: ${opt.label}` : ''})`, { id: req.user.id, name: me?.name || 'Agent' });
    if (updated) SocketService.broadcastConversationUpdate(updated);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
