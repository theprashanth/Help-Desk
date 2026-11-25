import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  Agent, Customer, Conversation, Message, SavedReply, Tag, AgentSettings, Workspace 
} from '../../../shared/src/types';
import { 
  IUserRepository, ICustomerRepository, IConversationRepository, 
  IMessageRepository, ISavedReplyRepository, ITagRepository, ISettingsRepository, IWorkspaceRepository 
} from './interfaces';
import { 
  UserModel, CustomerModel, ConversationModel, MessageModel, 
  SavedReplyModel, TagModel, SettingsModel, WorkspaceModel 
} from '../models/schemas';
import { nextTicketNumber, migrateLegacyText, hasLegacyTicketText } from '../services/ticketNumbers';
import { generateAppId } from '../services/appId';

/** One-time rename of legacy "TICKET-1130" ids to "#41130" in MongoDB (see migrateJsonTicketNumbers). */
export async function migrateMongoTicketNumbers(): Promise<number> {
  let changed = 0;
  const convs = await ConversationModel.find({ $or: [{ ticketNumber: /TICKET-\d+/ }, { lastMessageSnippet: /TICKET-\d+/ }, { 'mergedInto.ticketNumber': /TICKET-\d+/ }] }).lean();
  for (const c of convs as any[]) {
    const fix = (v: any) => (typeof v === 'string' ? migrateLegacyText(v) : v);
    await ConversationModel.updateOne({ _id: c._id }, { $set: {
      ticketNumber: fix(c.ticketNumber),
      lastMessageSnippet: fix(c.lastMessageSnippet),
      ...(c.customerSnippet ? { customerSnippet: fix(c.customerSnippet) } : {}),
      ...(c.mergedInto ? { mergedInto: JSON.parse(migrateLegacyText(JSON.stringify(c.mergedInto))) } : {}),
    } });
    changed++;
  }
  const msgs = await MessageModel.find({ $or: [{ content: /TICKET-\d+/ }, { 'metadata.mergeDetails.sourceTicketNumber': /TICKET-\d+/ }, { 'metadata.mergedIntoTicketNumber': /TICKET-\d+/ }] }).lean();
  for (const m of msgs as any[]) {
    const text = JSON.stringify({ content: m.content, metadata: m.metadata });
    if (!hasLegacyTicketText(text)) continue;
    await MessageModel.updateOne({ _id: m._id }, { $set: JSON.parse(migrateLegacyText(text)) });
    changed++;
  }
  if (changed) console.log(`[Migration] Renamed TICKET-xxxx ids to #number style in MongoDB (${changed} records)`);
  return changed;
}

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Mappers
const mapWorkspace = (doc: any): Workspace => ({
  id: doc._id.toString(),
  appId: doc.appId || undefined,
  name: doc.name,
  subdomain: doc.subdomain,
  apiKey: doc.apiKey,
  createdAt: doc.createdAt?.toISOString(),
  officeHours: doc.officeHours || undefined,
  replyTime: doc.replyTime || 'asap',
  customerFacingName: doc.customerFacingName,
  timezone: doc.timezone,
  showAttribution: doc.showAttribution,
  attributionText: doc.attributionText,
  snoozeOptions: doc.snoozeOptions,
  replyTimeNotice: doc.replyTimeNotice,
  integrations: doc.integrations,
  messenger: doc.messenger,
  identitySecret: doc.identitySecret,
  identityEnforced: doc.identityEnforced,
  allowedDomains: doc.allowedDomains,
  installations: doc.installations,
  chatFlow: doc.chatFlow,
  showStateToCustomer: doc.showStateToCustomer,
  csatEnabled: doc.csatEnabled,
  defaultTeamId: doc.defaultTeamId || undefined,
  email: doc.email || undefined,
  customerAttributes: doc.customerAttributes || undefined,
  sla: doc.sla || undefined,
  ai: doc.ai || undefined,
  dataImports: doc.dataImports || undefined,
});

export class MongooseWorkspaceRepository implements IWorkspaceRepository {
  async findById(id: string): Promise<Workspace | null> {
    const doc = await WorkspaceModel.findById(id);
    return doc ? mapWorkspace(doc) : null;
  }

