import crypto from 'crypto';
import { RepositoryFactory } from '../repositories/factory';
import { bulkImportJson } from '../repositories/json.repo';
import { bulkImportMongo } from '../repositories/mongoose.repo';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { Agent, Conversation, Customer, DataImportType, Message, TicketCategory } from '../../../shared/src/types';

/**
 * CSV imports (Settings › Data › Imports & exports).
 *  - people:        one row per contact (Intercom "People" export)
 *  - conversations: one row per conversation or ticket, optionally with its first message
 *  - messages:      one row per message ("conversation parts"), attached by conversation id
 * Columns are recognised by name (Intercom's names and common alternatives) and can be remapped.
 */

export type FieldDef = { key: string; label: string; synonyms: string[]; hint?: string };
export type Mapping = Record<string, string | null>; // field key -> CSV header (or null = not imported)

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export const FIELDS: Record<DataImportType, FieldDef[]> = {
  people: [
    { key: 'externalId', label: 'User ID', synonyms: ['userid', 'externalid', 'customerid', 'contactuserid', 'contactexternalid'] },
    { key: 'name', label: 'Name', synonyms: ['name', 'fullname', 'contactname', 'username', 'customername', 'leadname'] },
    { key: 'firstName', label: 'First name', synonyms: ['firstname', 'givenname'] },
    { key: 'lastName', label: 'Last name', synonyms: ['lastname', 'surname', 'familyname'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'emailaddress', 'useremail', 'contactemail', 'customeremail'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'contactphone'] },
    { key: 'city', label: 'City', synonyms: ['city', 'locationcity', 'citymaxmind'] },
    { key: 'country', label: 'Country', synonyms: ['country', 'locationcountry', 'countrymaxmind', 'location'] },
    { key: 'timezone', label: 'Time zone', synonyms: ['timezone', 'tz'] },
    { key: 'createdAt', label: 'Signed up / first seen', synonyms: ['signedup', 'signedupat', 'createdat', 'firstseen', 'firstseenat', 'created'] },
    { key: 'lastSeen', label: 'Last seen', synonyms: ['lastseen', 'lastseenat', 'lastactive', 'lastactiveat', 'lastheardfrom'] },
    { key: 'tags', label: 'Tags', synonyms: ['tags', 'tag', 'usertags', 'contacttags'], hint: 'Separated by commas or semicolons' },
  ],
  conversations: [
    { key: 'importId', label: 'Conversation / ticket ID', synonyms: ['conversationid', 'id', 'ticketid', 'conversationidentifier'], hint: 'Used to skip duplicates and to attach messages later' },
    { key: 'url', label: 'Conversation URL', synonyms: ['conversationurl', 'url', 'link', 'ticketurl'] },
    { key: 'createdAt', label: 'Created at', synonyms: ['createdat', 'conversationstartedat', 'startedat', 'conversationcreatedat', 'created', 'submittedat', 'ticketcreatedat', 'datecreated'] },
    { key: 'updatedAt', label: 'Last updated', synonyms: ['updatedat', 'lastupdated', 'lastupdatedat', 'lastactivityat', 'conversationlastupdated', 'ticketupdatedat'] },
    { key: 'state', label: 'State', synonyms: ['state', 'status', 'conversationstate', 'ticketstate', 'ticketstatus'] },
    { key: 'priority', label: 'Priority', synonyms: ['priority', 'prioritized', 'ticketpriority'] },
    { key: 'assignee', label: 'Assignee (name)', synonyms: ['assignee', 'teammateassigned', 'assignedto', 'adminassignee', 'assigneename', 'assignedteammate', 'teammate', 'owner'] },
    { key: 'assigneeEmail', label: 'Assignee email', synonyms: ['assigneeemail', 'teammateemail', 'adminassigneeemail', 'assignedtoemail'] },
    { key: 'customerExternalId', label: 'Contact user ID', synonyms: ['userid', 'externalid', 'contactuserid', 'contactexternalid', 'customerid'] },
    { key: 'customerName', label: 'Contact name', synonyms: ['contactname', 'username', 'customername', 'name', 'leadname', 'requester', 'requestername', 'fullname'] },
    { key: 'customerEmail', label: 'Contact email', synonyms: ['contactemail', 'useremail', 'customeremail', 'email', 'requesteremail', 'emailaddress'] },
    { key: 'customerPhone', label: 'Contact phone', synonyms: ['contactphone', 'userphone', 'customerphone', 'phone'] },
    { key: 'title', label: 'Title / subject', synonyms: ['title', 'subject', 'tickettitle', 'conversationtitle', 'conversationsubject'] },
    { key: 'description', label: 'Ticket description', synonyms: ['description', 'ticketdescription'] },
    { key: 'ticketType', label: 'Ticket type', synonyms: ['tickettype', 'ticketcategory'], hint: 'Any value marks the row as a ticket' },
    { key: 'category', label: 'Category', synonyms: ['category', 'topic', 'conversationtopic'] },
    { key: 'tags', label: 'Tags', synonyms: ['tags', 'conversationtags', 'tag'], hint: 'Separated by commas or semicolons' },
    { key: 'body', label: 'First message', synonyms: ['body', 'firstmessage', 'initialmessage', 'conversationbody', 'message', 'sourcebody', 'conversationsourcebody', 'firstcustomermessage', 'conversationmessage'] },
  ],
  messages: [
    { key: 'conversationId', label: 'Conversation ID', synonyms: ['conversationid', 'conversation', 'ticketid', 'conversationidentifier'] },
    { key: 'partId', label: 'Message / part ID', synonyms: ['partid', 'conversationpartid', 'messageid', 'id'] },
    { key: 'createdAt', label: 'Created at', synonyms: ['createdat', 'sentat', 'timestamp', 'created', 'date', 'partcreatedat'] },
    { key: 'authorType', label: 'Author type', synonyms: ['authortype', 'fromtype', 'sendertype', 'author_type', 'authorrole'], hint: 'user / lead / contact = customer; admin / teammate = team; bot / operator / fin = bot' },
    { key: 'authorName', label: 'Author name', synonyms: ['authorname', 'author', 'from', 'sendername', 'name'] },
    { key: 'authorEmail', label: 'Author email', synonyms: ['authoremail', 'fromemail', 'senderemail', 'email'] },
    { key: 'partType', label: 'Part type', synonyms: ['parttype', 'messagetype', 'type'], hint: '"note" makes it an internal note' },
    { key: 'body', label: 'Body', synonyms: ['body', 'message', 'content', 'text', 'partbody', 'messagebody'] },
  ],
};

