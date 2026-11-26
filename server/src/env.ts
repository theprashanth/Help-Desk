import dotenv from 'dotenv';

/**
 * Loads server/.env before any other module runs. It must be the first import in index.ts: modules
 * read settings such as JWT_SECRET when they load, and imports run before the code below them.
 */
dotenv.config();

const DEV_SECRET = 'supersecretkey';

/** The secret that signs teammates' login tokens. Production refuses to start without a real one (index.ts). */
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET || '';
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set');
  return DEV_SECRET; // local development only
}
