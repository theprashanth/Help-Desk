import { randomUUID } from 'crypto';
import { RepositoryFactory } from '../repositories/factory';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Decide the customer's User id. Every NEW customer gets a UUID
 * (e.g. 47f1664a-c15e-42fc-b74e-5046559f92db), guest or logged-in.
 *  - Logged-in users (externalUserId = your system's id): reuse the customer already linked to that
 *    id (same person on any device), otherwise create one with a UUID and remember the external id.
 *  - Guests: keep the browser's UUID; legacy ids (guest_…) are kept only if that customer already
 *    exists, so returning visitors don't lose their history. Anything else gets a fresh UUID.
 */
export async function resolveCustomerId(customerId: unknown, externalUserId?: unknown): Promise<{ id: string; externalId?: string }> {
  const repo = RepositoryFactory.getCustomerRepository();
  const external = typeof externalUserId === 'string' && externalUserId.trim() ? externalUserId.trim().slice(0, 200) : undefined;

  if (external) {
    const linked = await repo.findByExternalId(external);
    if (linked) return { id: linked.id, externalId: external };
    // Legacy: before UUIDs, a logged-in user's own id was used as their customer id — keep that record
    const legacy = await repo.findById(external);
    if (legacy) return { id: legacy.id, externalId: external };
    // A browser UUID that is still unclaimed can become this user's id; otherwise mint one
    if (isUuid(customerId) && !(await repo.findById(customerId))) return { id: customerId, externalId: external };
    return { id: randomUUID(), externalId: external };
  }

  if (isUuid(customerId)) return { id: customerId };
  if (typeof customerId === 'string' && customerId && (await repo.findById(customerId))) return { id: customerId }; // legacy, existing
  return { id: randomUUID() };
}