/** Which columns are required (at least one of each group). */
const REQUIRED: Record<DataImportType, string[][]> = {
  people: [['email', 'externalId', 'name', 'firstName']],
  conversations: [['importId', 'body', 'title', 'customerEmail', 'customerExternalId']],
  messages: [['conversationId'], ['body']],
};

export function suggestMapping(type: DataImportType, headers: string[]): Mapping {
  const used = new Set<string>();
  const byNorm = new Map(headers.map(h => [norm(h), h]));
  const mapping: Mapping = {};
  for (const f of FIELDS[type]) {
    const hit = f.synonyms.map(s => byNorm.get(s)).find(h => h && !used.has(h)) || null;
    mapping[f.key] = hit;
    if (hit) used.add(hit);
  }
  return mapping;
}

export function checkMapping(type: DataImportType, mapping: Mapping): string | null {
  for (const group of REQUIRED[type]) {
    if (!group.some(k => mapping[k])) {
      const labels = group.map(k => FIELDS[type].find(f => f.key === k)!.label);
      return group.length === 1 ? `Map a column to "${labels[0]}"` : `Map at least one of: ${labels.join(', ')}`;
    }
  }
  return null;
}

// ── Value helpers ────────────────────────────────────────────────────────────

/** ISO, "2024-03-01 10:22:33 UTC", unix seconds/ms, and most spreadsheet date formats. */
export function parseDate(v?: string): string | null {
  const s = (v || '').trim();
  if (!s) return null;
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const cleaned = s
    .replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(:\d{2})?(\.\d+)?)\s*UTC$/i, '$1T$2Z')
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})/, '$1T$2')
    .replace(/\s+UTC$/i, ' GMT');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Intercom message bodies are HTML; keep readable text with line breaks. */
