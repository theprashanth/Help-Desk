import { create } from 'zustand';
import { Agent, Conversation, Message, Tag, SavedReply, SnoozePreset } from '../../../../shared/src/types';
import { Socket } from 'socket.io-client';
import { matchesView, matchesState, statusesFor, StateFilter } from '../lib/inboxViews';

export type PresenceViewer = { agentId: string; name: string; typing: boolean };

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
  /** Collision detection: teammates viewing / typing in each conversation (from the server) */
  presence: Record<string, PresenceViewer[]>;
  setPresence: (conversationId: string, viewers: PresenceViewer[]) => void;
  setAllPresence: (all: { conversationId: string; viewers: PresenceViewer[] }[]) => void;
  /** Text to put in a conversation's reply box (Ask AI → "Insert in reply") */
  replyDraft: { conversationId: string; text: string } | null;
  setReplyDraft: (draft: { conversationId: string; text: string } | null) => void;
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

  // Organisation name (Settings > General) — used for the browser tab title
  workspaceName: string;
  setWorkspaceName: (name: string) => void;

  // Workspace snooze presets (Settings > General); empty = default list
  snoozePresets: SnoozePreset[];
  setSnoozePresets: (p: SnoozePreset[]) => void;

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
  replyDraft: null,
  setReplyDraft: (replyDraft) => set({ replyDraft }),
  presence: {},
  setPresence: (conversationId, viewers) => set((st) => {
    const next = { ...st.presence };
    if (viewers.length) next[conversationId] = viewers; else delete next[conversationId];
    return { presence: next };
  }),
  setAllPresence: (all) => set({ presence: Object.fromEntries(all.filter(p => p.viewers.length).map(p => [p.conversationId, p.viewers])) }),
  currentQueue: 'yours',
  stateFilter: 'open',
  composer: null,
  searchRequest: 0,
  inboxNavOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1440,
  focusMessageId: null,
  snoozePresets: [],
  workspaceName: (() => { try { return localStorage.getItem('workspace_name') || 'Chai Samosa'; } catch { return 'Chai Samosa'; } })(),
  setConversations: (conversations) => set({ conversations }),
  addConversation: (conversation) => 
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      if (exists || state.currentQueue === 'search') return state;
      if (!matchesView(conversation, state.currentQueue, state.agent?.id) ||
          !statusesFor(state.stateFilter).includes(conversation.status)) return state;
      return { conversations: [conversation, ...state.conversations] };
    }),
  updateConversation: (conversation) =>
    set((state) => {
      // Live updates can arrive out of order: never let an older copy overwrite a newer one
      const known = state.conversations.find((c) => c.id === conversation.id);
      if (known?.updatedAt && conversation.updatedAt && conversation.updatedAt < known.updatedAt) return state;
      // On the Search page the list is the search results: refresh in place, never add/drop by view
      if (state.currentQueue === 'search') {
        const i = state.conversations.findIndex((c) => c.id === conversation.id);
        if (i === -1) return state;
        const next = [...state.conversations];
        next[i] = { ...next[i], ...conversation };
        return { conversations: next };
      }

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

      // The conversation you're looking at stays put (e.g. right after you close it) until you open
      // another one; only then does it leave a view it no longer belongs to (Intercom behaviour).
      if (!matchesQueue && conversation.id !== state.activeConversationId) {
        return {
          conversations: state.conversations.filter((c) => c.id !== conversation.id)
        };
      }
      if (!matchesQueue) {
        const kept = [...state.conversations];
        kept[index] = { ...kept[index], ...conversation };
        return { conversations: kept };
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
  // Clear the merged view when changing chats, and let the chat you're leaving drop out of a view it no
  // longer belongs to (it was kept in place while it was open)
  setActiveConversationId: (id) => set((state) => {
    const prevId = state.activeConversationId;
    const prev = prevId && prevId !== id ? state.conversations.find(c => c.id === prevId) : undefined;
    const stale = !!prev && state.currentQueue !== 'search' && (
      !matchesView(prev, state.currentQueue, state.agent?.id) || !matchesState(prev, state.stateFilter)
    );
    return {
      activeConversationId: id,
      viewingMergedConversationId: null,
      ...(stale ? { conversations: state.conversations.filter(c => c.id !== prevId) } : {}),
    };
  }),
  setViewingMergedConversationId: (id) => set({ viewingMergedConversationId: id }),
  setCurrentQueue: (queue) => set({ currentQueue: queue }),
  setStateFilter: (stateFilter) => set({ stateFilter }),
  setComposer: (composer) => set({ composer }),
  requestSearch: () => set((st) => ({ searchRequest: st.searchRequest + 1 })),
  setInboxNavOpen: (open) => set({ inboxNavOpen: open }),
  setFocusMessageId: (id) => set({ focusMessageId: id }),
  setSnoozePresets: (snoozePresets) => set({ snoozePresets }),
  setWorkspaceName: (workspaceName) => {
    set({ workspaceName });
    // Remembered so the browser tab shows it immediately on the next load (see index.html)
    try { localStorage.setItem('workspace_name', workspaceName); } catch { /* storage blocked */ }
    if (typeof document !== 'undefined' && !document.title.startsWith('(')) document.title = workspaceName;
  },

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
