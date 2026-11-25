import { RepositoryFactory } from '../repositories/factory';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { SocketService } from './socket';
import { recordEvent, recordUpdateEvents } from './events';
import { aiFor, askJson, afterBotHandoff, inBackground } from './aiAssist';
import { plainText } from './conversationView';
import { AiAgentSettings, Conversation, ConversationAiAgent, HelpArticle, Message, Workspace } from '../../../shared/src/types';

/**
 * Settings › AI Agent: an AI teammate that answers customers itself and hands the conversation to a
 * person when it can't help. Everything about *how* it answers lives in this file:
 *  - takesNew(channel): should it answer a brand-new conversation?
 *  - respond(conversationId): answer the customer's latest message (or hand over);
 *  - decide(question, history): the model call (also used by the "Test AI Agent" box in Settings);
 *  - handOff(conv, reason): give the conversation to the team (routing, summary, SLA clock).
 * Swapping the model, the retrieval or the prompt only touches this file. Off by default.
 */

export const AI_AGENT_ID = 'ai-agent';

export const DEFAULT_AI_AGENT: AiAgentSettings = {
  enabled: false,
  name: 'AI Agent',
  answerFrom: 'knowledge',
  minConfidence: 0.6,
  maxReplies: 5,
  handoffTopics: ['refund', 'cancel my account', 'legal', 'lawyer', 'complaint'],
  handoffMessage: 'Let me get a teammate to help you with this. They’ll reply here soon.',
  channels: { messenger: true, email: false },
  afterChatFlow: true,
  askFeedback: true,
};

export function aiAgentSettingsOf(ws?: Workspace | null): AiAgentSettings {
  const s = ws?.aiAgent || {};
  return { ...DEFAULT_AI_AGENT, ...s, channels: { ...DEFAULT_AI_AGENT.channels, ...(s.channels || {}) } };
}

async function settings(): Promise<AiAgentSettings> {
  return aiAgentSettingsOf(await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId()));
}

/** Ready to answer: switched on and the AI provider is set up (Settings › AI assistant). */
export async function agentReady(): Promise<AiAgentSettings | null> {
  const s = await settings();
  if (!s.enabled || !(await aiFor())) return null;
  return s;
}

/** Should the AI Agent take a new conversation on this channel? Returns the state to store on it. */
export async function takesNew(channel: 'messenger' | 'email' | 'chatflow'): Promise<ConversationAiAgent | null> {
  const s = await agentReady();
  if (!s) return null;
  const on = channel === 'chatflow' ? s.afterChatFlow : s.channels[channel];
  return on ? { state: 'active', replies: 0, startedAt: new Date().toISOString() } : null;
}

// ── Deciding what to say ──────────────────────────────────────────────────

export type Decision = {
  reply: string;
  confidence: number;
  sources: { id: string; title: string }[];
  handoff: boolean;
  reason?: string;
};

const HUMAN_RE = /\b(human|real person|a person|someone real|agent|representative|operator|talk to (someone|a person|support)|speak to (someone|a person))\b/i;

/** Rules checked before asking the model: asking for a person, topics that always go to a person. */
export function ruleHandoff(s: AiAgentSettings, text: string): string | null {
  if (HUMAN_RE.test(text)) return 'The customer asked for a person';
  const lower = text.toLowerCase();
  const topic = s.handoffTopics.map(t => t.trim()).filter(Boolean).find(t => lower.includes(t.toLowerCase()));
  return topic ? `Topic that always goes to a person: “${topic}”` : null;
}

