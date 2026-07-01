import { create } from 'zustand';
import { Agent, Conversation, Message, Tag, SavedReply } from '../../../../shared/src/types';
import { Socket } from 'socket.io-client';

interface AppState {
  // Auth
  token: string | null;
  agent: Agent | null;
  setAuth: (agent: Agent | null, token: string | null) => void;
  logout: () => void;

  // Socket
  socket: Socket | null;
  setSocket: (socket: Socket | null) => void;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (conversation: Conversation) => void;
  setActiveConversationId: (id: string | null) => void;

  // Messages
  messages: Record<string, Message[]>; // conversationId -> messages
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  deleteMessage: (messageId: string, conversationId: string) => void;

  // Tags & Saved Replies
  tags: Tag[];
  savedReplies: SavedReply[];
  setTags: (tags: Tag[]) => void;
  setSavedReplies: (replies: SavedReply[]) => void;

  // Widget Customization Settings
  widgetSettings: {
    themeColor: string;
    brandName: string;
    greeting: string;
    welcome: string;
    darkTheme: boolean;
  };
  setWidgetSettings: (settings: Partial<AppState['widgetSettings']>) => void;
}

export const useStore = create<AppState>((set) => ({
  // Auth
  token: localStorage.getItem('agent_token'),
  agent: localStorage.getItem('agent_profile') 
    ? JSON.parse(localStorage.getItem('agent_profile')!) 
    : null,
  setAuth: (agent, token) => {
    if (token) {
      localStorage.setItem('agent_token', token);
      localStorage.setItem('agent_profile', JSON.stringify(agent));
    } else {
      localStorage.removeItem('agent_token');
      localStorage.removeItem('agent_profile');
    }
    set({ agent, token });
  },
  logout: () => {
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_profile');
    set({ agent: null, token: null, activeConversationId: null, socket: null });
  },

  // Socket
  socket: null,
  setSocket: (socket) => set({ socket }),

  // Conversations
  conversations: [],
  activeConversationId: null,
  setConversations: (conversations) => set({ conversations }),
  addConversation: (conversation) => 
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      if (exists) return state;
      return { conversations: [conversation, ...state.conversations] };
    }),
  updateConversation: (conversation) =>
    set((state) => {
      const index = state.conversations.findIndex((c) => c.id === conversation.id);
      if (index === -1) {
        return { conversations: [conversation, ...state.conversations] };
      }
      const updated = [...state.conversations];
      // Keep existing customer details if they are richer, or update
      updated[index] = { ...updated[index], ...conversation };
      
      // Resort by updatedAt
      const sorted = updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return { conversations: sorted };
    }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  // Messages
  messages: {},
  setMessages: (conversationId, conversationMessages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: conversationMessages }
    })),
  addMessage: (message) =>
    set((state) => {
      const convId = message.conversationId;
      const current = state.messages[convId] || [];
      const exists = current.some((m) => m.id === message.id);
      if (exists) return state;
      return {
        messages: {
          ...state.messages,
          [convId]: [...current, message]
        }
      };
    }),
  updateMessage: (message) =>
    set((state) => {
      const convId = message.conversationId;
      const current = state.messages[convId] || [];
      const index = current.findIndex((m) => m.id === message.id);
      if (index === -1) return state;
      
      const updated = [...current];
      updated[index] = message;
      return {
        messages: {
          ...state.messages,
          [convId]: updated
        }
      };
    }),
  deleteMessage: (messageId, conversationId) =>
    set((state) => {
      const current = state.messages[conversationId] || [];
      const filtered = current.filter((m) => m.id !== messageId);
      return {
        messages: {
          ...state.messages,
          [conversationId]: filtered
        }
      };
    }),

  // Tags & Saved Replies
  tags: [],
  savedReplies: [],
  setTags: (tags) => set({ tags }),
  setSavedReplies: (savedReplies) => set({ savedReplies }),

  // Widget Customization Settings
  widgetSettings: localStorage.getItem('widget_settings')
    ? JSON.parse(localStorage.getItem('widget_settings')!)
    : {
        themeColor: '#8B5CF6',
        brandName: 'Pebble SaaS',
        greeting: 'We reply in a few minutes',
        welcome: 'Ask us anything, or share your feedback.',
        darkTheme: false
      },
  setWidgetSettings: (updates) => set((state) => {
    const next = { ...state.widgetSettings, ...updates };
    localStorage.setItem('widget_settings', JSON.stringify(next));
    return { widgetSettings: next };
  })
}));