  async findByApiKey(apiKey: string): Promise<Workspace | null> {
    const doc = await WorkspaceModel.findOne({ apiKey });
    return doc ? mapWorkspace(doc) : null;
  }

  async findByAppId(appId: string): Promise<Workspace | null> {
    const doc = await WorkspaceModel.findOne({ appId });
    return doc ? mapWorkspace(doc) : null;
  }

  async findAll(): Promise<Workspace[]> {
    const docs = await WorkspaceModel.find({});
    return docs.map(mapWorkspace);
  }

  async create(workspace: Omit<Workspace, 'id' | 'createdAt'>): Promise<Workspace> {
    const doc = new WorkspaceModel({
      name: workspace.name,
      subdomain: workspace.subdomain,
      apiKey: workspace.apiKey,
      appId: workspace.appId || generateAppId(),
    });
    await doc.save();
    return mapWorkspace(doc);
  }

  async update(id: string, updateData: Partial<Workspace>): Promise<Workspace | null> {
    const doc = await WorkspaceModel.findByIdAndUpdate(id, { $set: updateData }, { new: true });
    return doc ? mapWorkspace(doc) : null;
  }
}

const mapAgent = (doc: any): Agent => ({
  id: doc._id.toString(),
  workspaceId: doc.workspaceId,
  email: doc.email,
  name: doc.name,
  avatar: doc.avatar,
  role: doc.role,
  status: doc.status,
  lastSeen: doc.lastSeen?.toISOString(),
  createdAt: doc.createdAt?.toISOString(),
  jobTitle: doc.jobTitle,
  department: doc.department,
  phone: doc.phone,
  bio: doc.bio,
  calendarLink: doc.calendarLink,
  location: doc.location,
  timezone: doc.timezone,
  away: doc.away || undefined,
  mentionsSeenAt: doc.mentionsSeenAt || undefined,
});

const mapCustomer = (doc: any): Customer => ({
  id: doc.id,
  externalId: doc.externalId || undefined,
  name: doc.name,
  email: doc.email,
  phone: doc.phone,
  session: {
    country: doc.session?.country,
    browser: doc.session?.browser,
    os: doc.session?.os,
    device: doc.session?.device,
    ip: doc.session?.ip,
    currentPage: doc.session?.currentPage,
    sessionDuration: doc.session?.sessionDuration,
    firstSeen: doc.session?.firstSeen?.toISOString(),
    lastSeen: doc.session?.lastSeen?.toISOString(),
    timezone: doc.session?.timezone,
    totalConversations: doc.session?.totalConversations,
  },
  tags: doc.tags || [],
  notes: doc.notes || [],
  blocked: doc.blocked || undefined,
  blockedAt: doc.blockedAt || undefined,
  companyId: doc.companyId || undefined,
  attributes: doc.attributes || undefined,
});

const mapMessage = (doc: any): Message => ({
  id: doc._id.toString(),
  conversationId: doc.conversationId,
  sender: {
    type: doc.sender.type,
    id: doc.sender.id,
    name: doc.sender.name,
    avatar: doc.sender.avatar,
  },
  content: doc.content,
  attachments: doc.attachments?.map((a: any) => ({
    name: a.name,
    url: a.url,
    type: a.type,
    size: a.size
  })) || [],
  isInternalNote: doc.isInternalNote,
  seen: doc.seen,
  seenAt: doc.seenAt?.toISOString(),
  delivered: doc.delivered,
  reactions: doc.reactions?.map((r: any) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    emoji: r.emoji
  })) || [],
  tags: doc.tags || [],
  metadata: doc.metadata,
  createdAt: doc.createdAt?.toISOString(),
});

// Mongoose User Repository
export class MongooseUserRepository implements IUserRepository {
  async findById(id: string): Promise<Agent | null> {
    const doc = await UserModel.findById(id);
    return doc ? mapAgent(doc) : null;
  }

  async findByEmail(email: string): Promise<Agent | null> {
    const doc = await UserModel.findOne({ email });
    return doc ? mapAgent(doc) : null;
  }

