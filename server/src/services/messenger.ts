import crypto from 'crypto';
import { RepositoryFactory } from '../repositories/factory';
import { MessengerAppearance, MessengerInstallation, Workspace } from '../../../shared/src/types';

export const DEFAULT_APPEARANCE: MessengerAppearance = {
  brandName: '',            // empty = use the workspace's customer-facing name
  themeColor: '#8B5CF6',
  greeting: 'We reply in a few minutes',
  welcome: 'Ask us anything, or share your feedback.',
  launcherPosition: 'right',
  showLauncher: true,
};

export const appearanceOf = (ws: Workspace | null): MessengerAppearance => ({ ...DEFAULT_APPEARANCE, ...(ws?.messenger || {}) });

/** Where the dashboard itself runs (its in-app preview must always be allowed to load the Messenger). */
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';
export const dashboardHost = () => { try { return new URL(DASHBOARD_URL).host; } catch { return 'localhost:5173'; } };

// ── Identity verification ───────────────────────────────────────────────────

export const newIdentitySecret = () => crypto.randomBytes(32).toString('hex');

/** The workspace's identity secret, created on first use. */
export async function ensureIdentitySecret(workspaceId: string): Promise<string> {
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(workspaceId);
  if (ws?.identitySecret) return ws.identitySecret;
  const secret = newIdentitySecret();
  await repo.update(workspaceId, { identitySecret: secret });
  return secret;
}

/** user_hash = HMAC-SHA256(user_id, secret) as hex — what your server computes for logged-in users. */
export const computeUserHash = (secret: string, userId: string) =>
  crypto.createHmac('sha256', secret).update(String(userId)).digest('hex');

export function verifyUserHash(secret: string | undefined, userId: string, userHash: unknown): boolean {
  if (!secret || typeof userHash !== 'string' || !/^[0-9a-f]{64}$/i.test(userHash)) return false;
  const expected = Buffer.from(computeUserHash(secret, userId), 'hex');
  const given = Buffer.from(userHash.toLowerCase(), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ── Allowed domains ─────────────────────────────────────────────────────────

/** Normalise "https://www.Shop.com/path" or "*.shop.com" into a host pattern. */
export function normaliseDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const wildcard = raw.startsWith('*.');
  let host = wildcard ? raw.slice(2) : raw;
  try { if (/^[a-z]+:\/\//.test(host)) host = new URL(host).host; } catch { return null; }
  host = host.replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host) || host.length > 253) return null;
  return wildcard ? `*.${host}` : host;
}

/** May the Messenger run on this host? Empty allow-list = anywhere. The dashboard is always allowed. */
export function hostAllowed(ws: Workspace | null, host: string | undefined): boolean {
  const list = ws?.allowedDomains || [];
  if (!list.length) return true;
  if (!host) return false;
  const h = host.toLowerCase();
  if (h === dashboardHost()) return true;
  const bare = h.replace(/:\d+$/, '');
  return list.some(d => {
    if (d.startsWith('*.')) { const base = d.slice(2).replace(/:\d+$/, ''); return bare === base || bare.endsWith('.' + base); }
    return d === h || d.replace(/:\d+$/, '') === bare && !d.includes(':');
  });
}

// ── Installations ───────────────────────────────────────────────────────────

const lastWrite = new Map<string, number>(); // throttle: one write per site per minute

/** Record that the Messenger loaded somewhere (called by the Messenger when it boots). */
export async function recordInstallation(workspaceId: string, info: {
  kind: 'website' | 'mobile'; host: string; platform?: string; url?: string; identified?: boolean; verified?: boolean;
}): Promise<void> {
  const key = `${workspaceId}|${info.kind}|${info.host}|${info.identified ? 1 : 0}${info.verified ? 1 : 0}`;
  const now = Date.now();
  const repo = RepositoryFactory.getWorkspaceRepository();
  const ws = await repo.findById(workspaceId);
  if (!ws) return;
  const list: MessengerInstallation[] = [...(ws.installations || [])];
  const i = list.findIndex(x => x.kind === info.kind && x.host === info.host);
  // Throttle refreshes of a known location; a new (or just-removed) one is always recorded
  if (i >= 0 && (lastWrite.get(key) || 0) > now - 60_000) return;
  lastWrite.set(key, now);
  const iso = new Date(now).toISOString();
  const base: MessengerInstallation = i >= 0 ? list[i] : {
    id: `inst_${crypto.randomBytes(6).toString('hex')}`, kind: info.kind, host: info.host, firstSeenAt: iso, lastSeenAt: iso,
  };
  const next: MessengerInstallation = {
    ...base,
    platform: info.platform || base.platform,
    lastSeenAt: iso,
    lastUrl: info.url ? info.url.slice(0, 500) : base.lastUrl,
    ...(info.identified ? { identifiedAt: iso } : {}),
    ...(info.verified ? { verifiedAt: iso } : {}),
  };
  if (i >= 0) list[i] = next; else list.unshift(next);
  await repo.update(workspaceId, { installations: list.slice(0, 50) });
}
