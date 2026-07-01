import React, { createContext, useContext, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';
import { Message, Conversation } from '../../../../shared/src/types';

const SocketContext = createContext<Socket | null>(null);
const BACKEND_URL = 'http://localhost:3000';

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
          name: agent.name
        });
      }
    });

    // Real-time Event Listeners
    newSocket.on('message:new', (msg: Message) => {
      console.log('[Socket] New message received:', msg);
      addMessage(msg);
      
      // Optionally trigger sound notification for new incoming messages for agents
      const isAgentMessage = msg.sender.type === 'agent';
      if (agent && !isAgentMessage && !msg.isInternalNote) {
        playNotificationSound();
        showDesktopNotification(msg);
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
      if (agent && conv.customer.id !== agent.id) {
        playNotificationSound();
      }
    });

    newSocket.on('conversation:update', (conv: Conversation) => {
      updateConversation(conv);
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected from server');
    });

    return () => {
      newSocket.close();
      setSocket(null);
    };
  }, [token, agent, setSocket, addMessage, updateMessage, deleteMessage, updateConversation, addConversation]);

  // Request browser notification permissions
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = () => {
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-500.wav'); // Subtle chime sound
      audio.volume = 0.4;
      audio.play().catch(() => {
        // Audio play might be blocked by browser policy until user interacts
      });
    } catch (e) {
      // Audio fallback fail silently
    }
  };

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
