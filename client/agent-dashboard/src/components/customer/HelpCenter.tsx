import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight, ThumbsUp, ThumbsDown, BookOpen, X } from 'lucide-react';
import { RichText } from '../../lib/richText';

/**
 * Messenger help center: search the knowledge base, browse collections, read an article and say
 * whether it helped. Also the "These articles might help" strip shown while writing a first message.
 */

type Api = (path: string, init?: RequestInit) => Promise<Response>;
export type ArticleSummary = { id: string; title: string; snippet: string; collectionId: string | null };
type Home = { collections: { id: string; name: string; description?: string; emoji?: string; count: number }[]; popular: ArticleSummary[]; total: number };
type Article = { id: string; title: string; body: string; updatedAt: string; authorName?: string; collection: { id: string; name: string } | null };

export type HelpView = { kind: 'home'; query?: string } | { kind: 'collection'; id: string } | { kind: 'article'; id: string };

function useHelpHome(api: Api) {
  const [home, setHome] = useState<Home | null>(null);
  useEffect(() => {
    api('/api/help/home').then(r => (r.ok ? r.json() : null)).then(setHome).catch(() => {});
  }, [api]);
  return home;
}

/** Search box + a few popular articles, for the Messenger home screen (hidden when there are no articles). */
export const HelpHomeCard: React.FC<{ api: Api; themeColor: string; onOpen: (v: HelpView) => void }> = ({ api, themeColor, onOpen }) => {
  const home = useHelpHome(api);
  const [q, setQ] = useState('');
  if (!home || !home.total) return null;
  return (
    <div className="flex flex-col gap-2.5 text-left rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <form onSubmit={e => { e.preventDefault(); onOpen({ kind: 'home', query: q }); }}
        className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 h-10">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for help" aria-label="Search for help"
          className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none" />
        <button type="submit" aria-label="Search" style={{ color: themeColor }}><Search className="w-4 h-4" /></button>
      </form>
      {home.popular.slice(0, 3).map(a => (
        <button key={a.id} onClick={() => onOpen({ kind: 'article', id: a.id })} className="flex items-center gap-2 px-1 py-1 text-sm text-slate-700 dark:text-slate-200 hover:underline text-left">
          <span className="flex-1 min-w-0 truncate">{a.title}</span><ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      ))}
    </div>
  );
};

