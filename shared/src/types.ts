export type TicketStatus = 'open' | 'waiting' | 'resolved' | 'closed' | 'archived' | 'merged';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high' | 'critical'; // critical is shown as "Urgent"
export type TicketCategory = 'general' | 'bug' | 'payment' | 'subscription' | 'refund' | 'feature_request' | 'other';
/** admin = everything; support_agent = conversations, no workspace settings or data; light = read-only, internal notes only. */
export type UserRole = 'admin' | 'support_agent' | 'light';
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
  sla?: SlaPolicy;                 // response-time targets (Settings › SLAs)
  csatEnabled?: boolean;           // ask customers to rate resolved conversations (default true)
  defaultTeamId?: string;          // new customer conversations go to this team inbox (Settings › Teams)
  customerAttributes?: CustomAttributeDef[]; // custom people data (Settings › People data)
  email?: EmailSettings;           // Settings › Channels › Email (passwords never leave the server)
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
  aiAgent?: Partial<AiAgentSettings>; // Settings › AI Agent (off by default)
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
  features?: AiFeatures;
  updatedAt?: string;
  updatedBy?: string;
}

/** AI that runs on its own (Settings › AI assistant › Automations). */
export interface AiFeatures {
  handoffSummary: boolean;   // summarize a chat as an internal note when the bot hands it to the team
  suggestedReplies: boolean; // suggest replies above the composer when the customer is waiting
  autoTriage: boolean;       // set priority and add matching tags to new conversations
  translation: boolean;      // translate customers' messages into the team language, and replies into theirs
  teamLanguage: string;      // e.g. "English"
}

/** How the Messenger looks for customers (saved on the server, applied everywhere it's installed). */
export interface MessengerAppearance {
  brandName: string;
  themeColor: string;
  greeting: string;      // header subtitle when no reply time is set
  welcome: string;       // home screen message
  launcherPosition: 'right' | 'left';
  showLauncher: boolean; // false = open it from your own button via ChaiSamosa('show')
  autoLanguage?: boolean; // Settings › Multilingual: show the Messenger in each visitor's browser language
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
  mentionsSeenAt?: string; // last time they opened the Mentions view (newer mentions count as unread)
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
  companyId?: string;    // the company this person belongs to
  attributes?: Record<string, string | number | boolean>; // custom attributes (Settings › People data)
}

/** A custom field on people, defined once in Settings › People data and filled in per person. */
export interface CustomAttributeDef {
  key: string;           // stable id, e.g. "plan" (letters, digits, underscores)
  label: string;         // "Plan"
  type: 'text' | 'number' | 'boolean' | 'date' | 'list';
  options?: string[];    // list type: the choices
  archived?: boolean;    // hidden from the profile, values kept
}

/** A company people belong to (B2B support: see every conversation from the same account). */
export interface Company {
  id: string;
  workspaceId?: string;
  name: string;
  website?: string;
  plan?: string;
  size?: number;         // number of employees
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** How a team inbox hands out new conversations. */
export type AssignmentMethod = 'manual' | 'round_robin' | 'balanced';

/** A team inbox (Settings › Teams). Conversations belong to a team and, optionally, a teammate. */
export interface Team {
  id: string;
  workspaceId?: string;
  name: string;
  emoji?: string;
  memberIds: string[];
  assignment: {
    method: AssignmentMethod;  // manual: stays unassigned; round_robin: take turns; balanced: fewest open conversations
    capacity?: number;         // max open conversations per teammate before they're skipped (empty = no limit)
    lastAssignedId?: string;   // round robin: who got the last one
  };
  createdAt?: string;
  updatedAt?: string;
}

/** Workspace audit log (Settings › Audit log): who changed settings, teammates or data, and when. */
export interface AuditEntry {
  id: string;
  workspaceId?: string;
  action: string;        // e.g. "settings.updated", "teammate.role_changed", "data.exported"
  summary: string;       // "Changed SLA targets"
  actor: { id: string; name: string } | null;
  target?: string;       // what it was done to, e.g. a teammate's name
  details?: Record<string, unknown>;
  ip?: string;
  createdAt?: string;
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
  linkedIssueId?: string;          // conversations/tickets: the tracker issue this report belongs to
  reportCount?: number;            // issues (computed, not stored): how many conversations are linked to it
  lastMessageFrom?: 'customer' | 'team'; // computed for lists: who sent the latest public message (↩ avatar when it's the team)
  participants?: string[];         // extra people (email addresses) who get every teammate reply by email
  participantThreadIds?: string[]; // Messenger conversations: Message-IDs of the participants' email thread
  aiAgent?: ConversationAiAgent;   // set while/after the AI Agent answered this conversation
  publicNotice?: string;           // issues: shown on the Messenger home while the issue is open ("We're aware of…")
  tags?: string[];                 // conversation tags (separate from the customer's tags)
  bot?: ConversationBotState;      // set while/after the chat-flow bot handled it
  mergedInto?: { id: string; ticketNumber: string; at: string; by?: string }; // set when merged into a primary conversation
  importedFrom?: { source: 'csv'; id: string; url?: string };  // Settings › Data › Imports (e.g. the Intercom conversation id)
  rating?: ConversationRating;     // CSAT: the customer's rating after it was resolved
  csatRequestedAt?: string;        // when the Messenger last asked for a rating
  sla?: ConversationSla;           // the reply the customer is waiting on (Settings › SLAs)
  teamId?: string;                 // team inbox it belongs to (Settings › Teams)
  channel?: 'messenger' | 'email'; // where the customer wrote in (default messenger)
  email?: ConversationEmail;       // email channel: subject + Message-IDs for threading
  language?: string;               // the customer's language when it isn't the team's (AI translation), e.g. "Spanish"
  createdAt: string;
  updatedAt: string;
}

/**
 * SLA clock for the reply the customer is waiting on. "first" = no teammate has replied yet,
 * "next" = the customer wrote again after a teammate's reply. Cleared once a teammate replies.
 */
export interface ConversationSla {
  kind: 'first' | 'next';
  startedAt: string;       // when the customer started waiting
  dueAt: string;           // startedAt + the target for the conversation's priority
  targetMinutes: number;
  breachedAt?: string;     // set once when the target is missed
}

/** Response-time targets per priority, in minutes (Settings › SLAs). */
export interface SlaPolicy {
  enabled: boolean;
  enabledAt?: string;      // only conversations waiting since then are measured
  firstResponseMinutes: Record<TicketPriority, number>;
  nextResponseMinutes: Record<TicketPriority, number>;
}

/** Email threading for a conversation that came in (or continues) by email. */
export interface ConversationEmail {
  subject: string;
  address: string;          // the customer's email address
  threadIds: string[];      // Message-IDs in this thread (ours and theirs), newest last
}

/**
 * Settings › Channels › Email. SMTP sends agent replies, missed-reply alerts and transcripts;
 * inbound mail arrives by IMAP polling or by a forwarding webhook and is threaded into tickets.
 */
export interface EmailSettings {
  enabled: boolean;
  fromName?: string;
  fromAddress?: string;
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string };
  inbound?: {
    mode: 'none' | 'imap' | 'webhook';
    imap?: { host: string; port: number; secure: boolean; user: string; password?: string; mailbox?: string };
    webhookToken?: string;
    lastPolledAt?: string;
    lastError?: string | null;
  };
  missedReplyAlerts?: boolean;       // email customers replies they haven't seen (default true)
  missedReplyDelayMinutes?: number;  // wait this long first (default 5)
  transcripts?: boolean;             // email the transcript when a conversation is closed (default true)
  ticketUpdates?: boolean;           // email customers about their tickets: opened, waiting on you, resolved (default true)
  lastSentAt?: string;
  lastError?: string | null;
  enabledAt?: string;
}

