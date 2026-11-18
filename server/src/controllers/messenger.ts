import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { MessengerAppearance, Workspace } from '../../../shared/src/types';
import {
  appearanceOf, ensureIdentitySecret, newIdentitySecret, verifyUserHash, normaliseDomain, hostAllowed, recordInstallation, dashboardHost,
} from '../services/messenger';

const wsIdOf = (req: AuthenticatedRequest) => req.workspaceId || req.user?.workspaceId || 'default_workspace';
const requireAdmin = (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Only admins can change Messenger settings' }); return false; }
  return true;
};

function settingsResponse(ws: Workspace) {
  return {
    appId: ws.id,
    appearance: appearanceOf(ws),
    identityVerification: { enforced: !!ws.identityEnforced, secretConfigured: !!ws.identitySecret },
    allowedDomains: ws.allowedDomains || [],
    installations: ws.installations || [],
  };
}

/** Public Messenger routes: the app id (X-Workspace-Id) must belong to a real workspace. */
export async function requireKnownWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.headers['x-workspace-id']) return next(); // dashboard / legacy default workspace
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Unknown app id' });
  next();
}

/** GET /api/messenger/settings — any teammate (the secret itself is never included). */
export async function getMessengerSettings(req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  return res.json(settingsResponse(ws));
}

/** PUT /api/messenger/settings — admins: { appearance?, enforced?, allowedDomains? } */
export async function updateMessengerSettings(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { appearance, enforced, allowedDomains } = req.body || {};
  const updates: Partial<Workspace> = {};

  if (appearance !== undefined) {
    if (typeof appearance !== 'object' || appearance === null) return res.status(400).json({ error: 'appearance must be an object' });
    const next: Partial<MessengerAppearance> = { ...(ws.messenger || {}) };
    const text = (k: 'brandName' | 'greeting' | 'welcome', max: number) => {
      if (appearance[k] === undefined) return null;
      if (typeof appearance[k] !== 'string' || appearance[k].length > max) return `${k} must be text of at most ${max} characters`;
      next[k] = appearance[k].trim();
      return null;
    };
    const err = text('brandName', 60) || text('greeting', 80) || text('welcome', 200);
    if (err) return res.status(400).json({ error: err });
    if (appearance.themeColor !== undefined) {
      if (typeof appearance.themeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(appearance.themeColor)) return res.status(400).json({ error: 'themeColor must be a hex color like #8B5CF6' });
      next.themeColor = appearance.themeColor;
    }
    if (appearance.launcherPosition !== undefined) {
      if (!['left', 'right'].includes(appearance.launcherPosition)) return res.status(400).json({ error: 'launcherPosition must be left or right' });
      next.launcherPosition = appearance.launcherPosition;
    }
    if (appearance.showLauncher !== undefined) {
      if (typeof appearance.showLauncher !== 'boolean') return res.status(400).json({ error: 'showLauncher must be true or false' });
      next.showLauncher = appearance.showLauncher;
    }
    updates.messenger = next;
  }
  if (enforced !== undefined) {
    if (typeof enforced !== 'boolean') return res.status(400).json({ error: 'enforced must be true or false' });
    if (enforced) await ensureIdentitySecret(ws.id);
    updates.identityEnforced = enforced;
  }
  if (allowedDomains !== undefined) {
    if (!Array.isArray(allowedDomains) || allowedDomains.length > 50) return res.status(400).json({ error: 'allowedDomains must be a list of at most 50 domains' });
    const cleaned: string[] = [];
    for (const d of allowedDomains) {
      const n = typeof d === 'string' ? normaliseDomain(d) : null;
      if (!n) return res.status(400).json({ error: `Not a valid domain: ${String(d)}` });
      if (!cleaned.includes(n)) cleaned.push(n);
    }
    updates.allowedDomains = cleaned;
  }
  const updated = await repo.update(ws.id, updates);
  return res.json(settingsResponse(updated || ws));
}

/** GET /api/messenger/identity-secret — admins: reveal (created on first use). */
export async function getIdentitySecret(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  return res.json({ secret: await ensureIdentitySecret(wsIdOf(req)) });
}

/** POST /api/messenger/identity-secret/rotate — admins: replace it (old user_hash values stop working). */
export async function rotateIdentitySecret(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const secret = newIdentitySecret();
  await RepositoryFactory.getWorkspaceRepository().update(wsIdOf(req), { identitySecret: secret });
  return res.json({ secret });
}

/** DELETE /api/messenger/installations/:id — admins: forget a location (it reappears if the Messenger loads there again). */
export async function removeInstallation(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const list = (ws.installations || []).filter(i => i.id !== req.params.id);
  const updated = await repo.update(ws.id, { installations: list });
  return res.json(settingsResponse(updated || ws));
}

/**
 * POST /api/messenger/ping — public, sent by the Messenger when it boots on a site or app.
 * Body: { host, url?, kind: 'website'|'mobile', platform?, userId?, userHash? }
 * Returns whether it may run there and how the identity checked out.
 */
export async function messengerPing(req: AuthenticatedRequest, res: Response) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsIdOf(req));
  if (!ws) return res.status(404).json({ error: 'Unknown app id' });
  const { host, url, kind, platform, userId, userHash } = req.body || {};
  const h = typeof host === 'string' ? host.trim().toLowerCase().slice(0, 253) : '';
  if (!h) return res.status(400).json({ error: 'host is required' });
  if (!hostAllowed(ws, h)) return res.json({ allowed: false });

  let identity: 'none' | 'verified' | 'unverified' | 'rejected' = 'none';
  if (typeof userId === 'string' && userId.trim()) {
    if (verifyUserHash(ws.identitySecret, userId.trim(), userHash)) identity = 'verified';
    else identity = ws.identityEnforced ? 'rejected' : 'unverified';
  }
  // The dashboard's own preview/demo isn't a customer installation
  if (h !== dashboardHost()) await recordInstallation(ws.id, {
    kind: kind === 'mobile' ? 'mobile' : 'website',
    host: h,
    platform: typeof platform === 'string' ? platform.slice(0, 30) : undefined,
    url: typeof url === 'string' ? url : undefined,
    identified: identity === 'verified' || identity === 'unverified',
    verified: identity === 'verified',
  });
  return res.json({ allowed: true, identity, enforced: !!ws.identityEnforced });
}
