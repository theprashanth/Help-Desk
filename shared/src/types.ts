export type TicketStatus = 'open' | 'waiting' | 'resolved' | 'closed' | 'archived' | 'merged';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketCategory = 'general' | 'bug' | 'payment' | 'subscription' | 'refund' | 'feature_request' | 'other';
export type UserRole = 'admin' | 'support_agent';

export interface Workspace {
  id: string;
  name: string;
  subdomain?: string;
  apiKey: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  workspaceId?: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  status: 'online' | 'offline';
  lastSeen?: string;
}

export interface CustomerSession {
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  ip?: string;
  currentPage?: string;
  sessionDuration?: number; // in seconds
  firstSeen?: string;
  lastSeen?: string;
  totalConversations?: number;
}

export interface Customer {
  id: string;
  workspaceId?: string;
  name: string;
  email?: string;
  phone?: string;
  session: CustomerSession;
  tags: string[]; // tag names
  notes: string[]; // local inline notes or note IDs
}

export interface MessageReaction {
  agentId: string;
  agentName: string;
  emoji: string;
}

export interface Attachment {
  name: string;
  url: string;
  type: 'image' | 'pdf' | 'file';
  size?: number;
}

export interface Message {
  id: string;
  workspaceId?: string;
  conversationId: string;
  sender: {
    type: 'customer' | 'agent';
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  attachments?: Attachment[];
  isInternalNote: boolean; // Agent internal comments
  seen: boolean;
  seenAt?: string;
  delivered: boolean;
  reactions?: MessageReaction[];
  createdAt: string;
  metadata?: any;
}

export interface Conversation {
  id: string;
  workspaceId?: string;
  ticketNumber: string; // TICKET-XXXX
  customer: Customer;
  assignedAgentId?: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  lastMessageSnippet?: string;
  unreadCountAgent: number;
  unreadCountCustomer: number;
  starred?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReply {
  id: string;
  workspaceId?: string;
  trigger: string; // e.g. /refund
  title: string;
  content: string; // markdown text
  availableFor?: 'everyone' | 'myself' | 'teams';
  availableWhen?: ('starting_conversations' | 'replying' | 'adding_notes')[];
  creator?: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt?: string;
}

export interface Tag {
  id: string;
  workspaceId?: string;
  name: string;
  color: string; // hex or CSS color
}

export interface BusinessHours {
  enabled: boolean;
  start: string; // e.g. "09:00"
  end: string;   // e.g. "17:00"
  timezone: string;
  days: number[]; // [1, 2, 3, 4, 5] (Monday-Friday)
}

export interface AgentSettings {
  agentId: string;
  workspaceId?: string;
  theme: 'light' | 'dark';
  notifications: {
    desktop: boolean;
    sound: boolean;
    browser: boolean;
  };
  timezone: string;
  language: string;
  autoAssign: boolean;
  businessHours: BusinessHours;
}

// WebSocket Event Definitions
export interface ServerToClientEvents {
  'message:new': (message: Message) => void;
  'message:update': (message: Message) => void;
  'message:deleted': (messageId: string, conversationId: string) => void;
  'message:seen': (payload: { conversationId: string; seenAt: string; role: 'customer' | 'agent' }) => void;
  'message:typing': (payload: { conversationId: string; senderType: 'customer' | 'agent'; senderName: string; isTyping: boolean }) => void;
  'conversation:new': (conversation: Conversation) => void;
  'conversation:update': (conversation: Conversation) => void;
  'conversation:deleted': (conversationId: string) => void;
  'conversation:assigned': (payload: { conversationId: string; agentId?: string; agentName?: string }) => void;
  'conversation:closed': (payload: { conversationId: string; closedBy: string }) => void;
  'agent:online': (payload: { agentId: string; name: string }) => void;
  'agent:offline': (payload: { agentId: string }) => void;
}

export interface ClientToServerEvents {
  'join': (room: string) => void;
  'leave': (room: string) => void;
  'typing': (payload: { conversationId: string; senderType: 'customer' | 'agent'; senderName: string; isTyping: boolean }) => void;
  'seen': (payload: { conversationId: string; role: 'customer' | 'agent' }) => void;
}
