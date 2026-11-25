import { Request, Response } from 'express';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Customer, Conversation, Message, Tag, SavedReply } from '../../../shared/src/types';
import fs from 'fs/promises';
import path from 'path';
import { logAudit } from '../services/audit';

// Sample arrays for simulation
const MOCK_COUNTRIES = ['United States', 'United Kingdom', 'Canada', 'India', 'Germany', 'Australia', 'Brazil', 'Japan'];
const MOCK_BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge'];
const MOCK_OS = ['macOS', 'Windows', 'iOS', 'Android', 'Linux'];
const MOCK_DEVICES = ['Desktop', 'Mobile', 'Tablet'];
const MOCK_NAMES = [
  'Emma Watson', 'Liam Neeson', 'Olivia Wilde', 'Noah Centineo', 'Sophia Loren',
  'Jackson Pollock', 'Isabella Rossellini', 'Lucas Hedges', 'Mia Farrow', 'Ethan Hawke',
  'Charlotte Gainsbourg', 'Oliver Stone', 'Amelia Earhart', 'Elijah Wood', 'Harper Lee',
  'James Dean', 'Evelyn Glennie', 'Benjamin Franklin', 'Abigail Adams', 'Lucas Leiva',
  'Mason Mount', 'Logan Paul', 'Alexander Hamilton', 'Ella Fitzgerald', 'Henry Cavill'
];

const MOCK_QUERIES = [
  {
    category: 'bug',
    priority: 'high',
    messages: [
      'The checkout button is not working on the mobile app. It just spins infinitely.',
      'Sorry about that! Can you tell me what device and browser version you are using?',
      'I am on iPhone 15, Safari browser.',
      'Thanks! Our developers are investigating the checkout spin bug on Safari iOS. We expect a fix shortly.',
    ]
  },
  {
    category: 'payment',
    priority: 'critical',
    messages: [
      'I was charged twice for my subscription this month. Can you check?',
      'Hello! Let me pull up your billing details. Yes, I see duplicate transactions on June 28th.',
      'Thank you. Will I get a refund for the second transaction?',
      'Yes, I have initiated a refund for the duplicate charge. It should reflect in 5-7 business days.',
    ]
  },
  {
    category: 'subscription',
    priority: 'medium',
    messages: [
      'How do I upgrade my account from Basic to Pro plan?',
      'You can upgrade in your billing dashboard. Go to Settings > Plan > Upgrade. The changes are pro-rated.',
    ]
  },
  {
    category: 'refund',
    priority: 'medium',
    messages: [
      'I am not satisfied with the product. I would like to request a refund for my purchase.',
      'I am sorry to hear that. I can process a refund for your recent purchase. What went wrong?',
      'It does not support importing csv files which is a blocker for us.',
      'Ah, understood. I have processed the refund. You will receive a confirmation email shortly.'
    ]
  },
  {
    category: 'feature_request',
    priority: 'low',
    messages: [
      'Do you support dark mode for the widgets?',
      'Yes! You can toggle dark mode inside your widget settings tab. It supports auto-detection as well.',
    ]
  },
  {
    category: 'general',
    priority: 'low',
    messages: [
      'Hi, I have a quick question. What are your support business hours?',
      'Hi there! Our support team is online Monday to Friday, from 9 AM to 5 PM EST.',
    ]
  }
];

