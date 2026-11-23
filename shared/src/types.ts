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
  appId?: string;                  // public Messenger App ID, e.g. "x7k2m9pq" (install code, X-Workspace-Id)
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
  showStateToCustomer?: boolean;   // post "Ticket in progress / Waiting on you / Ticket resolved / Conversation closed" lines in the Messenger (default true)
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
  chatFlow?: ChatFlowSettings;
  ai?: AiSettings;                 // Settings › AI assistant (the API key never leaves the server)
  dataImports?: DataImportRecord[]; // Settings › Data › Imports & exports (newest first, last 50)
}

export type DataImportType = 'people' | 'conversations' | 'messages';
export interface DataImportRecord {
  id: string;
  type: DataImportType;
  fileName: string;
  at: string;
  byName?: string;
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

/** Settings › AI assistant: the model teammates use in the "Ask AI" panel. */
export type AiProvider = 'anthropic' | 'openai' | 'openai_compatible';
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl?: string;        // openai_compatible only, e.g. https://generativelanguage.googleapis.com/v1beta/openai
  apiKey?: string;         // stored server-side only
  instructions?: string;   // extra guidance added to every request (tone, policies, product facts)
  updatedAt?: string;
  updatedBy?: string;
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
  away?: boolean;        // Away mode: not shown as online to customers, skipped by auto-assignment
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
  blocked?: boolean;     // can't send messages or start conversations (Block user)
  blockedAt?: string;
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
  bot?: ConversationBotState;      // set while/after the chat-flow bot handled it
  mergedInto?: { id: string; ticketNumber: string; at: string; by?: string }; // set when merged into a primary conversation
  importedFrom?: { source: 'csv'; id: string; url?: string };  // Settings › Data › Imports (e.g. the Intercom conversation id)
  createdAt: string;
  updatedAt: string;
}

/** Where a customer is in the chat-flow bot. menu = choosing; confirm = "Did this solve your issue?"; done = solved; handoff = asked for a person. */
export interface ConversationBotState {
  state: 'menu' | 'confirm' | 'done' | 'handoff';
  node: string | null;   // option id whose sub-menu is showing (null = main menu)
  path: string[];        // labels clicked, e.g. ["My Account Information", "OTP Not Received"]
  version: number;       // flow version this chat started on
}

// ── Chat flow (Settings › Channels › Chat flow) ─────────────────────────────

export type ChatFlowQuestionType = 'name' | 'phone' | 'email' | 'text';
export interface ChatFlowQuestion {
  id: string;
  type: ChatFlowQuestionType;
  label: string;          // "Your mobile number (choose your country code)"
  placeholder: string;
  required: boolean;      // optional questions show "Skip"
}

/** A button in a menu: opens a sub-menu (children), shows an answer, or connects the visitor to an agent. */
export interface ChatFlowOption {
  id: string;
  label: string;
  kind: 'menu' | 'answer' | 'agent';
  prompt?: string;            // menu: message shown above its sub-options
  answer?: string;            // answer: markdown (**bold**, emoji, lists); agent: optional message before connecting (empty = the "Reply to No" text)
  children?: ChatFlowOption[];
}

export interface ChatFlow {
  enabled: boolean;
  botName: string;            // "Chai Shots Support"
  botSubtitle: string;        // "Here to help, anytime."
  welcome: string;            // first message
  askDetails: boolean;        // ask the questions below before the menu
  questions: ChatFlowQuestion[];
  defaultCountry: string;     // ISO code for the phone picker, e.g. "IN"
  detailsPlaceholder: string; // composer text while answering ("Enter details in the input field")
  menuPrompt: string;         // "Thanks, {name}! How can we help you today? Please select an option below."
  options: ChatFlowOption[];  // main categories
  askResolved: boolean;       // after an answer: "Did this solve your issue?"
  resolvedQuestion: string;
  yesLabel: string;
  noLabel: string;
  yesReply: string;
  noReply: string;
  showBack: boolean;
  backLabel: string;
  showRestart: boolean;
  restartLabel: string;
  restartMessage: string;     // "Let's start again!"
  restartPrompt: string;      // "Please select a support category."
  menuPlaceholder: string;    // composer text while in the menus ("We are here to help you")
}

/** Stored on the workspace: edits go to the draft; Publish copies it live. */
export interface ChatFlowSettings {
  draft: ChatFlow;
  published: ChatFlow | null;
  version: number;            // bumps on every publish
  publishedAt?: string;
  updatedAt?: string;
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
