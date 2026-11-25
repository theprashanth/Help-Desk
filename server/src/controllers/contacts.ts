import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Conversation, Customer } from '../../../shared/src/types';
import { recordEvent, getActor } from '../services/events';
import { logAudit } from '../services/audit';
import { toCsv } from '../services/csv';
import { companiesRepo } from './org';
import { INTERNAL_CUSTOMER_ID } from './tickets';

/**
 * Contacts (the people who write in): a browsable list with search, filters and sorting, one contact's
 * full history, merging two records of the same person, deleting a contact, and CSV export.
 * Editing a contact's fields reuses PUT /api/customers/:id.
 */

type Row = {
  id: string; name: string; email?: string; phone?: string; externalId?: string;
  companyId?: string; companyName?: string; tags: string[]; country?: string;
  firstSeen?: string; lastSeen?: string; lastContacted?: string;
  conversations: number; openConversations: number; blocked?: boolean;
};

const SORTS = ['name', 'lastSeen', 'firstSeen', 'conversations', 'lastContacted'] as const;
type Sort = typeof SORTS[number];

async function buildRows(): Promise<Row[]> {
  const [customers, convs, companies] = await Promise.all([
    RepositoryFactory.getCustomerRepository().findAll(),
    RepositoryFactory.getConversationRepository().findAll(),
    companiesRepo.list(),
  ]);
  const companyName = new Map(companies.map(c => [c.id, c.name]));
  const stats = new Map<string, { n: number; open: number; last?: string }>();
  for (const c of convs) {
    if (c.kind === 'issue' || c.mergedInto) continue;
    const s = stats.get(c.customer.id) || { n: 0, open: 0 };
    s.n++;
    if (c.status === 'open' || c.status === 'waiting') s.open++;
    if (!s.last || c.updatedAt > s.last) s.last = c.updatedAt;
    stats.set(c.customer.id, s);
  }
  return customers
    .filter(c => c.id !== INTERNAL_CUSTOMER_ID)
    .map(c => {
      const s = stats.get(c.id);
      return {
        id: c.id, name: c.name, email: c.email || undefined, phone: c.phone || undefined, externalId: c.externalId,
        companyId: c.companyId, companyName: c.companyId ? companyName.get(c.companyId) : undefined,
        tags: c.tags || [], country: c.session?.country,
        firstSeen: c.session?.firstSeen, lastSeen: c.session?.lastSeen, lastContacted: s?.last,
        conversations: s?.n || 0, openConversations: s?.open || 0, blocked: c.blocked || undefined,
      };
    });
}

function filterAndSort(rows: Row[], q: Record<string, any>): Row[] {
  const search = String(q.search || '').trim().toLowerCase();
  const tag = String(q.tag || '');
  const company = String(q.companyId || '');
  const sort: Sort = SORTS.includes(q.sort) ? q.sort : 'lastSeen';
  const asc = q.dir === 'asc';
  const out = rows.filter(r =>
    (!search || [r.name, r.email, r.phone, r.id, r.externalId, r.companyName].some(v => (v || '').toLowerCase().includes(search))) &&
    (!tag || r.tags.includes(tag)) &&
    (!company || (company === 'none' ? !r.companyId : r.companyId === company)) &&
    (q.status !== 'open' || r.openConversations > 0) &&
    (q.status !== 'blocked' || !!r.blocked));
  const key = (r: Row): string | number => (sort === 'name' ? (r.name || '').toLowerCase() : sort === 'conversations' ? r.conversations : (r[sort] || ''));
  return out.sort((a, b) => {
    const ka = key(a), kb = key(b);
    const d = ka < kb ? -1 : ka > kb ? 1 : 0;
    return asc ? d : -d;
  });
}

