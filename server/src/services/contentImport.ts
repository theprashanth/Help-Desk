import { parseCsvObjects } from './csv';

/**
 * Reading knowledge-base articles and macros from files people upload:
 *  - articles: CSV (title, body/answer, collection, state) or Markdown/text files
 *    (title from front matter, the first "# " heading, or the file name);
 *  - macros: CSV (shortcut, title, message).
 * Header names are matched loosely ("Answer", "Content" and "Body" all work).
 */

export type ArticleRow = { title: string; body: string; collection?: string; state?: 'draft' | 'published'; source: string };
export type MacroRow = { trigger: string; title: string; content: string; source: string };

const pick = (row: Record<string, string>, names: string[]) => {
  for (const [k, v] of Object.entries(row)) if (names.includes(k.trim().toLowerCase())) return v;
  return '';
};
const stateOf = (v: string): ArticleRow['state'] =>
  /^(draft|unpublished|no|false|0)$/i.test(v.trim()) ? 'draft' : /^(published|live|yes|true|1)$/i.test(v.trim()) ? 'published' : undefined;

function fromCsv(name: string, text: string): ArticleRow[] {
  return parseCsvObjects(text).rows.map((r, i) => ({
    title: pick(r, ['title', 'name', 'question', 'article', 'article title']),
    body: pick(r, ['body', 'answer', 'content', 'text', 'article body', 'description']),
    collection: pick(r, ['collection', 'category', 'section', 'folder']) || undefined,
    state: stateOf(pick(r, ['state', 'status', 'published'])),
    source: `${name} row ${i + 2}`,
  }));
}

function fromMarkdown(name: string, text: string): ArticleRow {
  let rest = text.replace(/\r\n/g, '\n');
  const meta: Record<string, string> = {};
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(rest);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-z_ ]+):\s*(.*)$/.exec(line);
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    rest = rest.slice(fm[0].length);
  }
  let title = meta.title || '';
  if (!title) {
    const h = /^\s*#\s+(.+)\n?/.exec(rest);
    if (h) { title = h[1].trim(); rest = rest.slice(h.index + h[0].length); }
  }
  if (!title) {
    const t = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    title = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return {
    title, body: rest.trim(),
    collection: meta.collection || meta.category || undefined,
    state: meta.state || meta.status ? stateOf(meta.state || meta.status) : undefined,
    source: name,
  };
}

export function readArticleFiles(files: { name: string; content: string }[]): ArticleRow[] {
  const out: ArticleRow[] = [];
  for (const f of files) {
    const name = String(f.name || 'file');
    const text = String(f.content || '');
    if (/\.csv$/i.test(name)) out.push(...fromCsv(name, text));
    else out.push(fromMarkdown(name, text));
  }
  return out;
}

export function readMacroCsv(name: string, text: string): MacroRow[] {
  return parseCsvObjects(text).rows.map((r, i) => {
    const title = pick(r, ['title', 'name', 'macro', 'macro name']);
    let trigger = pick(r, ['shortcut', 'trigger', 'command', 'slash', 'keyword']) || title;
    trigger = '/' + trigger.trim().toLowerCase().replace(/^\/+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return { trigger, title: title || trigger.slice(1), content: pick(r, ['content', 'message', 'text', 'body', 'reply', 'answer']), source: `${name} row ${i + 2}` };
  });
}
