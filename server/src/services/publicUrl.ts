import { Request } from 'express';

/**
 * The server's own public address, for links to uploaded files (attachments, profile pictures) that
 * browsers and emails open. PUBLIC_API_URL wins (e.g. https://help.yourco.com); otherwise it's worked
 * out from the request (the address nginx forwards, thanks to `trust proxy`).
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
