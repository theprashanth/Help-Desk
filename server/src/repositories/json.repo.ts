import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  Agent, Customer, Conversation, Message, SavedReply, Tag, AgentSettings 
} from '../../../shared/src/types';
import { 
  IUserRepository, ICustomerRepository, IConversationRepository, 
  IMessageRepository, ISavedReplyRepository, ITagRepository, ISettingsRepository 
} from './interfaces';

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
    const user = users.find(u => u.id === id);
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return rest as Agent;
  }

  async findByEmail(email: string): Promise<Agent | null> {
    const users = await readJson<any[]>(this.file, []);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
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
      { id: agent.id, email: agent.email, role: agent.role },
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
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    
    users[idx] = { ...users[idx], ...updateData };
    await writeJson(this.file, users);
    
    const { passwordHash, ...rest } = users[idx];
    return rest as Agent;
  }

  async findAll(): Promise<Agent[]> {
    const users = await readJson<any[]>(this.file, []);
    return users.map(u => {
      const { passwordHash, ...rest } = u;
      return rest as Agent;
    });
  }
}

// JSON Customer Repository
export class JsonCustomerRepository implements ICustomerRepository {
  private file = 'customers.json';

  async findById(id: string): Promise<Customer | null> {
    const customers = await readJson<Customer[]>(this.file, []);
    return customers.find(c => c.id === id) || null;
  }

  async findOrCreate(id: string, defaultData: Omit<Customer, 'id'>): Promise<Customer> {
    const customers = await readJson<Customer[]>(this.file, []);
    let customer = customers.find(c => c.id === id);
    if (!customer) {
      customer = {
        id,
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
    // Ensure uniqueness
    const filtered = customers.filter(c => c.id !== customer.id);
    const newCustomer = {
      ...customer,
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
    const idx = customers.findIndex(c => c.id === id);
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
    return await readJson<Customer[]>(this.file, []);
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
    
    const newConvRaw = {
      id,
      ticketNumber,
      customerId: conv.customer.id,
      assignedAgentId: conv.assignedAgentId,
      status: conv.status,
      priority: conv.priority,
      category: conv.category,
      lastMessageSnippet: conv.lastMessageSnippet || '',
      unreadCountAgent: conv.unreadCountAgent || 0,
      unreadCountCustomer: conv.unreadCountCustomer || 0,
      createdAt: now,
      updatedAt: now
    };
    rawConversations.push(newConvRaw);
    await writeJson(this.file, rawConversations);
    
    return {
      ...conv,
      id,
      ticketNumber,
      createdAt: now,
      updatedAt: now
    } as Conversation;
  }

  async update(id: string, updateData: Partial<Conversation>): Promise<Conversation | null> {
    const rawConversations = await readJson<any[]>(this.file, []);
    const idx = rawConversations.findIndex(c => c.id === id);
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
    const customers = await readJson<Customer[]>('customers.json', []);
    
    const list: Conversation[] = [];
    for (const raw of rawConvs) {
      const customer = customers.find(c => c.id === raw.customerId) || {
        id: raw.customerId,
        name: 'Unknown User',
        session: {},
        tags: [],
        notes: []
      };
      
      list.push({
        id: raw.id,
        ticketNumber: raw.ticketNumber,
        customer: customer as Customer,
        assignedAgentId: raw.assignedAgentId,
        status: raw.status,
        priority: raw.priority,
        category: raw.category,
        lastMessageSnippet: raw.lastMessageSnippet,
        unreadCountAgent: raw.unreadCountAgent,
        unreadCountCustomer: raw.unreadCountCustomer,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt
      });
    }
    
    // Sort descending by updatedAt
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async findFiltered(filters: {
    status?: string[];
    priority?: string[];
    assignedAgentId?: string | null;
    category?: string[];
    search?: string;
    unread?: boolean;
    tag?: string;
  }): Promise<Conversation[]> {
    let list = await this.findAll();

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
    return messages.find(m => m.id === id) || null;
  }

  async findByConversationId(conversationId: string, limit = 50, skip = 0): Promise<Message[]> {
    const messages = await readJson<Message[]>(this.file, []);
    const filtered = messages.filter(m => m.conversationId === conversationId);
    // Sort ascending by creation time
    const sorted = filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return sorted.slice(skip, skip + limit);
  }

  async create(msg: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const messages = await readJson<Message[]>(this.file, []);
    const newMsg: Message = {
      ...msg,
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
    const idx = conversations.findIndex(c => c.id === msg.conversationId);
    if (idx !== -1) {
      conversations[idx].lastMessageSnippet = snippet;
      conversations[idx].updatedAt = new Date().toISOString();
      await writeJson('conversations.json', conversations);
    }

    return newMsg;
  }

  async update(id: string, updateData: Partial<Message>): Promise<Message | null> {
    const messages = await readJson<Message[]>(this.file, []);
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return null;

    messages[idx] = { ...messages[idx], ...updateData };
    await writeJson(this.file, messages);
    return messages[idx];
  }

  async delete(id: string): Promise<boolean> {
    const messages = await readJson<Message[]>(this.file, []);
    const filtered = messages.filter(m => m.id !== id);
    if (messages.length === filtered.length) return false;
    await writeJson(this.file, filtered);
    return true;
  }

  async markConversationSeen(conversationId: string, role: 'customer' | 'agent'): Promise<void> {
    const messages = await readJson<Message[]>(this.file, []);
    const now = new Date().toISOString();
    
    let updated = false;
    for (const m of messages) {
      if (m.conversationId === conversationId) {
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
    const idx = conversations.findIndex(c => c.id === conversationId);
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
    return messages.filter(m => m.conversationId === conversationId).length;
  }
}

// JSON Saved Reply Repository
export class JsonSavedReplyRepository implements ISavedReplyRepository {
  private file = 'saved_replies.json';

  async findAll(): Promise<SavedReply[]> {
    return await readJson<SavedReply[]>(this.file, []);
  }

  async findByTrigger(trigger: string): Promise<SavedReply | null> {
    const list = await this.findAll();
    return list.find(r => r.trigger.toLowerCase() === trigger.toLowerCase()) || null;
  }

  async create(reply: Omit<SavedReply, 'id'>): Promise<SavedReply> {
    const replies = await this.findAll();
    const newReply: SavedReply = {
      id: `reply_${Date.now()}`,
      trigger: reply.trigger,
      title: reply.title,
      content: reply.content
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
    return await readJson<Tag[]>(this.file, []);
  }

  async findByName(name: string): Promise<Tag | null> {
    const list = await this.findAll();
    return list.find(t => t.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async create(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const tags = await this.findAll();
    const newTag: Tag = {
      id: `tag_${Date.now()}`,
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
    return list.find(s => s.agentId === agentId) || null;
  }

  async save(settings: AgentSettings): Promise<AgentSettings> {
    const list = await readJson<AgentSettings[]>(this.file, []);
    const idx = list.findIndex(s => s.agentId === settings.agentId);
    if (idx === -1) {
      list.push(settings);
    } else {
      list[idx] = settings;
    }
    await writeJson(this.file, list);
    return settings;
  }
}
