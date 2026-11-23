import { SocketService, AGENTS_ROOM } from './socket';

/**
 * Collision detection: which teammates have each conversation open, and who is typing a reply.
 * Kept in memory (it only describes who is connected right now) and pushed to every agent as
 * `presence:update { conversationId, viewers: [{ agentId, name, typing }] }`.
 */

type Viewer = { agentId: string; name: string; typingUntil?: number };

const TYPING_TTL_MS = 6000;
const agentsBySocket = new Map<string, { agentId: string; name: string }>();
const byConversation = new Map<string, Map<string, Viewer>>(); // conversationId -> socketId -> viewer

function snapshot(conversationId: string) {
  const now = Date.now();
  const seen = new Map<string, { agentId: string; name: string; typing: boolean }>();
  // One entry per teammate, even with several tabs open; typing wins
  for (const v of byConversation.get(conversationId)?.values() || []) {
    const typing = !!v.typingUntil && v.typingUntil > now;
    const prev = seen.get(v.agentId);
    seen.set(v.agentId, { agentId: v.agentId, name: v.name, typing: typing || !!prev?.typing });
  }
  return Array.from(seen.values());
}

function publish(conversationId: string) {
  try {
    SocketService.emitToRoom(AGENTS_ROOM, 'presence:update', { conversationId, viewers: snapshot(conversationId) });
  } catch { /* sockets not ready */ }
}

export const Presence = {
  /** A verified agent socket (from agent:login). */
  registerAgent(socketId: string, agentId: string, name: string) {
    agentsBySocket.set(socketId, { agentId, name });
  },

  isAgent(socketId: string) {
    return agentsBySocket.has(socketId);
  },

  join(socketId: string, conversationId: string) {
    const agent = agentsBySocket.get(socketId);
    if (!agent) return;
    // A socket views one conversation at a time
    for (const [cid, viewers] of byConversation) {
      if (cid !== conversationId && viewers.delete(socketId)) {
        if (!viewers.size) byConversation.delete(cid);
        publish(cid);
      }
    }
    if (!byConversation.has(conversationId)) byConversation.set(conversationId, new Map());
    byConversation.get(conversationId)!.set(socketId, { agentId: agent.agentId, name: agent.name });
    publish(conversationId);
  },

  leave(socketId: string, conversationId: string) {
    const viewers = byConversation.get(conversationId);
    if (viewers?.delete(socketId)) {
      if (!viewers.size) byConversation.delete(conversationId);
      publish(conversationId);
    }
  },

  typing(socketId: string, conversationId: string, isTyping: boolean) {
    const v = byConversation.get(conversationId)?.get(socketId);
    if (!v) return;
    const was = !!v.typingUntil && v.typingUntil > Date.now();
    v.typingUntil = isTyping ? Date.now() + TYPING_TTL_MS : undefined;
    if (was !== isTyping) publish(conversationId);
  },

  disconnect(socketId: string) {
    agentsBySocket.delete(socketId);
    for (const [cid, viewers] of byConversation) {
      if (viewers.delete(socketId)) {
        if (!viewers.size) byConversation.delete(cid);
        publish(cid);
      }
    }
  },

  /** Everything at once, for a dashboard that just connected. */
  all() {
    return Array.from(byConversation.keys()).map(conversationId => ({ conversationId, viewers: snapshot(conversationId) }));
  },

  /** Typing expires on its own if the "stopped typing" event never arrives. */
  startSweeper() {
    setInterval(() => {
      const now = Date.now();
      for (const [cid, viewers] of byConversation) {
        let changed = false;
        for (const v of viewers.values()) {
          if (v.typingUntil && v.typingUntil <= now) { v.typingUntil = undefined; changed = true; }
        }
        if (changed) publish(cid);
      }
    }, 2000).unref?.();
  },
};
