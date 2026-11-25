import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../../../shared/src/types';
import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage } from '../context/tenant.context';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    workspaceId: string;
  };
  workspaceId?: string;
}

/**
 * The teammate's current role, read from their record (a role change or removal applies right
 * away, not at their next login). null = the teammate no longer exists.
 */
async function currentRole(payload: { id: string; role: UserRole; workspaceId: string }): Promise<UserRole | null> {
  try {
    const me = await tenantStorage.run(payload.workspaceId || 'default_workspace', () => RepositoryFactory.getUserRepository().findById(payload.id));
    return me ? me.role : null;
  } catch {
    return payload.role; // storage hiccup: fall back to the token
  }
}

export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header is missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token missing from bearer header' });
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET) as any;
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
  currentRole(payload).then(role => {
    if (!role) return res.status(401).json({ error: 'Your account was removed from this workspace' });
    req.user = { id: payload.id, email: payload.email, role, workspaceId: payload.workspaceId };
    req.workspaceId = payload.workspaceId;
    // Everything after this runs in the teammate's own workspace (resolveTenant ran before the login was known)
    tenantStorage.run(payload.workspaceId || 'default_workspace', () => next());
  });
}

export function requireRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
}

/** Verify a JWT and return its payload, or null if it's missing/invalid. */
export function verifyAgentToken(token?: string | null): { id: string; email: string; role: string; workspaceId: string } | null {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

/** Like authenticateJWT, but lets unauthenticated requests (e.g. the customer widget) through without req.user. */
export function optionalJWT(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  const payload = verifyAgentToken(token);
  if (!payload) return next();
  currentRole(payload as any).then(role => {
    if (!role) return next();
    req.user = { id: payload.id, email: payload.email, role, workspaceId: payload.workspaceId };
    req.workspaceId = payload.workspaceId;
    tenantStorage.run(payload.workspaceId || 'default_workspace', () => next());
  });
}

/** Light seats are read-only (internal notes only): block anything that changes conversations or data. */
export function requireFullSeat(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'light') return res.status(403).json({ error: 'Your Light seat is read-only. Ask an admin for a full seat to do this.', code: 'light_seat' });
  next();
}

/** Admins only (workspace settings, teammates, teams, data, audit log). */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do this', code: 'admin_only' });
  next();
}
