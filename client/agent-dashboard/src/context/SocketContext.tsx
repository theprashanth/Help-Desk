import React, { createContext, useContext, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';
import { Message, Conversation } from '../../../../shared/src/types';

const SocketContext = createContext<Socket | null>(null);
const BACKEND_URL = 'http://localhost:3000';

let sharedAudioCtx: AudioContext | null = null;

const initAudioContext = () => {
  if (sharedAudioCtx) return sharedAudioCtx;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioCtx = new AudioContextClass();
    }
  } catch (e) {
    console.warn('Failed to create AudioContext:', e);
  }
  return sharedAudioCtx;
};

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

  // Warm up and unlock AudioContext on first click or keydown gesture
  useEffect(() => {
    const unlock = () => {
      const ctx = initAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
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
      document.title = 'Chai Samosa';
    };
    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (!document.hidden) {
        document.title = 'Chai Samosa';
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

      // Only play sound + show notification for agent when it's an incoming customer message
      // that was NOT sent by this same browser's guest session (widget in same tab)
      const localGuestId = localStorage.getItem('customer_guest_id');
      const isFromLocalGuest = msg.sender.id === localGuestId;
      const isAgentMessage = msg.sender.type === 'agent' || msg.sender.type === 'system';

      if (agent && !isAgentMessage && !msg.isInternalNote && !isFromLocalGuest) {
        playNotificationSound();
        showDesktopNotification(msg);

        // Show ticket ID/number in tab title
        if (document.hidden || useStore.getState().activeConversationId !== msg.conversationId) {
          const convs = useStore.getState().conversations;
          const conv = convs.find(c => c.id === msg.conversationId);
          const label = conv?.ticketNumber || 'New Message';
          document.title = `(${label}) New Message | Chai Samosa`;
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

      // Only play sound when an agent is logged in AND the conversation was NOT
      // started by this browser's own guest widget (which would be the same tab).
      const localGuestId = localStorage.getItem('customer_guest_id');
      const isOwnGuestConv = conv.customer.id === localGuestId;

      if (agent && !isOwnGuestConv) {
        playNotificationSound();

        // Show new ticket ID/number in tab title
        if (document.hidden || useStore.getState().activeConversationId !== conv.id) {
          document.title = `(${conv.ticketNumber}) New Ticket | Chai Samosa`;
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
  }, [token, agent, setSocket, addMessage, updateMessage, deleteMessage, updateConversation, addConversation, removeConversation, activeConversationId]);

  // Request browser notification permissions
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = () => {
    try {
      const ctx = initAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const playNote = (freq: number, start: number, duration: number, vol: number = 0.25) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(start);
        osc.stop(start + duration);
      };
      
      const now = ctx.currentTime;
      playNote(523.25, now, 0.15, 0.12);        // C5
      playNote(659.25, now + 0.06, 0.15, 0.12);   // E5
      playNote(783.99, now + 0.12, 0.18, 0.18);   // G5
      playNote(1046.50, now + 0.18, 0.28, 0.22);  // C6
    } catch (e) {
      console.warn('AudioContext play failed:', e);
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
