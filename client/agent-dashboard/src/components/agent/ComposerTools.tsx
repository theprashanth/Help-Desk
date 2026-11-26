import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark, Smile, BookOpen, Paperclip, Image as ImageIcon, AudioLines, Workflow, Table as TableIcon,
  Pin, MoreHorizontal, Search, Zap, Plus, Minus, Loader2, Undo2, Link2,
} from 'lucide-react';
import { SavedReply } from '../../../../../shared/src/types';
import { useStore } from '../../store/useStore';
import { API_URL } from '../../lib/config';
import { hasMacroActions } from '../../lib/macros';

/*
 * The reply box's tools: a ⋯ menu (Macros, Emojis, GIFs, Articles, Attachments, Images, Dictate,
 * AI Compose, Workflows, Table). Any of them can be pinned next to ⋯; pins are remembered per browser.
 */

export type ToolKey = 'macros' | 'emojis' | 'gifs' | 'articles' | 'attachments' | 'images' | 'dictate' | 'ai' | 'workflows' | 'table';

const Badge: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <span className={`inline-flex items-center justify-center w-4 h-4 rounded-[4px] bg-current ${className}`}>
    <span className="text-[7.5px] font-extrabold leading-none tracking-tight text-surface" style={{ color: 'rgb(var(--ic-surface))' }}>{text}</span>
  </span>
);
const GifIcon: React.FC<{ className?: string }> = ({ className }) => <Badge text="GIF" className={className} />;
const AiIcon: React.FC<{ className?: string }> = ({ className }) => <Badge text="AI" className={className} />;

export const TOOLS: { key: ToolKey; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'macros', label: 'Macros', icon: Bookmark },
  { key: 'emojis', label: 'Emojis', icon: Smile },
  { key: 'gifs', label: 'GIFs', icon: GifIcon },
  { key: 'articles', label: 'Articles', icon: BookOpen },
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
  { key: 'images', label: 'Images', icon: ImageIcon },
  { key: 'dictate', label: 'Dictate', icon: AudioLines },
  { key: 'ai', label: 'AI Compose', icon: AiIcon },
  { key: 'workflows', label: 'Workflows', icon: Workflow },
  { key: 'table', label: 'Table', icon: TableIcon },
];

