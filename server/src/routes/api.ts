import { Router } from 'express';
import { authenticateJWT, optionalJWT } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { 
  login, getProfile, getSettings, updateSettings, getAgents, updateProfile,
  createAgent, updateAgent, deleteAgent, uploadAvatar, deleteAvatar
} from '../controllers/auth';
import { 
  getTickets, getTicket, createTicket, updateTicket, assignTicket, 
  updateCustomerProfile, getSavedReplies, createSavedReply, updateSavedReply, 
  deleteSavedReply, getTags, createTag, deleteTag, getCustomerTickets, mergeTickets,
  createManualTicket, getInboxCounts, searchCustomers
} from '../controllers/tickets';
import { 
  getMessages, createMessage, addReaction, deleteMessage, uploadFiles, markSeen, updateMessageTags
} from '../controllers/messages';
import { getAnalytics } from '../controllers/analytics';
import { getOfficeHours, updateOfficeHours, getPublicWorkspace, getWorkspace, updateWorkspace } from '../controllers/workspace';
import {
  getIntegrations, updateSlack, disconnectSlack, testSlack, updateWebhook, disconnectWebhook, testWebhook
} from '../controllers/integrations';
import { resetDatabase, seedData, simulateActivity } from '../controllers/simulation';

import { resolveTenant } from '../middleware/tenant.middleware';

const router = Router();

// Apply tenant context resolution to all API paths
router.use(resolveTenant);

// --- Root API status ---
router.get('/', (req, res) => {
  res.json({ status: 'healthy', message: 'Help Desk API root' });
});

// --- Auth Routes ---
router.post('/auth/login', login);
router.get('/auth/profile', authenticateJWT, getProfile);
router.put('/auth/profile', authenticateJWT, updateProfile);
router.post('/auth/profile/avatar', authenticateJWT, uploadAvatar);   // multipart field "avatar", images ≤ 2 MB
router.delete('/auth/profile/avatar', authenticateJWT, deleteAvatar);
router.get('/auth/settings', authenticateJWT, getSettings);
router.put('/auth/settings', authenticateJWT, updateSettings);
router.get('/auth/agents', authenticateJWT, getAgents);
router.post('/auth/agents', authenticateJWT, createAgent);       // admin only (checked in controller)
router.put('/auth/agents/:id', authenticateJWT, updateAgent);    // admin only
router.delete('/auth/agents/:id', authenticateJWT, deleteAgent); // admin only

// --- Workspace settings ---
router.get('/workspace/office-hours', getOfficeHours);           // public: Messenger widget reads it
router.put('/workspace/office-hours', authenticateJWT, updateOfficeHours); // admin only
router.get('/workspace/public', getPublicWorkspace);              // public: Messenger widget
router.get('/workspace', authenticateJWT, getWorkspace);
router.put('/workspace', authenticateJWT, updateWorkspace);         // admin only

// --- Integrations (reads: any teammate; writes: admin only) ---
router.get('/integrations', authenticateJWT, getIntegrations);
router.put('/integrations/slack', authenticateJWT, updateSlack);
router.delete('/integrations/slack', authenticateJWT, disconnectSlack);
router.post('/integrations/slack/test', authenticateJWT, testSlack);
router.put('/integrations/webhook', authenticateJWT, updateWebhook);
router.delete('/integrations/webhook', authenticateJWT, disconnectWebhook);
router.post('/integrations/webhook/test', authenticateJWT, testWebhook);

// --- Ticket / Conversation Routes ---
router.get('/tickets', authenticateJWT, getTickets);
router.get('/tickets/:id', optionalJWT, getTicket); // Let guest fetch single ticket details if needed
router.post('/tickets', createTicket); // Guest can create conversations
router.post('/tickets/manual', authenticateJWT, createManualTicket); // Teammate creates a conversation/ticket/issue
router.get('/inbox/counts', authenticateJWT, getInboxCounts);
router.get('/customers', authenticateJWT, searchCustomers);
router.put('/tickets/:id', authenticateJWT, updateTicket);
router.put('/tickets/:id/assign', authenticateJWT, assignTicket);
router.put('/customers/:customerId', authenticateJWT, updateCustomerProfile);
router.get('/customers/:customerId/tickets', authenticateJWT, getCustomerTickets);
router.post('/tickets/:id/merge', authenticateJWT, mergeTickets);

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
router.get('/messages/:conversationId', optionalJWT, getMessages); // Open for guest testing
router.post('/messages', createMessage); // Guest & Agent can post messages
router.put('/messages/:messageId/react', authenticateJWT, addReaction);
router.put('/messages/:messageId/tags', authenticateJWT, updateMessageTags);
router.delete('/messages/:messageId', authenticateJWT, deleteMessage);
router.post('/messages/upload', upload.single('file'), uploadFiles); // File attachments
router.post('/attachments/upload', upload.single('file'), uploadFiles); // Alias for widget file attachments
router.put('/messages/seen/:conversationId', markSeen); // Mark conversation as read

// --- Analytics Route ---
router.get('/analytics', authenticateJWT, getAnalytics);

// --- Seeding & Simulation Routes ---
router.post('/simulation/reset', resetDatabase);
router.post('/simulation/seed', seedData);
router.post('/simulation/activity', authenticateJWT, simulateActivity);

export default router;
