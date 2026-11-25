import crypto from 'crypto';
import { RecordRepository } from '../repositories/records';
import { RepositoryFactory } from '../repositories/factory';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { appearanceOf } from './messenger';
import { aiFor, askJson } from './aiAssist';
import { MESSENGER_STRINGS, MessengerStrings } from '../../../shared/src/messengerStrings';

/**
 * Settings › Multilingual: the Messenger in each visitor's browser language. The fixed Messenger text
 * (shared/messengerStrings) plus the workspace's greeting and welcome text are translated once per
 * language with the AI provider and cached; a change to any of them makes a new version. Only this
 * known text is ever translated, and at most MAX_LANGUAGES languages per workspace.
 */
type Cached = { id: string; lang: string; hash: string; strings: MessengerStrings; createdAt?: string };
const cache = new RecordRepository<Cached>('messenger_i18n', 'i18n');
const inflight = new Map<string, Promise<MessengerStrings | null>>();
const MAX_LANGUAGES = 40;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;

/** "pt-BR" → "pt-br"; "en-GB" → null (English needs no translation); junk → null. */
export function normaliseLang(raw: unknown): string | null {
  const l = String(raw || '').trim().toLowerCase().replace('_', '-');
  if (!LANG_RE.test(l)) return null;
  const base = l.split('-')[0];
  if (base === 'en') return null;
  // Region only matters for a few languages
  return ['pt', 'zh'].includes(base) ? l : base;
}

const languageName = (lang: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang; } catch { return lang; }
};

export async function messengerStringsFor(lang: string): Promise<MessengerStrings | null> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  const look = appearanceOf(ws);
  if (!look.autoLanguage) return null;
  const source: Record<string, string> = { ...MESSENGER_STRINGS, welcome: look.welcome || '', greeting: look.greeting || '' };
  const hash = crypto.createHash('sha1').update(JSON.stringify(source)).digest('hex').slice(0, 16);
  const all = await cache.list();
  const hit = all.find(c => c.lang === lang && c.hash === hash);
  if (hit) return hit.strings;
  const key = `${getActiveWorkspaceId()}:${lang}:${hash}`;
  if (inflight.has(key)) return inflight.get(key)!;
  const job = (async () => {
    if (new Set(all.map(c => c.lang)).size >= MAX_LANGUAGES && !all.some(c => c.lang === lang)) return null;
    const setup = await aiFor();
    if (!setup) return null;
    const out = await askJson<Record<string, unknown>>(setup.ai,
      `Translate the values of a JSON object of user-interface text for a customer support chat widget into ${languageName(lang)} (${lang}). ` +
      'Keep every key unchanged. Keep placeholders in curly braces like {name} exactly as they are. Keep emojis, punctuation style and the brand name. ' +
      'Use natural, friendly wording a native speaker would expect in an app.',
      JSON.stringify(source));
    // Anything missing, empty, or with lost placeholders stays in English
    const strings: Record<string, string> = {};
    for (const [k, en] of Object.entries(source)) {
      const v = out[k];
      const holders = en.match(/\{\w+\}/g) || [];
      strings[k] = typeof v === 'string' && v.trim() && holders.every(h => v.includes(h)) ? v.trim() : en;
    }
    for (const old of all.filter(c => c.lang === lang)) await cache.delete(old.id);
    await cache.create({ lang, hash, strings: strings as MessengerStrings });
    return strings as MessengerStrings;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
