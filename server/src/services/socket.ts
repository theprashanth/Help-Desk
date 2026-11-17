import { Server } from 'socket.io';
import { Conversation, Message } from '../../../shared/src/types';
import { toCustomerView, isCustomerVisible } from './conversationView';

/** Room joined only by sockets that presented a valid agent token. */
export const AGENTS_ROOM = 'agents';

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

  static broadcastMessageNew(message: Message) {
    if (isAgentOnly(message)) {
      this.emitToRoom(AGENTS_ROOM, 'message:new', message);
      return;
    }
    // Message room can be the conversationId
    this.emitToRoom(message.conversationId, 'message:new', message);
    this.emitGlobal('message:new', message);
  }

  static broadcastMessageUpdate(message: Message) {
    if (isAgentOnly(message)) {
      this.emitToRoom(AGENTS_ROOM, 'message:update', message);
      return;
    }
    this.emitToRoom(message.conversationId, 'message:update', message);
    this.emitGlobal('message:update', message);
  }

  static broadcastMessageDeleted(messageId: string, conversationId: string) {
    this.emitToRoom(conversationId, 'message:deleted', { messageId, conversationId });
    this.emitGlobal('message:deleted', { messageId, conversationId });
  }

  /**
   * Conversations go out in two versions: the full object to verified agent sockets, and a
   * customer-safe view (no internal-note previews, no internal-only tickets) to everyone else.
   */
  private static broadcastConversation(event: string, conv: Conversation) {
    if (!this.io) return;
    this.io.to(AGENTS_ROOM).emit(event, conv);
    if (isCustomerVisible(conv)) {
      this.io.except(AGENTS_ROOM).emit(event, toCustomerView(conv));
    }
  }

  static broadcastConversationNew(conv: Conversation) {
    this.broadcastConversation('conversation:new', conv);
  }

  static broadcastConversationUpdate(conv: Conversation) {
    this.broadcastConversation('conversation:update', conv);
  }

  static broadcastConversationDeleted(conversationId: string) {
    this.emitToRoom(conversationId, 'conversation:deleted', conversationId);
    this.emitGlobal('conversation:deleted', conversationId);
  }

  static broadcastAgentOnline(agentId: string, name: string) {
    this.emitGlobal('agent:online', { agentId, name });
  }

  static broadcastAgentOffline(agentId: string) {
    this.emitGlobal('agent:offline', { agentId });
  }
}
