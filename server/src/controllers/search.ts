import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { Conversation, Message } from '../../../shared/src/types';

/** Split a query into terms: "quoted phrases" stay together, other words split on spaces. */
export function parseQuery(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const t = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (t) terms.push(t);
  }
  return [...new Set(terms)].slice(0, 10);
}

/** ~140 chars of context around the first matching term. */
function snippetAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  if (at === -1) return text.slice(0, 140);
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, at + 90);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

const FIELD_WEIGHT: Record<string, number> = {
  ticket: 12, title: 10, customer: 8, tag: 6, description: 5, message: 3, note: 2, attachment: 3,
};

interface Match { field: string; label: string; snippet: string; messageId?: string; at?: string }

/**
 * GET /api/search — search everything the team can see.
 * q: words (all must match somewhere in the conversation) and "exact phrases".
 * Filters: type, assignee (id|unassigned), tag, customerId, status (incl. snoozed), priority,
 *          startedFrom / startedTo (ISO dates), title. sort: newest | oldest | relevance.
 */
export async function searchConversations(req: AuthenticatedRequest, res: Response) {
  try {
    const q = String(req.query.q || '').slice(0, 200);
    const terms = parseQuery(q);
    const list = (v: unknown) => (v ? String(v).split(',').filter(Boolean) : []);
    const types = list(req.query.type);
    const statuses = list(req.query.status);
    const priorities = list(req.query.priority);
    const assignee = req.query.assignee ? String(req.query.assignee) : '';
    const tag = req.query.tag ? String(req.query.tag) : '';
    const customerId = req.query.customerId ? String(req.query.customerId) : '';
    const title = String(req.query.title || '').trim().toLowerCase();
    const from = req.query.startedFrom ? Date.parse(String(req.query.startedFrom)) : NaN;
    const to = req.query.startedTo ? Date.parse(String(req.query.startedTo)) : NaN;
    const sort = ['newest', 'oldest', 'relevance'].includes(String(req.query.sort)) ? String(req.query.sort) : (terms.length ? 'relevance' : 'newest');
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

    const hasFilter = types.length || statuses.length || priorities.length || assignee || tag || customerId || title || !isNaN(from) || !isNaN(to);
    if (!terms.length && !hasFilter) return res.json({ total: 0, results: [], terms });

    const now = Date.now();
    const isSnoozed = (c: Conversation) => !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now;

    // 1. Filters on conversation fields
    let convs = (await RepositoryFactory.getConversationRepository().findAll()).filter(c => c.status !== 'merged' || statuses.includes('merged'));
    if (types.length) convs = convs.filter(c => types.includes(c.kind || 'conversation'));
    if (statuses.length) convs = convs.filter(c =>
      statuses.some(s => s === 'snoozed' ? (['open', 'waiting'].includes(c.status) && isSnoozed(c))
        : s === 'open' ? (c.status === 'open' && !isSnoozed(c)) : c.status === s));
    if (priorities.length) convs = convs.filter(c => priorities.includes(c.priority));
    if (assignee) convs = convs.filter(c => assignee === 'unassigned' ? !c.assignedAgentId : c.assignedAgentId === assignee);
    if (tag) convs = convs.filter(c => (c.tags || []).includes(tag) || (c.customer.tags || []).includes(tag));
    if (customerId) convs = convs.filter(c => c.customer.id === customerId);
    if (title) convs = convs.filter(c => (c.title || '').toLowerCase().includes(title));
    if (!isNaN(from)) convs = convs.filter(c => Date.parse(c.createdAt) >= from);
    if (!isNaN(to)) convs = convs.filter(c => Date.parse(c.createdAt) <= to);

    // 2. Text matching: every term must appear somewhere in the conversation
    const byConv = new Map<string, Message[]>();
    if (terms.length) {
      const ids = new Set(convs.map(c => c.id));
      for (const m of await RepositoryFactory.getMessageRepository().searchByTerms(terms)) {
        if (!ids.has(m.conversationId)) continue;
        const arr = byConv.get(m.conversationId) || [];
        arr.push(m);
        byConv.set(m.conversationId, arr);
      }
    }

    const results: { conversation: Conversation; matches: Match[]; score: number }[] = [];
    for (const c of convs) {
      if (!terms.length) { results.push({ conversation: c, matches: [], score: 0 }); continue; }
      const fields: { field: string; label: string; text: string; messageId?: string; at?: string }[] = [
        { field: 'ticket', label: 'Ticket', text: `${c.ticketNumber} ${c.id}` },
        { field: 'title', label: 'Title', text: c.title || '' },
        { field: 'description', label: 'Description', text: c.description || '' },
        { field: 'customer', label: 'Customer', text: [c.customer.name, c.customer.email, c.customer.phone, c.customer.id, c.customer.externalId].filter(Boolean).join(' · ') },
        { field: 'tag', label: 'Tags', text: [...(c.tags || []), ...(c.customer.tags || [])].join(' ') },
      ];
      for (const m of byConv.get(c.id) || []) {
        fields.push({ field: m.isInternalNote ? 'note' : 'message', label: m.isInternalNote ? `Note by ${m.sender.name}` : m.sender.name, text: m.content || '', messageId: m.id, at: m.createdAt });
        const extra = [...(m.attachments || []).map(a => a.name), ...(m.tags || [])].join(' ');
        if (extra) fields.push({ field: 'attachment', label: `${m.sender.name} (attachment/tag)`, text: extra, messageId: m.id, at: m.createdAt });
      }
      const lowerFields = fields.map(f => f.text.toLowerCase());
      if (!terms.every(t => lowerFields.some(f => f.includes(t)))) continue;

      let score = 0;
      const matches: Match[] = [];
      fields.forEach((f, i) => {
        const hits = terms.filter(t => lowerFields[i].includes(t)).length;
        if (!hits) return;
        score += hits * (FIELD_WEIGHT[f.field] || 1);
        matches.push({ field: f.field, label: f.label, snippet: snippetAround(f.text, terms), messageId: f.messageId, at: f.at });
      });
      matches.sort((a, b) => (FIELD_WEIGHT[b.field] || 1) - (FIELD_WEIGHT[a.field] || 1));
      results.push({ conversation: c, matches: matches.slice(0, 3), score });
    }

    const t = (c: Conversation) => Date.parse(c.updatedAt || c.createdAt);
    results.sort((a, b) =>
      sort === 'oldest' ? t(a.conversation) - t(b.conversation)
      : sort === 'relevance' ? (b.score - a.score) || (t(b.conversation) - t(a.conversation))
      : t(b.conversation) - t(a.conversation));

    return res.json({ total: results.length, results: results.slice(0, limit), terms, sort });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
