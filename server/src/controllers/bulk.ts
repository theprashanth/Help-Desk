import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { recordEvent, recordUpdateEvents, getActor } from '../services/events';
import { Conversation } from '../../../shared/src/types';
import { logAudit } from '../services/audit';

const STATUSES = ['open', 'waiting', 'resolved', 'closed', 'archived'];
const PRIORITIES = ['none', 'low', 'medium', 'high', 'critical'];
const CATEGORIES = ['general', 'bug', 'payment', 'subscription', 'refund', 'feature_request', 'other'];
const MAX_BULK = 500;

/** Same view/filter query params as GET /api/tickets, without status. */
function viewFilters(req: AuthenticatedRequest) {
  const q = req.query;
  const list = (v: unknown) => (v ? String(v).split(',') : undefined);
  const createdBy = q.createdBy as string | undefined;
  return {
    priority: list(q.priority),
    category: list(q.category),
    assignedAgentId: q.assignedAgentId !== undefined ? String(q.assignedAgentId) : undefined,
    search: q.search ? String(q.search) : undefined,
    tag: q.tag ? String(q.tag) : undefined,
    kind: list(q.kind),
    createdByAgentId: createdBy === 'me' ? req.user?.id : createdBy,
    bot: q.bot === 'handled' ? 'handled' as const : undefined,
  };
}

/**
 * GET /api/tickets/state-counts — how many conversations in the current view are in each state,
 * for the "N Open" dropdown. Snoozed = open/waiting with a future snooze time.
 */
export async function getStateCounts(req: AuthenticatedRequest, res: Response) {
  try {
    const list = await RepositoryFactory.getConversationRepository().findFiltered(viewFilters(req));
    const now = Date.now();
    const snoozed = (c: Conversation) => !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now;
    const counts = { open: 0, waiting: 0, snoozed: 0, resolved: 0, closed: 0, archived: 0, all: 0 };
    for (const c of list) {
      if (!STATUSES.includes(c.status)) continue; // e.g. merged
      counts.all++;
      if (c.status === 'open' || c.status === 'waiting') {
        if (snoozed(c)) counts.snoozed++;
        else {
          counts.open++;
          if (c.status === 'waiting') counts.waiting++;
        }
      } else {
        (counts as any)[c.status]++;
      }
    }
    return res.json(counts);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/tickets/bulk  { ids: string[], action, value? }
 * action: status | snooze | assign | priority | category | addTag | delete
 * Applies the change to every conversation, records events and broadcasts updates.
 * `delete` is admin-only and permanently removes the conversations and their messages.
 */
export async function bulkUpdate(req: AuthenticatedRequest, res: Response) {
  const { ids, action, value } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string')) {
    return res.status(400).json({ error: 'ids must be a non-empty array of conversation ids' });
  }
  if (ids.length > MAX_BULK) return res.status(400).json({ error: `At most ${MAX_BULK} conversations at a time` });

  // Validate the action + value once, up front
  let patch: Partial<Conversation> | null = null;
  switch (action) {
    case 'status':
      if (!STATUSES.includes(value)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
      patch = { status: value };
      break;
    case 'snooze':
      if (value !== null && (typeof value !== 'string' || isNaN(Date.parse(value)))) {
        return res.status(400).json({ error: 'snooze value must be an ISO date or null' });
      }
      patch = { snoozedUntil: value };
      break;
    case 'priority':
      if (!PRIORITIES.includes(value)) return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
      patch = { priority: value };
      break;
    case 'category':
      if (!CATEGORIES.includes(value)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
      patch = { category: value };
      break;
    case 'addTag':
      if (typeof value !== 'string' || !value.trim() || value.length > 50) return res.status(400).json({ error: 'tag must be a non-empty string' });
      break;
    case 'assign':
      if (value !== null && typeof value !== 'string') return res.status(400).json({ error: 'assign value must be an agent id or null' });
      break;
    case 'delete':
      if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete conversations' });
      break;
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }

  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();
    const actor = await getActor(req);
    let assigneeName: string | undefined;
    if (action === 'assign' && value) {
      const assignee = await RepositoryFactory.getUserRepository().findById(value);
      if (!assignee) return res.status(404).json({ error: 'Teammate not found' });
      assigneeName = assignee.name;
    }

    const done: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const before = await convRepo.findById(id);
        if (!before) { failed.push({ id, error: 'not found' }); continue; }

        if (action === 'delete') {
          await msgRepo.deleteByConversationId(id);
          await convRepo.delete(id);
          SocketService.broadcastConversationDeleted(id, before.customer.id);
          done.push(id);
          continue;
        }

        let update: Partial<Conversation> = patch || {};
        if (action === 'addTag') {
          const tags = before.tags || [];
          if (tags.includes(value)) { done.push(id); continue; }
          update = { tags: [...tags, value.trim()] };
        }
        if (action === 'assign') update = { assignedAgentId: value || undefined };

        const after = await convRepo.update(id, update);
        if (!after) { failed.push({ id, error: 'update failed' }); continue; }
        SocketService.broadcastConversationUpdate(after);

        if (action === 'assign') {
          if ((before.assignedAgentId || null) !== (value || null)) {
            const who = actor?.name || 'A teammate';
            const text = !value ? `${who} unassigned this conversation`
              : actor && actor.id === value ? `${who} assigned themselves` : `${who} assigned ${assigneeName}`;
            await recordEvent(id, 'assignment', text, actor, { targetId: value || null, targetName: assigneeName, bulk: true });
          }
        } else {
          await recordUpdateEvents(before, after, actor);
        }
        done.push(id);
      } catch (e: any) {
        failed.push({ id, error: e.message });
      }
    }
    if (action === 'delete' && done.length) {
      await (await import('../services/sideConversations')).deleteSideConversationsFor(done);
      // Deleted issues: the conversations linked to them are unlinked
      const gone = new Set(done);
      for (const c of await convRepo.findAll()) {
        if (!c.linkedIssueId || !gone.has(c.linkedIssueId)) continue;
        const after = await convRepo.update(c.id, { linkedIssueId: null as any }, { touch: false });
        if (after) SocketService.broadcastConversationUpdate(after);
      }
      await logAudit(req, 'data.conversations_deleted', `Deleted ${done.length} conversation${done.length === 1 ? '' : 's'}`, { details: { ids: done.slice(0, 50) } });
    }
    return res.json({ action, updated: done.length, ids: done, failed });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