  async verifyPassword(email: string, passwordPlain: string): Promise<{ agent: Agent; token: string } | null> {
    const userDoc = await UserModel.findOne({ email });
    if (!userDoc) return null;
    const isMatch = await bcrypt.compare(passwordPlain, userDoc.passwordHash);
    if (!isMatch) return null;
    
    const agent = mapAgent(userDoc);
    const token = jwt.sign(
      { id: agent.id, email: agent.email, role: agent.role, workspaceId: agent.workspaceId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return { agent, token };
  }

  async create(agentData: Omit<Agent, 'id'> & { passwordPlain: string }): Promise<Agent> {
    const passwordHash = await bcrypt.hash(agentData.passwordPlain, 10);
    const doc = new UserModel({
      email: agentData.email,
      passwordHash,
      name: agentData.name,
      avatar: agentData.avatar,
      role: agentData.role,
      status: agentData.status,
      lastSeen: agentData.lastSeen ? new Date(agentData.lastSeen) : new Date(),
    });
    await doc.save();
    return mapAgent(doc);
  }

  async update(id: string, updateData: Partial<Agent>): Promise<Agent | null> {
    const cleanUpdates: any = { ...updateData };
    if (updateData.lastSeen) cleanUpdates.lastSeen = new Date(updateData.lastSeen);
    const doc = await UserModel.findByIdAndUpdate(id, { $set: cleanUpdates }, { new: true });
    return doc ? mapAgent(doc) : null;
  }

  async findAll(): Promise<Agent[]> {
    const docs = await UserModel.find();
    return docs.map(mapAgent);
  }

  async delete(id: string): Promise<boolean> {
    const res = await UserModel.findByIdAndDelete(id);
    return res !== null;
  }
}

// Mongoose Customer Repository
export class MongooseCustomerRepository implements ICustomerRepository {
  async findById(id: string): Promise<Customer | null> {
    const doc = await CustomerModel.findOne({ id });
    return doc ? mapCustomer(doc) : null;
  }

  async findByExternalId(externalId: string): Promise<Customer | null> {
    const doc = await CustomerModel.findOne({ externalId });
    return doc ? mapCustomer(doc) : null;
  }

  async findOrCreate(id: string, defaultData: Omit<Customer, 'id'>): Promise<Customer> {
    let doc = await CustomerModel.findOne({ id });
    if (!doc) {
      doc = new CustomerModel({
        id,
        externalId: defaultData.externalId,
        name: defaultData.name,
        email: defaultData.email,
        phone: defaultData.phone,
        session: {
          ...defaultData.session,
          firstSeen: defaultData.session.firstSeen ? new Date(defaultData.session.firstSeen) : new Date(),
          lastSeen: defaultData.session.lastSeen ? new Date(defaultData.session.lastSeen) : new Date(),
        },
        tags: defaultData.tags,
        notes: defaultData.notes
      });
      await doc.save();
    }
    return mapCustomer(doc);
  }

  async create(customer: Customer): Promise<Customer> {
    const doc = new CustomerModel({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      session: {
        ...customer.session,
        firstSeen: customer.session.firstSeen ? new Date(customer.session.firstSeen) : new Date(),
        lastSeen: customer.session.lastSeen ? new Date(customer.session.lastSeen) : new Date(),
      },
      tags: customer.tags,
      notes: customer.notes
    });
    await doc.save();
    return mapCustomer(doc);
  }

  async update(id: string, updateData: Partial<Customer>): Promise<Customer | null> {
    const cleanUpdates: any = { ...updateData };
    if (updateData.session) {
      const current = await CustomerModel.findOne({ id });
      cleanUpdates.session = {
        ...(current?.session || {}),
        ...updateData.session,
      };
      if (updateData.session.firstSeen) cleanUpdates.session.firstSeen = new Date(updateData.session.firstSeen);
      if (updateData.session.lastSeen) cleanUpdates.session.lastSeen = new Date(updateData.session.lastSeen);
    }
    const doc = await CustomerModel.findOneAndUpdate({ id }, { $set: cleanUpdates }, { new: true });
    return doc ? mapCustomer(doc) : null;
  }

  async findAll(): Promise<Customer[]> {
    const docs = await CustomerModel.find();
    return docs.map(mapCustomer);
  }

  async delete(id: string): Promise<boolean> {
    const r = await CustomerModel.deleteOne({ id });
    return r.deletedCount > 0;
  }
}

// Mongoose Conversation Repository
export class MongooseConversationRepository implements IConversationRepository {
  private async buildConversationObject(doc: any): Promise<Conversation> {
    const customerDoc = await CustomerModel.findOne({ id: doc.customerId });
    const customer = customerDoc 
      ? mapCustomer(customerDoc) 
      : { id: doc.customerId, name: 'Unknown User', session: {}, tags: [], notes: [] };

    return {
      id: doc._id.toString(),
      ticketNumber: doc.ticketNumber,
      customer,
      assignedAgentId: doc.assignedAgentId,
      status: doc.status,
      priority: doc.priority,
      category: doc.category,
      lastMessageSnippet: doc.lastMessageSnippet,
      unreadCountAgent: doc.unreadCountAgent,
      unreadCountCustomer: doc.unreadCountCustomer,
      starred: doc.starred || false,
      snoozedUntil: doc.snoozedUntil ? new Date(doc.snoozedUntil).toISOString() : null,
      customerSnippet: doc.customerSnippet,
      tags: doc.tags || [],
      kind: (doc.kind as any) || 'conversation',
      title: doc.title,
      description: doc.description,
      createdByAgentId: doc.createdByAgentId,
      attributes: doc.attributes || {},
      sharing: (doc.sharing as any) || 'shared',
      bot: doc.bot || undefined,
      mergedInto: doc.mergedInto || undefined,
      importedFrom: doc.importedFrom || undefined,
      rating: doc.rating || undefined,
      csatRequestedAt: doc.csatRequestedAt || undefined,
      sla: doc.sla || undefined,
      teamId: doc.teamId || undefined,
      channel: (doc.channel as any) || undefined,
      email: doc.email || undefined,
      language: doc.language || undefined,
      linkedIssueId: doc.linkedIssueId || undefined,
      participants: doc.participants?.length ? doc.participants : undefined,
      participantThreadIds: doc.participantThreadIds?.length ? doc.participantThreadIds : undefined,
      publicNotice: doc.publicNotice || undefined,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  async findById(id: string): Promise<Conversation | null> {
    const doc = await ConversationModel.findById(id);
    return doc ? this.buildConversationObject(doc) : null;
  }

  async findByTicketNumber(ticketNumber: string): Promise<Conversation | null> {
    const doc = await ConversationModel.findOne({ ticketNumber });
    return doc ? this.buildConversationObject(doc) : null;
  }

  async create(conv: Omit<Conversation, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    // Generate Ticket number
    const existing = await ConversationModel.find({}, { ticketNumber: 1 }).lean();
    const ticketNumber = nextTicketNumber(existing.map((d: any) => d.ticketNumber));
    
    const doc = new ConversationModel({
      ticketNumber,
      customerId: conv.customer.id,
      assignedAgentId: conv.assignedAgentId,
      status: conv.status,
      priority: conv.priority,
      category: conv.category,
      lastMessageSnippet: conv.lastMessageSnippet || '',
      unreadCountAgent: conv.unreadCountAgent || 0,
      unreadCountCustomer: conv.unreadCountCustomer || 0,
      starred: conv.starred || false,
      snoozedUntil: conv.snoozedUntil || null,
      customerSnippet: conv.customerSnippet,
      tags: conv.tags || [],
      kind: conv.kind || 'conversation',
      title: conv.title,
      description: conv.description,
      createdByAgentId: conv.createdByAgentId,
      attributes: conv.attributes || {},
      sharing: conv.sharing || 'shared',
      bot: conv.bot,
      teamId: conv.teamId,
      channel: conv.channel,
      email: conv.email,
    });
    await doc.save();
    return this.buildConversationObject(doc);
  }

  async update(id: string, updateData: Partial<Conversation>, opts?: { touch?: boolean }): Promise<Conversation | null> {
    const cleanUpdates: any = { ...updateData };
    if (updateData.customer) {
      cleanUpdates.customerId = updateData.customer.id;
      delete cleanUpdates.customer;
    }
    // Keys explicitly set to undefined/null (e.g. unassigning) must be removed, not skipped
    const unset: Record<string, ''> = {};
    for (const k of Object.keys(cleanUpdates)) {
      if (cleanUpdates[k] === undefined || (k === 'assignedAgentId' && cleanUpdates[k] === null)) {
        unset[k] = '';
        delete cleanUpdates[k];
      }
    }
    const update: any = { $set: cleanUpdates };
    if (Object.keys(unset).length) update.$unset = unset;
    const doc = await ConversationModel.findByIdAndUpdate(id, update, { new: true, ...(opts?.touch === false ? { timestamps: false } : {}) });
    return doc ? this.buildConversationObject(doc) : null;
  }

  async findAll(): Promise<Conversation[]> {
    const docs = await ConversationModel.find().sort({ updatedAt: -1 });
    const list = [];
    for (const d of docs) {
      list.push(await this.buildConversationObject(d));
    }
    return list;
  }

  async findFiltered(filters: {
    status?: string[];
    priority?: string[];
    assignedAgentId?: string | null;
    category?: string[];
    search?: string;
    unread?: boolean;
    tag?: string;
    kind?: string[];
    createdByAgentId?: string;
    bot?: 'handled' | 'active' | 'resolved';
  }): Promise<Conversation[]> {
    const query: any = {};
    if (filters.bot) {
      query['bot.state'] = { $in: filters.bot === 'active' ? ['menu', 'confirm'] : filters.bot === 'resolved' ? ['done'] : ['menu', 'confirm', 'done'] };
    }

    if (filters.kind && filters.kind.length > 0) {
      // legacy documents have no kind => treat as 'conversation'
      query.kind = filters.kind.includes('conversation')
        ? { $in: [...filters.kind, null] }
        : { $in: filters.kind };
    }
    if (filters.createdByAgentId) {
      query.createdByAgentId = filters.createdByAgentId;
    }
    
    if (filters.status && filters.status.length > 0) {
      query.status = { $in: filters.status };
    }
    if (filters.priority && filters.priority.length > 0) {
      query.priority = { $in: filters.priority };
    }
    if (filters.category && filters.category.length > 0) {
      query.category = { $in: filters.category };
    }
    if (filters.assignedAgentId !== undefined) {
      if (filters.assignedAgentId === null || filters.assignedAgentId === 'unassigned') {
        query.assignedAgentId = { $exists: false };
      } else {
        query.assignedAgentId = filters.assignedAgentId;
      }
    }
    if (filters.unread) {
      query.unreadCountAgent = { $gt: 0 };
    }

    // Filter by customer tags if tag specified
    if (filters.tag) {
      const customers = await CustomerModel.find({ tags: filters.tag });
      const customerIds = customers.map(c => c.id);
      query.customerId = { $in: customerIds };
    }

    // Search query
    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      
      // Find matching customers first
      const customers = await CustomerModel.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
          { tags: searchRegex }
        ]
      });
      const customerIds = customers.map(c => c.id);

      // We search conversations matching ticketNumber, matching customer IDs, or matching message snippet
      query.$or = [
        { ticketNumber: searchRegex },
        { title: searchRegex },
        { lastMessageSnippet: searchRegex },
        { customerId: { $in: customerIds } }
      ];
    }

    const docs = await ConversationModel.find(query).sort({ updatedAt: -1 });
    const list = [];
    for (const d of docs) {
      try {
        list.push(await this.buildConversationObject(d));
      } catch (err) {
        // Skip orphaned conversations
      }
    }
    return list;
  }

