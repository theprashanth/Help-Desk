import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from './socket';
import { isOpenAt, nextOpening, isValidTimeZone } from './officeHours';
import { Conversation, Workspace } from '../../../shared/src/types';

const REPLY_TEXT: Record<string, string> = {
  asap: 'will reply as soon as they can.',
  minutes: 'usually replies in a few minutes.',
  hours: 'usually replies in a few hours.',
  day: 'usually replies in a day.',
};

/** "Tue 9:00 AM" / "today at 9:00 AM" / "tomorrow at 9:00 AM" in the workspace timezone. */
function formatBack(at: Date, now: Date, timeZone: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  if (day(at) === day(now)) return `today at ${time}`;
  if (day(at) === day(new Date(now.getTime() + 86400000))) return `tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(at);
  return `${weekday} at ${time}`;
}

/** The customer-facing sentence, e.g. "Chai Samosa usually replies in a few minutes." */
export function buildReplyNotice(ws: Workspace | null, now: Date = new Date()): string {
  const name = ws?.customerFacingName?.trim() || ws?.name?.trim() || 'The team';
  const officeHours = ws?.officeHours;
  if (officeHours && !isOpenAt(officeHours, now)) {
    const next = nextOpening(officeHours, now);
    const tz = isValidTimeZone(officeHours.timezone) ? officeHours.timezone : 'UTC';
    return next
      ? `${name} is away right now. We'll be back ${formatBack(next, now, tz)} and will reply then.`
      : `${name} is away right now. We'll reply as soon as we're back.`;
  }
  // Unset reply time = "a few minutes", matching what Settings > Office hours shows by default
  return `${name} ${REPLY_TEXT[ws?.replyTime || 'minutes'] || REPLY_TEXT.minutes}`;
}

/**
 * After a customer starts a conversation, post an automated message telling them when to expect
 * a reply (Settings > Office hours > "Tell customers your reply time"). Never throws.
 */
export async function sendReplyTimeNotice(conv: Conversation, workspaceId: string): Promise<void> {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceId);
    if (ws && ws.replyTimeNotice === false) return;
    const msg = await RepositoryFactory.getMessageRepository().create({
      conversationId: conv.id,
      sender: { type: 'agent', id: 'bot', name: ws?.customerFacingName?.trim() || ws?.name || 'Chai Samosa' },
      content: buildReplyNotice(ws),
      attachments: [],
      isInternalNote: false,
      seen: false,
      delivered: true,
      reactions: [],
      metadata: { type: 'auto_reply' },
    });
    SocketService.broadcastMessageNew(msg);
  } catch (err) {
    console.error('[AutoReply] Failed to send reply-time notice:', err);
  }
}
