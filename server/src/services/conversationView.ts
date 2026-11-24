import { RepositoryFactory } from '../repositories/factory';
import { Conversation, Message } from '../../../shared/src/types';

/** Customers may see a conversation unless it's an internal tracker issue or an internal-only ticket. */
export function isCustomerVisible(conv: Conversation): boolean {
  return conv.kind !== 'issue' && conv.sharing !== 'internal';
}

/** Preview text for a message, as shown in conversation lists. */
/** Previews are plain text: drop **bold** / *italic* / `code` / [link](url) markers. */
export const plainText = (text: string) =>
  (text || '')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^\n]*?\S)__/g, '$1')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^\n*]*?[^\s*])\*(?![*\w])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1');

export function snippetFor(m: Pick<Message, 'content' | 'attachments' | 'isInternalNote'>): string {
  let snippet = plainText(m.content || '');
  if (m.attachments && m.attachments.length > 0) {
    snippet = snippet ? `${snippet} (Attachment)` : 'Sent an attachment';
  }
  return m.isInternalNote ? `[Note] ${snippet}` : snippet;
}

/**
 * What a customer (the Messenger widget) is allowed to see of a conversation: the preview comes
 * from the last public message only, and teammate-only fields are dropped.
 */
export function toCustomerView(conv: Conversation): Conversation {
  const legacySnippet = conv.lastMessageSnippet && !conv.lastMessageSnippet.startsWith('[Note]')
    ? conv.lastMessageSnippet
    : '';
  const { createdByAgentId: _c, attributes: _a, unreadCountAgent: _u, linkedIssueId: _l, ...rest } = conv;
  return {
    ...rest,
    unreadCountAgent: 0,
    lastMessageSnippet: conv.customerSnippet ?? legacySnippet,
    customerSnippet: conv.customerSnippet ?? legacySnippet,
  } as Conversation;
}

/**
 * Recompute previews and unread counts from the messages that still exist. Used after a message
 * is deleted (so deleted text doesn't linger in previews) and to backfill older conversations.
 */
export async function refreshConversationSnippets(conversationId: string): Promise<Conversation | null> {
  const msgRepo = RepositoryFactory.getMessageRepository();
  const convRepo = RepositoryFactory.getConversationRepository();
  const messages = await msgRepo.findByConversationId(conversationId, 100000, 0);
  const real = messages.filter(m => m.sender?.type !== 'system');
  const publicMsgs = real.filter(m => !m.isInternalNote);
  const lastAny = real[real.length - 1];
  const lastPublic = publicMsgs[publicMsgs.length - 1];

  return convRepo.update(conversationId, {
    lastMessageSnippet: lastAny ? snippetFor(lastAny) : '',
    customerSnippet: lastPublic ? snippetFor(lastPublic) : '',
    unreadCountAgent: real.filter(m => m.sender.type === 'customer' && !m.seen).length,
    unreadCountCustomer: publicMsgs.filter(m => m.sender.type === 'agent' && !m.seen).length,
  });
}

/** Customer preview computed from messages without writing anything (for older conversations). */
export async function computeCustomerSnippet(conversationId: string): Promise<string> {
  const messages = await RepositoryFactory.getMessageRepository().findByConversationId(conversationId, 100000, 0);
  const publicMsgs = messages.filter(m => m.sender?.type !== 'system' && !m.isInternalNote);
  const last = publicMsgs[publicMsgs.length - 1];
  return last ? snippetFor(last) : '';
}
