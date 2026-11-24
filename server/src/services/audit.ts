import { RecordRepository } from '../repositories/records';
import { RepositoryFactory } from '../repositories/factory';
import { AuditEntry } from '../../../shared/src/types';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * Workspace audit log (Settings › Audit log): settings changes, teammates, teams, imports,
 * exports and deletions. Best-effort: a failure to log never fails the action itself.
 */
export const auditRepo = new RecordRepository<AuditEntry>('audit_log', 'audit');
const MAX_ENTRIES = 5000;

export async function logAudit(
  req: AuthenticatedRequest | null,
  action: string,
  summary: string,
  opts: { target?: string; details?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    let actor: AuditEntry['actor'] = null;
    if (req?.user) {
      const me = await RepositoryFactory.getUserRepository().findById(req.user.id);
      actor = { id: req.user.id, name: me?.name || req.user.email || 'Teammate' };
    }
    const ip = req ? (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || undefined) : undefined;
    await auditRepo.create({ action, summary, actor, ...(opts.target ? { target: opts.target } : {}), ...(opts.details ? { details: opts.details } : {}), ...(ip ? { ip } : {}) });
    if (Math.random() < 0.05) await auditRepo.prune(MAX_ENTRIES);
  } catch (err: any) {
    console.error('[Audit] Failed to log:', err.message);
  }
}

/** Names of the fields that differ between two objects (for "Changed X, Y" summaries). */
export function changedKeys(before: Record<string, any> | null | undefined, after: Record<string, any>): string[] {
  return Object.keys(after).filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after[k]));
}
