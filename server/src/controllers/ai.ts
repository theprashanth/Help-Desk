import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { AiProvider, AiSettings, Workspace } from '../../../shared/src/types';
import { AiError, AskTurn, DEFAULT_MODELS, complete, systemPrompt, transcriptOf } from '../services/ai';
import { logAudit } from '../services/audit';
import { relevantArticles } from './help';
import { featuresOf, suggestReplies, summarizeConversation, translateReply } from '../services/aiAssist';

const wsIdOf = (req: AuthenticatedRequest) => req.workspaceId || req.user?.workspaceId || 'default_workspace';
const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openai_compatible'];

/** What the browser may see: never the key itself. */
function publicSettings(ws: Workspace) {
  const ai = ws.ai;
  const key = ai?.apiKey || '';
  return {
    enabled: !!ai?.enabled,
    provider: ai?.provider || 'anthropic',
    model: ai?.model || DEFAULT_MODELS[ai?.provider || 'anthropic'],
    baseUrl: ai?.baseUrl || '',
    instructions: ai?.instructions || '',
    hasApiKey: !!key,
    apiKeyHint: key ? `…${key.slice(-4)}` : '',
    configured: !!ai?.enabled && (!!key || ai?.provider === 'openai_compatible') && !!(ai?.model || DEFAULT_MODELS[ai?.provider || 'anthropic']),
    features: featuresOf(ai),
    updatedAt: ai?.updatedAt,
  };
}

async function loadWorkspace(req: AuthenticatedRequest, res: Response): Promise<Workspace | null> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return null; }
  return ws;
}

/** GET /api/ai/settings — any teammate (to know whether Ask AI is set up). */
export async function getAiSettings(req: AuthenticatedRequest, res: Response) {
  const ws = await loadWorkspace(req, res);
  if (ws) res.json(publicSettings(ws));
}

/** Validate a settings body; apiKey: undefined = keep, '' = remove, string = replace. */
function nextSettings(current: AiSettings | undefined, body: any, userId?: string): AiSettings {
  const provider: AiProvider = PROVIDERS.includes(body?.provider) ? body.provider : (current?.provider || 'anthropic');
  const model = typeof body?.model === 'string' ? body.model.trim().slice(0, 120) : (current?.model || '');
  if (body?.model !== undefined && !/^[\w.:\/@-]*$/.test(model)) throw new AiError('Model names can only contain letters, numbers and . _ - : / @', 400);
  let baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : (current?.baseUrl || '');
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch { throw new AiError('Base URL must be a full http(s) URL, e.g. https://api.groq.com/openai/v1', 400); }
    baseUrl = baseUrl.replace(/\/+$/, '');
  }
  if (provider === 'openai_compatible' && !baseUrl) throw new AiError('Add the base URL of the OpenAI-compatible API', 400);
  let apiKey = current?.apiKey;
  if (typeof body?.apiKey === 'string') {
    const k = body.apiKey.trim();
    if (k.length > 400) throw new AiError('That API key is too long', 400);
    apiKey = k || undefined;
  }
  const instructions = typeof body?.instructions === 'string' ? body.instructions.slice(0, 4000) : (current?.instructions || '');
  const enabled = typeof body?.enabled === 'boolean' ? body.enabled : !!current?.enabled;
  const features = featuresOf(current);
  if (body?.features && typeof body.features === 'object') {
    for (const k of ['handoffSummary', 'suggestedReplies', 'autoTriage', 'translation'] as const) {
      if (typeof body.features[k] === 'boolean') features[k] = body.features[k];
    }
    if (body.features.teamLanguage !== undefined) {
      const l = String(body.features.teamLanguage).trim();
      if (!/^[A-Za-z][A-Za-z ()-]{1,39}$/.test(l)) throw new AiError('Team language must be a language name, e.g. English', 400);
      features.teamLanguage = l;
    }
  }
  return { enabled, provider, model: model || DEFAULT_MODELS[provider], baseUrl: provider === 'openai_compatible' ? baseUrl : undefined, apiKey, instructions, features, updatedAt: new Date().toISOString(), updatedBy: userId };
}

/** PUT /api/ai/settings — admins only. */
export async function saveAiSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can change AI settings' });
  const ws = await loadWorkspace(req, res);
  if (!ws) return;
  let ai: AiSettings;
  try { ai = nextSettings(ws.ai, req.body, req.user.id); } catch (e: any) { return res.status(e.status || 400).json({ error: e.message }); }
  const updated = await RepositoryFactory.getWorkspaceRepository().update(ws.id, { ai });
  await logAudit(req, 'settings.ai', req.body?.apiKey ? 'Changed AI assistant settings and API key' : 'Changed AI assistant settings', { details: { provider: ai.provider, enabled: ai.enabled } });
  return res.json(publicSettings(updated || { ...ws, ai }));
}

