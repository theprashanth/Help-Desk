import mongoose from 'mongoose';

/**
 * Your own user database (read-only): when a signed-in user opens the Messenger, the help desk looks them up
 * by their user id and takes their phone, name and email from your record, so the page only has to pass
 * the user id (and its user_hash). Configured on the server only, never in the dashboard:
 *
 *   USER_DIRECTORY_URI          mongodb+srv://readonly-user:pass@cluster/your-app-db   (a read-only user is best)
 *   USER_DIRECTORY_APP_ID       the help desk workspace (Messenger App ID) these users belong to
 *   USER_DIRECTORY_COLLECTION   default "users"
 *   USER_DIRECTORY_ID_FIELD     default "_id"       (the user id your page passes as user_id)
 *   USER_DIRECTORY_PHONE_FIELD  default "phone"     (dotted paths work: "profile.mobile")
 *   USER_DIRECTORY_NAME_FIELD   default "name"      (or "firstName lastName" to join two fields)
 *   USER_DIRECTORY_EMAIL_FIELD  default "email"
 *
 * Only identities verified with user_hash are looked up, so a user id typed into a browser can't pull
 * someone's phone number into a chat. Results are cached for 5 minutes.
 */

export type DirectoryUser = { phone?: string; name?: string; email?: string };

const cfg = () => ({
  uri: process.env.USER_DIRECTORY_URI || '',
  appId: process.env.USER_DIRECTORY_APP_ID || '',
  collection: process.env.USER_DIRECTORY_COLLECTION || 'users',
  idField: process.env.USER_DIRECTORY_ID_FIELD || '_id',
  phoneField: process.env.USER_DIRECTORY_PHONE_FIELD || 'phone',
  nameField: process.env.USER_DIRECTORY_NAME_FIELD || 'name',
  emailField: process.env.USER_DIRECTORY_EMAIL_FIELD || 'email',
});

/** Is a user directory set up for this workspace? */
export function directoryEnabledFor(appId?: string): boolean {
  const c = cfg();
  return !!c.uri && !!c.appId && c.appId === appId;
}

let conn: mongoose.Connection | null = null;
let connecting: Promise<mongoose.Connection> | null = null;
async function connection(): Promise<mongoose.Connection> {
  if (conn && conn.readyState === 1) return conn;
  if (!connecting) {
    connecting = mongoose.createConnection(cfg().uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 }).asPromise()
      .then(c => { conn = c; return c; })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

/** The value at a dotted path ("profile.mobile"); "firstName lastName" joins several fields with a space. */
export function readField(doc: any, spec: string): string | undefined {
  const one = (path: string) => path.split('.').reduce((v: any, k) => (v == null ? undefined : v[k]), doc);
  const parts = spec.split(/\s+/).filter(Boolean).map(one).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
  return parts.length ? parts.map(String).join(' ').trim() : undefined;
}

/** Ways the user id might be stored: as an ObjectId, a string, or a number. */
export function idCandidates(id: string): unknown[] {
  const out: unknown[] = [id];
  if (/^[0-9a-f]{24}$/i.test(id)) out.unshift(new mongoose.Types.ObjectId(id));
  if (/^\d{1,15}$/.test(id)) out.push(Number(id));
  return out;
}

const cache = new Map<string, { at: number; user: DirectoryUser | null }>();
const TTL = 5 * 60_000;

/** Look a user up in your database. null = not found, not configured, or the database couldn't be reached. */
export async function lookupUser(appId: string | undefined, userId: string): Promise<DirectoryUser | null> {
  if (!directoryEnabledFor(appId) || !userId) return null;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.user;
  const c = cfg();
  try {
    const db = await connection();
    const fields = [c.phoneField, c.emailField, ...c.nameField.split(/\s+/)].filter(Boolean);
    const projection = Object.fromEntries(fields.map(f => [f, 1]));
    const doc = await db.collection(c.collection).findOne({ [c.idField]: { $in: idCandidates(userId) } } as any, { projection });
    const user = doc ? { phone: readField(doc, c.phoneField), name: readField(doc, c.nameField), email: readField(doc, c.emailField) } : null;
    cache.set(userId, { at: Date.now(), user });
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return user;
  } catch (err: any) {
    console.warn(`[User directory] Lookup failed: ${err.message}`);
    return null; // the chat carries on with what the page sent
  }
}

/** For Settings › Security: what's configured (never the connection string). */
export function directoryStatus(appId?: string) {
  const c = cfg();
  if (!directoryEnabledFor(appId)) return { enabled: false };
  return { enabled: true, collection: c.collection, idField: c.idField, phoneField: c.phoneField, nameField: c.nameField, emailField: c.emailField };
}
