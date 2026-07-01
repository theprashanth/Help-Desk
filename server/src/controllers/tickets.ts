import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Conversation, Customer, Tag, SavedReply } from '../../../shared/src/types';

export async function getTickets(req: AuthenticatedRequest, res: Response) {
  try {
    const status = req.query.status ? (req.query.status as string).split(',') : undefined;
    const priority = req.query.priority ? (req.query.priority as string).split(',') : undefined;
    const category = req.query.category ? (req.query.category as string).split(',') : undefined;
    const assignedAgentId = req.query.assignedAgentId !== undefined ? (req.query.assignedAgentId as string) : undefined;
    const search = req.query.search as string;
    const unread = req.query.unread === 'true';
    const tag = req.query.tag as string;

    const convRepo = RepositoryFactory.getConversationRepository();
    const list = await convRepo.findFiltered({
      status,
      priority,
      assignedAgentId,
      category,
      search,
      unread,
      tag
    });
    
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const conv = await convRepo.findById(id);
    if (!conv) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    return res.json(conv);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTicket(req: AuthenticatedRequest, res: Response) {
  const { customerId, name, email, phone, priority, category, initialMessage, session } = req.body;
  
  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();

    const customer = await custRepo.findOrCreate(customerId, {
      name: name || `Guest #${customerId.slice(-4)}`,
      email: email || '',
      phone: phone || '',
      session: session || { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), totalConversations: 1 },
      tags: [],
      notes: []
    });

    // Update customer session total conversations count
    const totalConvs = (customer.session.totalConversations || 0) + 1;
    await custRepo.update(customerId, {
      session: {
        ...customer.session,
        totalConversations: totalConvs,
        lastSeen: new Date().toISOString()
      }
    });

    const newConv = await convRepo.create({
      customer,
      status: 'open',
      priority: priority || 'medium',
      category: category || 'general',
      unreadCountAgent: 1, // Start with 1 unread message for agents
      unreadCountCustomer: 0
    });

    // Save initial message if provided
    if (initialMessage) {
      await msgRepo.create({
        conversationId: newConv.id,
        sender: {
          type: 'customer',
          id: customer.id,
          name: customer.name
        },
        content: initialMessage,
        isInternalNote: false,
        seen: false,
        delivered: true
      });
      // Retrieve updated conversation with correct last message snippet
      const updatedConv = await convRepo.findById(newConv.id);
      if (updatedConv) {
        SocketService.broadcastConversationNew(updatedConv);
        return res.status(210).json(updatedConv);
      }
    }

    SocketService.broadcastConversationNew(newConv);
    return res.status(201).json(newConv);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const updated = await convRepo.update(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    SocketService.broadcastConversationUpdate(updated);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function assignTicket(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { agentId } = req.body;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const userRepo = RepositoryFactory.getUserRepository();
    
    let agentName = undefined;
    if (agentId) {
      const agent = await userRepo.findById(agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Support Agent not found' });
      }
      agentName = agent.name;
    }

    const updated = await convRepo.update(id, { 
      assignedAgentId: agentId || undefined,
      status: 'open' // re-open if closed or change state
    });

    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    SocketService.broadcastConversationUpdate(updated);
    SocketService.emitGlobal('conversation:assigned', { conversationId: id, agentId, agentName });
    
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateCustomerProfile(req: AuthenticatedRequest, res: Response) {
  const { customerId } = req.params;
  try {
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    
    const updatedCustomer = await custRepo.update(customerId, req.body);
    if (!updatedCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Refresh all tickets associated with this customer
    const allConvs = await convRepo.findAll();
    const customerConvs = allConvs.filter(c => c.customer.id === customerId);
    
    for (const c of customerConvs) {
      const updatedConv = { ...c, customer: updatedCustomer };
      SocketService.broadcastConversationUpdate(updatedConv);
    }

    return res.json(updatedCustomer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Saved Replies CRUD
export async function getSavedReplies(req: AuthenticatedRequest, res: Response) {
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const replies = await replyRepo.findAll();
    return res.json(replies);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createSavedReply(req: AuthenticatedRequest, res: Response) {
  const { trigger, title, content } = req.body;
  if (!trigger || !title || !content) {
    return res.status(400).json({ error: 'trigger, title, and content are required' });
  }
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const created = await replyRepo.create({ trigger, title, content });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSavedReply(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const updated = await replyRepo.update(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Saved reply not found' });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteSavedReply(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const deleted = await replyRepo.delete(id);
    if (!deleted) return res.status(404).json({ error: 'Saved reply not found' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Tags CRUD
export async function getTags(req: AuthenticatedRequest, res: Response) {
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const tags = await tagRepo.findAll();
    return res.json(tags);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTag(req: AuthenticatedRequest, res: Response) {
  const { name, color } = req.body;
  if (!name || !color) {
    return res.status(400).json({ error: 'name and color are required' });
  }
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const existing = await tagRepo.findByName(name);
    if (existing) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    const created = await tagRepo.create({ name, color });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteTag(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  try {
    const tagRepo = RepositoryFactory.getTagRepository();
    const deleted = await tagRepo.delete(id);
    if (!deleted) return res.status(404).json({ error: 'Tag not found' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
