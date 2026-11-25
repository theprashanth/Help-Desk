import { Agent, Customer, Conversation, Message, SavedReply, Tag, AgentSettings, Workspace } from '../../../shared/src/types';

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findByApiKey(apiKey: string): Promise<Workspace | null>;
  findByAppId(appId: string): Promise<Workspace | null>;
  findAll(): Promise<Workspace[]>;
  create(workspace: Omit<Workspace, 'id' | 'createdAt'>): Promise<Workspace>;
  update(id: string, updateData: Partial<Workspace>): Promise<Workspace | null>;
}

export interface IUserRepository {
  findById(id: string): Promise<Agent | null>;
  findByEmail(email: string): Promise<Agent | null>;
  verifyPassword(email: string, passwordPlain: string): Promise<{ agent: Agent; token: string } | null>;
  create(agentData: Omit<Agent, 'id'> & { passwordPlain: string }): Promise<Agent>;
  update(id: string, updateData: Partial<Agent>): Promise<Agent | null>;
  findAll(): Promise<Agent[]>;
  delete(id: string): Promise<boolean>;
}

export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByExternalId(externalId: string): Promise<Customer | null>;
  findOrCreate(id: string, defaultData: Omit<Customer, 'id'>): Promise<Customer>;
  create(customer: Customer): Promise<Customer>;
  update(id: string, updateData: Partial<Customer>): Promise<Customer | null>;
  findAll(): Promise<Customer[]>;
  delete(id: string): Promise<boolean>;
}

export interface IConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findByTicketNumber(ticketNumber: string): Promise<Conversation | null>;
  create(conversation: Omit<Conversation, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>): Promise<Conversation>;
  /** `touch: false` leaves updatedAt alone (bookkeeping that isn't conversation activity, e.g. SLA clocks). */
  update(id: string, updateData: Partial<Conversation>, opts?: { touch?: boolean }): Promise<Conversation | null>;
  findAll(): Promise<Conversation[]>;
  findFiltered(filters: {
    status?: string[];
    priority?: string[];
    assignedAgentId?: string | null;
    category?: string[];
    search?: string;
    unread?: boolean;
    tag?: string;
    kind?: string[];
    createdByAgentId?: string;
    bot?: 'handled' | 'active' | 'resolved';   // chat-flow bot chats not handed to a person: all, still in the menus, or resolved by the bot
  }): Promise<Conversation[]>;
  delete(id: string): Promise<boolean>;
}

export interface IMessageRepository {
  findById(id: string): Promise<Message | null>;
  findByConversationId(conversationId: string, limit?: number, skip?: number): Promise<Message[]>;
  /** Every message in the workspace, oldest first (exports). */
  findAll(): Promise<Message[]>;
  create(message: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  update(id: string, updateData: Partial<Message>): Promise<Message | null>;
  delete(id: string): Promise<boolean>;
  deleteByConversationId(conversationId: string): Promise<number>;
  /** Messages (not events) whose text, attachment names or tags contain ANY of the terms (case-insensitive). */
  searchByTerms(terms: string[], limit?: number): Promise<Message[]>;
  markConversationSeen(conversationId: string, role: 'customer' | 'agent'): Promise<void>;
  countMessages(conversationId: string): Promise<number>;
}

export interface ISavedReplyRepository {
  findAll(): Promise<SavedReply[]>;
  findByTrigger(trigger: string): Promise<SavedReply | null>;
  create(reply: Omit<SavedReply, 'id'>): Promise<SavedReply>;
  update(id: string, reply: Partial<SavedReply>): Promise<SavedReply | null>;
  delete(id: string): Promise<boolean>;
}

export interface ITagRepository {
  findAll(): Promise<Tag[]>;
  findByName(name: string): Promise<Tag | null>;
  create(tag: Omit<Tag, 'id'>): Promise<Tag>;
  delete(id: string): Promise<boolean>;
}

export interface ISettingsRepository {
  findByAgentId(agentId: string): Promise<AgentSettings | null>;
  save(settings: AgentSettings): Promise<AgentSettings>;
}