/** The full help screen inside the Messenger (search, collections, articles). */
export const HelpCenter: React.FC<{
  api: Api; themeColor: string; view: HelpView; onNavigate: (v: HelpView) => void; onAskTeam: () => void;
}> = ({ api, themeColor, view, onNavigate, onAskTeam }) => {
  const home = useHelpHome(api);
  const [q, setQ] = useState(view.kind === 'home' ? view.query || '' : '');
  const [results, setResults] = useState<ArticleSummary[] | null>(null);
  const [collection, setCollection] = useState<{ name: string; description?: string; articles: ArticleSummary[] } | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (view.kind !== 'home') return;
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const t = setTimeout(() => {
      api(`/api/help/search?q=${encodeURIComponent(term)}`).then(r => (r.ok ? r.json() : [])).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, view.kind, api]);

  useEffect(() => {
    setMissing(false);
    if (view.kind === 'collection') {
      setCollection(null);
      api(`/api/help/collections/${view.id}`).then(r => (r.ok ? r.json() : null)).then(d => (d ? setCollection(d) : setMissing(true))).catch(() => setMissing(true));
    } else if (view.kind === 'article') {
      setArticle(null); setVoted(null);
      api(`/api/help/articles/${view.id}`).then(r => (r.ok ? r.json() : null)).then(d => (d ? setArticle(d) : setMissing(true))).catch(() => setMissing(true));
    }
  }, [view, api]);

  const vote = (helpful: boolean) => {
    if (!article || voted !== null) return;
    setVoted(helpful);
    api(`/api/help/articles/${article.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ helpful }) }).catch(() => {});
  };

  const row = (a: ArticleSummary) => (
    <button key={a.id} onClick={() => onNavigate({ kind: 'article', id: a.id })} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{a.title}</span>
        {a.snippet && <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{a.snippet}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
    </button>
  );
  const card = 'rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800';
  const askTeam = (
    <button onClick={onAskTeam} className="w-full text-white font-semibold py-2.5 px-4 rounded-xl text-sm active:scale-[0.98] transition-all" style={{ background: themeColor }}>
      Still need help? Message us
    </button>
  );

  if (missing) return <div className="p-6 text-center text-sm text-slate-500">This article isn’t available any more.<div className="mt-4">{askTeam}</div></div>;

  if (view.kind === 'article') {
    if (!article) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
    return (
      <div className="p-5 flex flex-col gap-4">
        {article.collection && (
          <button onClick={() => onNavigate({ kind: 'collection', id: article.collection!.id })} className="self-start text-xs font-semibold hover:underline" style={{ color: themeColor }}>
            {article.collection.name}
          </button>
        )}
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 leading-snug">{article.title}</h2>
        <p className="text-xs text-slate-400 -mt-2">{article.authorName ? `By ${article.authorName} · ` : ''}Updated {new Date(article.updatedAt).toLocaleDateString()}</p>
        <RichText className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed" text={article.body} linkClass="underline" />
        <div className="mt-2 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
          {voted === null ? (
            <>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Did this answer your question?</p>
              <div className="flex justify-center gap-2">
                <button onClick={() => vote(true)} className="h-9 px-4 rounded-full bg-white dark:bg-slate-900 text-sm flex items-center gap-1.5 border border-slate-200 dark:border-slate-700"><ThumbsUp className="w-4 h-4" /> Yes</button>
                <button onClick={() => vote(false)} className="h-9 px-4 rounded-full bg-white dark:bg-slate-900 text-sm flex items-center gap-1.5 border border-slate-200 dark:border-slate-700"><ThumbsDown className="w-4 h-4" /> No</button>
              </div>
            </>
          ) : voted ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">Thanks! Glad it helped.</p>
          ) : (
            <div className="flex flex-col gap-3"><p className="text-sm text-slate-600 dark:text-slate-300">Sorry about that. Our team can help.</p>{askTeam}</div>
          )}
        </div>
      </div>
    );
  }

  if (view.kind === 'collection') {
    if (!collection) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="px-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{collection.name}</h2>
          {collection.description && <p className="text-xs text-slate-500 mt-0.5">{collection.description}</p>}
        </div>
        <div className={card}>{collection.articles.map(row)}</div>
      </div>
    );
  }

  // Home: search + collections
  return (
    <div className="p-4 flex flex-col gap-4">
      <label className="flex items-center gap-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 h-11">
        <Search className="w-4 h-4 text-slate-400" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search for help" aria-label="Search for help"
          className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none" />
        {q && <button onClick={() => setQ('')} aria-label="Clear"><X className="w-4 h-4 text-slate-400" /></button>}
      </label>
      {results ? (
        results.length ? <div className={card}>{results.map(row)}</div> : (
          <div className="text-center py-4 flex flex-col gap-3">
            <p className="text-sm text-slate-500">No articles match “{q}”.</p>{askTeam}
          </div>
        )
      ) : !home ? <p className="text-sm text-slate-400 px-1">Loading…</p> : (
        <>
          {home.collections.length > 0 && (
            <div className={card}>
              {home.collections.map(c => (
                <button key={c.id} onClick={() => onNavigate({ kind: 'collection', id: c.id })} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="text-lg w-6 text-center">{c.emoji || <BookOpen className="w-4 h-4 inline text-slate-400" />}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
                    <span className="block text-xs text-slate-500">{c.count} article{c.count === 1 ? '' : 's'}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}
          {home.popular.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="px-1 text-xs font-bold text-slate-400 uppercase tracking-wider">Popular articles</span>
              <div className={card}>{home.popular.map(row)}</div>
            </div>
          )}
          {askTeam}
        </>
      )}
    </div>
  );
};

/** While a customer writes their first message: articles that may already answer it. */
export const ArticleSuggestions: React.FC<{ api: Api; text: string; onOpen: (id: string) => void }> = ({ api, text, onOpen }) => {
  const [list, setList] = useState<ArticleSummary[]>([]);
  const [hidden, setHidden] = useState(false);
  const last = useRef('');
  useEffect(() => {
    const term = text.trim();
    if (term.length < 12) { setList([]); return; }
    const t = setTimeout(() => {
      if (term === last.current) return;
      last.current = term;
      api(`/api/help/search?q=${encodeURIComponent(term)}&limit=3`).then(r => (r.ok ? r.json() : [])).then(setList).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [text, api]);
  if (hidden || !list.length) return null;
  return (
    <div className="mb-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> These articles might help</span>
        <button onClick={() => setHidden(true)} aria-label="Hide suggestions" className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
      </div>
      {list.map(a => (
        <button key={a.id} onClick={() => onOpen(a.id)} className="w-full text-left px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate">{a.title}</span><ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      ))}
    </div>
  );
};

