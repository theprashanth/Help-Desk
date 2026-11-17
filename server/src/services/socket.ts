import { Server } from 'socket.io';
import { Conversation, Message } from '../../../shared/src/types';

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
    // Message room can be the conversationId
    this.emitToRoom(message.conversationId, 'message:new', message);
    this.emitGlobal('message:new', message);
  }

  static broadcastMessageUpdate(message: Message) {
    this.emitToRoom(message.conversationId, 'message:update', message);
    this.emitGlobal('message:update', message);
  }

  static broadcastMessageDeleted(messageId: string, conversationId: string) {
    this.emitToRoom(conversationId, 'message:deleted', { messageId, conversationId });
    this.emitGlobal('message:deleted', { messageId, conversationId });
  }

  static broadcastConversationNew(conv: Conversation) {
    this.emitToRoom(conv.id, 'conversation:new', conv);
    this.emitGlobal('conversation:new', conv);
  }

  static broadcastConversationUpdate(conv: Conversation) {
    this.emitToRoom(conv.id, 'conversation:update', conv);
    this.emitGlobal('conversation:update', conv);
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
