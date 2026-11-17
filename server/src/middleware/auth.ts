import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'admin' | 'support_agent';
    workspaceId: string;
  };
  workspaceId?: string;
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

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      workspaceId: payload.workspaceId
    };
    req.workspaceId = payload.workspaceId;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(roles: Array<'admin' | 'support_agent'>) {
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
  if (payload) {
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role as any,
      workspaceId: payload.workspaceId
    };
  }
  next();
}
