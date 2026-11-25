import { randomUUID } from 'crypto';
import { RepositoryFactory } from '../repositories/factory';
import type { Customer, Workspace } from '../../../shared/src/types';
import { verifyUserHash } from './messenger';

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

// ── Signed-in users from your own app ────────────────────────────────────────


/**
 * Must a user_id come with a valid user_hash? Yes when an admin turned identity verification on; in
 * production it's on unless an admin explicitly turned it off, so a user id typed into the browser
 * can't open someone else's conversations.
 */
export function identityRequired(ws?: Workspace | null): boolean {
  if (typeof ws?.identityEnforced === 'boolean') return ws.identityEnforced;
  return process.env.NODE_ENV === 'production';
}

export type IdentityCheck = 'none' | 'verified' | 'unverified' | 'rejected';

/** none: no user_id · verified: hash matches · unverified: no/wrong hash but not required · rejected: required and missing/wrong. */
export function checkIdentity(ws: Workspace | null | undefined, userId: unknown, userHash: unknown): IdentityCheck {
  if (typeof userId !== 'string' || !userId.trim()) return 'none';
  if (verifyUserHash(ws?.identitySecret, userId.trim(), userHash)) return 'verified';
  return identityRequired(ws) ? 'rejected' : 'unverified';
}

const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Your app is the source of truth for a signed-in user's name, email and phone: copy any that changed
 * onto their contact. Empty values never wipe what's there.
 */
export async function syncProfile(customer: Customer, profile: { name?: unknown; email?: unknown; phone?: unknown }): Promise<Customer> {
  const next: Partial<Customer> = {};
  const name = clean(profile.name, 120), email = clean(profile.email, 200)?.toLowerCase(), phone = clean(profile.phone, 40);
  if (name && name !== customer.name) next.name = name;
  if (email && email !== (customer.email || '').toLowerCase()) next.email = email;
  if (phone && phone !== customer.phone) next.phone = phone;
  if (!Object.keys(next).length) return customer;
  return (await RepositoryFactory.getCustomerRepository().update(customer.id, next)) || customer;
}

/**
 * A guest in this browser signed in: their earlier conversations move to the signed-in person's contact
 * and the guest record is removed, so the team sees one person with one history. Only guests (no
 * external user id of their own) are ever moved.
 */
export async function adoptGuest(guestId: unknown, into: Customer): Promise<number> {
  if (typeof guestId !== 'string' || !guestId || guestId === into.id) return 0;
  const custRepo = RepositoryFactory.getCustomerRepository();
  const guest = await custRepo.findById(guestId);
  if (!guest || guest.externalId) return 0;
  const convRepo = RepositoryFactory.getConversationRepository();
  const { SocketService } = await import('./socket');
  const { recordEvent } = await import('./events');
  let moved = 0;
  for (const c of (await convRepo.findAll()).filter(c => c.customer.id === guest.id)) {
    const after = await convRepo.update(c.id, { customer: into }, { touch: false });
    if (after) {
      moved++;
      SocketService.broadcastConversationUpdate(after);
      await recordEvent(c.id, 'attributes', `${guest.name} signed in as ${into.name}; this conversation moved to their profile`, undefined,
        { field: 'customerMerged', from: guest.id, to: into.id });
    }
  }
  await custRepo.update(into.id, {
    tags: Array.from(new Set([...(into.tags || []), ...(guest.tags || [])])),
    notes: [...(into.notes || []), ...(guest.notes || [])],
    session: { ...guest.session, ...into.session, totalConversations: (into.session?.totalConversations || 0) + (guest.session?.totalConversations || 0) },
  });
  await custRepo.delete(guest.id);
  return moved;
}
