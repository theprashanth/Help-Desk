import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';

type Provider = 'anthropic' | 'openai' | 'openai_compatible';
type Saved = {
  enabled: boolean; provider: Provider; model: string; baseUrl: string; instructions: string;
  hasApiKey: boolean; apiKeyHint: string; configured: boolean; updatedAt?: string;
};

const PROVIDERS: { id: Provider; label: string; hint: string; models: string[]; keyUrl?: string }[] = [
  {
    id: 'anthropic', label: 'Anthropic (Claude)', hint: 'Uses the official Anthropic SDK.',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai', label: 'OpenAI', hint: 'Chat Completions API at api.openai.com.',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openai_compatible', label: 'Other (OpenAI-compatible)',
    hint: 'Any provider with an OpenAI-compatible /chat/completions endpoint: Google Gemini, Groq, Mistral, OpenRouter, Together, or a local Ollama.',
    models: [],
  },
];

const BASE_URL_EXAMPLES = [
  { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
];

/** Settings › AI assistant: the model behind the inbox's "Ask AI" panel. The API key stays on the server. */
const AiSettings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const token = useStore(s => s.token);
  const agent = useStore(s => s.agent);
  const isAdmin = agent?.role === 'admin';
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState({ enabled: false, provider: 'anthropic' as Provider, model: '', baseUrl: '', instructions: '' });
  const [newKey, setNewKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Results show at the top of the page; bring them into view
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (notice) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [notice]);

  const load = (s: Saved) => {
    setSaved(s);
    setDraft({ enabled: s.enabled, provider: s.provider, model: s.model, baseUrl: s.baseUrl, instructions: s.instructions });
    setNewKey(''); setRemoveKey(false);
  };

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/ai/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => (r.ok ? load(await r.json()) : setLoadError('Couldn’t load AI settings')))
      .catch(() => setLoadError('Couldn’t load AI settings'));
  }, [token]);

  const provider = PROVIDERS.find(p => p.id === draft.provider)!;
  const dirty = useMemo(() => !!saved && (
    draft.enabled !== saved.enabled || draft.provider !== saved.provider || draft.model !== saved.model ||
    draft.baseUrl !== saved.baseUrl || draft.instructions !== saved.instructions || !!newKey.trim() || removeKey
  ), [draft, saved, newKey, removeKey]);

  const body = () => ({
    ...draft,
    model: draft.model.trim(),
    baseUrl: draft.provider === 'openai_compatible' ? draft.baseUrl.trim() : '',
    ...(newKey.trim() ? { apiKey: newKey.trim() } : removeKey ? { apiKey: '' } : {}),
  });

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Couldn’t save');
      load(data);
      setNotice({ ok: true, text: 'Saved' });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setNotice(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body()),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'The test failed');
      setNotice({ ok: true, text: `Connected to ${data.model} (${(data.ms / 1000).toFixed(1)}s)` });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally { setTesting(false); }
  };

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => { setDraft(d => ({ ...d, [k]: v })); setNotice(null); };
  const keyMissing = draft.provider !== 'openai_compatible' && !newKey.trim() && (!saved?.hasApiKey || removeKey);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col ic-panel overflow-hidden">
      <SettingsPageHeader title="AI assistant" onBack={onBack}>
        {isAdmin && (
          <>
            <button onClick={test} disabled={testing || !saved || keyMissing} className="ic-btn-ghost disabled:opacity-50">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Test connection
            </button>
            <button onClick={save} disabled={saving || !dirty} className="ic-btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </>
        )}
      </SettingsPageHeader>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-6 flex flex-col gap-5">
          {notice && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] ${notice.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
              {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span className="min-w-0 break-words">{notice.text}</span>
            </div>
          )}
          {loadError && <p className="text-[14px] text-red-600">{loadError}</p>}
          {!isAdmin && <p className="text-[14px] text-muted">Only admins can change these settings.</p>}

          {saved && (
            <>
              <SettingsFormSection
                title="Ask AI"
                description="Teammates get an Ask AI tab next to the conversation: ask questions about it, get a summary, or draft a reply to insert into the composer."
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[14px] text-ink">Turn on Ask AI for this workspace</span>
                  <button type="button" role="switch" aria-checked={draft.enabled} disabled={!isAdmin} onClick={() => set('enabled', !draft.enabled)}
                    className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${draft.enabled ? 'bg-ink' : 'bg-ink/15'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-surface shadow transition-all ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
                <p className="ic-help mt-2">
                  {saved.configured ? 'Ask AI is live for teammates.' : 'Ask AI is off until it’s turned on with a provider and key.'}
                </p>
              </SettingsFormSection>

              <SettingsFormSection title="Provider" description={provider.hint}>
                <div className="flex flex-col gap-2">
                  {PROVIDERS.map(p => (
                    <label key={p.id} className={`flex items-center gap-3 px-3.5 h-11 rounded-xl border cursor-pointer ${draft.provider === p.id ? 'border-ink/40 bg-subtle' : 'border-line hover:bg-subtle'}`}>
                      <input type="radio" name="ai-provider" checked={draft.provider === p.id} disabled={!isAdmin}
                        onChange={() => { set('provider', p.id); set('model', p.models[0] || ''); }} />
                      <span className="text-[14px] text-ink">{p.label}</span>
                    </label>
                  ))}
                </div>
              </SettingsFormSection>

              {draft.provider === 'openai_compatible' && (
                <SettingsFormSection title="Base URL" description="The address of the provider’s OpenAI-compatible API (without /chat/completions).">
                  <input className="ic-input font-mono text-[13px]" value={draft.baseUrl} disabled={!isAdmin}
                    placeholder="https://api.groq.com/openai/v1" onChange={e => set('baseUrl', e.target.value)} />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {BASE_URL_EXAMPLES.map(ex => (
                      <button key={ex.label} type="button" disabled={!isAdmin} onClick={() => set('baseUrl', ex.url)} className="ic-badge hover:bg-ink/10">{ex.label}</button>
                    ))}
                  </div>
                </SettingsFormSection>
              )}

              <SettingsFormSection title="Model" description="The exact model name from your provider.">
                <input className="ic-input font-mono text-[13px]" list="ai-models" value={draft.model} disabled={!isAdmin}
                  placeholder={provider.models[0] || 'e.g. gemini-2.5-flash, llama-3.3-70b-versatile'} onChange={e => set('model', e.target.value)} />
                <datalist id="ai-models">{provider.models.map(m => <option key={m} value={m} />)}</datalist>
                {provider.models.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {provider.models.map(m => (
                      <button key={m} type="button" disabled={!isAdmin} onClick={() => set('model', m)}
                        className={`ic-badge font-mono ${draft.model === m ? 'bg-ink text-surface' : 'hover:bg-ink/10'}`}>{m}</button>
                    ))}
                  </div>
                )}
              </SettingsFormSection>

              <SettingsFormSection
                title="API key"
                description={<>Stored on your server and never sent to browsers.{provider.keyUrl && <> Get one from <a className="ic-link" href={provider.keyUrl} target="_blank" rel="noreferrer">your {provider.label.split(' ')[0]} account</a>.</>}{draft.provider === 'openai_compatible' && ' Leave empty for local servers that don’t need one.'}</>}
              >
                {saved.hasApiKey && !removeKey && (
                  <div className="flex items-center justify-between gap-3 mb-2 px-3.5 h-11 rounded-xl border border-line bg-subtle">
                    <span className="flex items-center gap-2 text-[14px] text-ink"><KeyRound className="w-4 h-4 text-muted" /> Key saved <span className="font-mono text-muted">{saved.apiKeyHint}</span></span>
                    {isAdmin && <button type="button" onClick={() => { setRemoveKey(true); setNotice(null); }} className="text-[13px] text-red-600 hover:underline">Remove</button>}
                  </div>
                )}
                {removeKey && <p className="text-[13px] text-red-600 mb-2">The saved key will be removed when you save. <button className="ic-link" onClick={() => setRemoveKey(false)}>Undo</button></p>}
                <input
                  type="password" autoComplete="off" spellCheck={false} disabled={!isAdmin}
                  className="ic-input font-mono text-[13px]"
                  value={newKey}
                  placeholder={saved.hasApiKey ? 'Paste a new key to replace it' : 'Paste your API key'}
                  onChange={e => { setNewKey(e.target.value); setNotice(null); }}
                />
              </SettingsFormSection>

              <SettingsFormSection title="Instructions" description="Optional guidance added to every request: your tone of voice, policies, product facts, or what not to promise.">
                <textarea className="ic-input min-h-[120px] py-2.5 leading-relaxed" value={draft.instructions} maxLength={4000} disabled={!isAdmin}
                  placeholder="e.g. Refunds are processed within 5–7 business days. Always sign replies as the Chai Shots team. Never promise discounts."
                  onChange={e => set('instructions', e.target.value)} />
                <p className="ic-help mt-1.5">{4000 - draft.instructions.length} characters left</p>
              </SettingsFormSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AiSettings;
