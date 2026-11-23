import { Request, Response } from 'express';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import type { Conversation, Message } from '../../../shared/src/types';

/**
 * GET /api/analytics?days=7|30|90 (default 30)
 *
 * Every number here is computed from stored conversations and messages; when there is no data
 * the values are 0 / null and the arrays are empty or zero-filled, never made up.
 *
 * - First response time: first public human agent reply (no internal notes, no bot / auto-reply /
 *   merge messages) minus the first customer message before it. Counted in the range by the
 *   customer message's time.
 * - Resolution time: the last status event to 'resolved' / 'closed' minus the conversation's
 *   createdAt, for conversations currently resolved or closed. Conversations closed without a
 *   recorded status event (e.g. CSV imports) have no known resolution time and are left out.
 * - Merged conversations are skipped everywhere.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_RANGES = [7, 30, 90];
const NON_HUMAN_AGENT_TYPES = new Set(['bot', 'auto_reply', 'merge', 'merged_indicator']);
const DONE = new Set(['resolved', 'closed']);

const ts = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Seconds, rounded; null stays null. */
const secs = (ms: number | null) => (ms == null ? null : Math.round(ms / 1000));

const isHumanAgentReply = (m: Message) =>
  m.sender?.type === 'agent' && !m.isInternalNote && !NON_HUMAN_AGENT_TYPES.has(m.metadata?.type);

const isStatusEvent = (m: Message) => m.metadata?.type === 'event' && m.metadata?.field === 'status';