export function htmlToText(v?: string): string {
  const s = (v || '').trim();
  if (!/<[a-z!/][^>]*>/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) => (text && text !== href ? `${text} (${href})` : href))
    .replace(/<img [^>]*src="([^"]+)"[^>]*>/gi, '[image: $1]')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const splitTags = (v?: string) => (v || '').split(/[;,|]/).map(t => t.trim()).filter(Boolean);
const lower = (v?: string) => (v || '').trim().toLowerCase();
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

function mapState(v?: string): Conversation['status'] {
  const s = lower(v).replace(/[\s-]+/g, '_');
  if (['closed', 'close', 'done'].includes(s)) return 'closed';
  if (['resolved', 'solved'].includes(s)) return 'resolved';
  if (['waiting_on_customer', 'pending', 'waiting', 'awaiting_customer', 'on_hold'].includes(s)) return 'waiting';
  return 'open'; // open, submitted, in_progress, snoozed, new, ''
}

function mapPriority(v?: string): Conversation['priority'] {
  const s = lower(v);
  if (/urgent|critical|p0|p1/.test(s)) return 'critical';
  if (/high|^yes$|^true$|^priority$|prioriti/.test(s)) return 'high';
  if (/low|p3|p4/.test(s)) return 'low';
  if (/medium|normal|p2/.test(s)) return 'medium';
  return 'none';
}

const CATEGORIES: TicketCategory[] = ['general', 'bug', 'payment', 'subscription', 'refund', 'feature_request', 'other'];
function mapCategory(v?: string): TicketCategory {
  const s = lower(v).replace(/[\s-]+/g, '_');
  if (!s) return 'general';
  const exact = CATEGORIES.find(c => c === s);
  if (exact) return exact;
  if (/bug|error|crash|technical|broken/.test(s)) return 'bug';
  if (/refund/.test(s)) return 'refund';
  if (/subscri|plan|cancel/.test(s)) return 'subscription';
  if (/pay|billing|invoice|charge/.test(s)) return 'payment';
  if (/feature|request|idea/.test(s)) return 'feature_request';
  return 'general';
}

function authorKind(v?: string): 'customer' | 'agent' | 'bot' {
  const s = lower(v);
  if (/bot|operator|fin|automation|workflow/.test(s)) return 'bot';
  if (/admin|teammate|agent|team|staff/.test(s)) return 'agent';
  return 'customer'; // user, lead, contact, visitor, customer, ''
}

const newId = (prefix: string) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

// ── Import ───────────────────────────────────────────────────────────────────

export type ImportResult = {
  rows: number; created: number; updated: number; skipped: number;
  errors: { row: number; message: string }[];
  conversationsCreated?: number; messagesCreated?: number;
};

type Plan = { customers: any[]; conversations: any[]; messages: any[]; conversationPatches: Record<string, Record<string, any>> };

class Context {
  customers: Customer[] = [];
  byEmail = new Map<string, Customer>();
  byExternal = new Map<string, Customer>();
  agents: Agent[] = [];
  conversations: Conversation[] = [];
  byImportId = new Map<string, Conversation>();
  touchedCustomers = new Map<string, Customer>();

