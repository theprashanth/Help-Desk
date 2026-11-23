import crypto from 'crypto';
import { RepositoryFactory } from '../repositories/factory';
import { Workspace } from '../../../shared/src/types';

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), like "x7k2m9pq"
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A short public App ID for the Messenger install code. Not a secret: it only says which workspace to load. */
export function generateAppId(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Give every workspace an App ID (older workspaces used their internal id, e.g. "default_workspace"). */
export async function ensureWorkspaceAppIds(): Promise<void> {
  const repo = RepositoryFactory.getWorkspaceRepository();
  const all = await repo.findAll();
  const taken = new Set(all.map(w => w.appId).filter(Boolean) as string[]);
  for (const ws of all) {
    if (ws.appId) continue;
    let appId = generateAppId();
    while (taken.has(appId)) appId = generateAppId();
    taken.add(appId);
    await repo.update(ws.id, { appId });
    console.log(`[Migration] Workspace "${ws.name}" got App ID ${appId}`);
  }
}

/** The App ID to show in Settings and install snippets. */
export const appIdOf = (ws: Workspace) => ws.appId || ws.id;