const PIN_KEY = 'composer_pins';
export function usePinnedTools(): [ToolKey[], (k: ToolKey) => void] {
  const [pins, setPins] = useState<ToolKey[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
      if (Array.isArray(v)) return v.filter((k: string) => TOOLS.some(t => t.key === k));
    } catch { /* storage blocked */ }
    return ['attachments'];
  });
  const toggle = (k: ToolKey) => setPins(prev => {
    const next = prev.includes(k) ? prev.filter(x => x !== k) : TOOLS.map(t => t.key).filter(x => x === k || prev.includes(x));
    try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  return [pins, toggle];
}

/** Pinned tools + the ⋯ menu, for the reply box's bottom bar. */
export const ComposerToolbar: React.FC<{
  pins: ToolKey[];
  onTogglePin: (k: ToolKey) => void;
  active: ToolKey | null;
  dictating: boolean;
  disabled?: Partial<Record<ToolKey, string>>; // tool → why it's unavailable here
  onPick: (k: ToolKey) => void;
}> = ({ pins, onTogglePin, active, dictating, disabled = {}, onPick }) => {
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const on = (k: ToolKey) => active === k || (k === 'dictate' && dictating);
  return (
    <div ref={wrapRef} data-composer-tools className="relative flex items-center gap-0.5">
      {TOOLS.filter(t => pins.includes(t.key)).map(t => (
        <button key={t.key} type="button" onClick={() => onPick(t.key)} disabled={!!disabled[t.key]}
          className={`ic-icon-btn-ghost disabled:opacity-40 ${on(t.key) ? 'bg-ink/[0.06] text-ink' : ''} ${t.key === 'dictate' && dictating ? 'text-red-600' : ''}`}
          title={disabled[t.key] || (t.key === 'dictate' && dictating ? 'Stop dictating' : t.label)} aria-label={t.label}>
          <t.icon className={`w-4 h-4 ${t.key === 'dictate' && dictating ? 'animate-pulse' : ''}`} />
        </button>
      ))}
      <button type="button" onClick={() => setMenu(v => !v)} className={`ic-icon-btn-ghost ${menu ? 'bg-ink/[0.06] text-ink' : ''}`} title="More" aria-label="More tools" aria-expanded={menu}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {menu && (
        <div className="ic-menu absolute bottom-full left-0 mb-2 w-[232px]" role="menu">
          {TOOLS.map(t => {
            const pinned = pins.includes(t.key);
            const why = disabled[t.key];
            return (
              <div key={t.key} className="group/item flex items-center pr-1.5 hover:bg-subtle" title={why}>
                <button type="button" role="menuitem" disabled={!!why}
                  onClick={() => { setMenu(false); onPick(t.key); }}
                  className="flex-1 min-w-0 flex items-center gap-3 pl-3.5 h-9 text-[14px] text-ink text-left disabled:opacity-40">
                  <t.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.key === 'dictate' && dictating ? 'Stop dictating' : t.label}</span>
                </button>
                <button type="button" onClick={() => onTogglePin(t.key)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 hover:bg-ink/[0.08] ${pinned ? 'text-ink' : 'text-muted'}`}
                  title={pinned ? `Unpin ${t.label}` : `Pin ${t.label} to the reply box`} aria-label={pinned ? `Unpin ${t.label}` : `Pin ${t.label}`}>
                  <Pin className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Shared panel frame ──────────────────────────────────────────────────────

const Panel: React.FC<{ title: string; onClose: () => void; width?: string; children: React.ReactNode }> = ({ title, onClose, width = 'w-[360px]', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-composer-tools]')) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div ref={ref} className={`absolute bottom-full left-4 mb-2 ${width} max-w-[calc(100%-2rem)] bg-surface border border-line rounded-xl shadow-pop z-50 flex flex-col overflow-hidden animate-fade-in`}>
      <div className="px-3.5 pt-3 pb-1.5 text-[13px] font-medium text-muted">{title}</div>
      {children}
    </div>
  );
};

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div className="mx-3 mb-2 flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface focus-within:border-ink/40">
    <Search className="w-4 h-4 text-muted shrink-0" />
    <input autoFocus value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="flex-1 min-w-0 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none" />
  </div>
);

const useApi = () => {
  const token = useStore(s => s.token);
  return async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
};

// ── Macros ──────────────────────────────────────────────────────────────────

export const MacroPanel: React.FC<{ replies: SavedReply[]; onPick: (r: SavedReply) => void; onClose: () => void }> = ({ replies, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^\//, '');
    return replies.filter(r => !t || r.trigger.toLowerCase().includes(t) || r.title.toLowerCase().includes(t) || (r.content || '').toLowerCase().includes(t));
  }, [q, replies]);
  return (
    <Panel title="Macros" onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Search macros" />
      <div className="max-h-64 overflow-y-auto pb-1.5">
        {list.length === 0 && <p className="px-3.5 py-3 text-[13px] text-muted">{replies.length ? 'No macros match.' : 'No macros yet. Create them in Settings › Macros.'}</p>}
        {list.map(r => (
          <button key={r.id} onClick={() => onPick(r)} className="w-full text-left px-3.5 py-2 hover:bg-subtle flex flex-col">
            <span className="text-[14px] text-ink font-medium flex items-center gap-1.5">{r.title || r.trigger}{hasMacroActions(r) && <Zap className="w-3 h-3 text-amber-500" />}<span className="text-faint font-normal">{r.trigger}</span></span>
            {r.content && <span className="text-[13px] text-muted truncate">{r.content}</span>}
          </button>
        ))}
      </div>
    </Panel>
  );
};

// ── Emojis ──────────────────────────────────────────────────────────────────

const EMOJI_GROUPS: { name: string; items: [string, string][] }[] = [
  { name: 'Smileys', items: [
    ['😀', 'grin smile happy'], ['😃', 'smile happy'], ['😄', 'smile laugh'], ['😁', 'grin'], ['😆', 'laugh'], ['😅', 'sweat relief'],
    ['😂', 'joy tears laugh lol'], ['🤣', 'rofl laugh'], ['🙂', 'slight smile'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blush smile'],
    ['😇', 'angel innocent'], ['🥰', 'love hearts'], ['😍', 'heart eyes love'], ['🤩', 'star struck wow'], ['😘', 'kiss'], ['😋', 'yum'],
    ['😜', 'wink tongue'], ['🤗', 'hug'], ['🤔', 'thinking hmm'], ['🤨', 'raised eyebrow'], ['😐', 'neutral'], ['😑', 'expressionless'],
    ['😶', 'speechless'], ['🙄', 'eye roll'], ['😏', 'smirk'], ['😬', 'grimace awkward'], ['😌', 'relieved'], ['😴', 'sleep'],
    ['😷', 'mask sick'], ['🤒', 'sick ill'], ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd'], ['😕', 'confused'],
    ['😟', 'worried'], ['🙁', 'frown sad'], ['😮', 'wow surprised'], ['😲', 'astonished'], ['😳', 'flushed'], ['🥺', 'pleading please'],
    ['😢', 'cry sad'], ['😭', 'sob crying'], ['😱', 'scream shock'], ['😩', 'weary tired'], ['😤', 'triumph huff'], ['😡', 'angry mad'],
  ] },
  { name: 'Gestures', items: [
    ['👍', 'thumbs up yes ok like'], ['👎', 'thumbs down no'], ['👌', 'ok perfect'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'],
    ['🤝', 'handshake deal'], ['👏', 'clap applause'], ['🙌', 'raised hands hooray'], ['👋', 'wave hello hi bye'], ['🙏', 'pray thanks please'],
    ['💪', 'strong muscle'], ['👀', 'eyes look'], ['🫡', 'salute'], ['🤷', 'shrug'], ['🙋', 'raise hand'], ['👉', 'point right'], ['👇', 'point down'], ['☝️', 'point up'],
  ] },
  { name: 'Hearts', items: [
    ['❤️', 'heart love red'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
    ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'], ['💕', 'two hearts'], ['💖', 'sparkling heart'], ['💯', 'hundred perfect'],
  ] },
  { name: 'Objects', items: [
    ['🎉', 'party tada celebrate'], ['🎊', 'confetti'], ['🎁', 'gift present'], ['🎂', 'birthday cake'], ['🔥', 'fire lit'], ['✨', 'sparkles'],
    ['⭐', 'star'], ['🌟', 'glowing star'], ['💡', 'idea bulb'], ['📌', 'pin'], ['📎', 'paperclip'], ['📦', 'package box delivery'],
    ['🚚', 'truck delivery shipping'], ['💳', 'card payment'], ['💰', 'money'], ['🧾', 'receipt invoice'], ['📧', 'email'], ['📱', 'phone mobile'],
    ['💻', 'laptop computer'], ['🔒', 'lock secure'], ['🔑', 'key'], ['⏰', 'alarm clock'], ['⏳', 'hourglass wait'], ['📅', 'calendar date'],
    ['☕', 'coffee'], ['🍕', 'pizza'], ['🚀', 'rocket launch'], ['🏆', 'trophy win'], ['🎯', 'target'], ['🛠️', 'tools fix'],
  ] },
  { name: 'Symbols', items: [
    ['✅', 'check done yes'], ['☑️', 'checkbox'], ['✔️', 'check mark'], ['❌', 'cross no wrong'], ['⚠️', 'warning'], ['❗', 'exclamation'],
    ['❓', 'question'], ['ℹ️', 'info information'], ['🔔', 'bell notification'], ['🆗', 'ok'], ['🆕', 'new'], ['🔄', 'refresh repeat'],
    ['➡️', 'right arrow'], ['⬅️', 'left arrow'], ['⬆️', 'up arrow'], ['⬇️', 'down arrow'], ['🟢', 'green circle'], ['🔴', 'red circle'],
  ] },
];
const RECENT_KEY = 'composer_recent_emojis';

export const EmojiPanel: React.FC<{ onPick: (e: string) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 16); } catch { return []; } });
  const pick = (e: string) => {
    const next = [e, ...recent.filter(x => x !== e)].slice(0, 16);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    onPick(e);
  };
  const t = q.trim().toLowerCase();
  const groups = t
    ? [{ name: 'Results', items: EMOJI_GROUPS.flatMap(g => g.items).filter(([, k]) => k.includes(t)) }]
    : [...(recent.length ? [{ name: 'Recent', items: recent.map(e => [e, ''] as [string, string]) }] : []), ...EMOJI_GROUPS];
  return (
    <Panel title="Emojis" onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Search emojis" />
      <div className="max-h-64 overflow-y-auto px-2 pb-2">
        {groups.map(g => (
          <div key={g.name}>
            <div className="px-1.5 pt-1.5 pb-1 text-[11.5px] font-medium text-faint">{g.name}</div>
            <div className="grid grid-cols-9">
              {g.items.map(([e, k]) => (
                <button key={g.name + e} onClick={() => pick(e)} title={k.split(' ')[0] || e}
                  className="h-9 flex items-center justify-center rounded-lg text-[20px] hover:bg-subtle">{e}</button>
              ))}
            </div>
            {g.items.length === 0 && <p className="px-1.5 py-2 text-[13px] text-muted">No emojis match.</p>}
          </div>
        ))}
      </div>
    </Panel>
  );
};

// ── GIFs ────────────────────────────────────────────────────────────────────

type Gif = { id: string; title: string; preview: string; url: string };

export const GifPanel: React.FC<{ onPick: (g: { url: string; title: string }) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const api = useApi();
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true); setError(null);
      try {
        const d = await api(`/api/gifs?q=${encodeURIComponent(q.trim())}`);
        setEnabled(!!d.enabled); setGifs(d.gifs || []);
      } catch (e: any) { setError(e.message); }
      setBusy(false);
    }, q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const linkOk = /^https:\/\/\S+$/i.test(link.trim());
  return (
    <Panel title="GIFs" onClose={onClose} width="w-[400px]">
      {enabled !== false && <SearchBox value={q} onChange={setQ} placeholder="Search GIPHY" />}
      {enabled !== false && (
        <div className="max-h-72 overflow-y-auto px-3 pb-2">
          {error && <p className="py-2 text-[13px] text-red-600">{error}</p>}
          {busy && gifs.length === 0 && <div className="py-6 flex justify-center text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {!busy && !error && gifs.length === 0 && enabled && <p className="py-2 text-[13px] text-muted">No GIFs found.</p>}
          <div className="columns-3 gap-1.5">
            {gifs.map(g => (
              <button key={g.id} onClick={() => onPick({ url: g.url, title: g.title })} title={g.title} className="mb-1.5 block w-full rounded-lg overflow-hidden hover:opacity-80">
                <img src={g.preview} alt={g.title} loading="lazy" className="w-full block" />
              </button>
            ))}
          </div>
          {gifs.length > 0 && <p className="pt-1 text-[11px] text-faint text-right">Powered by GIPHY</p>}
        </div>
      )}
      {enabled === false && (
        <p className="px-3.5 pb-2 text-[13px] text-muted leading-relaxed">
          GIF search isn’t set up on the server yet (an admin adds a free <span className="text-ink">GIPHY_API_KEY</span>). You can paste a GIF link:
        </p>
      )}
      <form className="flex items-center gap-2 px-3 pb-3 pt-1" onSubmit={e => { e.preventDefault(); if (linkOk) onPick({ url: link.trim(), title: 'GIF' }); }}>
        <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-lg border border-line focus-within:border-ink/40">
          <Link2 className="w-4 h-4 text-muted shrink-0" />
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://…/funny.gif" className="flex-1 min-w-0 bg-transparent text-[13.5px] text-ink placeholder:text-faint focus:outline-none" />
        </div>
        <button type="submit" disabled={!linkOk} className="ic-btn-secondary h-9 disabled:opacity-40">Add</button>
      </form>
    </Panel>
  );
};

// ── Articles ────────────────────────────────────────────────────────────────

type Article = { id: string; title: string; body: string; state: string; collectionId?: string };

export const ArticlePanel: React.FC<{ onPick: (a: { id: string; title: string }) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const api = useApi();
  const [q, setQ] = useState('');
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [collections, setCollections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/api/help/admin').then(d => {
      setArticles((d.articles || []).filter((a: Article) => a.state === 'published'));
      setCollections(Object.fromEntries((d.collections || []).map((c: any) => [c.id, c.name])));
    }).catch(e => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const t = q.trim().toLowerCase();
  const list = (articles || []).filter(a => !t || a.title.toLowerCase().includes(t) || a.body.toLowerCase().includes(t));
  return (
    <Panel title="Share an article" onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Search published articles" />
      <div className="max-h-64 overflow-y-auto pb-1.5">
        {error && <p className="px-3.5 py-2 text-[13px] text-red-600">{error}</p>}
        {!articles && !error && <div className="py-5 flex justify-center text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>}
        {articles && list.length === 0 && <p className="px-3.5 py-3 text-[13px] text-muted">{articles.length ? 'No articles match.' : 'No published articles yet. Write them in Knowledge base.'}</p>}
        {list.map(a => (
          <button key={a.id} onClick={() => onPick({ id: a.id, title: a.title })} className="w-full text-left px-3.5 py-2 hover:bg-subtle flex items-start gap-2.5">
            <BookOpen className="w-4 h-4 mt-0.5 text-muted shrink-0" />
            <span className="min-w-0 flex flex-col">
              <span className="text-[14px] text-ink font-medium truncate">{a.title}</span>
              <span className="text-[12.5px] text-muted truncate">{a.collectionId && collections[a.collectionId] ? `${collections[a.collectionId]} · ` : ''}{a.body.replace(/[#*_`>\[\]()]/g, '').slice(0, 90)}</span>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
};

// ── AI Compose ──────────────────────────────────────────────────────────────

const AI_ACTIONS: { key: string; label: string; needsText: boolean }[] = [
  { key: 'draft', label: 'Write a reply for me', needsText: false },
  { key: 'expand', label: 'Expand', needsText: true },
  { key: 'rephrase', label: 'Rephrase', needsText: true },
  { key: 'friendly', label: 'More friendly', needsText: true },
  { key: 'formal', label: 'More formal', needsText: true },
  { key: 'shorter', label: 'Make shorter', needsText: true },
  { key: 'grammar', label: 'Fix spelling & grammar', needsText: true },
];

export const AiComposePanel: React.FC<{
  conversationId: string; text: string; configured: boolean;
  onResult: (text: string) => void; onClose: () => void;
}> = ({ conversationId, text, configured, onResult, onClose }) => {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const run = async (action: string) => {
    setBusy(action); setError(null);
    try {
      const d = await api('/api/ai/compose', { method: 'POST', body: JSON.stringify({ conversationId, text, action }) });
      setBefore(text);
      onResult(d.text || '');
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };
  const hasText = !!text.trim();
  return (
    <Panel title="AI Compose" onClose={onClose} width="w-[280px]">
      {!configured ? (
        <p className="px-3.5 pb-3 text-[13px] text-muted leading-relaxed">AI isn’t set up yet. An admin can connect it in Settings › AI assistant.</p>
      ) : (
        <div className="pb-1.5">
          {AI_ACTIONS.filter(a => (a.needsText ? hasText : !hasText) || a.key === 'draft').map(a => (
            <button key={a.key} disabled={!!busy || (a.needsText && !hasText)} onClick={() => run(a.key)}
              className="ic-menu-item disabled:opacity-40">
              {busy === a.key ? <Loader2 className="w-4 h-4 animate-spin text-muted" /> : <AiIcon className="w-4 h-4 text-muted" />}
              {a.key === 'draft' && hasText ? 'Write a new reply' : a.label}
            </button>
          ))}
          {before !== null && (
            <button onClick={() => { onResult(before); setBefore(null); }} className="ic-menu-item text-muted border-t border-line mt-1">
              <Undo2 className="w-4 h-4" /> Undo
            </button>
          )}
          {error && <p className="px-3.5 py-2 text-[13px] text-red-600">{error}</p>}
        </div>
      )}
    </Panel>
  );
};

// ── Workflows (hand the chat to the chat flow) ──────────────────────────────

type FlowOption = { id: string; label: string; kind: 'menu' | 'answer' | 'agent'; children?: FlowOption[] };

export const WorkflowPanel: React.FC<{ conversationId: string; onDone: (msg: string) => void; onClose: () => void }> = ({ conversationId, onDone, onClose }) => {
  const api = useApi();
  const [flow, setFlow] = useState<{ botName: string; options: FlowOption[] } | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/api/chat-flow').then(d => {
      const live = d?.published;
      setFlow(live?.enabled ? { botName: live.botName, options: live.options || [] } : null);
    }).catch(e => { setError(e.message); setFlow(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const menus = useMemo(() => {
    const out: { id: string | null; label: string; depth: number }[] = [];
    const walk = (opts: FlowOption[], depth: number) => opts.forEach(o => {
      if (o.kind === 'menu') { out.push({ id: o.id, label: o.label, depth }); walk(o.children || [], depth + 1); }
    });
    if (flow) { out.push({ id: null, label: 'Main menu', depth: 0 }); walk(flow.options, 1); }
    return out;
  }, [flow]);
  const pass = async (id: string | null, label: string) => {
    setBusy(id ?? 'main'); setError(null);
    try {
      await api(`/api/tickets/${conversationId}/chat-flow`, { method: 'POST', body: JSON.stringify({ node: id }) });
      onDone(`Passed to ${flow?.botName || 'the chat flow'}: ${label}`);
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };
  return (
    <Panel title="Pass to the chat flow" onClose={onClose} width="w-[320px]">
      {flow === undefined && <div className="py-5 flex justify-center text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {flow === null && !error && <p className="px-3.5 pb-3 text-[13px] text-muted leading-relaxed">No chat flow is published. An admin can build one in Settings › Channels › Chat flow.</p>}
      {flow && (
        <>
          <p className="px-3.5 pb-2 text-[12.5px] text-muted leading-relaxed">{flow.botName} shows the menu you pick and the customer chooses from its buttons. If they ask for a person, it comes back to you.</p>
          <div className="max-h-60 overflow-y-auto pb-1.5">
            {menus.map(m => (
              <button key={m.id ?? 'main'} disabled={!!busy} onClick={() => pass(m.id, m.label)} className="ic-menu-item disabled:opacity-50" style={{ paddingLeft: 14 + m.depth * 14 }}>
                {busy === (m.id ?? 'main') ? <Loader2 className="w-4 h-4 animate-spin text-muted" /> : <Workflow className="w-4 h-4 text-muted" />}
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="px-3.5 pb-3 text-[13px] text-red-600">{error}</p>}
    </Panel>
  );
};

// ── Table ───────────────────────────────────────────────────────────────────

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ').trim();

export const TablePanel: React.FC<{ onInsert: (markdown: string) => void; onClose: () => void }> = ({ onInsert, onClose }) => {
  const [grid, setGrid] = useState<string[][]>([['', ''], ['', ''], ['', '']]);
  const cols = grid[0].length;
  const set = (r: number, c: number, v: string) => setGrid(g => g.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = () => grid.length < 20 && setGrid(g => [...g, Array(cols).fill('')]);
  const delRow = () => grid.length > 2 && setGrid(g => g.slice(0, -1));
  const addCol = () => cols < 6 && setGrid(g => g.map(row => [...row, '']));
  const delCol = () => cols > 1 && setGrid(g => g.map(row => row.slice(0, -1)));
  const filled = grid[0].some(x => x.trim()) || grid.slice(1).some(r => r.some(x => x.trim()));
  const insert = () => {
    const head = grid[0].map((h, i) => cell(h) || `Column ${i + 1}`);
    const rows = grid.slice(1).filter(r => r.some(x => x.trim()));
    onInsert([`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(x => cell(x) || ' ').join(' | ')} |`)].join('\n'));
  };
  const Stepper: React.FC<{ label: string; onMinus: () => void; onPlus: () => void }> = ({ label, onMinus, onPlus }) => (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
      {label}
      <button type="button" onClick={onMinus} className="w-6 h-6 rounded-md hover:bg-subtle flex items-center justify-center" aria-label={`Remove ${label.toLowerCase()}`}><Minus className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onPlus} className="w-6 h-6 rounded-md hover:bg-subtle flex items-center justify-center" aria-label={`Add ${label.toLowerCase()}`}><Plus className="w-3.5 h-3.5" /></button>
    </span>
  );
  return (
    <Panel title="Insert a table" onClose={onClose} width="w-[460px]">
      <div className="px-3 max-h-64 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c} className="border border-line p-0">
                    <input value={v} onChange={e => set(r, c, e.target.value)} autoFocus={r === 0 && c === 0}
                      placeholder={r === 0 ? `Heading ${c + 1}` : ''}
                      className={`w-full min-w-[60px] h-8 px-2 bg-transparent text-ink placeholder:text-faint focus:outline-none focus:bg-subtle ${r === 0 ? 'font-semibold' : ''}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Stepper label="Rows" onMinus={delRow} onPlus={addRow} />
        <Stepper label="Columns" onMinus={delCol} onPlus={addCol} />
        <span className="flex-1" />
        <button onClick={insert} disabled={!filled} className="ic-btn-primary h-8 disabled:opacity-40">Insert</button>
      </div>
    </Panel>
  );
};

// ── Dictate (the browser's speech recognition) ──────────────────────────────

export const dictationSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

/** Speech to text into the reply box. `onText` receives each finished phrase. */
export function useDictation(onText: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => recRef.current?.abort?.(), []);
  const stop = () => { recRef.current?.stop?.(); };
  const start = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Dictation needs Chrome, Edge or Safari.'); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang || navigator.language || 'en-US';
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { const t = String(e.results[i][0].transcript || '').trim(); if (t) cb.current(t); }
      }
    };
    rec.onerror = (e: any) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access is blocked. Allow it in the browser’s address bar.' : e.error === 'no-speech' ? null : `Dictation stopped (${e.error}).`);
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    try { rec.start(); recRef.current = rec; setListening(true); setError(null); } catch (e: any) { setError(e.message); }
  };
  return { listening, error, start, stop, toggle: () => (listening ? stop() : start()), clearError: () => setError(null) };
}
