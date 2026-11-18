import { Conversation } from '../../../../shared/src/types';
import { isSnoozed } from './snooze';

/**
 * Inbox views (left panel) decide WHICH conversations; the state filter (the "N Open" chip)
 * decides WHAT STATE they're in. View ids:
 *   yours | created | all | unassigned | agent:<agentId> | kind:conversation | kind:ticket | kind:issue
 */
export type StateFilter = 'open' | 'waiting' | 'snoozed' | 'resolved' | 'closed' | 'archived' | 'all';

export const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

export const isInboxView = (id: string) =>
  ['yours', 'created', 'all', 'unassigned', 'bot'].includes(id) || id.startsWith('agent:') || id.startsWith('kind:');

/** Statuses to request from the server for a state filter (snooze is applied client-side). */
export function statusesFor(state: StateFilter): string[] {
  switch (state) {
    case 'open':
    case 'snoozed': return ['open', 'waiting'];
    case 'waiting': return ['waiting'];
    case 'resolved': return ['resolved'];
    case 'closed': return ['closed'];
    case 'archived': return ['archived'];
    default: return ['open', 'waiting', 'resolved', 'closed', 'archived'];
  }
}

/** Query-string params for a view (without status). */
export function viewParams(view: string, myId?: string): string {
  if (view === 'yours') return `assignedAgentId=${encodeURIComponent(myId || '')}`;
  if (view === 'created') return 'createdBy=me';
  if (view === 'unassigned') return 'assignedAgentId=unassigned';
  if (view.startsWith('agent:')) return `assignedAgentId=${encodeURIComponent(view.slice(6))}`;
  if (view.startsWith('kind:')) return `kind=${encodeURIComponent(view.slice(5))}`;
  if (view === 'bot') return 'bot=handled';
  return '';
}

/** Does a conversation belong in this view (ignoring state)? */
export function matchesView(c: Conversation, view: string, myId?: string): boolean {
  if (view === 'yours') return !!myId && c.assignedAgentId === myId;
  if (view === 'created') return !!myId && c.createdByAgentId === myId;
  if (view === 'unassigned') return !c.assignedAgentId;
  if (view.startsWith('agent:')) return c.assignedAgentId === view.slice(6);
  if (view.startsWith('kind:')) return (c.kind || 'conversation') === view.slice(5);
  if (view === 'bot') return !!c.bot && c.bot.state !== 'handoff';
  return true;
}

/** Does a conversation match a state filter (including snooze)? */
export function matchesState(c: Conversation, state: StateFilter, now: number = Date.now()): boolean {
  if (!statusesFor(state).includes(c.status)) return false;
  const snoozed = isSnoozed(c, now);
  if (state === 'snoozed') return snoozed;
  if (state === 'open' || state === 'waiting') return !snoozed;
  return true;
}

export const KIND_LABELS: Record<string, string> = {
  conversation: 'Conversations',
  ticket: 'Tickets',
  issue: 'Issues',
};