export async function getAnalytics(req: Request, res: Response) {
  try {
    const requested = parseInt(String(req.query.days ?? ''), 10);
    const days = ALLOWED_RANGES.includes(requested) ? requested : 30;

    const [allConversations, allMessages, agents, customers] = await Promise.all([
      RepositoryFactory.getConversationRepository().findAll(),
      RepositoryFactory.getMessageRepository().findAll(),
      RepositoryFactory.getUserRepository().findAll(),
      RepositoryFactory.getCustomerRepository().findAll(),
    ]);

    const conversations = (allConversations as Conversation[]).filter(c => !c.mergedInto && c.status !== 'merged');
    const convIds = new Set(conversations.map(c => c.id));

    // Messages per conversation, oldest first. System messages are dropped except status events.
    const byConv = new Map<string, Message[]>();
    for (const m of allMessages as Message[]) {
      if (!convIds.has(m.conversationId)) continue;
      if (m.sender?.type === 'system' && !isStatusEvent(m)) continue;
      if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
      byConv.get(m.conversationId)!.push(m);
    }
    for (const list of byConv.values()) list.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));

    const now = Date.now();
    const todayStart = startOfDay(now);
    const rangeStart = startOfDay(now - (days - 1) * DAY_MS);
    const inRange = (t: number) => t >= rangeStart && t <= now;

    // Day buckets for the charts (zero-filled so the axis is continuous)
    const buckets: { key: string; date: string; label: string }[] = [];
    for (let t = rangeStart; t <= now; t += DAY_MS) {
      const d = new Date(t);
      buckets.push({
        key: dayKey(t),
        date: d.toISOString(),
        label: d.toLocaleDateString('en-US', days <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
      });
    }
    const created = new Map<string, number>();
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();
    const frtByDay = new Map<string, number[]>();
    const inc = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) || 0) + 1);

    const firstResponses: number[] = [];
    const resolutions: number[] = [];
    let resolvedToday = 0;
    let conversationsInRange = 0;

    const perAgent = new Map<string, { assigned: number; replied: number; resolved: number }>();
    const agentStats = (id: string) => {
      if (!perAgent.has(id)) perAgent.set(id, { assigned: 0, replied: 0, resolved: 0 });
      return perAgent.get(id)!;
    };

    for (const c of conversations) {
      const msgs = byConv.get(c.id) || [];
      const createdAt = ts(c.createdAt);

      if (inRange(createdAt)) {
        conversationsInRange++;
        inc(created, dayKey(createdAt));
        if (c.assignedAgentId) agentStats(c.assignedAgentId).assigned++;
      }

      // Message volume + which agents replied in range
      const repliedBy = new Set<string>();
      for (const m of msgs) {
        const t = ts(m.createdAt);
        if (!inRange(t)) continue;
        if (m.sender?.type === 'customer') inc(inbound, dayKey(t));
        else if (isHumanAgentReply(m)) {
          inc(outbound, dayKey(t));
          if (m.sender.id) repliedBy.add(m.sender.id);
        }
      }
      for (const id of repliedBy) agentStats(id).replied++;

      // First response time
      const firstCustomer = msgs.find(m => m.sender?.type === 'customer');
      if (firstCustomer) {
        const asked = ts(firstCustomer.createdAt);
        const reply = msgs.find(m => isHumanAgentReply(m) && ts(m.createdAt) >= asked);
        if (reply && inRange(asked)) {
          const frt = ts(reply.createdAt) - asked;
          firstResponses.push(frt);
          const key = dayKey(asked);
          if (!frtByDay.has(key)) frtByDay.set(key, []);
          frtByDay.get(key)!.push(frt);
        }
      }

      // Resolution: last status event to resolved/closed, only if it is still resolved/closed
      if (DONE.has(c.status)) {
        const lastDone = [...msgs].reverse().find(m => isStatusEvent(m) && DONE.has(m.metadata?.to));
        if (lastDone) {
          const resolvedAt = ts(lastDone.createdAt);
          if (resolvedAt >= todayStart) resolvedToday++;
          if (inRange(resolvedAt)) {
            resolutions.push(Math.max(0, resolvedAt - createdAt));
            if (lastDone.metadata?.actorId) agentStats(lastDone.metadata.actorId).resolved++;
          }
        }
      }
    }

    const awayIds = new Set(agents.filter(a => a.away).map(a => a.id));
    const onlineAgents = Array.from(SocketService.onlineAgents.keys()).filter(id => !awayIds.has(id)).length;

    const agentNames = new Map(agents.map(a => [a.id, a.name]));
    const agentPerformance = Array.from(perAgent.entries())
      .filter(([id, s]) => agentNames.has(id) && (s.assigned || s.replied || s.resolved))
      .map(([id, s]) => ({ agentId: id, name: agentNames.get(id)!, ...s }))
      .sort((a, b) => b.replied + b.resolved + b.assigned - (a.replied + a.resolved + a.assigned));

    // CSAT: ratings given in the range; score = share of 4-5 ratings
    const ratings = conversations.filter(c => c.rating && inRange(ts(c.rating.at))).map(c => c.rating!.score);
    const csatScore = ratings.length ? Math.round((ratings.filter(s => s >= 4).length / ratings.length) * 100) : null;
    const csatAverage = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

    const medianFrt = median(firstResponses);
    const avgFrt = average(firstResponses);
    const medianRes = median(resolutions);
    const avgRes = average(resolutions);

    return res.json({
      range: { days, from: new Date(rangeStart).toISOString(), to: new Date(now).toISOString() },
      summary: {
        openTickets: conversations.filter(c => c.status === 'open' || c.status === 'waiting').length,
        resolvedToday,
        activeCustomers: customers.length,
        onlineAgents,
        conversationsInRange,
        // Durations in seconds; null = no data in the range
        medianFirstResponseSec: secs(medianFrt),
        avgFirstResponseSec: secs(avgFrt),
        firstResponseCount: firstResponses.length,
        medianResolutionSec: secs(medianRes),
        avgResolutionSec: secs(avgRes),
        resolutionCount: resolutions.length,
        csatScore,               // % of ratings that were 4 or 5; null = no ratings
        csatAverage,
        csatCount: ratings.length,
      },
      charts: {
        dailyTickets: buckets.map(b => ({ day: b.label, date: b.date, count: created.get(b.key) || 0 })),
        conversationVolume: buckets.map(b => ({
          day: b.label,
          date: b.date,
          inbound: inbound.get(b.key) || 0,
          outbound: outbound.get(b.key) || 0,
        })),
        // Median first response per day, in minutes (null on days with no replied conversations)
        responseTimeTrends: buckets.map(b => {
          const m = median(frtByDay.get(b.key) || []);
          return { day: b.label, date: b.date, minutes: m == null ? null : Math.round((m / 60000) * 10) / 10 };
        }),
        agentPerformance,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
