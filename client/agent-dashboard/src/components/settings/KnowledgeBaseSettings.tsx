import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, AlertCircle, Check, BookOpen, Eye, ThumbsUp, ThumbsDown, Search, FolderPlus, Pencil, Upload } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { HelpArticle, HelpCollection } from '../../../../../shared/src/types';
import { RichText } from '../../lib/richText';
import { BACKEND_URL, SettingsPageHeader } from './shared';
import ImportDialog from './ImportDialog';

type Draft = { title: string; body: string; collectionId: string; state: 'draft' | 'published' };
const empty: Draft = { title: '', body: '', collectionId: '', state: 'draft' };

/**
 * Settings › Knowledge base: collections and articles. Published articles appear in the Messenger
 * (search, suggestions while a customer writes) and are given to Ask AI as context.
 */
export default function KnowledgeBaseSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const canEdit = me?.role !== 'light';
  const isAdmin = me?.role === 'admin';
  const [collections, setCollections] = useState<HelpCollection[]>([]);
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [filter, setFilter] = useState<string>('all'); // all | none | <collectionId>
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BACKEND_URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || 'Something went wrong');
    return x;
  };
  const load = async () => {
    try { const d = await call('GET', '/help/admin'); setCollections(d.collections); setArticles(d.articles); } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = articles.find(a => a.id === selected);
  useEffect(() => {
    setError(null); setPreview(false);
    if (selected === 'new') setDraft({ ...empty, collectionId: filter !== 'all' && filter !== 'none' ? filter : '' });
    else if (current) setDraft({ title: current.title, body: current.body, collectionId: current.collectionId || '', state: current.state });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => articles
    .filter(a => filter === 'all' || (filter === 'none' ? !a.collectionId : a.collectionId === filter))
    .filter(a => !q.trim() || (a.title + ' ' + a.body).toLowerCase().includes(q.trim().toLowerCase())), [articles, filter, q]);

  const dirty = selected === 'new' ? !!(draft.title || draft.body)
    : !!current && (draft.title !== current.title || draft.body !== current.body || (draft.collectionId || '') !== (current.collectionId || '') || draft.state !== current.state);

  const save = async (state?: Draft['state']) => {
    setSaving(true); setError(null);
    const body = { ...draft, state: state || draft.state, collectionId: draft.collectionId || null };
    try {
      const a = selected === 'new' ? await call('POST', '/help/articles', body) : await call('PUT', `/help/articles/${selected}`, body);
      await load(); setSelected(a.id); setDraft(d => ({ ...d, state: a.state }));
      setFlash(a.state === 'published' ? 'Published' : 'Saved as draft'); setTimeout(() => setFlash(null), 2000);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!current || !window.confirm(`Delete “${current.title}”? This can’t be undone.`)) return;
    try { await call('DELETE', `/help/articles/${current.id}`); await load(); setSelected(null); } catch (e: any) { setError(e.message); }
  };
  const addCollection = async () => {
    const name = window.prompt('Collection name (e.g. Billing)');
    if (!name?.trim()) return;
    try { const c = await call('POST', '/help/collections', { name, order: collections.length }); await load(); setFilter(c.id); } catch (e: any) { setError(e.message); }
  };
  const renameCollection = async (c: HelpCollection) => {
    const name = window.prompt('Rename collection', c.name);
    if (!name?.trim() || name === c.name) return;
    try { await call('PUT', `/help/collections/${c.id}`, { name }); await load(); } catch (e: any) { setError(e.message); }
  };
  const deleteCollection = async (c: HelpCollection) => {
    if (!window.confirm(`Delete the collection “${c.name}”? Its articles are kept, without a collection.`)) return;
    try { await call('DELETE', `/help/collections/${c.id}`); setFilter('all'); await load(); } catch (e: any) { setError(e.message); }
  };

  const countIn = (id: string) => articles.filter(a => a.collectionId === id).length;
  const live = articles.filter(a => a.state === 'published').length;

  return (
    <>
      <SettingsPageHeader title="Knowledge base" onBack={onBack}>
        {flash && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> {flash}</span>}
        {canEdit && <button type="button" onClick={() => setImporting(true)} className="ic-btn-secondary"><Upload className="w-4 h-4" /> Import</button>}
        {canEdit && <button type="button" onClick={() => setSelected('new')} className="ic-btn-primary"><Plus className="w-4 h-4" /> New article</button>}
      </SettingsPageHeader>
      {importing && <ImportDialog kind="articles" onClose={() => setImporting(false)} onImported={load} />}
      <div className="flex-1 min-h-0 flex">
        {/* Collections */}
        <div className="w-56 shrink-0 border-r border-line p-3 flex flex-col gap-0.5 overflow-y-auto">
          <p className="px-2 pb-2 text-[12.5px] text-muted">{live} published · {articles.length - live} draft</p>
          {[{ id: 'all', name: 'All articles', n: articles.length }, ...collections.map(c => ({ id: c.id, name: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, n: countIn(c.id), c })), { id: 'none', name: 'No collection', n: articles.filter(a => !a.collectionId).length }].map((x: any) => (
            <div key={x.id} className={`group flex items-center gap-1 rounded-lg ${filter === x.id ? 'bg-subtle' : 'hover:bg-ink/[0.03]'}`}>
              <button onClick={() => setFilter(x.id)} className="flex-1 min-w-0 flex items-center gap-2 px-2 h-9 text-left text-[14px] text-ink">
                <span className="flex-1 min-w-0 truncate">{x.name}</span><span className="text-[12px] text-faint tabular-nums">{x.n}</span>
              </button>
              {x.c && canEdit && <button onClick={() => renameCollection(x.c)} className="opacity-0 group-hover:opacity-100 ic-icon-btn-ghost w-7 h-7" title="Rename"><Pencil className="w-3.5 h-3.5" /></button>}
              {x.c && isAdmin && <button onClick={() => deleteCollection(x.c)} className="opacity-0 group-hover:opacity-100 ic-icon-btn-ghost w-7 h-7" title="Delete collection"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          {canEdit && <button onClick={addCollection} className="ic-btn-ghost h-9 mt-2 justify-start"><FolderPlus className="w-4 h-4" /> New collection</button>}
        </div>

        {/* Articles */}
        <div className="w-80 shrink-0 border-r border-line flex flex-col min-h-0">
          <label className="flex items-center gap-2 mx-3 mt-3 ic-input w-auto h-9">
            <Search className="w-4 h-4 text-muted shrink-0" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles" className="flex-1 min-w-0 bg-transparent focus:outline-none" />
          </label>
          <div className="flex-1 overflow-y-auto p-2">
            {shown.length === 0 && (
              <div className="p-6 text-center">
                <BookOpen className="w-8 h-8 text-muted mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-[14px] text-muted">{articles.length ? 'No matching articles.' : 'No articles yet. Write answers to common questions so customers can help themselves.'}</p>
              </div>
            )}
            {shown.map(a => (
              <button key={a.id} onClick={() => setSelected(a.id)} className={`w-full text-left px-3 py-2.5 rounded-xl ${selected === a.id ? 'bg-subtle' : 'hover:bg-ink/[0.03]'}`}>
                <span className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-[14px] font-medium text-ink">{a.title}</span>
                  <span className={`ic-badge h-5 px-1.5 text-[11px] ${a.state === 'published' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted'}`}>{a.state === 'published' ? 'Live' : 'Draft'}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-3 text-[12px] text-faint">
                  <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" />{a.views || 0}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{a.helpful || 0}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsDown className="w-3 h-3" />{a.notHelpful || 0}</span>
                  <span className="ml-auto">{new Date(a.updatedAt || '').toLocaleDateString()}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {error && <div className="m-4 mb-0 p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
          {selected === null || (selected !== 'new' && !current) ? (
            <div className="ic-empty flex-1"><BookOpen className="w-10 h-10 text-muted mb-2" strokeWidth={1.25} /><p className="text-[14px] text-muted">Select an article, or write a new one.</p></div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Title</span>
                <input className="ic-input h-11 text-[17px] font-semibold" disabled={!canEdit} placeholder="e.g. How do I cancel my subscription?"
                  value={draft.title} maxLength={200} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} autoFocus={selected === 'new'} />
              </label>
              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink">Collection</span>
                  <select className="ic-select h-9 w-56" disabled={!canEdit} value={draft.collectionId} onChange={e => setDraft(d => ({ ...d, collectionId: e.target.value }))}>
                    <option value="">No collection</option>
                    {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <div className="inline-flex rounded-lg border border-line p-0.5 ml-auto">
                  <button onClick={() => setPreview(false)} className={`px-3 h-8 rounded-md text-[13px] ${!preview ? 'bg-subtle text-ink font-medium' : 'text-muted'}`}>Write</button>
                  <button onClick={() => setPreview(true)} className={`px-3 h-8 rounded-md text-[13px] ${preview ? 'bg-subtle text-ink font-medium' : 'text-muted'}`}>Preview</button>
                </div>
              </div>
              {preview ? (
                <div className="min-h-[320px] rounded-xl border border-line p-5">
                  <h1 className="text-[20px] font-semibold text-ink mb-3">{draft.title || 'Untitled'}</h1>
                  <RichText className="text-[15px] text-ink whitespace-pre-wrap leading-relaxed" text={draft.body || '_Nothing written yet._'} linkClass="text-link underline" />
                </div>
              ) : (
                <label className="flex flex-col gap-1.5 flex-1">
                  <span className="text-[13px] font-medium text-ink">Answer</span>
                  <textarea className="ic-textarea min-h-[320px] flex-1 font-normal leading-relaxed" disabled={!canEdit} value={draft.body}
                    placeholder={'Write the answer. Use **bold**, *italic*, [links](https://…) and blank lines between paragraphs.'}
                    onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />
                </label>
              )}
              {canEdit && (
                <div className="flex items-center gap-2 pt-2 border-t border-line">
                  {draft.state === 'published' ? (
                    <>
                      <button onClick={() => save('published')} disabled={saving || !dirty} className="ic-btn-primary disabled:opacity-40">{saving ? 'Saving…' : 'Update'}</button>
                      <button onClick={() => save('draft')} disabled={saving} className="ic-btn-ghost">Unpublish</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => save('published')} disabled={saving || !draft.title.trim() || !draft.body.trim()} className="ic-btn-primary disabled:opacity-40">{saving ? 'Saving…' : 'Publish'}</button>
                      <button onClick={() => save('draft')} disabled={saving || !draft.title.trim()} className="ic-btn-ghost disabled:opacity-40">Save draft</button>
                      {(!draft.title.trim() || !draft.body.trim()) && (
                        <span className="text-[12.5px] text-muted">{!draft.title.trim() ? 'Add a title' : 'Write the answer'} to publish.</span>
                      )}
                    </>
                  )}
                  {current && <span className="text-[12.5px] text-muted ml-2">{current.authorName ? `By ${current.authorName} · ` : ''}{current.views || 0} views</span>}
                  {current && <button onClick={remove} className="ic-btn-ghost ml-auto text-red-600 dark:text-red-400"><Trash2 className="w-4 h-4" /> Delete</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
