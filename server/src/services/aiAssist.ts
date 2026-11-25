import { RepositoryFactory } from '../repositories/factory';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { SocketService } from './socket';
import { recordUpdateEvents } from './events';
import { complete, transcriptOf, AiError } from './ai';
import { plainText } from './conversationView';
import { AiFeatures, AiSettings, Conversation, Message, TicketPriority } from '../../../shared/src/types';

/**
 * AI that saves teammates time (Settings › AI assistant › Automations), on the provider set up
 * for Ask AI:
 *  - a summary note when the chat-flow bot hands a conversation to the team;
 *  - suggested replies above the composer while the customer is waiting;
 *  - triage of new conversations: priority and matching tags;
 *  - translation: customers' messages into the team language, teammates' replies into theirs.
 * Everything is best-effort: if the AI is off or fails, the conversation carries on without it.
 */

export const DEFAULT_FEATURES: AiFeatures = { handoffSummary: true, suggestedReplies: true, autoTriage: true, translation: false, teamLanguage: 'English' };
export const AI_ACTOR = { id: 'ai', name: 'AI' };

export function featuresOf(ai?: AiSettings): AiFeatures {
  return { ...DEFAULT_FEATURES, ...(ai?.features || {}) };
}

/** The workspace's AI settings, if AI is on and set up (and the feature, if given, is on). */
export async function aiFor(feature?: keyof Omit<AiFeatures, 'teamLanguage'>): Promise<{ ai: AiSettings; features: AiFeatures; brand: string } | null> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  const ai = ws?.ai;
  if (!ws || !ai?.enabled || (!ai.apiKey && ai.provider !== 'openai_compatible') || !ai.model) return null;
  const features = featuresOf(ai);
  if (feature && !features[feature]) return null;
  return { ai, features, brand: ws.customerFacingName?.trim() || ws.name };
}

