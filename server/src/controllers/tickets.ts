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
        ...(session || {}),
        totalConversations: totalConvs,
        lastSeen: new Date().toISOString()
      }
    });

    // Auto-assign to online agent with the fewest open/waiting tickets
    let assignedAgentId = undefined;
    const onlineAgentIds = Array.from(SocketService.onlineAgents.keys());
    if (onlineAgentIds.length > 0) {
      // Get all open/waiting conversations to balance load
      const openConvs = await convRepo.findFiltered({ status: ['open', 'waiting'] });
      const openTicketCounts: Record<string, number> = {};
      onlineAgentIds.forEach(id => {
        openTicketCounts[id] = 0;
      });
      openConvs.forEach(c => {
        if (c.assignedAgentId && openTicketCounts[c.assignedAgentId] !== undefined) {
          openTicketCounts[c.assignedAgentId]++;
        }
      });
      
      // Find the agent with the minimum load
      let minCount = Infinity;
      let targetAgentId = onlineAgentIds[0];
      onlineAgentIds.forEach(id => {
        if (openTicketCounts[id] < minCount) {
          minCount = openTicketCounts[id];
          targetAgentId = id;
        }
      });
      assignedAgentId = targetAgentId;
      console.log(`[AutoAssign] Automatically assigned new ticket to online agent: ${targetAgentId} (current load: ${minCount} tickets)`);
    }

    const newConv = await convRepo.create({
      customer,
      status: 'open',
      priority: priority || 'medium',
      category: category || 'general',
      unreadCountAgent: 1, // Start with 1 unread message for agents
      unreadCountCustomer: 0,
      assignedAgentId
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
        delivered: true,
        metadata: {
          platform: 'web',
          sourceUrl: session?.currentPage || 'https://sudoprashanth.com/',
          browser: session?.browser || 'Chrome (149.0.0.0)',
          os: session?.os || 'OS X 10.15.7'
        }
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
  const { trigger, title, content, availableFor, availableWhen } = req.body;
  if (!trigger || !title || !content) {
    return res.status(400).json({ error: 'trigger, title, and content are required' });
  }
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agentDoc = req.user ? await userRepo.findById(req.user.id) : null;
    const creator = agentDoc ? {
      id: agentDoc.id,
      name: agentDoc.name,
      avatar: agentDoc.avatar
    } : undefined;

    const replyRepo = RepositoryFactory.getSavedReplyRepository();
    const created = await replyRepo.create({
      trigger,
      title,
      content,
      availableFor: availableFor || 'everyone',
      availableWhen: availableWhen || ['starting_conversations', 'replying', 'adding_notes'],
      creator
    });
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

// Get all conversations for a specific customer (for Recent Conversations panel)
export async function getCustomerTickets(req: AuthenticatedRequest, res: Response) {
  const { customerId } = req.params;
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const all = await convRepo.findAll();
    const customerConvs = all
      .filter(c => c.customer.id === customerId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20); // cap at 20 most recent
    return res.json(customerConvs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// Merge sourceId ticket into targetId: move all messages from source into target, then close source
export async function mergeTickets(req: AuthenticatedRequest, res: Response) {
  const { id: targetId } = req.params;
  const { sourceId } = req.body;

  if (!sourceId || !targetId) {
    return res.status(400).json({ error: 'sourceId and targetId are required' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ error: 'Cannot merge a ticket with itself' });
  }

  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();

    const target = await convRepo.findById(targetId);
    const source = await convRepo.findById(sourceId);
    if (!target) return res.status(404).json({ error: 'Target ticket not found' });
    if (!source) return res.status(404).json({ error: 'Source ticket not found' });

    // Build smart summaries for the merge event card
    const summaryBullets: string[] = [];
    let question = '';

    const sourceMessages = await msgRepo.findByConversationId(sourceId, 200, 0);
    const customerMsgs = sourceMessages.filter(m => m.sender.type === 'customer' || (m.sender as any).type === 'customer');
    if (customerMsgs.length > 0) {
      question = customerMsgs[0].content;
    } else {
      question = source.lastMessageSnippet || 'No initial question provided.';
    }

    // Generate clear, dynamic bullet summaries from source conversation
    for (const msg of sourceMessages) {
      const text = msg.content.toLowerCase();
      const isCustomer = msg.sender.type === 'customer' || (msg.sender as any).type === 'customer';
      if (isCustomer) {
        if (text.includes('hi') || text.includes('hello')) {
          // Extract brand name from subsequent agent replies if available
          const agentReply = sourceMessages.find(m => m.sender.type === 'agent' && m.content.includes('reply as soon as they can'));
          let brand = 'the team';
          if (agentReply) {
            const match = agentReply.content.match(/(.+?) will reply/i);
            if (match) brand = match[1];
          }
          summaryBullets.push(`User greeted and was informed ${brand} would reply soon.`);
        } else if (text.includes('test')) {
          summaryBullets.push('User stated they were just testing.');
        } else {
          const excerpt = msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content;
          summaryBullets.push(`User stated: "${excerpt}"`);
        }
      } else {
        if (text.includes('reply as soon as they can')) {
          const match = msg.content.match(/(.+?) will reply/i);
          const brand = match ? match[1] : 'the team';
          summaryBullets.push(`User greeted and was informed ${brand} would reply soon.`);
        } else if (text.includes('way to reach you')) {
          summaryBullets.push('Teammate requested contact information for follow-up.');
        } else if (text.includes('assistance for feedback') || text.includes('help')) {
          summaryBullets.push('Teammate offered assistance for feedback, issues, or questions.');
        } else {
          const excerpt = msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content;
          summaryBullets.push(`Teammate: "${excerpt}"`);
        }
      }
    }

    // Deduplicate summaries and limit to max 5 bullets
    const uniqueBullets = Array.from(new Set(summaryBullets)).slice(0, 5);

    const mergedBy = req.user ? (req.user as any).name || 'Agent' : 'Agent';
    const customerLocation = source.customer.session?.country || 'Hyderabad - India';

    // Add a system note to the target conversation about the merge
    await msgRepo.create({
      conversationId: targetId,
      sender: {
        type: 'agent',
        id: req.user?.id || 'system',
        name: mergedBy
      },
      content: `🔀 Merged ticket **${source.ticketNumber}** into this conversation.`,
      isInternalNote: true,
      seen: false,
      delivered: true,
      metadata: {
        type: 'merge',
        mergeDetails: {
          sourceTicketNumber: source.ticketNumber,
          sourceConversationId: sourceId,
          customerName: source.customer.name,
          customerLocation: customerLocation,
          mergedBy: mergedBy,
          question: question,
          summary: uniqueBullets
        }
      }
    });

    // Add an indicator system message to the source conversation that it has been merged
    await msgRepo.create({
      conversationId: sourceId,
      sender: {
        type: 'agent',
        id: req.user?.id || 'system',
        name: mergedBy
      },
      content: `↳ ${mergedBy} merged this conversation into #${target.ticketNumber}`,
      isInternalNote: false,
      seen: true,
      delivered: true,
      metadata: {
        type: 'merged_indicator',
        mergedIntoTicketNumber: target.ticketNumber,
        mergedIntoConversationId: targetId
      }
    });

    // Update the source conversation status to 'closed' instead of deleting it
    const updatedSource = await convRepo.update(sourceId, {
      status: 'closed',
      lastMessageSnippet: `[Merged into ${target.ticketNumber}]`
    });

    // Broadcast update events for both conversations
    if (updatedSource) SocketService.broadcastConversationUpdate(updatedSource);
    const updatedTarget = await convRepo.findById(targetId);
    if (updatedTarget) SocketService.broadcastConversationUpdate(updatedTarget);

    return res.json({ success: true, target: updatedTarget, closedSource: updatedSource });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

