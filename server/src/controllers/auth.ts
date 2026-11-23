import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { AgentSettings, Agent, UserRole } from '../../../shared/src/types';
import crypto from 'crypto';
import { SocketService } from '../services/socket';
import { recordEvent, getActor } from '../services/events';
import { isValidTimeZone } from '../services/officeHours';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadDir } from '../middleware/upload';

export async function login(req: AuthenticatedRequest, res: Response) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const result = await userRepo.verifyPassword(email, password);
    
    if (!result) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Ensure settings exist for the agent
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    const existingSettings = await settingsRepo.findByAgentId(result.agent.id);
    if (!existingSettings) {
      const defaultSettings: AgentSettings = {
        agentId: result.agent.id,
        theme: 'light',
        notifications: { desktop: true, sound: true, browser: true },
        timezone: 'America/New_York',
        language: 'en',
        autoAssign: false,
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'America/New_York', days: [1, 2, 3, 4, 5] }
      };
      await settingsRepo.save(defaultSettings);
    }

    return res.json({
      agent: result.agent,
      token: result.token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agent = await userRepo.findById(req.user.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(agent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    let settings = await settingsRepo.findByAgentId(req.user.id);
    
    if (!settings) {
      settings = {
        agentId: req.user.id,
        theme: 'light',
        notifications: { desktop: true, sound: true, browser: true },
        timezone: 'America/New_York',
        language: 'en',
        autoAssign: false,
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'America/New_York', days: [1, 2, 3, 4, 5] }
      };
      await settingsRepo.save(settings);
    }

    return res.json(settings);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    const updated = await settingsRepo.save({
      ...req.body,
      agentId: req.user.id
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getAgents(req: AuthenticatedRequest, res: Response) {
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agents = await userRepo.findAll();
    return res.json(agents.map(a => ({ ...a, online: SocketService.onlineAgents.has(a.id) })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Teammates management (admin only) ──────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES: UserRole[] = ['admin', 'support_agent'];

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return false;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can manage teammates' });
    return false;
  }
  return true;
}

/** Strong random password: 16 chars from a mixed alphabet, guaranteed to contain each class. */
function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_'];
  const all = sets.join('');
  const chars = sets.map(set => set[crypto.randomInt(set.length)]);
  while (chars.length < 16) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function createAgent(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const { name, email, role, password } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (name.trim().length > 80) return res.status(400).json({ error: 'Name is too long' });
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'A valid email address is required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'support_agent'" });
  const hasPassword = password !== undefined && password !== null && password !== '';
  if (hasPassword && (typeof password !== 'string' || password.length < 8)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (hasPassword && password.length > 128) return res.status(400).json({ error: 'Password is too long' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const normalizedEmail = email.trim().toLowerCase();
    if (await userRepo.findByEmail(normalizedEmail)) {
      return res.status(409).json({ error: 'A teammate with this email already exists' });
    }
    const passwordPlain = hasPassword ? (password as string) : generatePassword();
    const created = await userRepo.create({
      email: normalizedEmail,
      name: name.trim(),
      role,
      status: 'offline',
      passwordPlain,
    });
    const { passwordHash: _omit, ...safe } = created as any;
    return res.status(201).json({
      agent: { ...safe, online: false },
      ...(hasPassword ? {} : { temporaryPassword: passwordPlain }),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

async function countAdmins(): Promise<number> {
  const all = await RepositoryFactory.getUserRepository().findAll();
  return all.filter(a => a.role === 'admin').length;
}

export async function updateAgent(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  const { name, role } = req.body || {};
  const updates: Partial<Agent> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
    if (name.trim().length > 80) return res.status(400).json({ error: 'Name is too long' });
    updates.name = name.trim();
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'support_agent'" });
    updates.role = role;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const target = await userRepo.findById(id);
    if (!target) return res.status(404).json({ error: 'Teammate not found' });
    if (target.role === 'admin' && updates.role === 'support_agent' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'You can’t remove admin access from the last admin' });
    }
    const updated = await userRepo.update(id, updates);
    if (!updated) return res.status(404).json({ error: 'Teammate not found' });
    const { passwordHash: _omit, ...safe } = updated as any;
    return res.json({ ...safe, online: SocketService.onlineAgents.has(id) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteAgent(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  if (id === req.user!.id) return res.status(400).json({ error: 'You can’t remove yourself' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const target = await userRepo.findById(id);
    if (!target) return res.status(404).json({ error: 'Teammate not found' });
    if (target.role === 'admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'You can’t remove the last admin' });
    }

    // Unassign their open/waiting conversations so they land back in the Unassigned queue.
    const convRepo = RepositoryFactory.getConversationRepository();
    const assigned = await convRepo.findFiltered({ assignedAgentId: id, status: ['open', 'waiting'] });
    const actor = await getActor(req);
    let unassigned = 0;
    for (const conv of assigned) {
      const updated = await convRepo.update(conv.id, { assignedAgentId: undefined });
      if (updated) {
        unassigned++;
        SocketService.broadcastConversationUpdate(updated);
        SocketService.emitGlobal('conversation:assigned', { conversationId: conv.id, agentId: null });
        await recordEvent(conv.id, 'assignment', `${actor?.name || 'An admin'} unassigned this conversation (${target.name} was removed from the workspace)`, actor, { targetId: null });
      }
    }

    const ok = await userRepo.delete(id);
    if (!ok) return res.status(404).json({ error: 'Teammate not found' });
    SocketService.onlineAgents.delete(id);
    return res.json({ success: true, unassignedConversations: unassigned });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

const PROFILE_TEXT_FIELDS: Record<string, number> = {
  jobTitle: 80, department: 80, phone: 40, location: 100, bio: 280,
};

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const body = req.body || {};
  const { name } = body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.trim().length > 80) return res.status(400).json({ error: 'name is too long' });

  const updates: Partial<Agent> = { name: name.trim() };

  for (const [field, max] of Object.entries(PROFILE_TEXT_FIELDS)) {
    const v = body[field];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return res.status(400).json({ error: `${field} must be text` });
    const trimmed = (v || '').trim();
    if (trimmed.length > max) return res.status(400).json({ error: `${field} must be ${max} characters or fewer` });
    if (field === 'phone' && trimmed && !/^[+0-9()\-.\s]{3,40}$/.test(trimmed)) {
      return res.status(400).json({ error: 'phone may only contain digits, spaces and + ( ) - .' });
    }
    (updates as any)[field] = trimmed;
  }

  for (const field of ['calendarLink', 'avatar'] as const) {
    const v = body[field];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return res.status(400).json({ error: `${field} must be a URL` });
    const trimmed = (v || '').trim();
    if (trimmed && (!isHttpUrl(trimmed) || trimmed.length > 500)) {
      return res.status(400).json({ error: `${field} must be an http(s) URL` });
    }
    (updates as any)[field] = trimmed;
  }

  if (body.timezone !== undefined) {
    const tz = typeof body.timezone === 'string' ? body.timezone.trim() : body.timezone;
    if (tz !== '' && tz !== null && !isValidTimeZone(tz)) {
      return res.status(400).json({ error: 'timezone must be a valid IANA timezone' });
    }
    updates.timezone = tz || '';
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const updated = await userRepo.update(req.user.id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Profile picture ─────────────────────────────────────────────────────────

const AVATAR_TYPES: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_PREFIX = 'avatar-';
const PUBLIC_UPLOADS_URL = 'http://localhost:3000/uploads/';

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${AVATAR_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = AVATAR_TYPES[file.mimetype];
    if (!allowed || !allowed.includes(ext)) {
      return cb(new Error('Profile pictures must be PNG, JPEG, WebP or GIF images'));
    }
    cb(null, true);
  },
}).single('avatar');

/** Remove a previous avatar file — only files this endpoint created inside the uploads dir. */
function removeOldAvatar(url?: string) {
  if (!url || !url.startsWith(PUBLIC_UPLOADS_URL)) return;
  const name = url.slice(PUBLIC_UPLOADS_URL.length);
  if (!name.startsWith(AVATAR_PREFIX) || name !== path.basename(name)) return;
  const filePath = path.join(uploadDir, name);
  if (path.dirname(filePath) !== path.resolve(uploadDir)) return;
  fs.promises.unlink(filePath).catch(() => {});
}

export function uploadAvatar(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  avatarUpload(req as any, res as any, async (err: any) => {
    if (err) {
      const message = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? 'Profile pictures must be 2 MB or smaller' : err.message)
        : err.message;
      return res.status(400).json({ error: message });
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'Choose an image to upload (field "avatar")' });
    try {
      const userRepo = RepositoryFactory.getUserRepository();
      const before = await userRepo.findById(req.user!.id);
      const updated = await userRepo.update(req.user!.id, { avatar: `${PUBLIC_UPLOADS_URL}${file.filename}` });
      if (!updated) {
        fs.promises.unlink(file.path).catch(() => {});
        return res.status(404).json({ error: 'Agent not found' });
      }
      removeOldAvatar(before?.avatar);
      return res.json(updated);
    } catch (e: any) {
      fs.promises.unlink(file.path).catch(() => {});
      return res.status(500).json({ error: e.message });
    }
  });
}

export async function deleteAvatar(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const before = await userRepo.findById(req.user.id);
    const updated = await userRepo.update(req.user.id, { avatar: '' });
    if (!updated) return res.status(404).json({ error: 'Agent not found' });
    removeOldAvatar(before?.avatar);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** PUT /api/auth/profile/status { away } — Away mode for the signed-in teammate. */
export async function updateStatus(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const { away } = req.body || {};
  if (typeof away !== 'boolean') return res.status(400).json({ error: 'away must be true or false' });
  const updated = await RepositoryFactory.getUserRepository().update(req.user.id, { away });
  if (!updated) return res.status(404).json({ error: 'Teammate not found' });
  try { SocketService.getIO().emit('agent:status', { agentId: updated.id, away }); } catch { /* sockets not ready */ }
  return res.json(updated);
}
