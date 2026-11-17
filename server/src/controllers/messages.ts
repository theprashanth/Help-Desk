import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from '../services/socket';
import { Message, Attachment } from '../../../shared/src/types';
import path from 'path';

export async function getMessages(req: AuthenticatedRequest, res: Response) {
  const { conversationId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const skip = req.query.skip ? parseInt(req.query.skip as string) : 0;

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const list = await msgRepo.findByConversationId(conversationId, limit, skip);
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createMessage(req: AuthenticatedRequest, res: Response) {
  const { conversationId, sender, content, attachments, isInternalNote } = req.body;

  if (!conversationId || !sender || (!content && (!attachments || attachments.length === 0))) {
    return res.status(400).json({ error: 'conversationId, sender, and content/attachments are required' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const convRepo = RepositoryFactory.getConversationRepository();

    const conv = await convRepo.findById(conversationId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const createdMsg = await msgRepo.create({
      conversationId,
      sender,
      content: content || '',
      attachments: attachments || [],
      isInternalNote: !!isInternalNote,
      seen: false,
      delivered: true,
      reactions: [],
      metadata: req.body.metadata
    });

    // Update unread count based on sender type
    const updateData: any = {};
    if (sender.type === 'customer') {
      updateData.unreadCountAgent = conv.unreadCountAgent + 1;
      // A customer reply wakes the conversation up (Intercom-style)
      if (conv.snoozedUntil) updateData.snoozedUntil = null;
      if (conv.status === 'waiting') updateData.status = 'open';
    } else if (sender.type === 'agent' && !isInternalNote) {
      updateData.unreadCountCustomer = conv.unreadCountCustomer + 1;
    }

    // Refresh conversation snippet
    let snippet = content;
    if (attachments && attachments.length > 0) {
      snippet = snippet ? `${snippet} (Attachment)` : 'Sent an attachment';
    }
    if (isInternalNote) {
      snippet = `[Note] ${snippet}`;
    }
    updateData.lastMessageSnippet = snippet;

    const updatedConv = await convRepo.update(conversationId, updateData);

    // Emit live updates
    SocketService.broadcastMessageNew(createdMsg);
    if (updatedConv) {
      SocketService.broadcastConversationUpdate(updatedConv);
    }

    return res.status(201).json(createdMsg);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function addReaction(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!emoji) {
    return res.status(400).json({ error: 'emoji is required' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const msg = await msgRepo.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const reactions = msg.reactions ? [...msg.reactions] : [];
    const existingIdx = reactions.findIndex(
      r => r.agentId === req.user!.id && r.emoji === emoji
    );

    if (existingIdx > -1) {
      // Toggle off
      reactions.splice(existingIdx, 1);
    } else {
      // Add reaction (allow user name placeholder or fetch from repo)
      const userRepo = RepositoryFactory.getUserRepository();
      const agent = await userRepo.findById(req.user.id);
      reactions.push({
        agentId: req.user.id,
        agentName: agent ? agent.name : 'Agent',
        emoji
      });
    }

    const updated = await msgRepo.update(messageId, { reactions });
    if (!updated) {
      return res.status(404).json({ error: 'Message update failed' });
    }

    SocketService.broadcastMessageUpdate(updated);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateMessageTags(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;
  const { tags } = req.body;

  if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const uniqueTags = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)));
    const updated = await msgRepo.update(messageId, { tags: uniqueTags });
    if (!updated) {
      return res.status(404).json({ error: 'Message not found' });
    }
    SocketService.broadcastMessageUpdate(updated);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteMessage(req: AuthenticatedRequest, res: Response) {
  const { messageId } = req.params;

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const msg = await msgRepo.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const deleted = await msgRepo.delete(messageId);
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    SocketService.broadcastMessageDeleted(messageId, msg.conversationId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function uploadFiles(req: AuthenticatedRequest, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let type: 'image' | 'pdf' | 'file' = 'file';
    
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
      type = 'image';
    } else if (ext === '.pdf') {
      type = 'pdf';
    }

    const fileUrl = `http://localhost:3000/uploads/${req.file.filename}`;
    const attachment: Attachment = {
      name: req.file.originalname,
      url: fileUrl,
      type,
      size: req.file.size
    };

    return res.json(attachment);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markSeen(req: AuthenticatedRequest, res: Response) {
  const { conversationId } = req.params;
  const { role } = req.body; // 'agent' or 'customer'

  if (!conversationId || !role) {
    return res.status(400).json({ error: 'conversationId and role are required' });
  }

  try {
    const msgRepo = RepositoryFactory.getMessageRepository();
    const convRepo = RepositoryFactory.getConversationRepository();
    
    await msgRepo.markConversationSeen(conversationId, role);
    const updated = await convRepo.findById(conversationId);

    const seenAt = new Date().toISOString();
    SocketService.emitToRoom(conversationId, 'message:seen', { conversationId, seenAt, role });
    if (updated) {
      SocketService.broadcastConversationUpdate(updated);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
