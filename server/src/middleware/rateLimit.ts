import { Request, Response, NextFunction } from 'express';

/**
 * Small in-memory rate limiter (per server process): at most `max` requests per `windowMs` for each key
 * (by default the client's IP; real IPs come through `trust proxy`). Enough to stop password guessing
 * and floods of public requests; a busy multi-instance deployment would move this to Redis.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string; message?: string }) {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter(t => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, Math.min(opts.windowMs, 60_000)).unref?.();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (opts.key ? opts.key(req) : req.ip) || 'unknown';
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => t > now - opts.windowMs);
    if (list.length >= opts.max) {
      res.setHeader('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      return res.status(429).json({ error: opts.message || 'Too many requests. Please wait a moment and try again.' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}
