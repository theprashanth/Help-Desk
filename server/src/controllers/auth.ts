import { uploadsUrl } from '../services/publicUrl';
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
import { logAudit } from '../services/audit';

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

    // Ensure settings exist for the agent, in their own workspace (nobody is signed in yet, so there's no
    // workspace on this request: the person's record says which one)
    const { tenantStorage } = await import('../context/tenant.context');
    await tenantStorage.run(result.agent.workspaceId || 'default_workspace', async () => {
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
    });

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
const ROLES: UserRole[] = ['admin', 'support_agent', 'light'];
const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', support_agent: 'Agent', light: 'Light (read-only)' };

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
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin', 'support_agent' or 'light'" });
  const hasPassword = password !== undefined && password !== null && password !== '';
  if (hasPassword && (typeof password !== 'string' || password.length < 8)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (hasPassword && password.length > 128) return res.status(400).json({ error: 'Password is too long' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const normalizedEmail = email.trim().toLowerCase();
    // Emails are unique across workspaces: signing in finds the person (and their workspace) by email
    if (await userRepo.emailInUse(normalizedEmail)) {
      return res.status(409).json({ error: 'Someone with this email already has an account' });
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
    await logAudit(req, 'teammate.added', `Added ${created.name} as ${ROLE_LABELS[role as UserRole]}`, { target: created.name, details: { email: created.email } });
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
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin', 'support_agent' or 'light'" });
    updates.role = role;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const target = await userRepo.findById(id);
    if (!target) return res.status(404).json({ error: 'Teammate not found' });
    if (target.role === 'admin' && updates.role && updates.role !== 'admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'You can’t remove admin access from the last admin' });
    }
    const updated = await userRepo.update(id, updates);
    if (!updated) return res.status(404).json({ error: 'Teammate not found' });
    if (updates.role && updates.role !== target.role) {
      await logAudit(req, 'teammate.role_changed', `Changed ${target.name}'s role from ${ROLE_LABELS[target.role]} to ${ROLE_LABELS[updates.role]}`, { target: target.name });
    }
    if (updates.name && updates.name !== target.name) await logAudit(req, 'teammate.renamed', `Renamed ${target.name} to ${updates.name}`, { target: updates.name });
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
    await logAudit(req, 'teammate.removed', `Removed ${target.name} from the workspace`, { target: target.name, details: { unassignedConversations: unassigned } });
    // Take them out of every team
    const { teamsRepo } = await import('../services/teams');
    for (const t of (await teamsRepo.list()).filter(t => t.memberIds.includes(id))) {
      await teamsRepo.update(t.id, { memberIds: t.memberIds.filter(m => m !== id) });
    }
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
  const at = url ? url.indexOf('/uploads/') : -1;
  if (!url || at < 0) return;
  const name = url.slice(at + '/uploads/'.length);
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
      const updated = await userRepo.update(req.user!.id, { avatar: `${uploadsUrl(req)}${file.filename}` });
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


/** PUT /api/auth/profile/mentions-seen — opening the Mentions view clears its unread count. */
export async function markMentionsSeen(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const updated = await RepositoryFactory.getUserRepository().update(req.user.id, { mentionsSeenAt: new Date().toISOString() });
  return updated ? res.json({ mentionsSeenAt: updated.mentionsSeenAt }) : res.status(404).json({ error: 'Teammate not found' });
}

// ── Create a workspace (sign-up) ────────────────────────────────────────────

const signupsByIp = new Map<string, number[]>();

/**
 * POST /api/auth/signup { companyName, name, email, password } — public. Creates a new, empty workspace
 * (its own App ID for the Messenger) with the person as its admin, and signs them in. Turn it off with
 * ALLOW_SIGNUP=false (e.g. a single-company install). At most 5 sign-ups per IP address per hour.
 */
export async function signup(req: AuthenticatedRequest, res: Response) {
  if (process.env.ALLOW_SIGNUP === 'false') return res.status(403).json({ error: 'New workspaces can’t be created on this server' });
  const { companyName, name, email, password } = req.body || {};
  const company = typeof companyName === 'string' ? companyName.trim() : '';
  const person = typeof name === 'string' ? name.trim() : '';
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!company || company.length > 80) return res.status(400).json({ error: 'Enter your company name (up to 80 characters)' });
  if (!person || person.length > 80) return res.status(400).json({ error: 'Enter your name' });
  if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 128) return res.status(400).json({ error: 'Password is too long' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (signupsByIp.get(ip) || []).filter(t => now - t < 3600_000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many sign-ups from this network. Try again in an hour.' });

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    if (await userRepo.emailInUse(mail)) return res.status(409).json({ error: 'This email already has an account. Sign in instead.' });

    const ws = await RepositoryFactory.getWorkspaceRepository().create({
      name: company,
      apiKey: `key_${crypto.randomBytes(18).toString('hex')}`,
      customerFacingName: company,
    } as any);
    const { tenantStorage } = await import('../context/tenant.context');
    await tenantStorage.run(ws.id, async () => {
      await userRepo.create({ email: mail, name: person, role: 'admin', status: 'offline', passwordPlain: password });
    });
    recent.push(now); signupsByIp.set(ip, recent);
    const result = await userRepo.verifyPassword(mail, password);
    if (!result) return res.status(500).json({ error: 'The workspace was created but signing in failed. Try signing in.' });
    await tenantStorage.run(ws.id, () => logAudit({ ...req, user: { id: result.agent.id, role: 'admin', workspaceId: ws.id } } as any,
      'workspace.created', `Created the workspace ${company}`));
    return res.status(201).json({ ...result, workspace: { id: ws.id, name: ws.name, appId: ws.appId } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