/** Ask for JSON and parse it (models sometimes wrap it in a code fence or add a sentence). */
async function askJson<T>(ai: AiSettings, system: string, user: string): Promise<T> {
  const text = await complete(ai, `${system}\n\nRespond with a single JSON object only. No code fences, no commentary.`, [{ role: 'user', content: user }]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError('The AI didn’t return the expected format');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

async function loadThread(conversationId: string): Promise<{ conv: Conversation; messages: Message[] } | null> {
  const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
  if (!conv) return null;
  const messages = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100_000);
  return { conv, messages };
}

// ── Hand-off summary ───────────────────────────────────────────────────────

/** Write a short internal note summarizing the conversation so far. Returns the note, or null. */
export async function summarizeConversation(conversationId: string, opts: { reason: 'handoff' | 'manual' }): Promise<Message | null> {
  const setup = await aiFor(opts.reason === 'handoff' ? 'handoffSummary' : undefined);
  if (!setup) return null;
  const thread = await loadThread(conversationId);
  if (!thread || !thread.messages.some(m => m.sender.type === 'customer')) return null;
  const text = await complete(setup.ai,
    [
      `You write hand-over notes for ${setup.brand}'s support team. Summarize the conversation below for the teammate who is taking it over.`,
      'Write 2–5 short bullet points ("- "): what the customer needs, the key details they gave (order numbers, devices, error messages, account info), what has already been tried or answered (including by the bot), and what is still open.',
      'Be factual; don’t invent details. No greeting, no heading.',
      setup.ai.instructions?.trim() ? `Team instructions: ${setup.ai.instructions.trim()}` : '',
    ].filter(Boolean).join('\n'),
    [{ role: 'user', content: `<conversation>\n${transcriptOf(thread.conv, thread.messages)}\n</conversation>` }]);
  const note = await RepositoryFactory.getMessageRepository().create({
    conversationId,
    sender: { type: 'agent', id: 'ai', name: opts.reason === 'handoff' ? 'AI summary' : 'AI summary (requested)' },
    content: text.trim(),
    attachments: [], isInternalNote: true, seen: true, delivered: true, reactions: [],
    metadata: { type: 'ai_summary', reason: opts.reason },
  });
  SocketService.broadcastMessageNew(note);
  return note;
}

// ── Suggested replies ──────────────────────────────────────────────────────

const suggestionCache = new Map<string, { at: number; replies: string[] }>(); // `${convId}:${lastMessageId}`

/** Up to 3 short replies to the customer's latest message (cached until a new message arrives). */
export async function suggestReplies(conversationId: string): Promise<string[]> {
  const setup = await aiFor('suggestedReplies');
  if (!setup) return [];
  const thread = await loadThread(conversationId);
  if (!thread) return [];
  // What a person said (automatic messages like the reply-time notice don't count as an answer)
  const AUTO = new Set(['auto_reply', 'bot', 'bot_choice', 'csat_request', 'customer_event', 'event']);
  const visible = thread.messages.filter(m => m.sender.type !== 'system' && !m.isInternalNote && m.sender.id !== 'bot' && !AUTO.has(m.metadata?.type));
  const last = visible[visible.length - 1];
  if (!last || last.sender.type !== 'customer') return []; // only while the customer is waiting
  const key = `${conversationId}:${last.id}`;
  const hit = suggestionCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.replies;

  const { relevantArticles } = await import('../controllers/help');
  const articles = await relevantArticles(visible.slice(-3).map(m => m.content).join(' '), 2);
  const language = thread.conv.language && setup.features.translation ? setup.features.teamLanguage : null;
  const out = await askJson<{ replies?: unknown }>(setup.ai,
    [
      `You suggest replies for a teammate at ${setup.brand} to send to the customer in the conversation below.`,
      'Give exactly 3 different, ready-to-send replies to the customer’s latest message: a direct answer if the conversation or the articles contain it, a clarifying question if something is missing, and a short friendly acknowledgement. Each at most 2–3 sentences, in plain text.',
      'Never invent facts (order status, prices, policies) that aren’t in the conversation or the articles.',
      language ? `Write them in ${language} (the team’s language; they’ll be translated for the customer).` : 'Write them in the language the customer uses.',
      setup.ai.instructions?.trim() ? `Team instructions: ${setup.ai.instructions.trim()}` : '',
      'Format: {"replies": ["...", "...", "..."]}',
    ].filter(Boolean).join('\n'),
    [
      `<conversation>\n${transcriptOf(thread.conv, thread.messages)}\n</conversation>`,
      articles.length ? `<articles>\n${articles.map(a => `### ${a.title}\n${a.body.slice(0, 2000)}`).join('\n\n')}\n</articles>` : '',
    ].filter(Boolean).join('\n\n'));
  const replies = Array.isArray(out.replies) ? out.replies.filter((r): r is string => typeof r === 'string' && !!r.trim()).map(r => r.trim().slice(0, 1000)).slice(0, 3) : [];
  suggestionCache.set(key, { at: Date.now(), replies });
  if (suggestionCache.size > 500) suggestionCache.delete(suggestionCache.keys().next().value!);
  return replies;
}

// ── Triage ─────────────────────────────────────────────────────────────────

const PRIORITIES: TicketPriority[] = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * New conversation: pick a priority and matching tags (only tags that already exist), and note
 * the customer's language. Only fills in what's empty, so it never overrides a teammate.
 */
export async function triageConversation(conversationId: string): Promise<void> {
  const setup = await aiFor('autoTriage');
  if (!setup) return;
  const thread = await loadThread(conversationId);
  if (!thread) return;
  const { conv } = thread;
  if (conv.kind === 'issue' || (conv.bot && conv.bot.state !== 'handoff')) return;
  const tags = (await RepositoryFactory.getTagRepository().findAll()).map(t => t.name);
  const out = await askJson<{ priority?: string; tags?: unknown; language?: string }>(setup.ai,
    [
      `You triage new customer conversations for ${setup.brand}'s support team.`,
      'priority: "critical" only for outages, security problems, or a customer completely blocked from using the product or paying; "high" for an urgent problem affecting their work or money (payment failed, can’t log in); "medium" for problems with a workaround; "low" for questions, feedback and how-tos; "none" if unclear.',
      tags.length ? `tags: up to 3 that clearly fit, chosen ONLY from this list: ${JSON.stringify(tags)}. Use [] if none fit.` : 'tags: [] (there are no tags yet).',
      'language: the language the customer writes in, as an English name (e.g. "English", "Spanish", "Hindi").',
      'Format: {"priority": "...", "tags": [...], "language": "..."}',
    ].join('\n'),
    `<conversation>\n${transcriptOf(conv, thread.messages)}\n</conversation>`);

  const patch: Partial<Conversation> = {};
  if (conv.priority === 'none' && PRIORITIES.includes(out.priority as TicketPriority) && out.priority !== 'none') patch.priority = out.priority as TicketPriority;
  const picked = Array.isArray(out.tags) ? out.tags.filter((t): t is string => typeof t === 'string' && tags.includes(t)).slice(0, 3) : [];
  const merged = Array.from(new Set([...(conv.tags || []), ...picked]));
  if (merged.length !== (conv.tags || []).length) patch.tags = merged;
  const lang = typeof out.language === 'string' ? out.language.trim().slice(0, 40) : '';
  if (lang && !conv.language && lang.toLowerCase() !== setup.features.teamLanguage.toLowerCase()) patch.language = lang;
  if (!Object.keys(patch).length) return;
  const after = await RepositoryFactory.getConversationRepository().update(conv.id, patch, { touch: false });
  if (!after) return;
  SocketService.broadcastConversationUpdate(after);
  await recordUpdateEvents(conv, after, AI_ACTOR); // "AI changed priority…", "AI tagged this conversation…"
  if (patch.priority) await (await import('./sla')).refreshSla(conv.id);
}

// ── Translation ────────────────────────────────────────────────────────────

/**
 * A customer wrote: if it isn't in the team language, attach a translation for teammates
 * (message.metadata.translation) and remember the customer's language on the conversation.
 */
export async function translateCustomerMessage(conversationId: string, messageId: string): Promise<void> {
  const setup = await aiFor('translation');
  if (!setup) return;
  const msgRepo = RepositoryFactory.getMessageRepository();
  const msg = await msgRepo.findById(messageId);
  if (!msg || msg.sender.type !== 'customer' || !msg.content?.trim() || msg.metadata?.translation) return;
  const team = setup.features.teamLanguage;
  const out = await askJson<{ language?: string; translation?: string | null }>(setup.ai,
    [
      'You translate customer support messages.',
      `Detect the language of the message. If it is ${team}, return {"language": "${team}", "translation": null}.`,
      `Otherwise translate it into ${team}, keeping the meaning, tone, names, numbers and formatting, and return {"language": "<the message's language, as an English name>", "translation": "<the ${team} text>"}.`,
    ].join('\n'),
    `<message>\n${msg.content.slice(0, 8000)}\n</message>`);
  const language = typeof out.language === 'string' ? out.language.trim().slice(0, 40) : '';
  const convRepo = RepositoryFactory.getConversationRepository();
  const conv = await convRepo.findById(conversationId);
  if (language && conv) {
    const foreign = language.toLowerCase() !== team.toLowerCase();
    if (foreign && conv.language !== language) {
      const u = await convRepo.update(conv.id, { language }, { touch: false });
      if (u) SocketService.broadcastConversationUpdate(u);
    } else if (!foreign && conv.language) {
      const u = await convRepo.update(conv.id, { language: undefined }, { touch: false });
      if (u) SocketService.broadcastConversationUpdate(u);
    }
  }
  if (typeof out.translation === 'string' && out.translation.trim() && language.toLowerCase() !== team.toLowerCase()) {
    const updated = await msgRepo.update(msg.id, { metadata: { ...(msg.metadata || {}), translation: { text: out.translation.trim().slice(0, 20_000), from: language, to: team } } });
    if (updated) SocketService.broadcastMessageUpdate(updated);
  }
}

/** A teammate's reply, translated into the customer's language before it's sent. */
export async function translateReply(conversationId: string, text: string): Promise<{ text: string; language: string }> {
  const setup = await aiFor('translation');
  if (!setup) throw new AiError('Translation is turned off. An admin can turn it on in Settings › AI assistant.', 409);
  const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
  if (!conv?.language) throw new AiError('This customer writes in the team language; no translation needed.', 400);
  const translated = await complete(setup.ai,
    `You translate a support teammate's reply into ${conv.language}. Keep the meaning, tone, names, numbers, links and markdown formatting (**bold**, *italic*, [links](url)). Output only the translated text.`,
    [{ role: 'user', content: text.slice(0, 8000) }]);
  return { text: translated.trim(), language: conv.language };
}

// ── Issue updates ──────────────────────────────────────────────────────────

/**
 * Draft the message sent to every customer linked to a tracker issue (usually: it's fixed).
 * Written from the issue's title, description, root cause and its internal notes.
 */
export async function draftIssueUpdate(issueId: string): Promise<string> {
  const setup = await aiFor();
  if (!setup) throw new AiError('Ask AI isn’t set up. An admin can turn it on in Settings › AI assistant.', 409);
  const thread = await loadThread(issueId);
  if (!thread || thread.conv.kind !== 'issue') throw new AiError('Issue not found', 404);
  const { conv, messages } = thread;
  const notes = messages
    .filter(m => m.sender.type === 'agent' && m.metadata?.type !== 'event')
    .slice(-15)
    .map(m => `- ${m.sender.name}: ${plainText(m.content).slice(0, 600)}`)
    .join('\n');
  const facts = [
    `Issue: ${conv.title || 'Untitled'}`,
    conv.description ? `Description: ${conv.description}` : '',
    conv.attributes?.platforms?.length ? `Platforms: ${conv.attributes.platforms.join(', ')}` : '',
    conv.attributes?.rootCause ? `Root cause: ${conv.attributes.rootCause}` : '',
    `State: ${conv.status === 'resolved' || conv.status === 'closed' ? 'fixed / resolved' : 'still being worked on'}`,
    notes ? `Team notes:\n${notes}` : '',
  ].filter(Boolean).join('\n');
  const text = await complete(setup.ai,
    `You write a short update from the ${setup.brand} support team to customers who reported the problem below. ` +
    'It is sent to each of them in their own conversation. Be warm, plain and specific; 2–4 sentences; ' +
    'thank them for reporting it, say what changed and what (if anything) they need to do. ' +
    'No greeting with a name (it goes to many people), no internal details, no promises you can’t see in the facts. Output only the message.',
    [{ role: 'user', content: facts }]);
  return text.trim();
}

// ── Bot hand-off ───────────────────────────────────────────────────────────

/** Something the customer typed themselves (not a chat-flow button or details answer). */
const isTyped = (m: Message) => m.sender.type === 'customer' && !m.isInternalNote && m.metadata?.type !== 'bot_choice' && !!m.content?.trim();

/**
 * The bot handed a chat to the team. Summarize and triage only once the customer has said what
 * they need: now if they've already typed something, otherwise on their first typed message
 * (see onCustomerTyped). Tapping "Other" alone gives the AI nothing to work with.
 */
export async function afterBotHandoff(conversationId: string): Promise<void> {
  const messages = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100_000);
  if (!messages.some(isTyped)) return; // wait for their first message
  await summarizeHandoffOnce(conversationId, messages);
  await triageConversation(conversationId);
}

/** A customer typed in a chat the bot handled: if it's their first typed message, summarize and triage now. */
export async function onCustomerTyped(conversationId: string, messageId: string): Promise<void> {
  const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
  if (!conv?.bot) return; // only chats that started with the bot
  const messages = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100_000);
  if (messages.some(m => m.id !== messageId && isTyped(m))) return; // not their first typed message
  await summarizeHandoffOnce(conversationId, messages);
  await triageConversation(conversationId);
}

async function summarizeHandoffOnce(conversationId: string, messages: Message[]) {
  if (messages.some(m => m.metadata?.type === 'ai_summary' && m.metadata?.reason === 'handoff')) return;
  await summarizeConversation(conversationId, { reason: 'handoff' });
}

/** Run an AI side task without holding up the request; failures only go to the log. */
export function inBackground(label: string, task: () => Promise<unknown>) {
  task().catch(err => console.warn(`[AI] ${label} skipped: ${err?.message || err}`));
}
