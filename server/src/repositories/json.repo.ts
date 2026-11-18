import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  Agent, Customer, Conversation, Message, SavedReply, Tag, AgentSettings, Workspace 
} from '../../../shared/src/types';
import { 
  IUserRepository, ICustomerRepository, IConversationRepository, 
  IMessageRepository, ISavedReplyRepository, ITagRepository, ISettingsRepository, IWorkspaceRepository 
} from './interfaces';

import { getActiveWorkspaceId } from '../context/tenant.context';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    // Ignore if exists
  }
}

const fileLocks: Record<string, Promise<any>> = {};

async function lockFile<T>(filename: string, operation: () => Promise<T>): Promise<T> {
  const currentLock = fileLocks[filename] || Promise.resolve();
  
  const nextLock = currentLock.then(async () => {
    return await operation();
  });
  
  fileLocks[filename] = nextLock.catch(() => {}); // prevent lock breaking on errors
  return nextLock;
}

async function readJson<T>(filename: string, defaultValue: T): Promise<T> {
  return lockFile(filename, async () => {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      if (!data.trim()) {
        throw new Error('Empty file content');
      }
      return JSON.parse(data) as T;
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.message === 'Empty file content' || err instanceof SyntaxError) {
        const filePathWrite = path.join(DATA_DIR, filename);
        await fs.writeFile(filePathWrite, JSON.stringify(defaultValue, null, 2), 'utf-8');
        return defaultValue;
      }
      console.error(`[Database Error] Failed to read ${filename}:`, err);
      return defaultValue;
    }
  });
}

async function writeJson<T>(filename: string, data: T): Promise<void> {
  return lockFile(filename, async () => {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  });
}

// JSON User Repository
export class JsonUserRepository implements IUserRepository {
  private file = 'users.json';

  async findById(id: string): Promise<Agent | null> {
    const users = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const user = users.find(u => u.id === id && u.workspaceId === workspaceId);
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return rest as Agent;
  }

  async findByEmail(email: string): Promise<Agent | null> {
    const users = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.workspaceId === workspaceId);
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return rest as Agent;
  }

  async verifyPassword(email: string, passwordPlain: string): Promise<{ agent: Agent; token: string } | null> {
    const users = await readJson<any[]>(this.file, []);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return null;
    const isMatch = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isMatch) return null;

    const { passwordHash, ...rest } = user;
    const agent = rest as Agent;
    
    const token = jwt.sign(
      { id: agent.id, email: agent.email, role: agent.role, workspaceId: agent.workspaceId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return { agent, token };
  }

  async create(agentData: Omit<Agent, 'id'> & { passwordPlain: string }): Promise<Agent> {
    const users = await readJson<any[]>(this.file, []);
    const passwordHash = await bcrypt.hash(agentData.passwordPlain, 10);
    const newAgent = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      workspaceId: getActiveWorkspaceId(),
      createdAt: new Date().toISOString(),
      email: agentData.email,
      name: agentData.name,
      avatar: agentData.avatar,
      role: agentData.role,
      status: agentData.status,
      lastSeen: agentData.lastSeen || new Date().toISOString(),
      passwordHash
    };
    users.push(newAgent);
    await writeJson(this.file, users);
    
    const { passwordHash: _, ...rest } = newAgent;
    return rest as Agent;
  }

  async update(id: string, updateData: Partial<Agent>): Promise<Agent | null> {
    const users = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const idx = users.findIndex(u => u.id === id && u.workspaceId === workspaceId);
    if (idx === -1) return null;
    
    users[idx] = { ...users[idx], ...updateData };
    await writeJson(this.file, users);
    
    const { passwordHash, ...rest } = users[idx];
    return rest as Agent;
  }

  async findAll(): Promise<Agent[]> {
    const users = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return users
      .filter(u => u.workspaceId === workspaceId)
      .map(u => {
        const { passwordHash, ...rest } = u;
        return rest as Agent;
      });
  }

  async delete(id: string): Promise<boolean> {
    const users = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const kept = users.filter(u => !(u.id === id && u.workspaceId === workspaceId));
    if (kept.length === users.length) return false;
    await writeJson(this.file, kept);
    return true;
  }
}

