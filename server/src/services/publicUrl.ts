import { Request } from 'express';

/**
 * The server's own public address, for links to uploaded files (attachments, profile pictures) that
 * browsers and emails open. PUBLIC_API_URL wins (e.g. https://help-desk-api.onrender.com); otherwise
 * it's worked out from the request (the host behind Render/Railway's proxy, thanks to `trust proxy`).
 */
export function publicApiUrl(req?: Request): string {
  const env = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  if (req) {
    const host = req.get('host');
    if (host) return `${req.protocol}://${host}`;
  }
  return 'http://localhost:3000';
}

export const uploadsUrl = (req?: Request) => `${publicApiUrl(req)}/uploads/`;