/** Knowledge base: a group of articles (e.g. "Billing"). */
export interface HelpCollection {
  id: string;
  workspaceId?: string;
  name: string;
  description?: string;
  emoji?: string;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Knowledge base article. Published ones show in the Messenger and inform Ask AI. */
export interface HelpArticle {
  id: string;
  workspaceId?: string;
  title: string;
  body: string;               // markdown
  collectionId?: string;
  state: 'draft' | 'published';
  authorId?: string;
  authorName?: string;
  views: number;
  helpful: number;
  notHelpful: number;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Proactive (outbound) message shown in the Messenger: a chat message or a banner at the top of the page. */
export interface OutboundMessage {
  id: string;
  workspaceId?: string;
  name: string;               // internal name
  kind: 'chat' | 'banner';
  body: string;               // markdown
  senderId?: string;          // chat: teammate it comes from
  link?: { label: string; url: string }; // banner: optional button
  bannerStyle?: 'info' | 'promo';
  audience: {
    people: 'everyone' | 'leads' | 'users';
    pageUrl?: { op: 'contains' | 'equals' | 'starts_with'; value: string };
    attribute?: { key: string; value: string };
  };
  frequency: 'once' | 'every_page';  // once per person, or on every matching page until dismissed
  state: 'live' | 'paused';
  stats?: { sent: number; opened: number; replied: number; dismissed: number };
  createdAt?: string;
  updatedAt?: string;
}

/** Customer satisfaction (CSAT): 1 = terrible … 5 = amazing. */
export interface ConversationRating {
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  at: string;
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

/** What a macro does to the conversation when it's applied (on send, or right away when it has no text). */
export interface MacroActions {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignTo?: string;          // teammate id, 'me', or 'unassigned'
  addTags?: string[];         // tag names
  snoozeMinutes?: number;     // snooze for this long
}

export interface SavedReply {
  id: string;
  workspaceId?: string;
  trigger: string; // e.g. /refund
  title: string;
  content: string; // markdown text; may be empty for an action-only macro
  actions?: MacroActions;
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

/**
 * A side conversation: an email thread with someone outside the team (a supplier, another department)
 * started from a conversation. Its messages are internal notes in that conversation (metadata.side),
 * so the customer never sees them.
 */
export interface SideConversation {
  id: string;
  workspaceId?: string;
  conversationId: string;
  number: number;              // 1, 2, … within the conversation (subject tag "[#41153/2]")
  to: string;                  // their email address
  subject: string;
  threadIds: string[];         // Message-IDs, newest last
  createdBy?: { id: string; name: string };
  lastMessageAt?: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Settings › AI Agent: an AI teammate that answers customers itself (from the knowledge base) and hands
 * the conversation to a person when it can't help. Off by default.
 */
export interface AiAgentSettings {
  enabled: boolean;
  name: string;                       // shown to customers, e.g. "AI Agent"
  answerFrom: 'knowledge' | 'general'; // only from help articles, or general knowledge too
  minConfidence: number;              // 0–1: below this, hand over instead of answering
  maxReplies: number;                 // per conversation, then hand over
  handoffTopics: string[];            // words/topics that always go to a person (refund, legal…)
  handoffMessage: string;             // what the customer sees when it hands over
  channels: { messenger: boolean; email: boolean };
  afterChatFlow: boolean;             // also answer chats the chat-flow bot hands to the team
  askFeedback: boolean;               // "Did that answer your question?" under each answer
}

export interface ConversationAiAgent {
  state: 'active' | 'resolved' | 'handoff';
  replies: number;
  startedAt: string;
  endedAt?: string;
  reason?: string;                    // why it handed over
}
