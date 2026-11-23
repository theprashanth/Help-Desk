import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import apiRouter from './routes/api';
import { RepositoryFactory } from './repositories/factory';
import { migrateJsonTicketNumbers } from './repositories/json.repo';
import { ensureWorkspaceAppIds } from './services/appId';
import { Presence } from './services/presence';
import { startScheduler } from './services/scheduler';
import { migrateMongoTicketNumbers } from './repositories/mongoose.repo';
import { SocketService, AGENTS_ROOM, customerRoom } from './services/socket';

const customerTypingTimers = new Map<string, ReturnType<typeof setTimeout>>();
import { verifyAgentToken } from './middleware/auth';
import { uploadDir } from './middleware/upload';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow connections from frontend Vite
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api', apiRouter);

// Database Initialization & Failover
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/help-desk';
const PORT = process.env.PORT || 3000;

async function startServer() {
  let isMongoConnected = false;
  
  if (process.env.USE_LOCAL_STORAGE === 'true') {
    RepositoryFactory.setUseMongoose(false);
  } else {
    try {
      console.log(`[Database] Attempting connection to MongoDB at: ${MONGODB_URI}`);
      // Set short timeout (3 seconds) to prevent server boot hang on connect failure
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000
      });
      isMongoConnected = true;
      RepositoryFactory.setUseMongoose(true);
      console.log('[Database] MongoDB Connection Established Successfully!');
    } catch (err: any) {
      console.warn(`[Database Warning] MongoDB connection failed: ${err.message}`);
      console.warn('[Database Fallback] Falling back to local JSON file storage inside \'.data/\' folder.');
      RepositoryFactory.setUseMongoose(false);
    }
  }

  // Rename legacy TICKET-xxxx ids to the #number style (no-op once done)
  try {
    if (isMongoConnected) await migrateMongoTicketNumbers();
    else await migrateJsonTicketNumbers();
  } catch (err: any) {
    console.warn(`[Migration] Ticket number rename skipped: ${err.message}`);
  }

  // Ensure default workspace exists
  try {
    const workspaceRepo = RepositoryFactory.getWorkspaceRepository();
    if (!RepositoryFactory.isJson()) {
      const { WorkspaceModel } = require('./models/schemas');
      const exists = await WorkspaceModel.findOne({ _id: 'default_workspace' });
      if (!exists) {
        const doc = new WorkspaceModel({
          _id: 'default_workspace',
          name: 'Default Workspace',
          subdomain: 'default',
          apiKey: 'default_api_key_12345'
        });
        // Override _id since mongoose cast could occur
        doc._id = 'default_workspace';
        await doc.save();
        console.log('[Seeder] Seeded default MongoDB Workspace');
      }
    } else {
      const fs = require('fs/promises');
      const path = require('path');
      const filePath = path.resolve(process.cwd(), '.data/workspaces.json');
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        let list = [];
        try {
          list = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (e) {}
        if (!list.some((w: any) => w.id === 'default_workspace')) {
          list.push({
            id: 'default_workspace',
            name: 'Default Workspace',
            subdomain: 'default',
            apiKey: 'default_api_key_12345',
            createdAt: new Date().toISOString()
          });
          await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf-8');
          console.log('[Seeder] Seeded default JSON Workspace');
        }
      } catch (e) {}
    }
  } catch (err: any) {
    console.error('[Seeder Error] Failed to ensure default workspace:', err.message);
  }

  // Every workspace gets a real App ID for the Messenger (instead of its internal id)
  try { await ensureWorkspaceAppIds(); } catch (err: any) { console.warn(`[Migration] App ID setup skipped: ${err.message}`); }

  // Run JSON files schema migration to ensure all old single-tenant records
  // have a default workspaceId assigned.
  if (RepositoryFactory.isJson()) {
    try {
      const fs = require('fs/promises');
      const path = require('path');
      const dataFiles = ['users.json', 'customers.json', 'conversations.json', 'messages.json', 'tags.json', 'settings.json'];
      for (const file of dataFiles) {
        const filePath = path.resolve(process.cwd(), '.data', file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          if (content.trim()) {
            const list = JSON.parse(content);
            if (Array.isArray(list)) {
              let updated = false;
              for (const item of list) {
                if (!item.workspaceId) {
                  item.workspaceId = 'default_workspace';
                  updated = true;
                }
              }
              if (updated) {
                await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf-8');
                console.log(`[Migration] Scoped legacy records in ${file} to 'default_workspace'`);
              }
            }
          }
        } catch (e) {
          // File might not exist yet
        }
      }
    } catch (err: any) {
      console.error('[Migration Error] Failed to migrate JSON records:', err.message);
    }
  }

  // Set up auto-seed if database is empty
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agents = await userRepo.findAll();
    if (agents.length === 0) {
      console.log('[Seeder] No agents found. Seeding default Admin agent...');
      await userRepo.create({
        email: 'admin@localhost',
        passwordPlain: 'admin123',
        name: 'Admin Manager',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
        role: 'admin',
        status: 'online',
        lastSeen: new Date().toISOString()
      });
      console.log('[Seeder] Seeded default Admin Account (email: admin@localhost, password: admin123)');
    }
  } catch (err: any) {
    console.error('[Seeder Error] Failed to verify/seed default credentials:', err.message);
  }

  // Real-time WebSockets
  SocketService.init(io);
  Presence.startSweeper();
  startScheduler(); // snoozed conversations wake up when their time comes



  io.on('connection', (socket) => {
    console.log(`[Socket.IO] New connection: ${socket.id}`);

    // Join conversation room
    socket.on('join', (room: string) => {
      if (typeof room !== 'string' || room === AGENTS_ROOM || room.startsWith('customer:')) return; // protected rooms
      socket.join(room);
      Presence.join(socket.id, room); // collision detection: "Sarah is viewing"
      console.log(`[Socket.IO] Socket ${socket.id} joined room ${room}`);
    });

    // Leave conversation room
    socket.on('leave', (room: string) => {
      socket.leave(room);
      if (typeof room === 'string') Presence.leave(socket.id, room);
      console.log(`[Socket.IO] Socket ${socket.id} left room ${room}`);
    });

    // Broadcast Agent Login
    socket.on('agent:login', (payload: { agentId: string; name: string; token?: string }) => {
      // Only sockets with a valid agent token may receive internal notes and events
      const verified = verifyAgentToken(payload.token);
      if (verified && verified.id === payload.agentId) {
        socket.join(AGENTS_ROOM);
        Presence.registerAgent(socket.id, payload.agentId, payload.name);
        // Conversations this socket opened before its login was verified
        for (const r of socket.rooms) if (r !== socket.id && r !== AGENTS_ROOM && !r.startsWith('customer:')) Presence.join(socket.id, r);
        socket.emit('presence:all', Presence.all()); // who is viewing what, right now
      }
      SocketService.onlineAgents.set(payload.agentId, { socketId: socket.id, name: payload.name });
      SocketService.broadcastAgentOnline(payload.agentId, payload.name);
      console.log(`[Socket.IO] Agent ${payload.name} (${payload.agentId}) went online`);
    });

    // Handle Typing indicator
    // Messenger: a customer's widget joins its private room with its (unguessable) User id
    socket.on('messenger:join', (payload: { customerId?: string }) => {
      const id = payload?.customerId;
      if (typeof id === 'string' && id.length > 0 && id.length <= 100) socket.join(customerRoom(id));
    });

    // Customer is typing (from the Messenger) -> agents; auto-clears after 4s of silence
    socket.on('customer:typing', async (payload: { conversationId?: string; guestName?: string }) => {
      if (!payload?.conversationId) return;
      const conv = await RepositoryFactory.getConversationRepository().findById(payload.conversationId).catch(() => null);
      if (!conv || !socket.rooms.has(customerRoom(conv.customer.id))) return; // only the conversation's own customer
      const event = { conversationId: conv.id, senderType: 'customer', senderName: conv.customer.name, isTyping: true };
      SocketService.emitToRoom(AGENTS_ROOM, 'message:typing', event);
      clearTimeout(customerTypingTimers.get(conv.id));
      customerTypingTimers.set(conv.id, setTimeout(() => SocketService.emitToRoom(AGENTS_ROOM, 'message:typing', { ...event, isTyping: false }), 4000));
    });

    socket.on('typing', (payload: { conversationId: string; senderType: 'customer' | 'agent'; senderName: string; isTyping: boolean }) => {
      if (!socket.rooms.has(AGENTS_ROOM)) return; // only verified agents send this event
      if (payload?.senderType === 'agent' && typeof payload.conversationId === 'string') {
        Presence.typing(socket.id, payload.conversationId, !!payload.isTyping); // "Sarah is replying…"
      }
      // Broadcast typing event to others in the same room
      socket.to(payload.conversationId).emit('message:typing', payload);
      // ...and tell the customer's Messenger ("Rishi is typing…")
      SocketService.emitToConversationCustomer(payload.conversationId, 'agent:typing', {
        conversationId: payload.conversationId, agentName: payload.senderName, isTyping: payload.isTyping,
      });
      console.log(`[Socket.IO] Typing state in ${payload.conversationId}: ${payload.senderName} (${payload.senderType}) typing=${payload.isTyping}`);
    });

    // Handle Seen notification
    socket.on('seen', (payload: { conversationId: string; role: 'customer' | 'agent' }) => {
      const seenAt = new Date().toISOString();
      socket.to(payload.conversationId).emit('message:seen', {
        conversationId: payload.conversationId,
        seenAt,
        role: payload.role
      });
    });

    // Handle Disconnection
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Disconnected: ${socket.id}`);
      Presence.disconnect(socket.id);
      
      // Check if disconnected socket belongs to an agent
      for (const [agentId, value] of SocketService.onlineAgents.entries()) {
        if (value.socketId === socket.id) {
          SocketService.onlineAgents.delete(agentId);
          SocketService.broadcastAgentOffline(agentId);
          console.log(`[Socket.IO] Agent ${value.name} went offline`);
          
          // Update status in repo
          const userRepo = RepositoryFactory.getUserRepository();
          userRepo.update(agentId, { status: 'offline', lastSeen: new Date().toISOString() })
            .catch(err => console.error(`Failed to update offline status for agent ${agentId}:`, err.message));
          break;
        }
      }
    });
  });

  // Root endpoint for status / navigation
  app.get('/', (req, res) => {
    if (req.accepts('html')) {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Help Desk Backend API</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #0f172a;
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 1rem;
              }
              .card {
                background-color: #1e293b;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 2rem;
                max-width: 480px;
                width: 100%;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
              }
              .badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: #064e3b;
                color: #34d399;
                padding: 4px 10px;
                border-radius: 9999px;
                font-size: 0.8rem;
                font-weight: 600;
                margin-bottom: 1rem;
              }
              .badge-dot {
                width: 8px;
                height: 8px;
                background-color: #10b981;
                border-radius: 50%;
              }
              h1 {
                font-size: 1.5rem;
                margin: 0 0 0.5rem 0;
                color: #f8fafc;
              }
              p {
                color: #94a3b8;
                font-size: 0.95rem;
                line-height: 1.5;
                margin: 0 0 1.5rem 0;
              }
              .actions {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
              }
              a {
                display: block;
                text-align: center;
                text-decoration: none;
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 0.95rem;
                font-weight: 500;
                transition: all 0.15s ease-in-out;
              }
              .btn-primary {
                background-color: #2563eb;
                color: #ffffff;
              }
              .btn-primary:hover {
                background-color: #1d4ed8;
              }
              .btn-secondary {
                background-color: #334155;
                color: #e2e8f0;
              }
              .btn-secondary:hover {
                background-color: #475569;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="badge">
                <span class="badge-dot"></span>
                API Server Online
              </div>
              <h1>Help Desk Backend</h1>
              <p>The Express &amp; Socket.IO backend service is running successfully on port ${PORT}. If you want to use the customer support web application or agent dashboard, open the frontend:</p>
              <div class="actions">
                <a href="http://localhost:5173/agent" class="btn-primary">Go to Agent Dashboard (localhost:5173/agent)</a>
                <a href="http://localhost:5173" class="btn-secondary">View Customer Demo Site (localhost:5173)</a>
                <a href="/health" class="btn-secondary">Check System Health Status (/health)</a>
              </div>
            </div>
          </body>
        </html>
      `);
    } else {
      res.json({
        status: 'healthy',
        message: 'Help Desk Backend API is running',
        port: PORT,
        dashboardUrl: 'http://localhost:5173',
        healthCheck: '/health'
      });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      database: RepositoryFactory.isJson() ? 'JSON Files' : 'MongoDB Mongoose',
      mongoConnected: isMongoConnected,
      onlineAgentsCount: SocketService.onlineAgents.size
    });
  });

  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 Support Platform Backend Running on: http://localhost:${PORT}`);
    console.log(`🏥 Health Check endpoint: http://localhost:${PORT}/health`);
    console.log(`=================================================`);
  });
}

startServer();