/** GET /api/contacts?search&tag&companyId&status=open|blocked&sort&dir&page&pageSize */
export async function listContacts(req: AuthenticatedRequest, res: Response) {
  try {
    const rows = filterAndSort(await buildRows(), req.query);
    const pageSize = Math.min(200, Math.max(10, parseInt(String(req.query.pageSize || '50'), 10) || 50));
    const page = Math.max(0, parseInt(String(req.query.page || '0'), 10) || 0);
    return res.json({ total: rows.length, page, pageSize, rows: rows.slice(page * pageSize, page * pageSize + pageSize) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/contacts/export.csv — same filters as the list, every matching contact. */
export async function exportContacts(req: AuthenticatedRequest, res: Response) {
  try {
    const rows = filterAndSort(await buildRows(), req.query);
    const csv = toCsv(
      ['User ID', 'External ID', 'Name', 'Email', 'Phone', 'Company', 'Tags', 'Country', 'First seen', 'Last seen', 'Conversations', 'Open', 'Blocked'],
      rows.map(r => [r.id, r.externalId || '', r.name, r.email || '', r.phone || '', r.companyName || '', r.tags.join('; '), r.country || '',
        r.firstSeen || '', r.lastSeen || '', r.conversations, r.openConversations, r.blocked ? 'yes' : '']),
    );
    await logAudit(req, 'data.contacts_exported', `Exported ${rows.length} contact${rows.length === 1 ? '' : 's'}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/contacts/:id — the person, their company, every conversation, and recent pages they wrote from. */
export async function getContact(req: AuthenticatedRequest, res: Response) {
  try {
    const customer = await RepositoryFactory.getCustomerRepository().findById(req.params.id);
    if (!customer || customer.id === INTERNAL_CUSTOMER_ID) return res.status(404).json({ error: 'Contact not found' });
    const company = customer.companyId ? await companiesRepo.get(customer.companyId) : null;
    const convs = (await RepositoryFactory.getConversationRepository().findAll())
      .filter(c => c.customer.id === customer.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const msgRepo = RepositoryFactory.getMessageRepository();
    const pages = new Map<string, string>();
    for (const c of convs.slice(0, 30)) {
      for (const m of await msgRepo.findByConversationId(c.id, 500)) {
        const url = m.sender.type === 'customer' ? m.metadata?.sourceUrl : undefined;
        if (url && (!pages.has(url) || pages.get(url)! < m.createdAt)) pages.set(url, m.createdAt);
      }
    }
    return res.json({
      customer,
      company,
      conversations: convs.map(c => ({
        id: c.id, ticketNumber: c.ticketNumber, kind: c.kind || 'conversation', title: c.title, status: c.status,
        channel: c.channel, snippet: c.lastMessageSnippet, createdAt: c.createdAt, updatedAt: c.updatedAt,
        mergedInto: c.mergedInto ? true : undefined, rating: c.rating?.score,
      })),
      pageViews: [...pages.entries()].map(([url, at]) => ({ url, at })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/contacts/:id (admins) — deletes the person and every conversation they had, with its
 * messages. Can't be undone; recorded in the audit log.
 */
export async function deleteContact(req: AuthenticatedRequest, res: Response) {
  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();
    const customer = await custRepo.findById(req.params.id);
    if (!customer || customer.id === INTERNAL_CUSTOMER_ID) return res.status(404).json({ error: 'Contact not found' });
    const convs = (await convRepo.findAll()).filter(c => c.customer.id === customer.id);
    const gone = new Set(convs.map(c => c.id));
    for (const c of convs) {
      await msgRepo.deleteByConversationId(c.id);
      await convRepo.delete(c.id);
      SocketService.broadcastConversationDeleted(c.id, customer.id);
    }
    // Other conversations merged into one of these would point at nothing: un-merge them
    for (const c of await convRepo.findAll()) {
      if (c.mergedInto && gone.has((c.mergedInto as any).id)) await convRepo.update(c.id, { mergedInto: null } as any, { touch: false });
    }
    await (await import('../services/sideConversations')).deleteSideConversationsFor(gone);
    await custRepo.delete(customer.id);
    await logAudit(req, 'data.contact_deleted', `Deleted contact ${customer.name}${customer.email ? ` (${customer.email})` : ''} and ${convs.length} conversation${convs.length === 1 ? '' : 's'}`,
      { target: customer.id, details: { conversations: convs.length } });
    return res.json({ deleted: true, conversations: convs.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/contacts/merge { primaryId, secondaryId } — the same person known twice (e.g. once from email,
 * once from the Messenger). The secondary's conversations move to the primary; empty fields on the primary
 * are filled from the secondary; tags, notes and attributes are combined (the primary's values win); the
 * secondary record is removed.
 */
export async function mergeContacts(req: AuthenticatedRequest, res: Response) {
  const { primaryId, secondaryId } = req.body || {};
  if (!primaryId || !secondaryId || primaryId === secondaryId) return res.status(400).json({ error: 'Pick two different contacts' });
  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const [primary, secondary] = await Promise.all([custRepo.findById(primaryId), custRepo.findById(secondaryId)]);
    if (!primary || !secondary || [primary.id, secondary.id].includes(INTERNAL_CUSTOMER_ID)) return res.status(404).json({ error: 'Contact not found' });
    if (primary.externalId && secondary.externalId && primary.externalId !== secondary.externalId) {
      return res.status(400).json({ error: 'Both contacts have a different user ID from your own system, so they are different people' });
    }

    const earliest = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
    const latest = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);
    const merged: Partial<Customer> = {
      name: primary.name && !/^(Guest|User |Unknown)/i.test(primary.name) ? primary.name : (secondary.name || primary.name),
      email: primary.email || secondary.email,
      phone: primary.phone || secondary.phone,
      externalId: primary.externalId || secondary.externalId,
      companyId: primary.companyId || secondary.companyId,
      tags: Array.from(new Set([...(primary.tags || []), ...(secondary.tags || [])])),
      notes: [...(primary.notes || []), ...(secondary.notes || [])],
      attributes: { ...(secondary.attributes || {}), ...(primary.attributes || {}) },
      blocked: primary.blocked || secondary.blocked || undefined,
      session: {
        ...secondary.session, ...primary.session,
        firstSeen: earliest(primary.session?.firstSeen, secondary.session?.firstSeen),
        lastSeen: latest(primary.session?.lastSeen, secondary.session?.lastSeen),
        totalConversations: (primary.session?.totalConversations || 0) + (secondary.session?.totalConversations || 0),
      },
    };
    // The external ID moves to the primary: take it off the secondary first so lookups never find two records
    if (secondary.externalId && !primary.externalId) await custRepo.update(secondary.id, { externalId: null } as any);
    const updated = await custRepo.update(primary.id, merged);
    if (!updated) return res.status(404).json({ error: 'Contact not found' });

    const actor = await getActor(req);
    const moved: Conversation[] = [];
    for (const c of (await convRepo.findAll()).filter(c => c.customer.id === secondary.id)) {
      const after = await convRepo.update(c.id, { customer: updated }, { touch: false });
      if (after) {
        moved.push(after);
        SocketService.broadcastConversationUpdate(after);
        await recordEvent(c.id, 'attributes', `${actor?.name || 'A teammate'} merged contact ${secondary.name} into ${updated.name}`, actor,
          { field: 'customerMerged', from: secondary.id, to: updated.id });
      }
    }
    // The primary's own conversations show the updated profile too
    for (const c of (await convRepo.findAll()).filter(c => c.customer.id === updated.id && !moved.some(m => m.id === c.id))) {
      SocketService.broadcastConversationUpdate({ ...c, customer: updated });
    }
    await custRepo.delete(secondary.id);
    await logAudit(req, 'data.contacts_merged', `Merged contact ${secondary.name} into ${updated.name}`,
      { target: updated.id, details: { from: secondary.id, conversations: moved.length } });
    return res.json({ customer: updated, movedConversations: moved.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
