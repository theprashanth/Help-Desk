import { RepositoryFactory } from '../repositories/factory';
import { toCsv } from './csv';

/**
 * CSV exports (Settings › Data › Imports & exports › CSV exports). Column names follow Intercom's
 * exports so the files open the same way and can be imported back here.
 */
export type ExportType = 'people' | 'conversations' | 'messages';

const iso = (v?: string | null) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '');
const inRange = (at: string | undefined, from?: string, to?: string) =>
  !!at && (!from || at >= from) && (!to || at <= to);

export async function buildExport(type: ExportType, from?: string, to?: string): Promise<{ csv: string; rows: number }> {
  const customers = await RepositoryFactory.getCustomerRepository().findAll();
  const agents = await RepositoryFactory.getUserRepository().findAll();
  const agentById = new Map(agents.map(a => [a.id, a]));

  if (type === 'people') {
    const conversations = await RepositoryFactory.getConversationRepository().findAll();
    const counts = new Map<string, number>();
    for (const c of conversations) counts.set(c.customer.id, (counts.get(c.customer.id) || 0) + 1);
    const list = customers.filter(c => !from && !to ? true : inRange(c.session?.firstSeen, from, to));
    const rows = list.map(c => [
      c.id, c.externalId || '', c.name, c.email || '', c.phone || '',
      c.email || c.externalId ? 'User' : 'Lead',
      c.session?.country || '', c.session?.timezone || '',
      iso(c.session?.firstSeen), iso(c.session?.lastSeen),
      (c.tags || []).join(', '), counts.get(c.id) || 0,
    ]);
    return {
      csv: toCsv(['Intercom ID', 'User ID', 'Name', 'Email', 'Phone', 'Type', 'Location', 'Time zone', 'Signed up', 'Last seen', 'Tags', 'Conversations'], rows),
      rows: rows.length,
    };
  }

  const conversations = (await RepositoryFactory.getConversationRepository().findAll())
    .filter(c => !from && !to ? true : inRange(c.createdAt, from, to))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const messages = await RepositoryFactory.getMessageRepository().findAll();

  if (type === 'conversations') {
    const byConv = new Map<string, typeof messages>();
    for (const m of messages) {
      if (m.sender?.type === 'system') continue;
      if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
      byConv.get(m.conversationId)!.push(m);
    }
    const rows = conversations.map(c => {
      const msgs = byConv.get(c.id) || [];
      const firstCustomer = msgs.find(m => m.sender.type === 'customer');
      const lastPublic = [...msgs].reverse().find(m => !m.isInternalNote);
      const agent = c.assignedAgentId ? agentById.get(c.assignedAgentId) : undefined;
      return [
        c.ticketNumber.replace(/^#/, ''), c.id, c.kind === 'ticket' ? 'Ticket' : c.kind === 'issue' ? 'Tracker ticket' : 'Conversation',
        c.title || '', c.mergedInto ? 'merged' : c.status, c.priority, c.category,
        agent?.name || '', agent?.email || '',
        c.customer?.name || '', c.customer?.email || '', c.customer?.phone || '', c.customer?.externalId || '',
        (c.tags || []).join(', '),
        iso(c.createdAt), iso(c.updatedAt), msgs.length,
        firstCustomer?.content || '', lastPublic?.content || '',
        c.importedFrom?.id && c.importedFrom.id !== c.id ? c.importedFrom.id : '',
      ];
    });
    return {
      csv: toCsv(['Conversation ID', 'Internal ID', 'Type', 'Title', 'State', 'Priority', 'Category', 'Assignee', 'Assignee email',
        'Contact name', 'Contact email', 'Contact phone', 'User ID', 'Tags', 'Created at', 'Updated at', 'Messages',
        'First message', 'Last message', 'Imported ID'], rows),
      rows: rows.length,
    };
  }

  // messages: one row per message ("conversation parts"), state changes and notes included
  const convById = new Map(conversations.map(c => [c.id, c]));
  const rows = messages
    .filter(m => convById.has(m.conversationId))
    .filter(m => !(from || to) || inRange(m.createdAt, from, to))
    .map(m => {
      const c = convById.get(m.conversationId)!;
      const isEvent = m.sender?.type === 'system';
      const authorType = m.sender.type === 'customer' ? 'user' : m.sender.id === 'bot' || m.metadata?.type === 'bot' ? 'bot' : isEvent ? 'system' : 'admin';
      const agent = m.sender.type === 'agent' ? agentById.get(m.sender.id) : undefined;
      const partType = isEvent ? (m.metadata?.field === 'status' ? 'state_change' : 'event') : m.isInternalNote ? 'note' : 'comment';
      return [
        c.ticketNumber.replace(/^#/, ''), m.id, iso(m.createdAt), authorType, m.sender.name || '',
        m.sender.type === 'customer' ? c.customer?.email || '' : agent?.email || '',
        partType, m.content || '', (m.attachments || []).map(a => a.url).join(' '),
      ];
    });
  return {
    csv: toCsv(['Conversation ID', 'Part ID', 'Created at', 'Author type', 'Author name', 'Author email', 'Part type', 'Body', 'Attachments'], rows),
    rows: rows.length,
  };
}
