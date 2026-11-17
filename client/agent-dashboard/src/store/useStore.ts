import { create } from 'zustand';
import { Agent, Conversation, Message, Tag, SavedReply } from '../../../../shared/src/types';
import { Socket } from 'socket.io-client';
import { matchesView, statusesFor, StateFilter } from '../lib/inboxViews';

/** What the create screen is making; customer is prefilled from "New conversation". */
export type ComposerState = {
  kind: 'conversation' | 'ticket' | 'issue';
  customer?: { id: string; name: string; email?: string };
} | null;

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
  viewingMergedConversationId: string | null;
  currentQueue: string;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (conversation: Conversation) => void;
  removeConversation: (id: string) => void;
  setActiveConversationId: (id: string | null) => void;
  setViewingMergedConversationId: (id: string | null) => void;
  setCurrentQueue: (queue: string) => void;

  // State filter for the list ("N Open" chip): open | waiting | snoozed | resolved | closed | archived | all
  stateFilter: StateFilter;
  setStateFilter: (state: StateFilter) => void;

  // Manual create screen (conversation / ticket / issue)
  composer: ComposerState;
  setComposer: (composer: ComposerState) => void;

  // Ask the conversation list to open + focus its search box (incremented by the "Search" nav item)
  searchRequest: number;
  requestSearch: () => void;

  // Layout: whether the Inbox navigation panel is expanded
  inboxNavOpen: boolean;
  setInboxNavOpen: (open: boolean) => void;

  // Deep link target: scroll to and highlight this message once it's loaded
  focusMessageId: string | null;
  setFocusMessageId: (id: string | null) => void;

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

  // Chat Bubble Color Theme
  chatColorTheme: 'sky-blue' | 'classic';
  setChatColorTheme: (theme: 'sky-blue' | 'classic') => void;
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
  viewingMergedConversationId: null,
  currentQueue: 'yours',
  stateFilter: 'open',
  composer: null,
  searchRequest: 0,
  inboxNavOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1440,
  focusMessageId: null,
  setConversations: (conversations) => set({ conversations }),
  addConversation: (conversation) => 
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      if (exists) return state;
      if (!matchesView(conversation, state.currentQueue, state.agent?.id) ||
          !statusesFor(state.stateFilter).includes(conversation.status)) return state;
      return { conversations: [conversation, ...state.conversations] };
    }),
  updateConversation: (conversation) =>
    set((state) => {
      // Keep conversations that belong to the current view and state (snooze is filtered in the list)
      const matchesQueue =
        matchesView(conversation, state.currentQueue, state.agent?.id) &&
        statusesFor(state.stateFilter).includes(conversation.status);

      const index = state.conversations.findIndex((c) => c.id === conversation.id);

      if (index === -1) {
        if (matchesQueue) {
          return { conversations: [conversation, ...state.conversations] };
        }
        return state;
      }

      if (!matchesQueue) {
        return {
          conversations: state.conversations.filter((c) => c.id !== conversation.id)
        };
      }

      const updated = [...state.conversations];
      updated[index] = { ...updated[index], ...conversation };
      
      const sorted = updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return { conversations: sorted };
    }),
  removeConversation: (id: string) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id)
    })),
  setActiveConversationId: (id) => set({ activeConversationId: id, viewingMergedConversationId: null }), // Clear merged view when changing active chat
  setViewingMergedConversationId: (id) => set({ viewingMergedConversationId: id }),
  setCurrentQueue: (queue) => set({ currentQueue: queue }),
  setStateFilter: (stateFilter) => set({ stateFilter }),
  setComposer: (composer) => set({ composer }),
  requestSearch: () => set((st) => ({ searchRequest: st.searchRequest + 1 })),
  setInboxNavOpen: (open) => set({ inboxNavOpen: open }),
  setFocusMessageId: (id) => set({ focusMessageId: id }),

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
        brandName: 'Chai Samosa',
        greeting: 'We reply in a few minutes',
        welcome: 'Ask us anything, or share your feedback.',
        darkTheme: false
      },
  setWidgetSettings: (updates) => set((state) => {
    const next = { ...state.widgetSettings, ...updates };
    localStorage.setItem('widget_settings', JSON.stringify(next));
    return { widgetSettings: next };
  }),

  // Chat Bubble Color Theme
  chatColorTheme: (localStorage.getItem('chat_color_theme') as any) || 'sky-blue',
  setChatColorTheme: (theme) => {
    localStorage.setItem('chat_color_theme', theme);
    set({ chatColorTheme: theme });
  }
}));
