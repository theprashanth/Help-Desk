import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage, getActiveWorkspaceId } from '../context/tenant.context';
import { SocketService, AGENTS_ROOM } from './socket';
import { recordEvent } from './events';
import { Conversation, ConversationSla, Message, SlaPolicy, TicketPriority, Workspace } from '../../../shared/src/types';

/**
 * SLA timers (Settings › SLAs). The clock is worked out from the messages rather than kept as
 * running state, so it can't drift:
 *  - the customer is waiting when their latest public message (or the bot's hand-off to a person)
 *    came after the last teammate reply;
 *  - "first" response if no teammate has replied yet, otherwise "next" response;
 *  - due = when they started waiting + the target for the conversation's priority.
 * Waiting on customer / resolved / closed / merged conversations, and chats the bot is still
 * handling, have no clock. Snoozed conversations keep theirs but can't breach until they wake.
 */

export const PRIORITIES: TicketPriority[] = ['critical', 'high', 'medium', 'low', 'none'];

export const DEFAULT_SLA_POLICY: SlaPolicy = {
  enabled: false,
  firstResponseMinutes: { critical: 15, high: 60, medium: 240, low: 480, none: 480 },
  nextResponseMinutes: { critical: 30, high: 120, medium: 480, low: 1440, none: 1440 },
};

export function slaPolicyOf(ws?: Workspace | null): SlaPolicy {
  const p = ws?.sla;
  return {
    enabled: !!p?.enabled,
    enabledAt: p?.enabledAt,
    firstResponseMinutes: { ...DEFAULT_SLA_POLICY.firstResponseMinutes, ...(p?.firstResponseMinutes || {}) },
    nextResponseMinutes: { ...DEFAULT_SLA_POLICY.nextResponseMinutes, ...(p?.nextResponseMinutes || {}) },
  };
}

const NOT_A_REPLY = new Set(['event', 'auto_reply', 'bot', 'bot_choice', 'csat_request', 'customer_event', 'imported', 'ai_agent']);
const isTeammateReply = (m: Message) =>
  m.sender.type === 'agent' && m.sender.id !== 'bot' && !m.isInternalNote && !NOT_A_REPLY.has(m.metadata?.type);
const isBotMessage = (m: Message) => m.sender.id === 'bot' || m.metadata?.type === 'bot';
const isCustomerMessage = (m: Message) => m.sender.type === 'customer' && !m.isInternalNote;

/** The clock this conversation should have now (undefined = none). Keeps an earlier breach time. */
export function deriveSla(conv: Conversation, msgs: Message[], policy: SlaPolicy): ConversationSla | undefined {
  if (!policy.enabled) return undefined;
  if (conv.status !== 'open' || conv.mergedInto || conv.kind === 'issue') return undefined;
  if (conv.bot && conv.bot.state !== 'handoff') return undefined;
  if (conv.aiAgent?.state === 'active') return undefined; // the AI Agent is answering

  const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastReply = [...sorted].reverse().find(isTeammateReply);
  const after = lastReply?.createdAt || '';

  let startedAt: string | undefined;
  if (conv.bot) {
    // Bot chats: the customer has waited since the bot handed them over (or since they wrote after it)
    const lastBot = [...sorted].reverse().find(isBotMessage);
    const floor = lastBot && lastBot.createdAt > after ? lastBot.createdAt : after;
    if (lastBot && lastBot.createdAt > after) startedAt = lastBot.createdAt;
    else startedAt = sorted.find(m => isCustomerMessage(m) && m.createdAt > floor)?.createdAt;
  } else {
    startedAt = sorted.find(m => isCustomerMessage(m) && m.createdAt > after)?.createdAt;
  }
  if (!startedAt) return undefined;
  if (policy.enabledAt && startedAt < policy.enabledAt) return undefined; // waiting from before SLAs were on

  const kind: ConversationSla['kind'] = lastReply ? 'next' : 'first';
  const priority = (conv.priority || 'none') as TicketPriority;
  const targetMinutes = (kind === 'first' ? policy.firstResponseMinutes : policy.nextResponseMinutes)[priority];
  if (!targetMinutes || targetMinutes <= 0) return undefined;
  const dueAt = new Date(new Date(startedAt).getTime() + targetMinutes * 60_000).toISOString();

  const prev = conv.sla;
  const sameClock = prev && prev.startedAt === startedAt && prev.kind === kind && prev.dueAt === dueAt;
  return { kind, startedAt, dueAt, targetMinutes, ...(sameClock && prev?.breachedAt ? { breachedAt: prev.breachedAt } : {}) };
}

const same = (a?: ConversationSla, b?: ConversationSla) =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && a.startedAt === b.startedAt && a.dueAt === b.dueAt && a.breachedAt === b.breachedAt);

function fmtTarget(mins: number): string {
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Bring one conversation's clock up to date, record a breach if it just happened, and broadcast. */
async function sync(conv: Conversation, msgs: Message[], policy: SlaPolicy, now: string): Promise<Conversation> {
  let next = deriveSla(conv, msgs, policy);
  let breachedNow = false;
  const snoozed = !!conv.snoozedUntil && conv.snoozedUntil > now;
  if (next && !next.breachedAt && next.dueAt <= now && !snoozed) {
    next = { ...next, breachedAt: now };
    breachedNow = true;
  }
  if (same(conv.sla, next)) return conv;
  const updated = await RepositoryFactory.getConversationRepository().update(conv.id, { sla: next }, { touch: false });
  if (!updated) return conv;
  SocketService.broadcastConversationUpdate(updated);
  if (breachedNow && next) {
    const label = next.kind === 'first' ? 'First response' : 'Next response';
    await recordEvent(conv.id, 'other', `${label} SLA missed (target ${fmtTarget(next.targetMinutes)})`, undefined,
      { field: 'sla', kind: next.kind, dueAt: next.dueAt });
    try {
      SocketService.emitToRoom(AGENTS_ROOM, 'sla:breach', {
        conversationId: conv.id, ticketNumber: conv.ticketNumber, kind: next.kind,
        assignedAgentId: conv.assignedAgentId || null, customerName: conv.customer?.name,
      });
    } catch { /* sockets not ready */ }
  }
  return updated;
}

/** After a message or a change to state/priority: refresh that conversation's clock right away. */
export async function refreshSla(conversationId: string): Promise<void> {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
    const policy = slaPolicyOf(ws);
    const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
    if (!conv) return;
    if (!policy.enabled && !conv.sla) return;
    const msgs = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100_000); // whole thread
    await sync(conv, msgs, policy, new Date().toISOString());
  } catch (err: any) {
    console.error('[SLA] refresh failed:', err.message);
  }
}

/** Scheduler: every workspace, every conversation that has or may need a clock. */
export async function checkSlas(): Promise<void> {
  const workspaces = await RepositoryFactory.getWorkspaceRepository().findAll();
  const now = new Date().toISOString();
  for (const ws of workspaces) {
    await tenantStorage.run(ws.id, async () => {
      const policy = slaPolicyOf(ws);
      const convs = (await RepositoryFactory.getConversationRepository().findAll())
        .filter(c => c.sla || (policy.enabled && c.status === 'open' && !c.mergedInto));
      if (!convs.length) return;
      const ids = new Set(convs.map(c => c.id));
      const byConv = new Map<string, Message[]>();
      for (const m of await RepositoryFactory.getMessageRepository().findAll()) {
        if (!ids.has(m.conversationId)) continue;
        if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
        byConv.get(m.conversationId)!.push(m);
      }
      for (const c of convs) await sync(c, byConv.get(c.id) || [], policy, now);
    });
  }
}
