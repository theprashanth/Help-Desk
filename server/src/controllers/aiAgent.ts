import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { logAudit } from '../services/audit';
import { aiFor } from '../services/aiAssist';
import { aiAgentSettingsOf, decide, ruleHandoff, customerFeedback, takeOver } from '../services/aiAgent';
import { toCustomerView } from '../services/conversationView';
import { AiAgentSettings } from '../../../shared/src/types';

/** Settings › AI Agent, its test box and numbers; "Take over" in the chat; the customer's buttons. */

async function workspace() {
  return RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
}

/** GET /api/ai-agent/settings */
export async function getAiAgentSettings(_req: AuthenticatedRequest, res: Response) {
  const ws = await workspace();
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  return res.json({ settings: aiAgentSettingsOf(ws), aiReady: !!(await aiFor()) });
}

/** PUT /api/ai-agent/settings (admins) */
export async function saveAiAgentSettings(req: AuthenticatedRequest, res: Response) {
  const ws = await workspace();
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const b = req.body || {};
  const cur = aiAgentSettingsOf(ws);
  const next: AiAgentSettings = { ...cur, channels: { ...cur.channels } };
  if (b.enabled !== undefined) next.enabled = !!b.enabled;
  if (b.name !== undefined) {
    const n = String(b.name || '').trim();
    if (!n || n.length > 40) return res.status(400).json({ error: 'Name must be 1–40 characters' });
    next.name = n;
  }
  if (b.answerFrom !== undefined) {
    if (!['knowledge', 'general'].includes(b.answerFrom)) return res.status(400).json({ error: 'answerFrom must be knowledge or general' });
    next.answerFrom = b.answerFrom;
  }
  if (b.minConfidence !== undefined) {
    const v = Number(b.minConfidence);
    if (!(v >= 0 && v <= 1)) return res.status(400).json({ error: 'minConfidence must be between 0 and 1' });
    next.minConfidence = v;
  }
  if (b.maxReplies !== undefined) {
    const v = Math.round(Number(b.maxReplies));
    if (!(v >= 1 && v <= 20)) return res.status(400).json({ error: 'maxReplies must be between 1 and 20' });
    next.maxReplies = v;
  }
  if (b.handoffTopics !== undefined) {
    if (!Array.isArray(b.handoffTopics)) return res.status(400).json({ error: 'handoffTopics must be a list' });
    next.handoffTopics = Array.from(new Set(b.handoffTopics.map((t: unknown) => String(t || '').trim()).filter(Boolean))).slice(0, 50) as string[];
  }
  if (b.handoffMessage !== undefined) next.handoffMessage = String(b.handoffMessage || '').slice(0, 300);
  if (b.channels !== undefined) {
    if (b.channels.messenger !== undefined) next.channels.messenger = !!b.channels.messenger;
    if (b.channels.email !== undefined) next.channels.email = !!b.channels.email;
  }
  if (b.afterChatFlow !== undefined) next.afterChatFlow = !!b.afterChatFlow;
  if (b.askFeedback !== undefined) next.askFeedback = !!b.askFeedback;
  await RepositoryFactory.getWorkspaceRepository().update(ws.id, { aiAgent: next });
  if (cur.enabled !== next.enabled) await logAudit(req, 'settings.ai_agent', next.enabled ? 'Turned the AI Agent on' : 'Turned the AI Agent off');
  else await logAudit(req, 'settings.ai_agent', 'Changed AI Agent settings');
  return res.json({ settings: next, aiReady: !!(await aiFor()) });
}

/** POST /api/ai-agent/test { question } — what it would say, without any customer involved. */
export async function testAiAgent(req: AuthenticatedRequest, res: Response) {
  const question = String(req.body?.question || '').trim().slice(0, 2000);
  if (!question) return res.status(400).json({ error: 'Type a question to test' });
  const s = aiAgentSettingsOf(await workspace());
  if (!(await aiFor())) return res.status(409).json({ error: 'The AI assistant isn’t set up yet (Settings › AI assistant).' });
  const rule = ruleHandoff(s, question);
  if (rule) return res.json({ handoff: true, reason: rule, reply: '', confidence: 0, sources: [], wouldSay: s.handoffMessage });
  try {
    const d = await decide(s, question, '');
    const handoff = d.handoff || !d.reply || d.confidence < s.minConfidence;
    return res.json({ ...d, handoff, reason: handoff ? (d.reason || (d.reply ? `Not confident enough (${Math.round(d.confidence * 100)}%, needs ${Math.round(s.minConfidence * 100)}%)` : 'No answer found')) : undefined, wouldSay: handoff ? s.handoffMessage : d.reply });
  } catch (err: any) {
    return res.status(502).json({ error: `The AI couldn’t answer: ${err.message}` });
  }
}

/** GET /api/ai-agent/stats?days=30 — conversations it took, resolved, and handed over. */
export async function aiAgentStats(req: AuthenticatedRequest, res: Response) {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days || '30'), 10) || 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const list = (await RepositoryFactory.getConversationRepository().findAll()).filter(c => c.aiAgent && c.aiAgent.startedAt >= since);
  const resolved = list.filter(c => c.aiAgent!.state === 'resolved').length;
  const handoff = list.filter(c => c.aiAgent!.state === 'handoff').length;
  const reasons: Record<string, number> = {};
  for (const c of list) if (c.aiAgent!.state === 'handoff' && c.aiAgent!.reason) {
    const r = c.aiAgent!.reason.replace(/\s*\([\s\S]*\)\s*$/, '').replace(/“[\s\S]*”/, '…').slice(0, 100);
    reasons[r] = (reasons[r] || 0) + 1;
  }
  return res.json({
    days, total: list.length, active: list.filter(c => c.aiAgent!.state === 'active').length, resolved, handoff,
    resolutionRate: list.length ? resolved / list.length : null,
    replies: list.reduce((n, c) => n + (c.aiAgent!.replies || 0), 0),
    topHandoffReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
  });
}

/** POST /api/tickets/:id/ai-takeover — a teammate takes the conversation from the AI Agent. */
export async function takeOverFromAi(req: AuthenticatedRequest, res: Response) {
  const convRepo = RepositoryFactory.getConversationRepository();
  const conv = await convRepo.findById(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
  await takeOver(conv, me?.name || 'A teammate');
  // Taking over makes it yours
  const updated = await convRepo.update(conv.id, { assignedAgentId: req.user?.id, status: 'open' });
  if (updated) (await import('../services/socket')).SocketService.broadcastConversationUpdate(updated);
  return res.json(updated || conv);
}

/** POST /api/messenger/ai-feedback { conversationId, action: helpful | not_helpful | human } — public (X-Customer-Id). */
export async function aiFeedback(req: AuthenticatedRequest, res: Response) {
  const { conversationId, action } = req.body || {};
  if (!['helpful', 'not_helpful', 'human'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
  const conv = typeof conversationId === 'string' ? await RepositoryFactory.getConversationRepository().findById(conversationId) : null;
  if (!conv || req.headers['x-customer-id'] !== conv.customer.id) return res.status(404).json({ error: 'Conversation not found' });
  const updated = await customerFeedback(conv, action);
  return res.json(toCustomerView(updated || conv));
}
