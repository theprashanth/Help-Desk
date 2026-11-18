import { Server } from 'socket.io';
import { Conversation, Message } from '../../../shared/src/types';
import { toCustomerView, isCustomerVisible } from './conversationView';
import { RepositoryFactory } from '../repositories/factory';

/** Room joined only by sockets that presented a valid agent token. */
export const AGENTS_ROOM = 'agents';

/** Private room for one customer's Messenger (joined with their unguessable UUID User id). */
export const customerRoom = (customerId: string) => `customer:${customerId}`;

/** Internal notes and conversation events must never reach customer sockets. */
const isAgentOnly = (m: Message) => !!m.isInternalNote || m.sender?.type === 'system';

export class SocketService {
  private static io: Server | null = null;
  public static onlineAgents = new Map<string, { socketId: string; name: string }>();

  static init(ioInstance: Server) {
    this.io = ioInstance;
    console.log('[SocketService] Initialized and bound to Socket.IO server');
  }

  static getIO(): Server {
    if (!this.io) {
      throw new Error('SocketService is not initialized yet.');
    }
    return this.io;
  }

  static emitToRoom(room: string, event: string, data: any) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  static emitGlobal(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  /** Send to the conversation's customer only (their private room), if they may see it. */
  static async emitToConversationCustomer(conversationId: string, event: string, data: any) {
    if (!this.io) return;
    try {
      const conv = await RepositoryFactory.getConversationRepository().findById(conversationId);
      if (conv && isCustomerVisible(conv)) this.io.to(customerRoom(conv.customer.id)).emit(event, data);
    } catch (err) {
      console.error('[SocketService] customer emit failed:', err);
    }
  }

  // Messages: agents get everything; a customer only gets public messages of their own conversations
  static broadcastMessageNew(message: Message) {
    this.emitToRoom(AGENTS_ROOM, 'message:new', message);
    if (!isAgentOnly(message)) this.emitToConversationCustomer(message.conversationId, 'message:new', message);
  }

  static broadcastMessageUpdate(message: Message) {
    this.emitToRoom(AGENTS_ROOM, 'message:update', message);
    if (!isAgentOnly(message)) this.emitToConversationCustomer(message.conversationId, 'message:update', message);
  }

  static broadcastMessageDeleted(messageId: string, conversationId: string) {
    this.emitToRoom(AGENTS_ROOM, 'message:deleted', { messageId, conversationId });
    this.emitToConversationCustomer(conversationId, 'message:deleted', { messageId, conversationId });
  }

  /**
   * Conversations go out in two versions: the full object to verified agent sockets, and a
   * customer-safe view (no internal-note previews, no internal-only tickets) to everyone else.
   */
  private static broadcastConversation(event: string, conv: Conversation) {
    if (!this.io) return;
    this.io.to(AGENTS_ROOM).emit(event, conv);
    if (isCustomerVisible(conv)) {
      this.io.to(customerRoom(conv.customer.id)).emit(event, toCustomerView(conv));
    }
  }

  static broadcastConversationNew(conv: Conversation) {
    this.broadcastConversation('conversation:new', conv);
  }

  static broadcastConversationUpdate(conv: Conversation) {
    this.broadcastConversation('conversation:update', conv);
  }

  static broadcastConversationDeleted(conversationId: string, customerId?: string) {
    this.emitToRoom(AGENTS_ROOM, 'conversation:deleted', conversationId);
    if (customerId) this.emitToRoom(customerRoom(customerId), 'conversation:deleted', conversationId);
  }

  static broadcastAgentOnline(agentId: string, name: string) {
    this.emitGlobal('agent:online', { agentId, name });
  }

  static broadcastAgentOffline(agentId: string) {
    this.emitGlobal('agent:offline', { agentId });
  }
}