  async load(needConversations: boolean) {
    this.customers = await RepositoryFactory.getCustomerRepository().findAll();
    for (const c of this.customers) this.index(c);
    this.agents = await RepositoryFactory.getUserRepository().findAll();
    if (needConversations) {
      this.conversations = await RepositoryFactory.getConversationRepository().findAll();
      for (const c of this.conversations) if (c.importedFrom?.id) this.byImportId.set(c.importedFrom.id, c);
    }
  }
  index(c: Customer) {
    if (c.email) this.byEmail.set(lower(c.email), c);
    if (c.externalId) this.byExternal.set(c.externalId, c);
  }
  agentFor(name?: string, email?: string): Agent | undefined {
    const e = lower(email), n = lower(name);
    return (e && this.agents.find(a => lower(a.email) === e)) || (n && this.agents.find(a => lower(a.name) === n)) || undefined;
  }
  /** Find or create the contact for a row; new/changed contacts are written with the plan. */
  customerFor(info: { externalId?: string; email?: string; name?: string; phone?: string }, at: string): Customer {
    const email = validEmail(lower(info.email)) ? lower(info.email) : '';
    const found = (info.externalId && this.byExternal.get(info.externalId)) || (email && this.byEmail.get(email)) || undefined;
    if (found) return found;
    const c: Customer = {
      id: crypto.randomUUID(),
      externalId: info.externalId || undefined,
      name: info.name?.trim() || (email ? email.split('@')[0] : 'Imported contact'),
      email, phone: info.phone || '',
      session: { firstSeen: at, lastSeen: at, totalConversations: 0 },
      tags: [], notes: [],
    };
    this.customers.push(c);
    this.index(c);
    this.touchedCustomers.set(c.id, c);
    return c;
  }
  bumpConversations(c: Customer, at: string) {
    const s = c.session || ({} as any);
    c.session = {
      ...s,
      totalConversations: (s.totalConversations || 0) + 1,
      firstSeen: !s.firstSeen || at < s.firstSeen ? at : s.firstSeen,
      lastSeen: !s.lastSeen || at > s.lastSeen ? at : s.lastSeen,
    };
    this.touchedCustomers.set(c.id, c);
  }
}

const get = (row: Record<string, string>, mapping: Mapping, key: string) => {
  const h = mapping[key];
  return h ? (row[h] ?? '').trim() : '';
};

async function commit(plan: Plan): Promise<Record<string, string>> {
  if (RepositoryFactory.isJson()) {
    await bulkImportJson(plan);
    return {};
  }
  return (await bulkImportMongo(plan, getActiveWorkspaceId())).ids;
}

