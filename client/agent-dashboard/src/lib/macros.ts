import { Conversation, MacroActions, SavedReply } from '../../../../shared/src/types';

const BACKEND_URL = 'http://localhost:3000';

const STATE_LABELS: Record<string, string> = { open: 'Open', waiting: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed' };
const PRIORITY_LABELS: Record<string, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', critical: 'Urgent' };

export const hasMacroActions = (r?: Pick<SavedReply, 'actions'> | null): boolean =>
  !!r?.actions && Object.keys(r.actions).length > 0;

export function formatSnooze(mins: number): string {
  if (mins % (60 * 24) === 0) { const d = mins / (60 * 24); return `${d} day${d === 1 ? '' : 's'}`; }
  if (mins % 60 === 0) { const h = mins / 60; return `${h} hour${h === 1 ? '' : 's'}`; }
  return `${mins} min`;
}

/** Short human labels for what a macro does, e.g. ["Close", "Add tag: refund"]. */
export function describeMacroActions(a: MacroActions | undefined, teammates: { id: string; name: string }[] = []): string[] {
  if (!a) return [];
  const out: string[] = [];
  if (a.assignTo) {
    out.push(a.assignTo === 'me' ? 'Assign to me'
      : a.assignTo === 'unassigned' ? 'Unassign'
      : `Assign to ${teammates.find(t => t.id === a.assignTo)?.name || 'teammate'}`);
  }
  if (a.status) out.push(a.status === 'open' ? 'Reopen' : `Set state: ${STATE_LABELS[a.status] || a.status}`);
  if (a.priority) out.push(`Priority: ${PRIORITY_LABELS[a.priority] || a.priority}`);
  if (a.addTags?.length) out.push(`Add tag${a.addTags.length > 1 ? 's' : ''}: ${a.addTags.join(', ')}`);
  if (a.snoozeMinutes) out.push(`Snooze ${formatSnooze(a.snoozeMinutes)}`);
  return out;
}

/**
 * Apply a macro's actions to a conversation through the normal endpoints, so the usual events,
 * customer state lines and live updates all happen. Assignment goes first because assigning
 * reopens the conversation; the state change then wins.
 */
export async function applyMacroActions(
  conv: Pick<Conversation, 'id' | 'tags'>,
  actions: MacroActions,
  ctx: { token: string | null; agentId?: string },
): Promise<{ ok: boolean; error?: string }> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` };
  try {
    if (actions.assignTo) {
      const agentId = actions.assignTo === 'me' ? ctx.agentId : actions.assignTo === 'unassigned' ? null : actions.assignTo;
      const res = await fetch(`${BACKEND_URL}/api/tickets/${conv.id}/assign`, { method: 'PUT', headers, body: JSON.stringify({ agentId }) });
      if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error || 'Could not assign' };
    }
    const patch: Record<string, unknown> = {};
    if (actions.status) patch.status = actions.status;
    if (actions.priority) patch.priority = actions.priority;
    if (actions.addTags?.length) {
      const current = conv.tags || [];
      const merged = Array.from(new Set([...current, ...actions.addTags]));
      if (merged.length !== current.length) patch.tags = merged;
    }
    if (actions.snoozeMinutes) patch.snoozedUntil = new Date(Date.now() + actions.snoozeMinutes * 60_000).toISOString();
    if (Object.keys(patch).length) {
      const res = await fetch(`${BACKEND_URL}/api/tickets/${conv.id}`, { method: 'PUT', headers, body: JSON.stringify(patch) });
      if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error || 'Could not update the conversation' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}
