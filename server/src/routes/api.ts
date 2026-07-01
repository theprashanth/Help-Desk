import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { 
  login, getProfile, getSettings, updateSettings, getAgents 
} from '../controllers/auth';
import { 
  getTickets, getTicket, createTicket, updateTicket, assignTicket, 
  updateCustomerProfile, getSavedReplies, createSavedReply, updateSavedReply, 
  deleteSavedReply, getTags, createTag, deleteTag 
} from '../controllers/tickets';
import { 
  getMessages, createMessage, addReaction, deleteMessage, uploadFiles, markSeen 
} from '../controllers/messages';
import { getAnalytics } from '../controllers/analytics';
import { resetDatabase, seedData, simulateActivity } from '../controllers/simulation';

const router = Router();

// --- Auth Routes ---
router.post('/auth/login', login);
router.get('/auth/profile', authenticateJWT, getProfile);
router.get('/auth/settings', authenticateJWT, getSettings);
router.put('/auth/settings', authenticateJWT, updateSettings);
router.get('/auth/agents', authenticateJWT, getAgents);

// --- Ticket / Conversation Routes ---
router.get('/tickets', authenticateJWT, getTickets);
router.get('/tickets/:id', getTicket); // Let guest fetch single ticket details if needed
router.post('/tickets', createTicket); // Guest can create conversations
router.put('/tickets/:id', authenticateJWT, updateTicket);
router.put('/tickets/:id/assign', authenticateJWT, assignTicket);
router.put('/customers/:customerId', authenticateJWT, updateCustomerProfile);

// --- Saved Replies Routes ---
router.get('/saved-replies', authenticateJWT, getSavedReplies);
router.post('/saved-replies', authenticateJWT, createSavedReply);
router.put('/saved-replies/:id', authenticateJWT, updateSavedReply);
router.delete('/saved-replies/:id', authenticateJWT, deleteSavedReply);

// --- Tags Routes ---
router.get('/tags', authenticateJWT, getTags);
router.post('/tags', authenticateJWT, createTag);
router.delete('/tags/:id', authenticateJWT, deleteTag);

// --- Message Routes ---
router.get('/messages/:conversationId', getMessages); // Open for guest testing
router.post('/messages', createMessage); // Guest & Agent can post messages
router.put('/messages/:messageId/react', authenticateJWT, addReaction);
router.delete('/messages/:messageId', authenticateJWT, deleteMessage);
router.post('/messages/upload', upload.single('file'), uploadFiles); // File attachments
router.put('/messages/seen/:conversationId', markSeen); // Mark conversation as read

// --- Analytics Route ---
router.get('/analytics', authenticateJWT, getAnalytics);

// --- Seeding & Simulation Routes ---
router.post('/simulation/reset', resetDatabase);
router.post('/simulation/seed', seedData);
router.post('/simulation/activity', authenticateJWT, simulateActivity);

export default router;
