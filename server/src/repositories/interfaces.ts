import { Agent, Customer, Conversation, Message, SavedReply, Tag, AgentSettings, Workspace } from '../../../shared/src/types';

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findByApiKey(apiKey: string): Promise<Workspace | null>;
  create(workspace: Omit<Workspace, 'id' | 'createdAt'>): Promise<Workspace>;
}

export interface IUserRepository {
  findById(id: string): Promise<Agent | null>;
  findByEmail(email: string): Promise<Agent | null>;
  verifyPassword(email: string, passwordPlain: string): Promise<{ agent: Agent; token: string } | null>;
  create(agentData: Omit<Agent, 'id'> & { passwordPlain: string }): Promise<Agent>;
  update(id: string, updateData: Partial<Agent>): Promise<Agent | null>;
  findAll(): Promise<Agent[]>;
}

export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findOrCreate(id: string, defaultData: Omit<Customer, 'id'>): Promise<Customer>;
  create(customer: Customer): Promise<Customer>;
  update(id: string, updateData: Partial<Customer>): Promise<Customer | null>;
  findAll(): Promise<Customer[]>;
}

export interface IConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findByTicketNumber(ticketNumber: string): Promise<Conversation | null>;
  create(conversation: Omit<Conversation, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>): Promise<Conversation>;
  update(id: string, updateData: Partial<Conversation>): Promise<Conversation | null>;
  findAll(): Promise<Conversation[]>;
  findFiltered(filters: {
    status?: string[];
    priority?: string[];
    assignedAgentId?: string | null;
    category?: string[];
    search?: string;
    unread?: boolean;
    tag?: string;
  }): Promise<Conversation[]>;
  delete(id: string): Promise<boolean>;
}

export interface IMessageRepository {
  findById(id: string): Promise<Message | null>;
  findByConversationId(conversationId: string, limit?: number, skip?: number): Promise<Message[]>;
  create(message: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  update(id: string, updateData: Partial<Message>): Promise<Message | null>;
  delete(id: string): Promise<boolean>;
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