/** POST /api/ai/test — admins: try the (unsaved) settings with a tiny request. */
export async function testAiSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can test AI settings' });
  const ws = await loadWorkspace(req, res);
  if (!ws) return;
  try {
    const ai = nextSettings(ws.ai, req.body, req.user.id);
    const started = Date.now();
    const reply = await complete(ai, 'You are a connection test. Reply with exactly: OK', [{ role: 'user', content: 'Reply with OK.' }]);
    return res.json({ ok: true, model: ai.model, reply: reply.slice(0, 80), ms: Date.now() - started });
  } catch (e: any) {
    return res.status(e instanceof AiError ? e.status : 500).json({ ok: false, error: e.message });
  }
}

/**
 * POST /api/ai/ask { conversationId, question, history?: [{role, content}], action?: 'ask' | 'draft' }
 * Any teammate. Answers about the conversation; 'draft' returns only the reply text to send.
 */
export async function askAi(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const ws = await loadWorkspace(req, res);
  if (!ws) return;
  const ai = ws.ai;
  if (!ai?.enabled) return res.status(409).json({ error: 'Ask AI is turned off. An admin can set it up in Settings › AI assistant.', code: 'not_configured' });

  const { conversationId, question, history, action } = req.body || {};
  if (typeof conversationId !== 'string') return res.status(400).json({ error: 'conversationId is required' });
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) return res.status(400).json({ error: 'Ask a question' });
  if (q.length > 4000) return res.status(400).json({ error: 'That question is too long' });

  const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const messages = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 500, 0);

  // Earlier turns of this Ask AI chat (kept by the browser), alternating user/assistant
  const turns: AskTurn[] = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-10)) {
      if ((h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) {
        turns.push({ role: h.role, content: h.content.slice(0, 8000) });
      }
    }
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const ask = action === 'draft'
    ? `${q}\n\n(Write only the reply to send to the customer.)`
    : q;
  turns.push({ role: 'user', content: ask });

  try {
    const name = (ws.customerFacingName || '').trim() || ws.name;
    // Knowledge base: the published articles closest to the question and the customer's latest messages
    const lastCustomer = messages.filter(m => m.sender.type === 'customer' && !m.isInternalNote).slice(-3).map(m => m.content).join(' ');
    const articles = await relevantArticles(`${q} ${lastCustomer}`, 3);
    const kb = articles.length
      ? `\n\nHelp center articles from this workspace's knowledge base. Prefer them over guessing, and name the article you used (e.g. "See: <title>"):\n${articles.map(a => `### ${a.title}\n${a.body.slice(0, 3000)}`).join('\n\n')}`
      : '';
    const answer = await complete(ai, systemPrompt(name, conv, transcriptOf(conv, messages), ai.instructions) + kb, turns);
    return res.json({ answer, action: action === 'draft' ? 'draft' : 'ask', model: ai.model, articles: articles.map(a => ({ id: a.id, title: a.title })) });
  } catch (e: any) {
    return res.status(e instanceof AiError ? e.status : 500).json({ error: e.message });
  }
}

/** POST /api/ai/suggest { conversationId } — up to 3 replies while the customer is waiting. */
export async function suggestRepliesHandler(req: AuthenticatedRequest, res: Response) {
  const id = req.body?.conversationId;
  if (typeof id !== 'string') return res.status(400).json({ error: 'conversationId is required' });
  try { return res.json({ replies: await suggestReplies(id) }); }
  catch (e: any) { return res.status(e instanceof AiError ? e.status : 500).json({ error: e.message, replies: [] }); }
}

/** POST /api/ai/summarize { conversationId } — add an AI summary as an internal note. */
export async function summarizeHandler(req: AuthenticatedRequest, res: Response) {
  const id = req.body?.conversationId;
  if (typeof id !== 'string') return res.status(400).json({ error: 'conversationId is required' });
  try {
    const note = await summarizeConversation(id, { reason: 'manual' });
    if (!note) return res.status(409).json({ error: 'Ask AI isn’t set up, or there’s nothing to summarize yet.' });
    return res.status(201).json(note);
  } catch (e: any) { return res.status(e instanceof AiError ? e.status : 500).json({ error: e.message }); }
}

/** POST /api/ai/translate { conversationId, text } — a reply in the customer's language. */
export async function translateHandler(req: AuthenticatedRequest, res: Response) {
  const { conversationId, text } = req.body || {};
  if (typeof conversationId !== 'string' || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'conversationId and text are required' });
  try { return res.json(await translateReply(conversationId, text)); }
  catch (e: any) { return res.status(e instanceof AiError ? e.status : 500).json({ error: e.message }); }
}
