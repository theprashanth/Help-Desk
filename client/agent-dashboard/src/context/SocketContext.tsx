import React, { createContext, useContext, useEffect, useRef } from 'react';
import { playChime, unlockAudio } from '../lib/sound';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';
import { Message, Conversation } from '../../../../shared/src/types';

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
      if (token && agent) {
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

      // Loud alert for every incoming customer message while you're on the agent dashboard.
      // (Earlier this was skipped when the sender matched a guest id stored in this browser,
      //  which silenced alerts whenever the widget had ever been used in the same browser.)
      const isCustomerMessage = msg.sender.type === 'customer' && !msg.isInternalNote;

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
      if (agent && !conv.createdByAgentId && onAgentPage()) {
        if (soundEnabledRef.current) playChime();

        // Show new ticket ID/number in tab title
        if (document.hidden || useStore.getState().activeConversationId !== conv.id) {
          document.title = `(${conv.ticketNumber}) New Ticket | ${useStore.getState().workspaceName}`;
        }
      }
    });

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

    newSocket.on('disconnect', () => {
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
