import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Copy, Check, CornerDownLeft, Loader2, RotateCcw, Settings2, Sparkles, BookOpen } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { RichText } from '../../lib/richText';
import { API_URL } from '../../lib/config';

const BACKEND_URL = API_URL;

type Turn = { id: number; role: 'user' | 'assistant'; content: string; draft?: boolean; error?: boolean; articles?: { id: string; title: string }[] };
type Status = { enabled: boolean; configured: boolean; provider: string; model: string } | null;

const QUICK: { label: string; question: string; action: 'ask' | 'draft' }[] = [
  { label: 'Draft a reply', question: 'Draft a reply to the customer’s latest message.', action: 'draft' },
  { label: 'Summarize', question: 'Summarize this conversation in 3 short bullet points: the problem, what has been tried, and what’s still open.', action: 'ask' },
  { label: 'What does the customer want?', question: 'In one or two sentences, what does the customer want?', action: 'ask' },
  { label: 'Suggest next steps', question: 'What should I do next to resolve this? Give a short checklist.', action: 'ask' },
];

let seq = 0;
// Each conversation keeps its own Ask AI chat while the dashboard is open
const chats = new Map<string, Turn[]>();

/** "Ask AI" tab next to the conversation: questions about it, summaries, and reply drafts to insert. */
export const AskAiPanel: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const token = useStore(s => s.token);
  const agent = useStore(s => s.agent);
  const setReplyDraft = useStore(s => s.setReplyDraft);
  const [status, setStatus] = useState<Status>(null);
  const [turns, setTurns] = useState<Turn[]>(() => chats.get(conversationId) || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTurns(chats.get(conversationId) || []); setInput(''); }, [conversationId]);
  useEffect(() => { chats.set(conversationId, turns); }, [conversationId, turns]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }
  }, [input]);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/ai/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(s => setStatus(s ? { enabled: s.enabled, configured: s.configured, provider: s.provider, model: s.model } : null))
      .catch(() => setStatus(null));
  }, [token]);

  const ask = async (question: string, action: 'ask' | 'draft' = 'ask') => {
    const q = question.trim();
    if (!q || busy || !token) return;
    const history = turns.filter(t => !t.error).map(t => ({ role: t.role, content: t.content }));
    setTurns(prev => [...prev, { id: ++seq, role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, question: q, history, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ask AI failed');
      setTurns(prev => [...prev, { id: ++seq, role: 'assistant', content: data.answer, draft: action === 'draft', articles: Array.isArray(data.articles) ? data.articles : [] }]);
    } catch (e: any) {
      setTurns(prev => [...prev, { id: ++seq, role: 'assistant', content: e.message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const copy = (t: Turn) => {
    navigator.clipboard?.writeText(t.content).then(() => { setCopied(t.id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  if (status && !status.configured) {
    return (
      <div className="p-5 flex flex-col gap-3 animate-fade-in">
        <div className="ic-card p-5 flex flex-col gap-3 items-start">
          <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Sparkles className="w-5 h-5" /></span>
          <h3 className="text-[15px] font-semibold text-ink">Ask AI isn’t set up yet</h3>
          <p className="text-[14px] text-muted leading-relaxed">
            Connect the AI you use (Claude, OpenAI, Gemini, Groq, or any OpenAI-compatible API) with an API key, and teammates can ask questions about conversations and draft replies here.
          </p>
          {agent?.role === 'admin' ? (
            <button
              className="ic-btn-primary ic-btn-sm"
              onClick={() => { sessionStorage.setItem('settings_open_section', 'ai'); window.dispatchEvent(new CustomEvent('open-settings')); }}
            >
              <Settings2 className="w-4 h-4" /> Set up in Settings
            </button>
          ) : (
            <p className="text-[13px] text-faint">Ask an admin to set it up in Settings › AI assistant.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col animate-fade-in">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-ink">
              <Sparkles className="w-[18px] h-[18px] text-accent" />
              <span className="text-[15px] font-semibold">Ask AI</span>
            </div>
            <p className="text-[13.5px] text-muted leading-relaxed">
              Ask anything about this conversation, or start with one of these.{status?.model && <span className="text-faint"> Using {status.model}.</span>}
            </p>
            <div className="flex flex-col gap-1.5">
              {QUICK.map(q => (
                <button key={q.label} onClick={() => ask(q.question, q.action)} disabled={busy}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl border border-line hover:bg-subtle text-[14px] text-ink disabled:opacity-50">
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map(t => t.role === 'user' ? (
          <div key={t.id} className="self-end max-w-[88%] px-3.5 py-2 rounded-2xl rounded-br-md bg-ink text-surface text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
            {t.content}
          </div>
        ) : (
          <div key={t.id} className={`self-stretch rounded-2xl border px-3.5 py-3 text-[13.5px] leading-relaxed break-words ${t.error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' : 'border-line bg-surface text-ink'}`}>
            {!t.error && (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted mb-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" /> {t.draft ? 'Draft reply' : 'AI'}
              </div>
            )}
            <div className="whitespace-pre-wrap"><RichText text={t.content} /></div>
            {!!t.articles?.length && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                <BookOpen className="w-3.5 h-3.5" /> From the knowledge base:
                {t.articles.map(a => <span key={a.id} className="ic-badge h-6 px-2 text-[12px] text-ink">{a.title}</span>)}
              </div>
            )}
            {!t.error && (
              <div className="flex items-center gap-1 mt-2.5 -mb-1">
                <button
                  onClick={() => setReplyDraft({ conversationId, text: t.content })}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-medium bg-subtle hover:bg-ink/10 text-ink"
                  title="Put this text in the reply box (you can edit it before sending)"
                >
                  <CornerDownLeft className="w-3.5 h-3.5" /> Insert in reply
                </button>
                <button onClick={() => copy(t)} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] text-muted hover:bg-subtle hover:text-ink">
                  {copied === t.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied === t.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="self-start flex items-center gap-2 text-[13px] text-muted px-1">
            <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 border-t border-line">
        {turns.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2 overflow-x-auto">
            {QUICK.slice(0, 2).map(q => (
              <button key={q.label} onClick={() => ask(q.question, q.action)} disabled={busy}
                className="shrink-0 h-7 px-2.5 rounded-full border border-line text-[12.5px] text-ink hover:bg-subtle disabled:opacity-50">{q.label}</button>
            ))}
            <button onClick={() => setTurns([])} disabled={busy} title="Start over"
              className="shrink-0 ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-full text-[12.5px] text-muted hover:bg-subtle"><RotateCcw className="w-3.5 h-3.5" /> Clear</button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface focus-within:border-ink/30 px-3 py-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); } }}
            placeholder="Ask AI about this conversation…"
            className="flex-1 min-w-0 resize-none bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none max-h-[120px] py-1"
          />
          <button onClick={() => ask(input)} disabled={busy || !input.trim()} title="Ask (Enter)"
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-ink text-surface disabled:bg-subtle disabled:text-faint">
            <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AskAiPanel;