/** The model call: an answer from the knowledge base (and general knowledge if allowed), or a hand-over. */
export async function decide(s: AiAgentSettings, question: string, history: string): Promise<Decision> {
  const setup = await aiFor();
  if (!setup) return { reply: '', confidence: 0, sources: [], handoff: true, reason: 'The AI assistant isn’t set up' };
  const { relevantArticles } = await import('../controllers/help');
  const articles: HelpArticle[] = await relevantArticles(`${question}\n${history.slice(-600)}`, 4);
  const kb = articles.length
    ? articles.map((a, i) => `[${i + 1}] id=${a.id} title="${a.title}"\n${plainText(a.body).slice(0, 2500)}`).join('\n\n')
    : '(no matching articles)';
  const rules = [
    `You are ${s.name}, the support assistant of ${setup.brand}, answering a customer in a chat.`,
    s.answerFrom === 'knowledge'
      ? 'Answer ONLY with facts from the help articles below. If they don’t contain the answer, hand over to a person.'
      : 'Prefer facts from the help articles below; you may use general knowledge for simple, safe questions. Never invent account details, prices, policies or promises.',
    'Keep answers short (1–5 sentences), friendly and practical. Use the customer’s language. No greeting if the chat is already going.',
    'Hand over to a person (handoff=true) when: the customer needs something done on their account, is upset, asks for a person, or you are not sure.',
    setup.ai.instructions ? `Team guidance: ${setup.ai.instructions}` : '',
    'Return JSON: {"reply": string, "confidence": number 0-1 (how sure you are the reply fully and correctly answers), "sources": [article ids you used], "handoff": boolean, "reason": short string when handing off}.',
  ].filter(Boolean).join('\n');
  const out = await askJson<{ reply?: unknown; confidence?: unknown; sources?: unknown; handoff?: unknown; reason?: unknown }>(setup.ai, rules,
    `Help articles:\n${kb}\n\nConversation so far:\n${history || '(none)'}\n\nCustomer’s latest message:\n${question}`);
  const ids = Array.isArray(out.sources) ? out.sources.map(String) : [];
  return {
    reply: typeof out.reply === 'string' ? out.reply.trim() : '',
    confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
    sources: articles.filter(a => ids.includes(a.id)).map(a => ({ id: a.id, title: a.title })),
    handoff: out.handoff === true,
    reason: typeof out.reason === 'string' ? out.reason.slice(0, 200) : undefined,
  };
}

/** What the customer and the team said, oldest first (no notes or events). */
function historyOf(msgs: Message[], exceptId?: string): string {
  return msgs
    .filter(m => m.id !== exceptId && !m.isInternalNote && (m.sender.type === 'customer' || m.sender.type === 'agent') && m.content?.trim())
    .slice(-20)
    .map(m => `${m.sender.type === 'customer' ? 'Customer' : m.sender.id === AI_AGENT_ID ? 'You' : `Teammate ${m.sender.name}`}: ${plainText(m.content).slice(0, 800)}`)
    .join('\n');
}

// ── Acting on it ──────────────────────────────────────────────────────────

function typing(conversationId: string, name: string, isTyping: boolean) {
  try { SocketService.emitToConversationCustomer(conversationId, 'agent:typing', { conversationId, agentName: name, isTyping }); } catch { /* sockets not ready */ }
}

async function say(conv: Conversation, s: AiAgentSettings, content: string, metadata: Record<string, any>): Promise<Message> {
  const { sendAgentReply } = await import('../controllers/messages');
  return sendAgentReply(conv, { id: AI_AGENT_ID, name: s.name }, content, { type: 'ai_agent', ...metadata });
}

async function setState(conv: Conversation, patch: Partial<ConversationAiAgent>, extra: Partial<Conversation> = {}): Promise<Conversation | null> {
  const current = (await RepositoryFactory.getConversationRepository().findById(conv.id)) || conv;
  const next = { ...(current.aiAgent || { state: 'active', replies: 0, startedAt: new Date().toISOString() }), ...patch } as ConversationAiAgent;
  const updated = await RepositoryFactory.getConversationRepository().update(conv.id, { aiAgent: next, ...extra });
  if (updated) SocketService.broadcastConversationUpdate(updated);
  return updated;
}

/** Give the conversation to the team: tell the customer, route it, summarize it, start the SLA clock. */
export async function handOff(conv: Conversation, reason: string, opts: { silent?: boolean } = {}): Promise<void> {
  const s = await settings();
  // Check the current state: a teammate may have taken over while the AI was thinking
  const fresh = (await RepositoryFactory.getConversationRepository().findById(conv.id)) || conv;
  if (!fresh.aiAgent || fresh.aiAgent.state === 'handoff') return;
  if (!opts.silent && s.handoffMessage.trim()) await say(fresh, s, s.handoffMessage.trim(), { handoff: true });
  const { routeNewConversation } = await import('./teams');
  const route = fresh.assignedAgentId ? null : await routeNewConversation();
  const updated = await setState(fresh, { state: 'handoff', endedAt: new Date().toISOString(), reason }, {
    status: 'open',
    unreadCountAgent: (fresh.unreadCountAgent || 0) + 1,
    ...(route?.assignedAgentId ? { assignedAgentId: route.assignedAgentId } : {}),
    ...(route?.teamId && !fresh.teamId ? { teamId: route.teamId } : {}),
  });
  await recordEvent(conv.id, 'status', `${s.name} handed this to the team: ${reason}`, undefined, { field: 'aiAgent', to: 'handoff', reason });
  if (route?.assignedAgentId) {
    const assignee = await RepositoryFactory.getUserRepository().findById(route.assignedAgentId);
    await recordEvent(conv.id, 'assignment', `Auto-assigned to ${assignee?.name || 'a teammate'}${route.reason ? ` (${route.reason})` : ''}`, undefined,
      { targetId: route.assignedAgentId, targetName: assignee?.name, auto: true });
  }
  if (updated) {
    // The hand-off message already told the customer a teammate is coming; otherwise say when to expect a reply
    if (opts.silent || !s.handoffMessage.trim()) {
      const { sendReplyTimeNotice } = await import('./autoReply');
      await sendReplyTimeNotice(updated, getActiveWorkspaceId());
    }
    const { refreshSla } = await import('./sla');
    await refreshSla(updated.id);
    const { notifyIntegrations } = await import('./notifications');
    notifyIntegrations(getActiveWorkspaceId(), 'conversation.created', { conversation: updated });
    inBackground('ai agent hand-off', () => afterBotHandoff(updated.id)); // summary note + triage
  }
}