export async function runImport(type: DataImportType, rows: Record<string, string>[], mapping: Mapping): Promise<ImportResult> {
  const result: ImportResult = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
  const fail = (i: number, message: string) => { if (result.errors.length < 500) result.errors.push({ row: i + 2, message }); };
  const ctx = new Context();
  await ctx.load(type !== 'people');
  const plan: Plan = { customers: [], conversations: [], messages: [], conversationPatches: {} };
  const now = new Date().toISOString();

  if (type === 'people') {
    rows.forEach((row, i) => {
      const name = get(row, mapping, 'name') || [get(row, mapping, 'firstName'), get(row, mapping, 'lastName')].filter(Boolean).join(' ');
      const rawEmail = lower(get(row, mapping, 'email'));
      const email = validEmail(rawEmail) ? rawEmail : '';
      const externalId = get(row, mapping, 'externalId');
      if (rawEmail && !email) return fail(i, `"${rawEmail}" isn't a valid email address`);
      if (!name && !email && !externalId) return fail(i, 'Row has no name, email or user ID');
      const createdAt = parseDate(get(row, mapping, 'createdAt')) || undefined;
      const lastSeen = parseDate(get(row, mapping, 'lastSeen')) || undefined;
      const location = [get(row, mapping, 'city'), get(row, mapping, 'country')].filter(Boolean).join(', ');
      const tags = splitTags(get(row, mapping, 'tags'));
      const phone = get(row, mapping, 'phone');
      const timezone = get(row, mapping, 'timezone');

      const existing = (externalId && ctx.byExternal.get(externalId)) || (email && ctx.byEmail.get(email)) || undefined;
      if (existing) {
        // Fill in what the CSV has; never blank out what we already know
        if (name) existing.name = name;
        if (email && !existing.email) existing.email = email;
        if (phone) existing.phone = phone;
        if (externalId && !existing.externalId) existing.externalId = externalId;
        existing.tags = Array.from(new Set([...(existing.tags || []), ...tags]));
        existing.session = {
          ...existing.session,
          ...(location ? { country: location } : {}),
          ...(timezone ? { timezone } : {}),
          ...(createdAt && (!existing.session?.firstSeen || createdAt < existing.session.firstSeen) ? { firstSeen: createdAt } : {}),
          ...(lastSeen && (!existing.session?.lastSeen || lastSeen > existing.session.lastSeen) ? { lastSeen } : {}),
        };
        ctx.index(existing);
        ctx.touchedCustomers.set(existing.id, existing);
        result.updated++;
        return;
      }
      const c: Customer = {
        id: crypto.randomUUID(),
        externalId: externalId || undefined,
        name: name || (email ? email.split('@')[0] : `User ${externalId}`),
        email, phone,
        session: {
          firstSeen: createdAt || lastSeen || now,
          lastSeen: lastSeen || createdAt || now,
          totalConversations: 0,
          ...(location ? { country: location } : {}),
          ...(timezone ? { timezone } : {}),
        },
        tags, notes: [],
      };
      ctx.customers.push(c);
      ctx.index(c);
      ctx.touchedCustomers.set(c.id, c);
      result.created++;
    });
  }

  if (type === 'conversations') {
    const importIdHeader = norm(mapping.importId || '');
    const stateHeader = norm(mapping.state || '');
    rows.forEach((row, i) => {
      const importId = get(row, mapping, 'importId');
      if (importId && ctx.byImportId.has(importId)) { result.skipped++; return; } // already imported
      const createdAt = parseDate(get(row, mapping, 'createdAt')) || now;
      const updatedAt = parseDate(get(row, mapping, 'updatedAt')) || createdAt;
      const body = htmlToText(get(row, mapping, 'body'));
      const title = get(row, mapping, 'title');
      const customer = ctx.customerFor({
        externalId: get(row, mapping, 'customerExternalId'),
        email: get(row, mapping, 'customerEmail'),
        name: get(row, mapping, 'customerName'),
        phone: get(row, mapping, 'customerPhone'),
      }, createdAt);
      if (!importId && !body && !title && !customer.email && !customer.externalId) return fail(i, 'Row has no conversation ID, message, title or contact');
      const agent = ctx.agentFor(get(row, mapping, 'assignee'), get(row, mapping, 'assigneeEmail'));
      const isTicket = !!get(row, mapping, 'ticketType') || importIdHeader === 'ticketid' || stateHeader.startsWith('ticket');
      const id = newId('conv');
      const conv: any = {
        id,
        customerId: customer.id,
        assignedAgentId: agent?.id,
        status: mapState(get(row, mapping, 'state')),
        priority: mapPriority(get(row, mapping, 'priority')),
        category: mapCategory(get(row, mapping, 'category') || get(row, mapping, 'ticketType')),
        lastMessageSnippet: body.slice(0, 200),
        customerSnippet: body.slice(0, 200) || undefined,
        unreadCountAgent: 0,
        unreadCountCustomer: 0,
        starred: false,
        snoozedUntil: null,
        tags: splitTags(get(row, mapping, 'tags')),
        kind: isTicket ? 'ticket' : 'conversation',
        title: title || undefined,
        description: htmlToText(get(row, mapping, 'description')) || undefined,
        attributes: {},
        sharing: 'shared',
        importedFrom: { source: 'csv', id: importId || id, ...(get(row, mapping, 'url') ? { url: get(row, mapping, 'url') } : {}) },
        createdAt,
        updatedAt,
      };
      plan.conversations.push(conv);
      if (importId) ctx.byImportId.set(importId, { id } as Conversation);
      ctx.bumpConversations(customer, createdAt);
      if (body) {
        plan.messages.push({
          id: newId('msg'), conversationId: id,
          sender: { type: 'customer', id: customer.id, name: customer.name },
          content: body, attachments: [], isInternalNote: false, seen: true, delivered: true, reactions: [],
          metadata: { type: 'imported', importKey: `first:${importId || id}` },
          createdAt,
        });
      }
      result.created++;
    });
    result.conversationsCreated = plan.conversations.length;
    result.messagesCreated = plan.messages.length;
  }

  if (type === 'messages') {
    // Group rows by conversation, keeping file order
    const groups = new Map<string, { row: Record<string, string>; i: number }[]>();
    rows.forEach((row, i) => {
      const cid = get(row, mapping, 'conversationId');
      if (!cid) return fail(i, 'Row has no conversation ID');
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push({ row, i });
    });
    const msgRepo = RepositoryFactory.getMessageRepository();
    let conversationsCreated = 0;

    for (const [cid, items] of groups) {
      let conv = ctx.byImportId.get(cid);
      let convId: string;
      let customer: Customer;
      const known = new Set<string>();
      let lastAt = '';
      let lastPublic = '';

      if (conv && conv.id) {
        convId = conv.id;
        customer = conv.customer || ctx.customers.find(c => c.id === (conv as any).customerId)!;
        for (const m of await msgRepo.findByConversationId(conv.id, 100000, 0)) if (m.metadata?.importKey) known.add(m.metadata.importKey);
        lastAt = conv.updatedAt || '';
      } else {
        // No such conversation yet: start one from the first customer row
        const first = items.find(x => authorKind(get(x.row, mapping, 'authorType')) === 'customer') || items[0];
        const at = parseDate(get(first.row, mapping, 'createdAt')) || now;
        customer = ctx.customerFor({ email: get(first.row, mapping, 'authorEmail'), name: get(first.row, mapping, 'authorName') }, at);
        convId = newId('conv');
        plan.conversations.push({
          id: convId, customerId: customer.id, status: 'closed', priority: 'medium', category: 'general',
          lastMessageSnippet: '', unreadCountAgent: 0, unreadCountCustomer: 0, starred: false, snoozedUntil: null,
          tags: [], kind: 'conversation', attributes: {}, sharing: 'shared',
          importedFrom: { source: 'csv', id: cid }, createdAt: at, updatedAt: at,
        });
        ctx.byImportId.set(cid, { id: convId } as Conversation);
        ctx.bumpConversations(customer, at);
        conversationsCreated++;
      }
      const newConv = plan.conversations.find(c => c.id === convId);

      for (const { row, i } of items) {
        const body = htmlToText(get(row, mapping, 'body'));
        if (!body) { result.skipped++; continue; } // assignment / state parts have no text
        const at = parseDate(get(row, mapping, 'createdAt')) || newConv?.createdAt || now;
        const partId = get(row, mapping, 'partId');
        const key = partId ? `part:${partId}` : `msg:${cid}:${at}:${crypto.createHash('sha1').update(body).digest('hex').slice(0, 12)}`;
        if (known.has(key)) { result.skipped++; continue; }
        known.add(key);
        const kind = authorKind(get(row, mapping, 'authorType'));
        const name = get(row, mapping, 'authorName');
        const note = /note/i.test(get(row, mapping, 'partType'));
        let sender: Message['sender'];
        let metadata: Record<string, any> = { type: 'imported', importKey: key };
        if (kind === 'customer') sender = { type: 'customer', id: customer.id, name: customer.name };
        else if (kind === 'bot') { sender = { type: 'agent', id: 'bot', name: name || 'Bot' }; metadata = { type: 'bot', importKey: key }; }
        else {
          const agent = ctx.agentFor(name, get(row, mapping, 'authorEmail'));
          sender = { type: 'agent', id: agent?.id || `imported:${lower(name) || 'teammate'}`, name: agent?.name || name || 'Teammate' };
        }
        plan.messages.push({
          id: newId('msg'), conversationId: convId, sender, content: body, attachments: [],
          isInternalNote: note, seen: true, delivered: true, reactions: [], metadata, createdAt: at,
        });
        if (!lastAt || at >= lastAt) { lastAt = at; }
        if (!note) lastPublic = body;
        result.created++;
        void i;
      }

      // Preview text and last activity follow the newest imported message
      const snippet = lastPublic.slice(0, 200);
      if (newConv) {
        if (snippet) { newConv.lastMessageSnippet = snippet; newConv.customerSnippet = snippet; }
        if (lastAt) newConv.updatedAt = lastAt;
      } else if (snippet || lastAt) {
        plan.conversationPatches[convId] = {
          ...(snippet ? { lastMessageSnippet: snippet, customerSnippet: snippet } : {}),
          ...(lastAt ? { updatedAt: lastAt } : {}),
        };
      }
    }
    result.conversationsCreated = conversationsCreated;
    result.messagesCreated = result.created;
  }

  plan.customers = Array.from(ctx.touchedCustomers.values());
  if (plan.customers.length || plan.conversations.length || plan.messages.length || Object.keys(plan.conversationPatches).length) {
    await commit(plan);
  }
  return result;
}
