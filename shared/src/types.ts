export type TicketStatus = 'open' | 'waiting' | 'resolved' | 'closed' | 'archived' | 'merged';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high' | 'critical'; // critical is shown as "Urgent"
export type TicketCategory = 'general' | 'bug' | 'payment' | 'subscription' | 'refund' | 'feature_request' | 'other';
export type UserRole = 'admin' | 'support_agent';
/** conversation = customer chat, ticket = customer ticket, issue = internal tracker ticket */
export type ConversationKind = 'conversation' | 'ticket' | 'issue';

/** Categories of conversation events (status changes, assignment, ...) shown inline in the thread */
export type ConversationEventCategory = 'status' | 'assignment' | 'priority' | 'tags' | 'attributes' | 'tickets' | 'other';

/** Weekly opening hours + closures; times are "HH:MM" in the workspace timezone. */
export interface OfficeHours {
  timezone: string;                                   // IANA, e.g. "Asia/Kolkata"
  intervals: { days: number[]; start: string; end: string }[]; // days: 0=Sun..6=Sat; empty list = 24/7
  closures: { date: string; label?: string }[];       // date: YYYY-MM-DD
}

/** What customers are told about reply speed in the Messenger */
export type ReplyTime = 'asap' | 'minutes' | 'hours' | 'day';

export interface Workspace {
  id: string;
  name: string;
  subdomain?: string;
  apiKey: string;
  createdAt: string;
  officeHours?: OfficeHours;
  replyTime?: ReplyTime;
  // Settings > General
  customerFacingName?: string;     // shown to customers in the Messenger; defaults to name
  timezone?: string;               // IANA; office hours use this zone
  showAttribution?: boolean;       // "Powered by Chai Samosa" in the Messenger (default true)
  attributionText?: string;        // custom attribution text (default "Powered by Chai Samosa")
  snoozeOptions?: SnoozePreset[];  // custom snooze list (default list used when empty)
  // Settings > Office hours
  replyTimeNotice?: boolean;       // auto-tell customers the reply time when they start a conversation (default true)
  // Settings > Integrations (secrets are never sent to the browser)
  integrations?: {
    slack?: SlackIntegration;
    webhook?: WebhookIntegration;
  };
  // Settings > Messenger Live Chat
  messenger?: Partial<MessengerAppearance>;
  identitySecret?: string;          // HMAC key for identity verification (server-side only)
  identityEnforced?: boolean;       // reject logged-in users without a valid user_hash
  allowedDomains?: string[];        // empty = the Messenger may load on any site
  installations?: MessengerInstallation[];
}

/** How the Messenger looks for customers (saved on the server, applied everywhere it's installed). */
export interface MessengerAppearance {
  brandName: string;
  themeColor: string;
  greeting: string;      // header subtitle when no reply time is set
  welcome: string;       // home screen message
  launcherPosition: 'right' | 'left';
  showLauncher: boolean; // false = open it from your own button via ChaiSamosa('show')
}

/** A website or app where the Messenger has loaded (detected automatically). */
export interface MessengerInstallation {
  id: string;
  kind: 'website' | 'mobile';
  host: string;             // e.g. "shop.example.com" or "com.example.app (iOS)"
  platform?: string;        // web | ios | android | react-native
  firstSeenAt: string;
  lastSeenAt: string;
  lastUrl?: string;
  identifiedAt?: string;    // last time a logged-in (identified) user was seen there
  verifiedAt?: string;      // last time that identity carried a valid user_hash
}

/** A snooze menu entry. kind: hours/days use `amount`; days and the named ones land at 9:00 AM. */
export interface SnoozePreset {
  kind: 'hours' | 'days' | 'tomorrow' | 'next-week' | 'next-month';
  amount?: number;
  label?: string; // optional custom label; otherwise generated
}

export type IntegrationEvent = 'conversation.created' | 'message.customer';

export interface SlackIntegration {
  webhookUrl: string;              // https://hooks.slack.com/services/... (server-side only)
  enabled: boolean;
  events: IntegrationEvent[];
  connectedAt?: string;
  connectedBy?: string;
  lastDeliveryAt?: string;
  lastError?: string | null;
}

export interface WebhookIntegration {
  url: string;                     // any https URL (server-side only)
  secret?: string;                 // used to sign payloads (HMAC-SHA256), server-side only
  enabled: boolean;
  events: IntegrationEvent[];
  connectedAt?: string;
  lastDeliveryAt?: string;
  lastError?: string | null;
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
  createdAt?: string;
  // Public profile (Settings > Personal > Details)
  jobTitle?: string;
  department?: string;
  phone?: string;
  bio?: string;          // "Introduce yourself"
  calendarLink?: string;
  location?: string;     // e.g. "Hyderabad, India"
  timezone?: string;     // IANA, e.g. "Asia/Kolkata"
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
  timezone?: string; // IANA zone from the Messenger's geo lookup, for the customer's local time
}

export interface Customer {
  id: string;            // User id: a UUID (e.g. 47f1664a-c15e-42fc-b74e-5046559f92db) for every new customer
  externalId?: string;   // your own system's user id for logged-in users (window.HelpDesk.userId)
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
    type: 'customer' | 'agent' | 'system'; // system = conversation event
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
  tags?: string[]; // tag names applied to this message
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
  lastMessageSnippet?: string;   // teammates' preview (includes [Note] ...)
  customerSnippet?: string;      // customer-facing preview: last public message only
  unreadCountAgent: number;
  unreadCountCustomer: number;
  starred?: boolean;
  snoozedUntil?: string | null; // ISO time; conversation is snoozed while this is in the future
  kind?: ConversationKind;        // defaults to 'conversation'
  title?: string;                 // tickets/issues
  description?: string;           // tickets/issues
  createdByAgentId?: string;      // set when a teammate creates it manually
  attributes?: { platforms?: string[]; rootCause?: string };
  sharing?: 'shared' | 'internal'; // tickets: visible to the customer or internal only
  tags?: string[];                 // conversation tags (separate from the customer's tags)
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
