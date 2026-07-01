import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import apiRouter from './routes/api';
import { RepositoryFactory } from './repositories/factory';
import { SocketService } from './services/socket';
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

  // Keep track of active connections
  const onlineAgents = new Map<string, { socketId: string; name: string }>();

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] New connection: ${socket.id}`);

    // Join conversation room
    socket.on('join', (room: string) => {
      socket.join(room);
      console.log(`[Socket.IO] Socket ${socket.id} joined room ${room}`);
    });

    // Leave conversation room
    socket.on('leave', (room: string) => {
      socket.leave(room);
      console.log(`[Socket.IO] Socket ${socket.id} left room ${room}`);
    });

    // Broadcast Agent Login
    socket.on('agent:login', (payload: { agentId: string; name: string }) => {
      onlineAgents.set(payload.agentId, { socketId: socket.id, name: payload.name });
      SocketService.broadcastAgentOnline(payload.agentId, payload.name);
      console.log(`[Socket.IO] Agent ${payload.name} (${payload.agentId}) went online`);
    });

    // Handle Typing indicator
    socket.on('typing', (payload: { conversationId: string; senderType: 'customer' | 'agent'; senderName: string; isTyping: boolean }) => {
      // Broadcast typing event to others in the same room
      socket.to(payload.conversationId).emit('message:typing', payload);
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
      
      // Check if disconnected socket belongs to an agent
      for (const [agentId, value] of onlineAgents.entries()) {
        if (value.socketId === socket.id) {
          onlineAgents.delete(agentId);
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

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      database: RepositoryFactory.isJson() ? 'JSON Files' : 'MongoDB Mongoose',
      mongoConnected: isMongoConnected,
      onlineAgentsCount: onlineAgents.size
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
