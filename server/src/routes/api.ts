import { getChatFlow, saveChatFlowDraft, publishChatFlow, discardChatFlowDraft, startChatFlow, chatFlowAction } from '../controllers/chatFlow';
import { Router, text as textBody } from 'express';
import { authenticateJWT, optionalJWT } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { 
  login, getProfile, getSettings, updateSettings, getAgents, updateProfile,
  createAgent, updateAgent, deleteAgent, uploadAvatar, deleteAvatar, updateStatus
} from '../controllers/auth';
import { getAiSettings, saveAiSettings, testAiSettings, askAi } from '../controllers/ai';
import { previewImport, runDataImport, listImports, downloadExport } from '../controllers/data';
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
import { getStateCounts, bulkUpdate } from '../controllers/bulk';
import { searchConversations } from '../controllers/search';
import {
  requireKnownWorkspace, getMessengerSettings, updateMessengerSettings, getIdentitySecret,
  rotateIdentitySecret, removeInstallation, messengerPing
} from '../controllers/messenger';

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
router.put('/auth/profile/status', authenticateJWT, updateStatus);   // { away }
// Settings › AI assistant + the Ask AI panel
router.get('/ai/settings', authenticateJWT, getAiSettings);
router.put('/ai/settings', authenticateJWT, saveAiSettings);
router.post('/ai/test', authenticateJWT, testAiSettings);
router.post('/ai/ask', authenticateJWT, askAi);
// Settings › Data › Imports & exports (CSV uploads are sent as text/csv)
const csvUpload = textBody({ type: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'], limit: '25mb' });
router.post('/data/imports/preview', authenticateJWT, csvUpload, previewImport);
router.post('/data/imports', authenticateJWT, csvUpload, runDataImport);
router.get('/data/imports', authenticateJWT, listImports);
router.get('/data/exports/:type', authenticateJWT, downloadExport);
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
// Messenger Live Chat (Settings) + the public boot ping the embedded Messenger sends
router.get('/messenger/settings', authenticateJWT, getMessengerSettings);
router.put('/messenger/settings', authenticateJWT, updateMessengerSettings);
router.get('/messenger/identity-secret', authenticateJWT, getIdentitySecret);
router.post('/messenger/identity-secret/rotate', authenticateJWT, rotateIdentitySecret);
router.delete('/messenger/installations/:id', authenticateJWT, removeInstallation);
router.post('/messenger/ping', requireKnownWorkspace, messengerPing);

// Chat flow (Settings › Channels › Chat flow) + the Messenger running it
router.get('/chat-flow', authenticateJWT, getChatFlow);
router.put('/chat-flow', authenticateJWT, saveChatFlowDraft);
router.post('/chat-flow/publish', authenticateJWT, publishChatFlow);
router.post('/chat-flow/discard', authenticateJWT, discardChatFlowDraft);
router.post('/chat-flow/start', requireKnownWorkspace, startChatFlow);     // public: visitor finished the details form
router.post('/chat-flow/action', requireKnownWorkspace, chatFlowAction);   // public: visitor tapped a button
router.get('/search', authenticateJWT, searchConversations); // full search: messages, notes, tickets, customers, tags
router.get('/tickets/state-counts', authenticateJWT, getStateCounts); // counts per state for the list's state menu
router.post('/tickets/bulk', authenticateJWT, bulkUpdate); // bulk close/snooze/assign/priority/category/tag/delete
router.get('/tickets', authenticateJWT, getTickets);
router.get('/tickets/:id', optionalJWT, getTicket); // Let guest fetch single ticket details if needed
router.post('/tickets', requireKnownWorkspace, createTicket); // Guest can create conversations
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
router.post('/messages', requireKnownWorkspace, optionalJWT, createMessage); // Guest & Agent can post messages
router.put('/messages/:messageId/react', authenticateJWT, addReaction);
router.put('/messages/:messageId/tags', authenticateJWT, updateMessageTags);
router.delete('/messages/:messageId', authenticateJWT, deleteMessage);
router.post('/messages/upload', upload.single('file'), uploadFiles); // File attachments
router.post('/attachments/upload', upload.single('file'), uploadFiles); // Alias for widget file attachments
router.put('/messages/seen/:conversationId', optionalJWT, markSeen); // Mark conversation as read

// --- Analytics Route ---
router.get('/analytics', authenticateJWT, getAnalytics);

// --- Seeding & Simulation Routes ---
// Testing panel: admins only (reset wipes the workspace's data)
const adminOnly = (req: any, res: any, next: any) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Only admins can use the testing tools' }));
router.post('/simulation/reset', authenticateJWT, adminOnly, resetDatabase);
router.post('/simulation/seed', authenticateJWT, adminOnly, seedData);
router.post('/simulation/activity', authenticateJWT, adminOnly, simulateActivity);

export default router;
