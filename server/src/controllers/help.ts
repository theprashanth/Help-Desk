import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { RecordRepository } from '../repositories/records';
import { logAudit } from '../services/audit';
import { HelpArticle, HelpCollection } from '../../../shared/src/types';

/**
 * Knowledge base: collections and articles (Settings › Knowledge base). Published articles are
 * searchable in the Messenger, suggested while a customer writes, and given to Ask AI as context.
 */
export const collectionsRepo = new RecordRepository<HelpCollection>('help_collections', 'hcol');
export const articlesRepo = new RecordRepository<HelpArticle>('help_articles', 'art');

// ── Search ────────────────────────────────────────────────────────────────

const STOP = new Set('a an and are as at be but by can do does for from how i if in into is it its me my no not of on or our so that the their them then there these this to was we what when where which who why will with you your'.split(' '));
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1 && !STOP.has(t));
const stem = (t: string) => t.replace(/(ing|ed|es|s)$/, '');

/** Rank published articles for a query: title matches count most, then body; phrase match bonus. */
export function rankArticles(articles: HelpArticle[], query: string, limit = 8): { article: HelpArticle; score: number }[] {
  const q = tokens(query).map(stem);
  if (!q.length) return [];
  const phrase = query.trim().toLowerCase();
  return articles
    .filter(a => a.state === 'published')
    .map(a => {
      const title = tokens(a.title).map(stem);
      const body = tokens(a.body).map(stem);
      let score = 0;
      for (const t of new Set(q)) {
        const inTitle = title.filter(x => x === t || (t.length > 3 && x.startsWith(t))).length;
        const inBody = body.filter(x => x === t).length;
        if (inTitle) score += 6 + inTitle;
        if (inBody) score += Math.min(6, 1 + Math.log2(1 + inBody));
      }
      const matched = new Set(q.filter(t => title.includes(t) || body.includes(t))).size;
      score *= matched / new Set(q).size; // reward covering more of the question
      if (phrase.length > 4 && (a.title.toLowerCase().includes(phrase) || a.body.toLowerCase().includes(phrase))) score += 5;
      return { article: a, score };
    })
    .filter(r => r.score > 1.5)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

const strip = (md: string) => md.replace(/[#*_`>\[\]]/g, '').replace(/\((https?:\/\/[^)]+)\)/g, '').replace(/\s+/g, ' ').trim();
const snippetOf = (a: HelpArticle, query: string) => {
  const text = strip(a.body);
  const t = tokens(query)[0];
  const i = t ? text.toLowerCase().indexOf(t) : -1;
  const start = i > 60 ? i - 60 : 0;
  return (start ? '…' : '') + text.slice(start, start + 180) + (text.length > start + 180 ? '…' : '');
};
const summary = (a: HelpArticle, query = '') => ({
  id: a.id, title: a.title, collectionId: a.collectionId || null, snippet: query ? snippetOf(a, query) : strip(a.body).slice(0, 160),
  updatedAt: a.updatedAt,
});

/** Best articles for some text (Ask AI context, Messenger suggestions). */
export async function relevantArticles(text: string, limit = 3): Promise<HelpArticle[]> {
  return rankArticles(await articlesRepo.list(), text, limit).map(r => r.article);
}

// ── Teammates: manage ─────────────────────────────────────────────────────

export async function listHelpAdmin(_req: AuthenticatedRequest, res: Response) {
  try {
    const [collections, articles] = await Promise.all([collectionsRepo.list(), articlesRepo.list()]);
    return res.json({
      collections: collections.sort((a, b) => a.order - b.order),
      articles: articles.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

function cleanCollection(b: any, cur?: HelpCollection) {
  const name = b.name !== undefined ? String(b.name).trim() : cur?.name;
  if (!name) return { error: 'Collection name is required' };
  if (name.length > 80) return { error: 'Collection name is too long' };
  return {
    value: {
      name,
      description: b.description !== undefined ? String(b.description || '').trim().slice(0, 300) || undefined : cur?.description,
      emoji: b.emoji !== undefined ? String(b.emoji || '').trim().slice(0, 8) || undefined : cur?.emoji,
      order: b.order !== undefined && Number.isFinite(Number(b.order)) ? Number(b.order) : cur?.order ?? Date.now(),
    },
  };
}

export async function createCollection(req: AuthenticatedRequest, res: Response) {
  const { value, error } = cleanCollection(req.body || {});
  if (error || !value) return res.status(400).json({ error });
  return res.status(201).json(await collectionsRepo.create(value));
}

export async function updateCollection(req: AuthenticatedRequest, res: Response) {
  const cur = await collectionsRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Collection not found' });
  const { value, error } = cleanCollection(req.body || {}, cur);
  if (error || !value) return res.status(400).json({ error });
  return res.json(await collectionsRepo.update(cur.id, value));
}

export async function deleteCollection(req: AuthenticatedRequest, res: Response) {
  const cur = await collectionsRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Collection not found' });
  // Its articles stay, without a collection
  for (const a of (await articlesRepo.list()).filter(a => a.collectionId === cur.id)) await articlesRepo.update(a.id, { collectionId: undefined });
  await collectionsRepo.delete(cur.id);
  await logAudit(req, 'help.collection_deleted', `Deleted the help collection ${cur.name}`, { target: cur.name });
  return res.json({ success: true });
}

async function cleanArticle(b: any, cur?: HelpArticle) {
  const title = b.title !== undefined ? String(b.title).trim() : cur?.title;
  if (!title) return { error: 'Article title is required' };
  if (title.length > 200) return { error: 'Title is too long' };
  const body = b.body !== undefined ? String(b.body) : cur?.body || '';
  if (body.length > 100_000) return { error: 'The article is too long' };
  let collectionId = b.collectionId !== undefined ? (b.collectionId || undefined) : cur?.collectionId;
  if (collectionId && !(await collectionsRepo.get(collectionId))) return { error: 'That collection no longer exists' };
  const state = b.state !== undefined ? b.state : cur?.state || 'draft';
  if (!['draft', 'published'].includes(state)) return { error: 'state must be draft or published' };
  if (state === 'published' && !body.trim()) return { error: 'Write something before publishing' };
  return { value: { title, body, collectionId, state } as Pick<HelpArticle, 'title' | 'body' | 'collectionId' | 'state'> };
}

export async function createArticle(req: AuthenticatedRequest, res: Response) {
  const { value, error } = await cleanArticle(req.body || {});
  if (error || !value) return res.status(400).json({ error });
  const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
  const art = await articlesRepo.create({
    ...value, authorId: req.user?.id, authorName: me?.name, views: 0, helpful: 0, notHelpful: 0,
    ...(value.state === 'published' ? { publishedAt: new Date().toISOString() } : {}),
  });
  return res.status(201).json(art);
}

export async function updateArticle(req: AuthenticatedRequest, res: Response) {
  const cur = await articlesRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Article not found' });
  const { value, error } = await cleanArticle(req.body || {}, cur);
  if (error || !value) return res.status(400).json({ error });
  const publishing = value.state === 'published' && cur.state !== 'published';
  return res.json(await articlesRepo.update(cur.id, { ...value, ...(publishing ? { publishedAt: new Date().toISOString() } : {}) }));
}

export async function deleteArticle(req: AuthenticatedRequest, res: Response) {
  const cur = await articlesRepo.get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Article not found' });
  await articlesRepo.delete(cur.id);
  await logAudit(req, 'help.article_deleted', `Deleted the article “${cur.title}”`, { target: cur.title });
  return res.json({ success: true });
}

/** Teammates: search published articles (to share a link or answer from it). */
export async function searchHelpAdmin(req: AuthenticatedRequest, res: Response) {
  const q = String(req.query.q || '');
  return res.json(rankArticles(await articlesRepo.list(), q, 10).map(r => summary(r.article, q)));
}

// ── Messenger (public) ────────────────────────────────────────────────────

export async function helpHome(_req: AuthenticatedRequest, res: Response) {
  const [collections, articles] = await Promise.all([collectionsRepo.list(), articlesRepo.list()]);
  const live = articles.filter(a => a.state === 'published');
  return res.json({
    collections: collections.sort((a, b) => a.order - b.order)
      .map(c => ({ id: c.id, name: c.name, description: c.description, emoji: c.emoji, count: live.filter(a => a.collectionId === c.id).length }))
      .filter(c => c.count > 0),
    popular: [...live].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).map(a => summary(a)),
    total: live.length,
  });
}

export async function helpCollection(req: AuthenticatedRequest, res: Response) {
  const c = await collectionsRepo.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const list = (await articlesRepo.list()).filter(a => a.state === 'published' && a.collectionId === c.id)
    .sort((a, b) => a.title.localeCompare(b.title));
  return res.json({ id: c.id, name: c.name, description: c.description, emoji: c.emoji, articles: list.map(a => summary(a)) });
}

export async function helpSearch(req: AuthenticatedRequest, res: Response) {
  const q = String(req.query.q || '').slice(0, 300);
  return res.json(rankArticles(await articlesRepo.list(), q, Number(req.query.limit) > 0 ? Math.min(10, Number(req.query.limit)) : 8).map(r => summary(r.article, q)));
}

export async function helpArticle(req: AuthenticatedRequest, res: Response) {
  const a = await articlesRepo.get(req.params.id);
  if (!a || a.state !== 'published') return res.status(404).json({ error: 'Article not found' });
  await articlesRepo.update(a.id, { views: (a.views || 0) + 1 });
  const c = a.collectionId ? await collectionsRepo.get(a.collectionId) : null;
  return res.json({ id: a.id, title: a.title, body: a.body, updatedAt: a.updatedAt, authorName: a.authorName, collection: c ? { id: c.id, name: c.name } : null });
}

export async function helpFeedback(req: AuthenticatedRequest, res: Response) {
  const a = await articlesRepo.get(req.params.id);
  if (!a || a.state !== 'published') return res.status(404).json({ error: 'Article not found' });
  const helpful = req.body?.helpful === true;
  await articlesRepo.update(a.id, helpful ? { helpful: (a.helpful || 0) + 1 } : { notHelpful: (a.notHelpful || 0) + 1 });
  return res.json({ ok: true });
}

/**
 * POST /api/help/import { files: [{ name, content }], publish? } — CSV or Markdown files (see services/contentImport).
 * Missing collections are created by name; an article with the same title is updated instead of duplicated.
 */
export async function importArticles(req: AuthenticatedRequest, res: Response) {
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 200) : [];
  if (!files.length) return res.status(400).json({ error: 'Choose one or more .csv, .md or .txt files' });
  const publishByDefault = req.body?.publish !== false;
  try {
    const { readArticleFiles } = await import('../services/contentImport');
    const rows = readArticleFiles(files).slice(0, 1000);
    const me = req.user ? await RepositoryFactory.getUserRepository().findById(req.user.id) : null;
    const collections = await collectionsRepo.list();
    const byName = new Map(collections.map(c => [c.name.toLowerCase(), c.id]));
    const articles = await articlesRepo.list();
    const byTitle = new Map(articles.map(a => [a.title.trim().toLowerCase(), a]));
    let created = 0, updated = 0, collectionsCreated = 0;
    const skipped: { source: string; reason: string }[] = [];
    for (const r of rows) {
      if (!r.title.trim()) { skipped.push({ source: r.source, reason: 'No title' }); continue; }
      let collectionId: string | undefined;
      if (r.collection?.trim()) {
        const key = r.collection.trim().toLowerCase();
        if (!byName.has(key)) {
          const c = cleanCollection({ name: r.collection.trim() });
          if (c.value) { const made = await collectionsRepo.create(c.value); byName.set(key, made.id); collectionsCreated++; }
        }
        collectionId = byName.get(key);
      }
      const state = r.state || (publishByDefault && r.body.trim() ? 'published' : 'draft');
      const existing = byTitle.get(r.title.trim().toLowerCase());
      const { value, error } = await cleanArticle({ title: r.title, body: r.body, collectionId: collectionId ?? existing?.collectionId, state }, existing);
      if (error || !value) { skipped.push({ source: r.source, reason: error || 'Invalid' }); continue; }
      if (existing) {
        const publishing = value.state === 'published' && existing.state !== 'published';
        const saved = await articlesRepo.update(existing.id, { ...value, ...(publishing ? { publishedAt: new Date().toISOString() } : {}) });
        if (saved) byTitle.set(saved.title.trim().toLowerCase(), saved);
        updated++;
      } else {
        const made = await articlesRepo.create({
          ...value, authorId: req.user?.id, authorName: me?.name, views: 0, helpful: 0, notHelpful: 0,
          ...(value.state === 'published' ? { publishedAt: new Date().toISOString() } : {}),
        });
        byTitle.set(made.title.trim().toLowerCase(), made);
        created++;
      }
    }
    await logAudit(req, 'help.imported', `Imported ${created + updated} article${created + updated === 1 ? '' : 's'} (${created} new, ${updated} updated)`);
    return res.json({ created, updated, collectionsCreated, skipped: skipped.slice(0, 50), skippedCount: skipped.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
