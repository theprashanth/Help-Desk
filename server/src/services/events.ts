import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from './socket';
import { AuthenticatedRequest } from '../middleware/auth';
import { Conversation, ConversationEventCategory } from '../../../shared/src/types';

export type Actor = { id: string; name: string };

/** Who performed the request (an agent), if authenticated. */
export async function getActor(req: AuthenticatedRequest): Promise<Actor | undefined> {
  if (!req.user) return undefined;
  const user = await RepositoryFactory.getUserRepository().findById(req.user.id);
  return user ? { id: user.id, name: user.name } : { id: req.user.id, name: req.user.email };
}

/**
 * Record a conversation event (status change, assignment, ...). Events are stored as
 * agent-only system messages so they appear inline in the thread for teammates, never for
 * customers, and they don't change the conversation's preview or unread counts.
 *
 * `text` is the fully rendered sentence (e.g. "Rishi set state to Resolved"); `extra`
 * carries the structured bits the dashboard uses to render "You" instead of your own name.
 */
export async function recordEvent(
  conversationId: string,
  category: ConversationEventCategory,
  text: string,
  actor?: Actor,
  extra: Record<string, any> = {}
): Promise<void> {
  try {
    const msg = await RepositoryFactory.getMessageRepository().create({
      conversationId,
      sender: { type: 'system', id: actor?.id || 'system', name: actor?.name || 'System' },
      content: text,
      attachments: [],
      isInternalNote: true,
      seen: true,
      delivered: true,
      reactions: [],
      metadata: { type: 'event', category, actorId: actor?.id, actorName: actor?.name, ...extra }
    });
    SocketService.broadcastMessageNew(msg);
  } catch (err) {
    console.error('[Events] Failed to record event:', err);
  }
}

const STATE_LABELS: Record<string, string> = {
  open: 'In progress',
  waiting: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
  archived: 'Archived',
  merged: 'Merged',
};
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—');
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Compare a conversation before/after an update and record one event per meaningful change. */
export async function recordUpdateEvents(before: Conversation, after: Conversation, actor?: Actor) {
  const who = actor?.name || 'System';
  const id = after.id;

  if (before.status !== after.status) {
    await recordEvent(id, 'status', `${who} set state to ${STATE_LABELS[after.status] || after.status}`, actor,
      { field: 'status', from: before.status, to: after.status });
  }
  const wasSnoozed = !!before.snoozedUntil;
  const isSnoozedNow = !!after.snoozedUntil;
  if (isSnoozedNow && before.snoozedUntil !== after.snoozedUntil) {
    await recordEvent(id, 'status', `${who} snoozed until ${fmtTime(after.snoozedUntil!)}`, actor,
      { field: 'snoozedUntil', to: after.snoozedUntil });
  } else if (wasSnoozed && !isSnoozedNow) {
    await recordEvent(id, 'status', `${who} unsnoozed this conversation`, actor, { field: 'snoozedUntil', to: null });
  }
  if (before.priority !== after.priority) {
    await recordEvent(id, 'priority', `${who} changed priority from ${cap(before.priority)} to ${cap(after.priority)}`, actor,
      { field: 'priority', from: before.priority, to: after.priority });
  }
  if (!!before.starred !== !!after.starred) {
    await recordEvent(id, 'priority', after.starred ? `${who} flagged this as priority` : `${who} removed the priority flag`, actor,
      { field: 'starred', to: !!after.starred });
  }
  if (before.category !== after.category) {
    await recordEvent(id, 'attributes', `${who} set Category to ${cap(after.category)}`, actor,
      { field: 'category', from: before.category, to: after.category });
  }
  if ((before.title || '') !== (after.title || '') && after.title) {
    await recordEvent(id, 'attributes', `${who} changed the title to "${after.title}"`, actor, { field: 'title', to: after.title });
  }
  const bp = (before.attributes?.platforms || []).join(', ');
  const ap = (after.attributes?.platforms || []).join(', ');
  if (bp !== ap) {
    await recordEvent(id, 'attributes', `${who} set Platforms to ${ap || '—'}`, actor, { field: 'platforms', to: ap });
  }
  if ((before.attributes?.rootCause || '') !== (after.attributes?.rootCause || '')) {
    await recordEvent(id, 'attributes', `${who} set Root cause to ${after.attributes?.rootCause || '—'}`, actor,
      { field: 'rootCause', to: after.attributes?.rootCause });
  }
}