  async delete(id: string): Promise<boolean> {
    const res = await ConversationModel.deleteOne({ _id: id });
    return res.deletedCount !== undefined && res.deletedCount > 0;
  }
}

// Mongoose Message Repository
export class MongooseMessageRepository implements IMessageRepository {
  async findById(id: string): Promise<Message | null> {
    const doc = await MessageModel.findById(id);
    return doc ? mapMessage(doc) : null;
  }

  async findByConversationId(conversationId: string, limit = 50, skip = 0): Promise<Message[]> {
    const docs = await MessageModel.find({ conversationId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit);
    return docs.map(mapMessage);
  }

  async findAll(): Promise<Message[]> {
    const docs = await MessageModel.find({}).sort({ createdAt: 1 });
    return docs.map(mapMessage);
  }

  async create(msg: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const doc = new MessageModel({
      conversationId: msg.conversationId,
      sender: msg.sender,
      content: msg.content,
      attachments: msg.attachments,
      isInternalNote: msg.isInternalNote,
      seen: msg.seen,
      delivered: msg.delivered,
      reactions: msg.reactions,
      tags: msg.tags || [],
      metadata: msg.metadata,
    });
    await doc.save();
    
    // Update last message snippet on conversation
    let snippet = msg.content;
    if (msg.attachments && msg.attachments.length > 0) {
      snippet = snippet ? `${snippet} (Attachment)` : 'Sent an attachment';
    }
    if (msg.isInternalNote) {
      snippet = `[Note] ${snippet}`;
    }
    // Conversation events (system) don't change the preview
    if (msg.sender.type !== 'system' && msg.metadata?.type !== 'auto_reply') {
      await ConversationModel.findByIdAndUpdate(msg.conversationId, {
        $set: { lastMessageSnippet: snippet }
      });
    }

    return mapMessage(doc);
  }

  async update(id: string, updateData: Partial<Message>): Promise<Message | null> {
    const doc = await MessageModel.findByIdAndUpdate(id, { $set: updateData }, { new: true });
    return doc ? mapMessage(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const res = await MessageModel.findByIdAndDelete(id);
    return res !== null;
  }

  async searchByTerms(terms: string[], limit = 5000): Promise<Message[]> {
    const needles = terms.filter(Boolean);
    if (needles.length === 0) return [];
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const or = needles.flatMap(t => {
      const re = new RegExp(esc(t), 'i');
      return [{ content: re }, { 'attachments.name': re }, { tags: re }];
    });
    const docs = await MessageModel.find({ 'sender.type': { $ne: 'system' }, $or: or }).limit(limit);
    return docs.map(mapMessage);
  }

  async deleteByConversationId(conversationId: string): Promise<number> {
    const res = await MessageModel.deleteMany({ conversationId });
    return res.deletedCount || 0;
  }

  async markConversationSeen(conversationId: string, role: 'customer' | 'agent'): Promise<void> {
    const now = new Date();
    if (role === 'agent') {
      // Agent is viewing, mark customer messages seen
      await MessageModel.updateMany(
        { conversationId, 'sender.type': 'customer', seen: false },
        { $set: { seen: true, seenAt: now } }
      );
      await ConversationModel.findByIdAndUpdate(conversationId, {
        $set: { unreadCountAgent: 0 }
      }, { timestamps: false });
    } else {
      // Customer is viewing, mark agent messages seen (that are not internal notes)
      await MessageModel.updateMany(
        { conversationId, 'sender.type': 'agent', isInternalNote: false, seen: false },
        { $set: { seen: true, seenAt: now } }
      );
      await ConversationModel.findByIdAndUpdate(conversationId, {
        $set: { unreadCountCustomer: 0 }
      }, { timestamps: false });
    }
  }

  async countMessages(conversationId: string): Promise<number> {
    return await MessageModel.countDocuments({ conversationId });
  }
}

// Mongoose Saved Reply Repository
export class MongooseSavedReplyRepository implements ISavedReplyRepository {
  async findAll(): Promise<SavedReply[]> {
    const docs = await SavedReplyModel.find();
    return docs.map(d => ({
      id: d._id.toString(),
      trigger: d.trigger,
      title: d.title,
      content: d.content,
      availableFor: d.availableFor,
      availableWhen: d.availableWhen,
      actions: (d as any).actions || undefined,
      creator: d.creator,
      createdAt: (d as any).createdAt?.toISOString()
    }));
  }

  async findByTrigger(trigger: string): Promise<SavedReply | null> {
    const doc = await SavedReplyModel.findOne({ trigger });
    return doc ? {
      id: doc._id.toString(),
      trigger: doc.trigger,
      title: doc.title,
      content: doc.content,
      availableFor: doc.availableFor,
      availableWhen: doc.availableWhen,
      actions: (doc as any).actions || undefined,
      creator: doc.creator,
      createdAt: (doc as any).createdAt?.toISOString()
    } : null;
  }

  async create(reply: Omit<SavedReply, 'id'>): Promise<SavedReply> {
    const doc = new SavedReplyModel(reply);
    await doc.save();
    return {
      id: doc._id.toString(),
      trigger: doc.trigger,
      title: doc.title,
      content: doc.content,
      availableFor: doc.availableFor,
      availableWhen: doc.availableWhen,
      actions: (doc as any).actions || undefined,
      creator: doc.creator,
      createdAt: (doc as any).createdAt?.toISOString()
    };
  }

  async update(id: string, reply: Partial<SavedReply>): Promise<SavedReply | null> {
    const doc = await SavedReplyModel.findByIdAndUpdate(id, { $set: reply }, { new: true });
    return doc ? {
      id: doc._id.toString(),
      trigger: doc.trigger,
      title: doc.title,
      content: doc.content,
      availableFor: doc.availableFor,
      availableWhen: doc.availableWhen,
      actions: (doc as any).actions || undefined,
      creator: doc.creator,
      createdAt: (doc as any).createdAt?.toISOString()
    } : null;
  }

  async delete(id: string): Promise<boolean> {
    const res = await SavedReplyModel.findByIdAndDelete(id);
    return res !== null;
  }
}

// Mongoose Tag Repository
export class MongooseTagRepository implements ITagRepository {
  async findAll(): Promise<Tag[]> {
    const docs = await TagModel.find();
    return docs.map(d => ({ id: d._id.toString(), name: d.name, color: d.color }));
  }

  async findByName(name: string): Promise<Tag | null> {
    const doc = await TagModel.findOne({ name });
    return doc ? { id: doc._id.toString(), name: doc.name, color: doc.color } : null;
  }

  async create(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const doc = new TagModel(tag);
    await doc.save();
    return { id: doc._id.toString(), name: doc.name, color: doc.color };
  }

  async delete(id: string): Promise<boolean> {
    const res = await TagModel.findByIdAndDelete(id);
    return res !== null;
  }
}

// Mongoose Settings Repository
export class MongooseSettingsRepository implements ISettingsRepository {
  async findByAgentId(agentId: string): Promise<AgentSettings | null> {
    const doc = await SettingsModel.findOne({ agentId });
    if (!doc) return null;
    return {
      agentId: doc.agentId,
      theme: doc.theme,
      notifications: doc.notifications,
      timezone: doc.timezone,
      language: doc.language,
      autoAssign: doc.autoAssign,
      businessHours: doc.businessHours,
    };
  }

  async save(settings: AgentSettings): Promise<AgentSettings> {
    const doc = await SettingsModel.findOneAndUpdate(
      { agentId: settings.agentId },
      { $set: settings },
      { upsert: true, new: true }
    );
    return {
      agentId: doc.agentId,
      theme: doc.theme,
      notifications: doc.notifications,
      timezone: doc.timezone,
      language: doc.language,
      autoAssign: doc.autoAssign,
      businessHours: doc.businessHours,
    };
  }
}

/** MongoDB version of bulkImportJson: same plan, original timestamps kept. Returns new conversation ids. */
export async function bulkImportMongo(plan: {
  customers: any[]; conversations: any[]; messages: any[]; conversationPatches: Record<string, Record<string, any>>;
}, workspaceId: string): Promise<{ ids: Record<string, string>; numbers: Record<string, string> }> {
  const ids: Record<string, string> = {};
  const numbers: Record<string, string> = {};
  for (const c of plan.customers) {
    const { id, ...rest } = c;
    await CustomerModel.updateOne({ id }, { $set: { ...rest, id, workspaceId } }, { upsert: true });
  }
  const existing = (await ConversationModel.find({}, { ticketNumber: 1 }).lean()).map((d: any) => d.ticketNumber);
  for (const c of plan.conversations) {
    const ticketNumber = nextTicketNumber(existing);
    existing.push(ticketNumber);
    const { id: tempId, ...rest } = c;
    const res = await ConversationModel.collection.insertOne({ ...rest, workspaceId, ticketNumber,
      createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } as any);
    ids[tempId] = res.insertedId.toString();
    numbers[tempId] = ticketNumber;
  }
  for (const [id, patch] of Object.entries(plan.conversationPatches)) {
    const p: any = { ...patch };
    if (p.updatedAt) p.updatedAt = new Date(p.updatedAt);
    await ConversationModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) } as any, { $set: p });
  }
  if (plan.messages.length) {
    await MessageModel.collection.insertMany(plan.messages.map(m => {
      const { id, ...rest } = m;
      return { ...rest, workspaceId, conversationId: ids[m.conversationId] || m.conversationId, createdAt: new Date(m.createdAt) };
    }) as any[]);
  }
  return { ids, numbers };
}
