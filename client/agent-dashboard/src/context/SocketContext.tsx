import React, { createContext, useContext, useEffect, useRef } from 'react';
import { playChime, unlockAudio } from '../lib/sound';
import { io, Socket } from 'socket.io-client';
import { useStore, PresenceViewer } from '../store/useStore';
import { mentionedConversationIds } from '../lib/inboxViews';
import { Message, Conversation } from '../../../../shared/src/types';
import { loadTeams } from '../lib/teams';
import { refreshAttributeDefs } from '../components/agent/CustomerOrgFields';

const SocketContext = createContext<Socket | null>(null);
const BACKEND_URL = 'http://localhost:3000';

/** Alerts only make sense on the agent dashboard (not on the customer demo page). */
const onAgentPage = () => window.location.pathname.startsWith('/agent');

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socket = useStore((state) => state.socket);
  const setSocket = useStore((state) => state.setSocket);
  const token = useStore((state) => state.token);
  const agent = useStore((state) => state.agent);
  
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
  const deleteMessage = useStore((state) => state.deleteMessage);
  const updateConversation = useStore((state) => state.updateConversation);
  const addConversation = useStore((state) => state.addConversation);
  const removeConversation = useStore((state) => state.removeConversation);
  const activeConversationId = useStore((state) => state.activeConversationId);

  // Respect the agent's "Sound alerts" preference (Settings); defaults to on
  const soundEnabledRef = useRef(true);
  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/settings`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(s => { if (s?.notifications) soundEnabledRef.current = s.notifications.sound !== false; })
      .catch(() => {});
  }, [token]);

  // Browsers only allow audio after a user gesture: unlock on the first click / key press
  useEffect(() => {
    const unlock = () => { unlockAudio(); };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Clear unread notifications from tab title when window is focused or active conversation changes
  useEffect(() => {
    const handleFocus = () => {
      document.title = useStore.getState().workspaceName;
    };
    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (!document.hidden) {
        document.title = useStore.getState().workspaceName;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeConversationId]);

  useEffect(() => {
    // Initialize Socket connection
    const newSocket = io(BACKEND_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    setSocket(newSocket);

    // Track when connected
    newSocket.on('connect', () => {
      console.log(`[Socket] Connected: ${newSocket.id}`);
      
      // If we are logged in as an agent, register online status
      // (never from the embedded Messenger, which may share this browser's storage with the dashboard)
      if (token && agent && !window.location.pathname.startsWith('/messenger/')) {
        newSocket.emit('agent:login', {
          agentId: agent.id,
          name: agent.name,
          token // verified server-side before this socket may receive internal notes and events
        });
      }
    });

    // Real-time Event Listeners
    newSocket.on('message:new', (msg: Message) => {
      console.log('[Socket] New message received:', msg);
      addMessage(msg);
      // The list's avatar shows ↩ while the team sent the latest public message
      const spoken = !msg.isInternalNote && (msg.sender.type === 'customer' || msg.sender.type === 'agent')
        && !['event', 'customer_event', 'csat_request', 'auto_reply', 'merged_indicator'].includes(msg.metadata?.type);
      if (spoken) {
        const from = msg.sender.type === 'customer' ? 'customer' : 'team';
        useStore.setState(st => ({ conversations: st.conversations.map(c => (c.id === msg.conversationId && c.lastMessageFrom !== from ? { ...c, lastMessageFrom: from } : c)) }));
      }

      // Loud alert for every incoming customer message while you're on the agent dashboard.
      // (Earlier this was skipped when the sender matched a guest id stored in this browser,
      //  which silenced alerts whenever the widget had ever been used in the same browser.)
      // Taps inside the chat-flow bot are silent; asking for a person (handoff) alerts like a new message
      const botTap = msg.metadata?.type === 'bot_choice' && !msg.metadata?.handoff;
      const isCustomerMessage = msg.sender.type === 'customer' && !msg.isInternalNote && !botTap;

      if (agent && isCustomerMessage && onAgentPage()) {
        if (soundEnabledRef.current) playChime();
        if (document.hidden || useStore.getState().activeConversationId !== msg.conversationId) {
          showDesktopNotification(msg);
        }

        // Show ticket ID/number in tab title
        if (document.hidden || useStore.getState().activeConversationId !== msg.conversationId) {
          const convs = useStore.getState().conversations;
          const conv = convs.find(c => c.id === msg.conversationId);
          const label = conv?.ticketNumber || 'New Message';
          document.title = `(${label}) New Message | ${useStore.getState().workspaceName}`;
        }
      }
    });

    newSocket.on('message:update', (msg: Message) => {
      updateMessage(msg);
    });

    newSocket.on('message:deleted', (payload: { messageId: string; conversationId: string }) => {
      deleteMessage(payload.messageId, payload.conversationId);
    });

    newSocket.on('conversation:new', (conv: Conversation) => {
      addConversation(conv);

      // New conversation started by a customer (not one a teammate created manually)
      if (agent && !conv.createdByAgentId && !conv.bot && onAgentPage()) {
        if (soundEnabledRef.current) playChime();

        // Show new ticket ID/number in tab title
        if (document.hidden || useStore.getState().activeConversationId !== conv.id) {
          document.title = `(${conv.ticketNumber}) New Ticket | ${useStore.getState().workspaceName}`;
        }
      }
    });

    // Someone @mentioned you in a note
    newSocket.on('mention:new', (p: { conversationId: string; ticketNumber: string; mentions: string[]; from: { id: string; name: string }; snippet: string }) => {
      if (!agent || !p?.mentions?.includes(agent.id) || p.from?.id === agent.id) return;
      mentionedConversationIds.add(p.conversationId);
      if (!onAgentPage()) return;
      if (soundEnabledRef.current) playChime();
      if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || useStore.getState().activeConversationId !== p.conversationId)) {
        new Notification(`${p.from.name} mentioned you · ${p.ticketNumber}`, { body: p.snippet || 'In an internal note' });
      }
      if (document.hidden) document.title = `(@) ${p.from.name} mentioned you | ${useStore.getState().workspaceName}`;
    });

    // A snoozed conversation is back: tell its assignee (or everyone, if unassigned)
    newSocket.on('conversation:unsnoozed', (conv: Conversation) => {
      if (!agent || !onAgentPage()) return;
      if (conv.assignedAgentId && conv.assignedAgentId !== agent.id) return;
      if (soundEnabledRef.current) playChime();
      if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || useStore.getState().activeConversationId !== conv.id)) {
        new Notification(`Snooze ended · ${conv.ticketNumber}`, { body: `${conv.customer?.name || 'Conversation'} is back in your inbox` });
      }
    });

    // An SLA target was missed: tell the assignee (or everyone, if unassigned)
    newSocket.on('sla:breach', (p: { conversationId: string; ticketNumber: string; kind: 'first' | 'next'; assignedAgentId: string | null; customerName?: string }) => {
      if (!agent || !onAgentPage()) return;
      if (p.assignedAgentId && p.assignedAgentId !== agent.id) return;
      if (soundEnabledRef.current) playChime();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`SLA missed · ${p.ticketNumber}`, {
          body: `${p.customerName || 'A customer'} is still waiting for a ${p.kind === 'first' ? 'first' : 'next'} response`,
        });
      }
    });

    // Settings › Teams changed somewhere: refresh the team inboxes
    newSocket.on('teams:changed', () => { loadTeams(true); });
    newSocket.on('attributes:changed', () => { refreshAttributeDefs(); });

    newSocket.on('conversation:update', (conv: Conversation) => {
      updateConversation(conv);
    });

    newSocket.on('conversation:deleted', (conversationId: string) => {
      removeConversation(conversationId);
      // If active conversation was deleted, deselect it
      if (useStore.getState().activeConversationId === conversationId) {
        useStore.getState().setActiveConversationId(null);
      }
    });

    // Collision detection: who else has a conversation open / is replying
    newSocket.on('presence:all', (all: { conversationId: string; viewers: PresenceViewer[] }[]) => {
      useStore.getState().setAllPresence(Array.isArray(all) ? all : []);
    });
    newSocket.on('presence:update', (p: { conversationId: string; viewers: PresenceViewer[] }) => {
      if (p?.conversationId) useStore.getState().setPresence(p.conversationId, Array.isArray(p.viewers) ? p.viewers : []);
    });

    newSocket.on('disconnect', () => {
      useStore.getState().setAllPresence([]);
      console.log('[Socket] Disconnected from server');
    });

    return () => {
      newSocket.close();
      setSocket(null);
    };
  }, [token, agent, setSocket, addMessage, updateMessage, deleteMessage, updateConversation, addConversation, removeConversation]);

  // Request browser notification permissions
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const showDesktopNotification = (msg: Message) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = `Message from ${msg.sender.name}`;
      const options = {
        body: msg.content || 'Sent an attachment',
        icon: msg.sender.avatar || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%238B5CF6\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin='
      };
      new Notification(title, options);
    }
  };

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