// JSON Customer Repository
export class JsonCustomerRepository implements ICustomerRepository {
  private file = 'customers.json';

  async findById(id: string): Promise<Customer | null> {
    const customers = await readJson<Customer[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return customers.find(c => c.id === id && c.workspaceId === workspaceId) || null;
  }

  async findOrCreate(id: string, defaultData: Omit<Customer, 'id'>): Promise<Customer> {
    const customers = await readJson<Customer[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    let customer = customers.find(c => c.id === id && c.workspaceId === workspaceId);
    if (!customer) {
      customer = {
        id,
        workspaceId,
        name: defaultData.name,
        email: defaultData.email,
        phone: defaultData.phone,
        session: {
          ...defaultData.session,
          firstSeen: defaultData.session.firstSeen || new Date().toISOString(),
          lastSeen: defaultData.session.lastSeen || new Date().toISOString(),
        },
        tags: defaultData.tags || [],
        notes: defaultData.notes || []
      };
      customers.push(customer);
      await writeJson(this.file, customers);
    }
    return customer;
  }

  async create(customer: Customer): Promise<Customer> {
    const customers = await readJson<Customer[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const filtered = customers.filter(c => !(c.id === customer.id && c.workspaceId === workspaceId));
    const newCustomer = {
      ...customer,
      workspaceId,
      session: {
        ...customer.session,
        firstSeen: customer.session.firstSeen || new Date().toISOString(),
        lastSeen: customer.session.lastSeen || new Date().toISOString(),
      }
    };
    filtered.push(newCustomer);
    await writeJson(this.file, filtered);
    return newCustomer;
  }

  async update(id: string, updateData: Partial<Customer>): Promise<Customer | null> {
    const customers = await readJson<Customer[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const idx = customers.findIndex(c => c.id === id && c.workspaceId === workspaceId);
    if (idx === -1) return null;

    const current = customers[idx];
    const session = updateData.session ? { ...current.session, ...updateData.session } : current.session;
    
    customers[idx] = {
      ...current,
      ...updateData,
      session
    };
    
    await writeJson(this.file, customers);
    return customers[idx];
  }

  async findAll(): Promise<Customer[]> {
    const customers = await readJson<Customer[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return customers.filter(c => c.workspaceId === workspaceId);
  }
}

// JSON Conversation Repository
export class JsonConversationRepository implements IConversationRepository {
  private file = 'conversations.json';

  async findById(id: string): Promise<Conversation | null> {
    const list = await this.findAll();
    return list.find(c => c.id === id) || null;
  }

  async findByTicketNumber(ticketNumber: string): Promise<Conversation | null> {
    const list = await this.findAll();
    return list.find(c => c.ticketNumber === ticketNumber) || null;
  }

  async create(conv: Omit<Conversation, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    const rawConversations = await readJson<any[]>(this.file, []);
    const ticketNumber = `TICKET-${1000 + rawConversations.length + 1}`;
    const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();
    const workspaceId = getActiveWorkspaceId();
    
    const newConvRaw = {
      id,
      workspaceId,
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
      createdAt: now,
      updatedAt: now
    };
    rawConversations.push(newConvRaw);
    await writeJson(this.file, rawConversations);
    
    return {
      ...conv,
      id,
      workspaceId,
      ticketNumber,
      createdAt: now,
      updatedAt: now
    } as Conversation;
  }

  async update(id: string, updateData: Partial<Conversation>): Promise<Conversation | null> {
    const rawConversations = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const idx = rawConversations.findIndex(c => c.id === id && c.workspaceId === workspaceId);
    if (idx === -1) return null;

    const current = rawConversations[idx];
    const cleanUpdates: any = { ...updateData };
    if (updateData.customer) {
      cleanUpdates.customerId = updateData.customer.id;
      delete cleanUpdates.customer;
    }
    
    rawConversations[idx] = {
      ...current,
      ...cleanUpdates,
      updatedAt: new Date().toISOString()
    };
    
    await writeJson(this.file, rawConversations);
    return await this.findById(id);
  }

  async findAll(): Promise<Conversation[]> {
    const rawConvs = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const filteredRaw = rawConvs.filter(c => c.workspaceId === workspaceId);
    const customers = await readJson<Customer[]>('customers.json', []);
    
    const list: Conversation[] = [];
    for (const raw of filteredRaw) {
      const customer = customers.find(c => c.id === raw.customerId && c.workspaceId === workspaceId) || {
        id: raw.customerId,
        workspaceId,
        name: 'Unknown User',
        session: {},
        tags: [],
        notes: []
      };
      
      list.push({
        id: raw.id,
        workspaceId,
        ticketNumber: raw.ticketNumber,
        customer: customer as Customer,
        assignedAgentId: raw.assignedAgentId,
        status: raw.status,
        priority: raw.priority,
        category: raw.category,
        lastMessageSnippet: raw.lastMessageSnippet,
        unreadCountAgent: raw.unreadCountAgent,
        unreadCountCustomer: raw.unreadCountCustomer,
        starred: raw.starred || false,
        snoozedUntil: raw.snoozedUntil || null,
        customerSnippet: raw.customerSnippet,
        tags: raw.tags || [],
        kind: raw.kind || 'conversation',
        title: raw.title,
        description: raw.description,
        createdByAgentId: raw.createdByAgentId,
        attributes: raw.attributes || {},
        sharing: raw.sharing || 'shared',
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt
      });
    }
    
    // Sort descending by updatedAt
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async delete(id: string): Promise<boolean> {
    const rawConversations = await readJson<any[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const filtered = rawConversations.filter(c => !(c.id === id && c.workspaceId === workspaceId));
    if (rawConversations.length === filtered.length) return false;
    await writeJson(this.file, filtered);
    return true;
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
  }): Promise<Conversation[]> {
    let list = await this.findAll();

    if (filters.kind && filters.kind.length > 0) {
      list = list.filter(c => filters.kind!.includes(c.kind || 'conversation'));
    }
    if (filters.createdByAgentId) {
      list = list.filter(c => c.createdByAgentId === filters.createdByAgentId);
    }

    if (filters.status && filters.status.length > 0) {
      list = list.filter(c => filters.status!.includes(c.status));
    }
    if (filters.priority && filters.priority.length > 0) {
      list = list.filter(c => filters.priority!.includes(c.priority));
    }
    if (filters.category && filters.category.length > 0) {
      list = list.filter(c => filters.category!.includes(c.category));
    }
    if (filters.assignedAgentId !== undefined) {
      if (filters.assignedAgentId === null || filters.assignedAgentId === 'unassigned') {
        list = list.filter(c => !c.assignedAgentId);
      } else {
        list = list.filter(c => c.assignedAgentId === filters.assignedAgentId);
      }
    }
    if (filters.unread) {
      list = list.filter(c => c.unreadCountAgent > 0);
    }
    if (filters.tag) {
      list = list.filter(c => c.customer?.tags?.includes(filters.tag!));
    }
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(c => 
        c.ticketNumber.toLowerCase().includes(s) ||
        (c.title && c.title.toLowerCase().includes(s)) ||
        (c.lastMessageSnippet && c.lastMessageSnippet.toLowerCase().includes(s)) ||
        c.customer.name.toLowerCase().includes(s) ||
        (c.customer.email && c.customer.email.toLowerCase().includes(s)) ||
        (c.customer.phone && c.customer.phone.toLowerCase().includes(s))
      );
    }

    return list;
  }
}

// JSON Message Repository
export class JsonMessageRepository implements IMessageRepository {
  private file = 'messages.json';

  async findById(id: string): Promise<Message | null> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return messages.find(m => m.id === id && m.workspaceId === workspaceId) || null;
  }

  async findByConversationId(conversationId: string, limit = 50, skip = 0): Promise<Message[]> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const filtered = messages.filter(m => m.conversationId === conversationId && m.workspaceId === workspaceId);
    // Sort ascending by creation time
    const sorted = filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return sorted.slice(skip, skip + limit);
  }

  async create(msg: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const newMsg: Message = {
      ...msg,
      workspaceId,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString()
    };
    messages.push(newMsg);
    await writeJson(this.file, messages);

    // Update conversation snippet
    let snippet = msg.content;
    if (msg.attachments && msg.attachments.length > 0) {
      snippet = snippet ? `${snippet} (Attachment)` : 'Sent an attachment';
    }
    if (msg.isInternalNote) {
      snippet = `[Note] ${snippet}`;
    }

    const conversations = await readJson<any[]>('conversations.json', []);
    const idx = conversations.findIndex(c => c.id === msg.conversationId && c.workspaceId === workspaceId);
    // Conversation events (system) don't change the preview or last-activity time
    if (idx !== -1 && msg.sender.type !== 'system' && msg.metadata?.type !== 'auto_reply') {
      conversations[idx].lastMessageSnippet = snippet;
      conversations[idx].updatedAt = new Date().toISOString();
      await writeJson('conversations.json', conversations);
    }

    return newMsg;
  }

  async update(id: string, updateData: Partial<Message>): Promise<Message | null> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const idx = messages.findIndex(m => m.id === id && m.workspaceId === workspaceId);
    if (idx === -1) return null;

    messages[idx] = { ...messages[idx], ...updateData };
    await writeJson(this.file, messages);
    return messages[idx];
  }

  async delete(id: string): Promise<boolean> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const filtered = messages.filter(m => !(m.id === id && m.workspaceId === workspaceId));
    if (messages.length === filtered.length) return false;
    await writeJson(this.file, filtered);
    return true;
  }

  async markConversationSeen(conversationId: string, role: 'customer' | 'agent'): Promise<void> {
    const messages = await readJson<Message[]>(this.file, []);
    const now = new Date().toISOString();
    const workspaceId = getActiveWorkspaceId();
    
    let updated = false;
    for (const m of messages) {
      if (m.conversationId === conversationId && m.workspaceId === workspaceId) {
        if (role === 'agent' && m.sender.type === 'customer' && !m.seen) {
          m.seen = true;
          m.seenAt = now;
          updated = true;
        } else if (role === 'customer' && m.sender.type === 'agent' && !m.isInternalNote && !m.seen) {
          m.seen = true;
          m.seenAt = now;
          updated = true;
        }
      }
    }

    if (updated) {
      await writeJson(this.file, messages);
    }

    // Reset unread count
    const conversations = await readJson<any[]>('conversations.json', []);
    const idx = conversations.findIndex(c => c.id === conversationId && c.workspaceId === workspaceId);
    if (idx !== -1) {
      if (role === 'agent') {
        conversations[idx].unreadCountAgent = 0;
      } else {
        conversations[idx].unreadCountCustomer = 0;
      }
      await writeJson('conversations.json', conversations);
    }
  }

  async countMessages(conversationId: string): Promise<number> {
    const messages = await readJson<Message[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return messages.filter(m => m.conversationId === conversationId && m.workspaceId === workspaceId).length;
  }
}

// JSON Saved Reply Repository
export class JsonSavedReplyRepository implements ISavedReplyRepository {
  private file = 'saved_replies.json';

  async findAll(): Promise<SavedReply[]> {
    const list = await readJson<SavedReply[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return list.filter(r => r.workspaceId === workspaceId);
  }

  async findByTrigger(trigger: string): Promise<SavedReply | null> {
    const list = await this.findAll();
    return list.find(r => r.trigger.toLowerCase() === trigger.toLowerCase()) || null;
  }

  async create(reply: Omit<SavedReply, 'id'>): Promise<SavedReply> {
    const replies = await readJson<SavedReply[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const newReply: SavedReply = {
      id: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      workspaceId,
      trigger: reply.trigger,
      title: reply.title,
      content: reply.content,
      availableFor: reply.availableFor || 'everyone',
      availableWhen: reply.availableWhen || ['starting_conversations', 'replying', 'adding_notes']
    };
    replies.push(newReply);
    await writeJson(this.file, replies);
    return newReply;
  }

  async update(id: string, reply: Partial<SavedReply>): Promise<SavedReply | null> {
    const replies = await this.findAll();
    const idx = replies.findIndex(r => r.id === id);
    if (idx === -1) return null;

    replies[idx] = { ...replies[idx], ...reply };
    await writeJson(this.file, replies);
    return replies[idx];
  }

  async delete(id: string): Promise<boolean> {
    const replies = await this.findAll();
    const filtered = replies.filter(r => r.id !== id);
    if (replies.length === filtered.length) return false;
    await writeJson(this.file, filtered);
    return true;
  }
}

// JSON Tag Repository
export class JsonTagRepository implements ITagRepository {
  private file = 'tags.json';

  async findAll(): Promise<Tag[]> {
    const list = await readJson<Tag[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return list.filter(t => t.workspaceId === workspaceId);
  }

  async findByName(name: string): Promise<Tag | null> {
    const list = await this.findAll();
    return list.find(t => t.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async create(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const tags = await readJson<Tag[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const newTag: Tag = {
      id: `tag_${Date.now()}`,
      workspaceId,
      name: tag.name,
      color: tag.color
    };
    tags.push(newTag);
    await writeJson(this.file, tags);
    return newTag;
  }

  async delete(id: string): Promise<boolean> {
    const tags = await this.findAll();
    const filtered = tags.filter(t => t.id !== id);
    if (tags.length === filtered.length) return false;
    await writeJson(this.file, filtered);
    return true;
  }
}

// JSON Settings Repository
export class JsonSettingsRepository implements ISettingsRepository {
  private file = 'settings.json';

  async findByAgentId(agentId: string): Promise<AgentSettings | null> {
    const list = await readJson<AgentSettings[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    return list.find(s => s.agentId === agentId && s.workspaceId === workspaceId) || null;
  }

  async save(settings: AgentSettings): Promise<AgentSettings> {
    const list = await readJson<AgentSettings[]>(this.file, []);
    const workspaceId = getActiveWorkspaceId();
    const idx = list.findIndex(s => s.agentId === settings.agentId && s.workspaceId === workspaceId);
    const scopedSettings = { ...settings, workspaceId };
    if (idx === -1) {
      list.push(scopedSettings);
    } else {
      list[idx] = scopedSettings;
    }
    await writeJson(this.file, list);
    return scopedSettings;
  }
}

// JSON Workspace Repository
export class JsonWorkspaceRepository implements IWorkspaceRepository {
  private file = 'workspaces.json';

  async findById(id: string): Promise<Workspace | null> {
    const list = await readJson<Workspace[]>(this.file, []);
    return list.find(w => w.id === id) || null;
  }

  async findByApiKey(apiKey: string): Promise<Workspace | null> {
    const list = await readJson<Workspace[]>(this.file, []);
    return list.find(w => w.apiKey === apiKey) || null;
  }

  async create(workspace: Omit<Workspace, 'id' | 'createdAt'>): Promise<Workspace> {
    const list = await readJson<Workspace[]>(this.file, []);
    const id = `work_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();
    const newWorkspace: Workspace = {
      ...workspace,
      id,
      createdAt: now
    };
    list.push(newWorkspace);
    await writeJson(this.file, list);
    return newWorkspace;
  }

  async update(id: string, updateData: Partial<Workspace>): Promise<Workspace | null> {
    const list = await readJson<Workspace[]>(this.file, []);
    const idx = list.findIndex(w => w.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updateData, id: list[idx].id };
    await writeJson(this.file, list);
    return list[idx];
  }
}