export async function resetDatabase(req: Request, res: Response) {
  try {
    if (RepositoryFactory.isJson()) {
      // Clear JSON files in .data
      const dataDir = path.resolve(process.cwd(), '.data');
      // The audit log is kept, so the reset itself stays on record
      const files = ['users.json', 'customers.json', 'conversations.json', 'messages.json', 'tags.json', 'saved_replies.json', 'settings.json', 'teams.json', 'companies.json'];
      
      for (const file of files) {
        try {
          await fs.writeFile(path.join(dataDir, file), JSON.stringify([], null, 2));
        } catch (e) {
          // File might not exist yet, skip
        }
      }
    } else {
      // Clear MongoDB collections
      const mongoose = require('mongoose');
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        await collections[key].deleteMany({});
      }
    }

    // Force re-seed basic admin agent so the platform is usable
    const userRepo = RepositoryFactory.getUserRepository();
    await userRepo.create({
      email: 'admin@localhost',
      passwordPlain: 'admin123',
      name: 'Admin Manager',
      role: 'admin',
      status: 'online',
      lastSeen: new Date().toISOString()
    });

    console.log('[Simulator] Database Reset Completed');
    await logAudit(req as any, 'data.reset', 'Reset the workspace data (testing tools)');
    return res.json({ success: true, message: 'Database reset and default admin registered.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function seedData(req: Request, res: Response) {
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const custRepo = RepositoryFactory.getCustomerRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();
    const tagRepo = RepositoryFactory.getTagRepository();
    const replyRepo = RepositoryFactory.getSavedReplyRepository();

    // 1. Seed Agents (if not already seeded)
    let agents = await userRepo.findAll();
    let sarahAgent = agents.find(a => a.email === 'agent@localhost');
    let adminAgent = agents.find(a => a.email === 'admin@localhost');

    if (!adminAgent) {
      adminAgent = await userRepo.create({
        email: 'admin@localhost',
        passwordPlain: 'admin123',
        name: 'Admin Manager',
        role: 'admin',
        status: 'online',
        lastSeen: new Date().toISOString()
      });
    }

    if (!sarahAgent) {
      sarahAgent = await userRepo.create({
        email: 'agent@localhost',
        passwordPlain: 'agent123',
        name: 'Sarah Support',
        role: 'support_agent',
        status: 'online',
        lastSeen: new Date().toISOString()
      });
    }

    // Refresh agent list
    agents = [adminAgent, sarahAgent];

    // 2. Seed Default Tags
    const tagsToSeed = [
      { name: 'VIP', color: '#8B5CF6' },
      { name: 'Bug', color: '#EF4444' },
      { name: 'Billing', color: '#10B981' },
      { name: 'Feature', color: '#3B82F6' },
      { name: 'Follow Up', color: '#F59E0B' }
    ];
    for (const t of tagsToSeed) {
      const existing = await tagRepo.findByName(t.name);
      if (!existing) {
        await tagRepo.create(t);
      }
    }
    const tags = await tagRepo.findAll();

    // 3. Seed Default Saved Replies
    const repliesToSeed = [
      { trigger: '/hello', title: 'Welcome Greeting', content: 'Hello! Thank you for reaching out. How can I assist you today?' },
      { trigger: '/refund', title: 'Refund Protocol', content: 'We process refunds within 5-7 business days of approval. Please share your invoice details so I can look it up.' },
      { trigger: '/payment', title: 'Payment Update', content: 'You can update your payment method directly in your settings under the Billing & Subscriptions tab.' },
      { trigger: '/subscription', title: 'Pricing Plans', content: 'We offer monthly and annual pricing tiers. Annual subscriptions receive a 20% discount!' }
    ];
    for (const r of repliesToSeed) {
      const existing = await replyRepo.findByTrigger(r.trigger);
      if (!existing) {
        await replyRepo.create(r);
      }
    }

    // 4. Generate 100 conversations
    const totalConversationsNeeded = 100;
    console.log(`[Simulator] Starting generation of ${totalConversationsNeeded} conversations...`);

    const statuses = ['open', 'waiting', 'resolved', 'closed', 'archived'];
    const statusWeights = [0.2, 0.2, 0.4, 0.15, 0.05]; // Weighted distribution

    const selectWeighted = (items: any[], weights: number[]) => {
      const r = Math.random();
      let sum = 0;
      for (let i = 0; i < items.length; i++) {
        sum += weights[i];
        if (r <= sum) return items[i];
      }
      return items[items.length - 1];
    };

    for (let i = 0; i < totalConversationsNeeded; i++) {
      const customerId = `cust_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`;
      const name = MOCK_NAMES[i % MOCK_NAMES.length];
      const email = `${name.toLowerCase().replace(' ', '.')}@example.com`;
      const phone = `+1 (555) ${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const randomCountry = MOCK_COUNTRIES[Math.floor(Math.random() * MOCK_COUNTRIES.length)];
      const randomBrowser = MOCK_BROWSERS[Math.floor(Math.random() * MOCK_BROWSERS.length)];
      const randomOS = MOCK_OS[Math.floor(Math.random() * MOCK_OS.length)];
      const randomDevice = MOCK_DEVICES[Math.floor(Math.random() * MOCK_DEVICES.length)];
      
      const session = {
        country: randomCountry,
        browser: randomBrowser,
        os: randomOS,
        device: randomDevice,
        ip: `192.168.1.${Math.floor(10 + Math.random() * 200)}`,
        currentPage: ['/dashboard', '/pricing', '/docs', '/checkout'][Math.floor(Math.random() * 4)],
        sessionDuration: Math.floor(60 + Math.random() * 3600),
        firstSeen: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 * Math.random()).toISOString(),
        lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000 * Math.random()).toISOString(),
        totalConversations: 1
      };

      // Random Tags mapping
      const customerTags: string[] = [];
      if (Math.random() > 0.6) {
        const t1 = tags[Math.floor(Math.random() * tags.length)];
        customerTags.push(t1.name);
      }

      // Customer Notes
      const customerNotes: string[] = [];
      if (Math.random() > 0.7) {
        customerNotes.push(`Customer operates on ${randomOS} ${randomDevice}. Needs follow-up.`);
      }

      const customer = await custRepo.create({
        id: customerId,
        name,
        email,
        phone,
        session,
        tags: customerTags,
        notes: customerNotes
      });

      // Select query template
      const queryTemplate = MOCK_QUERIES[i % MOCK_QUERIES.length];
      const status = selectWeighted(statuses, statusWeights);
      
      // Assign Agent: 70% chance to assign
      const shouldAssign = Math.random() > 0.3;
      const assignedAgent = shouldAssign ? agents[Math.floor(Math.random() * agents.length)] : undefined;

      // Unread Counts
      let unreadCountAgent = 0;
      let unreadCountCustomer = 0;
      if (status === 'open') {
        unreadCountAgent = Math.random() > 0.5 ? 1 : 0;
      } else if (status === 'waiting') {
        unreadCountCustomer = Math.random() > 0.5 ? 1 : 0;
      }

      // Create conversation
      const conv = await convRepo.create({
        customer,
        status,
        priority: queryTemplate.priority as any,
        category: queryTemplate.category as any,
        unreadCountAgent,
        unreadCountCustomer
      });

      // Add messages chronologically
      for (let j = 0; j < queryTemplate.messages.length; j++) {
        const msgText = queryTemplate.messages[j];
        const isAgent = j % 2 === 1;
        const sender = isAgent 
          ? { type: 'agent' as const, id: assignedAgent?.id || adminAgent.id, name: assignedAgent?.name || adminAgent.name, avatar: assignedAgent?.avatar || adminAgent.avatar }
          : { type: 'customer' as const, id: customer.id, name: customer.name };

        await msgRepo.create({
          conversationId: conv.id,
          sender,
          content: msgText,
          isInternalNote: false,
          seen: true,
          delivered: true
        });
      }

      // Add a simulated internal note occasionally (15% chance)
      if (Math.random() > 0.85) {
        await msgRepo.create({
          conversationId: conv.id,
          sender: {
            type: 'agent',
            id: adminAgent.id,
            name: adminAgent.name,
            avatar: adminAgent.avatar
          },
          content: `Internal assessment: User reports critical bug in browser ${randomBrowser}. Action required.`,
          isInternalNote: true,
          seen: true,
          delivered: true
        });
      }
    }

    console.log('[Simulator] Seeding Complete! Generated 100 conversations.');
    return res.json({ success: true, count: 100 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function simulateActivity(req: Request, res: Response) {
  const { action, conversationId } = req.body;
  
  try {
    const convRepo = RepositoryFactory.getConversationRepository();
    const msgRepo = RepositoryFactory.getMessageRepository();
    const userRepo = RepositoryFactory.getUserRepository();

    if (action === 'customer_message') {
      if (!conversationId) return res.status(400).json({ error: 'conversationId required' });
      const conv = await convRepo.findById(conversationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      // Add message
      const customerMsg = 'Hello! Just following up on this. Any updates?';
      const created = await msgRepo.create({
        conversationId,
        sender: {
          type: 'customer',
          id: conv.customer.id,
          name: conv.customer.name
        },
        content: customerMsg,
        isInternalNote: false,
        seen: false,
        delivered: true
      });

      // Update conversation
      const updatedConv = await convRepo.update(conversationId, {
        status: 'open',
        unreadCountAgent: conv.unreadCountAgent + 1
      });

      SocketService.broadcastMessageNew(created);
      if (updatedConv) SocketService.broadcastConversationUpdate(updatedConv);

      return res.json({ success: true, message: created });
    }

    if (action === 'agent_reply') {
      if (!conversationId) return res.status(400).json({ error: 'conversationId required' });
      const conv = await convRepo.findById(conversationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      const agents = await userRepo.findAll();
      const activeAgent = agents.find(a => a.id === conv.assignedAgentId) || agents[0];

      // Typing animation simulation
      SocketService.emitGlobal('message:typing', {
        conversationId,
        senderType: 'agent',
        senderName: activeAgent.name,
        isTyping: true
      });

      // Deliver message after 2.5s delay
      setTimeout(async () => {
        const replyText = "Hello! I am looking into this issue right now. Thank you for your patience.";
        const created = await msgRepo.create({
          conversationId,
          sender: {
            type: 'agent',
            id: activeAgent.id,
            name: activeAgent.name,
            avatar: activeAgent.avatar
          },
          content: replyText,
          isInternalNote: false,
          seen: false,
          delivered: true
        });

        // Update conversation
        const updatedConv = await convRepo.update(conversationId, {
          status: 'waiting',
          unreadCountCustomer: conv.unreadCountCustomer + 1
        });

        // Turn off typing
        SocketService.emitGlobal('message:typing', {
          conversationId,
          senderType: 'agent',
          senderName: activeAgent.name,
          isTyping: false
        });

        SocketService.broadcastMessageNew(created);
        if (updatedConv) SocketService.broadcastConversationUpdate(updatedConv);
      }, 2500);

      return res.json({ success: true, message: 'Typing triggered; reply scheduled in 2.5s.' });
    }

    return res.status(400).json({ error: 'Invalid action parameter' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
