import mongoose, { Schema, Document } from 'mongoose';
import { tenantPlugin } from './tenant-plugin';

mongoose.plugin(tenantPlugin);

// Workspace Schema (Tenants)
export interface IWorkspaceDoc extends Document {
  name: string;
  subdomain?: string;
  apiKey: string;
}

export const WorkspaceSchema = new Schema<IWorkspaceDoc>({
  name: { type: String, required: true },
  subdomain: { type: String, unique: true, sparse: true },
  apiKey: { type: String, required: true, unique: true, index: true }
}, { timestamps: true });

export const WorkspaceModel = mongoose.model<IWorkspaceDoc>('Workspace', WorkspaceSchema);

// User Schema (Agents & Admins)
export interface IUserDoc extends Document {
  workspaceId: string;
  email: string;
  passwordHash: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'support_agent';
  status: 'online' | 'offline';
  lastSeen?: Date;
}

export const UserSchema = new Schema<IUserDoc>({
  workspaceId: { type: String, required: true, index: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  avatar: { type: String },
  role: { type: String, enum: ['admin', 'support_agent'], default: 'support_agent' },
  status: { type: String, enum: ['online', 'offline'], default: 'offline' },
  lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

export const UserModel = mongoose.model<IUserDoc>('User', UserSchema);

// Customer Schema (Guest Users)
export interface ICustomerDoc extends Document {
  workspaceId: string;
  id: string; // Custom unique string identifier (e.g. guest_uuid)
  name: string;
  email?: string;
  phone?: string;
  session: {
    country?: string;
    browser?: string;
    os?: string;
    device?: string;
    ip?: string;
    currentPage?: string;
    sessionDuration?: number;
    firstSeen?: Date;
    lastSeen?: Date;
    totalConversations?: number;
  };
  tags: string[];
  notes: string[];
}

export const CustomerSchema = new Schema<ICustomerDoc>({
  workspaceId: { type: String, required: true, index: true },
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  session: {
    country: { type: String, default: 'India' },
    browser: { type: String, default: 'Chrome' },
    os: { type: String, default: 'macOS' },
    device: { type: String, default: 'Desktop' },
    ip: { type: String, default: '127.0.0.1' },
    currentPage: { type: String, default: '/' },
    sessionDuration: { type: Number, default: 0 },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    totalConversations: { type: Number, default: 0 }
  },
  tags: [{ type: String }],
  notes: [{ type: String }]
}, { timestamps: true });

export const CustomerModel = mongoose.model<ICustomerDoc>('Customer', CustomerSchema);

// Conversation (Ticket) Schema
export interface IConversationDoc extends Document {
  workspaceId: string;
  ticketNumber: string; // TICKET-1001
  customerId: string; // references Customer id
  assignedAgentId?: string;
  status: string;
  priority: string;
  category: string;
  lastMessageSnippet?: string;
  unreadCountAgent: number;
  unreadCountCustomer: number;
  starred?: boolean;
  snoozedUntil?: Date | null;
  kind?: string;
  title?: string;
  description?: string;
  createdByAgentId?: string;
  attributes?: { platforms?: string[]; rootCause?: string };
  sharing?: string;
}

export const ConversationSchema = new Schema<IConversationDoc>({
  workspaceId: { type: String, required: true, index: true },
  ticketNumber: { type: String, required: true, unique: true, index: true },
  customerId: { type: String, required: true, index: true },
  assignedAgentId: { type: String, index: true },
  status: { type: String, required: true, enum: ['open', 'waiting', 'resolved', 'closed', 'archived'], default: 'open' },
  priority: { type: String, required: true, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  category: { type: String, required: true, enum: ['general', 'bug', 'payment', 'subscription', 'refund', 'feature_request', 'other'], default: 'general' },
  lastMessageSnippet: { type: String, default: '' },
  unreadCountAgent: { type: Number, default: 0 },
  unreadCountCustomer: { type: Number, default: 0 },
  starred: { type: Boolean, default: false },
  snoozedUntil: { type: Date, default: null },
  kind: { type: String, enum: ['conversation', 'ticket', 'issue'], default: 'conversation', index: true },
  title: { type: String },
  description: { type: String },
  createdByAgentId: { type: String, index: true },
  attributes: { type: Schema.Types.Mixed, default: {} },
  sharing: { type: String, enum: ['shared', 'internal'], default: 'shared' }
}, { timestamps: true });

export const ConversationModel = mongoose.model<IConversationDoc>('Conversation', ConversationSchema);

// Message Schema (incorporates internal notes and reactions)
export interface IMessageDoc extends Document {
  workspaceId: string;
  conversationId: string;
  sender: {
    type: 'customer' | 'agent';
    id: string; // Customer ID or Agent ID
    name: string;
    avatar?: string;
  };
  content: string;
  attachments?: Array<{
    name: string;
    url: string;
    type: 'image' | 'pdf' | 'file';
    size?: number;
  }>;
  isInternalNote: boolean;
  seen: boolean;
  seenAt?: Date;
  delivered: boolean;
  reactions?: Array<{
    agentId: string;
    agentName: string;
    emoji: string;
  }>;
  tags?: string[];
  metadata?: any;
}

export const MessageSchema = new Schema<IMessageDoc>({
  workspaceId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  sender: {
    type: { type: String, required: true, enum: ['customer', 'agent', 'system'] },
    id: { type: String, required: true },
    name: { type: String, required: true },
    avatar: { type: String }
  },
  content: { type: String, default: '' },
  attachments: [{
    name: { type: String },
    url: { type: String },
    type: { type: String, enum: ['image', 'pdf', 'file'] },
    size: { type: Number }
  }],
  isInternalNote: { type: Boolean, default: false },
  seen: { type: Boolean, default: false },
  seenAt: { type: Date },
  delivered: { type: Boolean, default: true },
  reactions: [{
    agentId: { type: String, required: true },
    agentName: { type: String, required: true },
    emoji: { type: String, required: true }
  }],
  tags: { type: [String], default: [] },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

export const MessageModel = mongoose.model<IMessageDoc>('Message', MessageSchema);

// Saved Reply Schema
export interface ISavedReplyDoc extends Document {
  workspaceId: string;
  trigger: string; // e.g. /refund
  title: string;
  content: string;
  availableFor?: 'everyone' | 'myself' | 'teams';
  availableWhen?: ('starting_conversations' | 'replying' | 'adding_notes')[];
  creator?: {
    id: string;
    name: string;
    avatar?: string;
  };
}

export const SavedReplySchema = new Schema<ISavedReplyDoc>({
  workspaceId: { type: String, required: true, index: true },
  trigger: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  availableFor: { type: String, enum: ['everyone', 'myself', 'teams'], default: 'everyone' },
  availableWhen: { type: [String], default: ['starting_conversations', 'replying', 'adding_notes'] },
  creator: {
    id: { type: String },
    name: { type: String },
    avatar: { type: String }
  }
}, { timestamps: true });

export const SavedReplyModel = mongoose.model<ISavedReplyDoc>('SavedReply', SavedReplySchema);

// Tag Schema
export interface ITagDoc extends Document {
  workspaceId: string;
  name: string;
  color: string;
}

export const TagSchema = new Schema<ITagDoc>({
  workspaceId: { type: String, required: true, index: true },
  name: { type: String, required: true, unique: true, index: true },
  color: { type: String, required: true }
}, { timestamps: true });

export const TagModel = mongoose.model<ITagDoc>('Tag', TagSchema);

// Agent Settings Schema
export interface ISettingsDoc extends Document {
  workspaceId: string;
  agentId: string;
  theme: 'light' | 'dark';
  notifications: {
    desktop: boolean;
    sound: boolean;
    browser: boolean;
  };
  timezone: string;
  language: string;
  autoAssign: boolean;
  businessHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
    days: number[];
  };
}

export const SettingsSchema = new Schema<ISettingsDoc>({
  workspaceId: { type: String, required: true, index: true },
  agentId: { type: String, required: true, unique: true, index: true },
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  notifications: {
    desktop: { type: Boolean, default: true },
    sound: { type: Boolean, default: true },
    browser: { type: Boolean, default: true }
  },
  timezone: { type: String, default: 'America/New_York' },
  language: { type: String, default: 'en' },
  autoAssign: { type: Boolean, default: false },
  businessHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '09:00' },
    end: { type: String, default: '17:00' },
    timezone: { type: String, default: 'America/New_York' },
    days: { type: [Number], default: [1, 2, 3, 4, 5] }
  }
}, { timestamps: true });

export const SettingsModel = mongoose.model<ISettingsDoc>('Settings', SettingsSchema);
