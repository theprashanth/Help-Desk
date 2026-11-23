import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage } from '../context/tenant.context';
import { SocketService, AGENTS_ROOM } from './socket';
import { recordUpdateEvents } from './events';

/**
 * Background jobs. Every minute: conversations whose snooze has ended wake up — the snooze is
 * cleared, an "unsnoozed" event is recorded, and agents get `conversation:unsnoozed` so the
 * dashboard can alert the assignee and refresh counts.
 */
async function wakeSnoozed() {
  const workspaces = await RepositoryFactory.getWorkspaceRepository().findAll();
  const now = new Date().toISOString();
  for (const ws of workspaces) {
    await tenantStorage.run(ws.id, async () => {
      const repo = RepositoryFactory.getConversationRepository();
      const due = (await repo.findAll()).filter(c => c.snoozedUntil && c.snoozedUntil <= now);
      for (const before of due) {
        const after = await repo.update(before.id, { snoozedUntil: null });
        if (!after) continue;
        await recordUpdateEvents(before, after); // "System unsnoozed this conversation"
        SocketService.broadcastConversationUpdate(after);
        try { SocketService.emitToRoom(AGENTS_ROOM, 'conversation:unsnoozed', after); } catch { /* sockets not ready */ }
      }
    });
  }
}

let running = false;
export function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await wakeSnoozed(); } catch (err: any) { console.error('[Scheduler] Snooze wake-up failed:', err.message); }
    finally { running = false; }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 60_000).unref?.();
}