/** The customer wrote while the AI Agent has the conversation: answer, or hand over. */
export async function respond(conversationId: string, messageId: string): Promise<void> {
  const convRepo = RepositoryFactory.getConversationRepository();
  let conv = await convRepo.findById(conversationId);
  if (!conv?.aiAgent || conv.aiAgent.state === 'handoff') return;
  const s = await settings();
  if (!s.enabled) return handOff(conv, `${s.name} is switched off`, { silent: true });
  // A customer writing again after the AI resolved it: the AI picks it back up
  if (conv.aiAgent.state === 'resolved') conv = (await setState(conv, { state: 'active', endedAt: undefined })) || conv;

  const msgs = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100_000);
  const msg = msgs.find(m => m.id === messageId);
  const question = msg?.content?.trim();
  if (!question) return; // attachments only: wait for words
  if (conv.aiAgent!.replies >= s.maxReplies) return handOff(conv, `Reached ${s.maxReplies} AI replies`);
  const rule = ruleHandoff(s, question);
  if (rule) return handOff(conv, rule);

  typing(conversationId, s.name, true);
  let d: Decision;
  try {
    d = await decide(s, question, historyOf(msgs, messageId));
  } catch (err: any) {
    typing(conversationId, s.name, false);
    const why = /quota|rate limit/i.test(err.message || '') ? 'the AI provider is out of quota' : String(err.message || 'error').split('\n')[0].slice(0, 80);
    return handOff(conv, `The AI couldn’t answer (${why})`);
  }
  typing(conversationId, s.name, false);
  // The conversation may have changed while the model was thinking (a teammate stepped in)
  const now = await convRepo.findById(conversationId);
  if (!now?.aiAgent || now.aiAgent.state !== 'active') return;
  if (d.handoff || !d.reply || d.confidence < s.minConfidence) {
    return handOff(now, d.reason || (d.reply ? `Not confident enough (${Math.round(d.confidence * 100)}%)` : 'No answer found'));
  }
  await say(now, s, d.reply, { sources: d.sources, confidence: d.confidence, askFeedback: s.askFeedback });
  await setState(now, { replies: (now.aiAgent.replies || 0) + 1 });
}

/** Customer buttons under an AI answer: it helped (resolve), it didn't, or "Talk to a person". */
export async function customerFeedback(conv: Conversation, action: 'helpful' | 'not_helpful' | 'human'): Promise<Conversation | null> {
  if (!conv.aiAgent || conv.aiAgent.state === 'handoff') return conv;
  const s = await settings();
  if (action === 'helpful') {
    const before = conv;
    const after = await setState(conv, { state: 'resolved', endedAt: new Date().toISOString() }, { status: 'resolved' });
    if (after) {
      await recordUpdateEvents(before, after, { id: AI_AGENT_ID, name: s.name });
      await recordEvent(conv.id, 'status', `Resolved by ${s.name}: the customer said the answer helped`, undefined, { field: 'aiAgent', to: 'resolved' });
    }
    return after;
  }
  await handOff(conv, action === 'human' ? 'The customer asked for a person' : 'The customer said the answer didn’t help');
  return RepositoryFactory.getConversationRepository().findById(conv.id);
}

/** A teammate took the conversation over (or replied): the AI Agent steps back without a message. */
export async function takeOver(conv: Conversation, who: string): Promise<void> {
  if (!conv.aiAgent || conv.aiAgent.state !== 'active') return;
  await setState(conv, { state: 'handoff', endedAt: new Date().toISOString(), reason: `${who} took over` });
  await recordEvent(conv.id, 'status', `${who} took over from the AI Agent`, undefined, { field: 'aiAgent', to: 'handoff' });
}
