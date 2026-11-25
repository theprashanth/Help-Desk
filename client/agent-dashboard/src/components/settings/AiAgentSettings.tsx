import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Check, Send, Sparkles, UserRound } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { AiAgentSettings as Settings } from '../../../../../shared/src/types';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';

type TestResult = { reply: string; confidence: number; sources: { id: string; title: string }[]; handoff: boolean; reason?: string; wouldSay: string };
type Stats = { days: number; total: number; active: number; resolved: number; handoff: number; resolutionRate: number | null; replies: number; topHandoffReasons: { reason: string; count: number }[] };

function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`ic-toggle mt-0.5 ${checked ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}>
        <span className="ic-toggle-knob" />
      </button>
      <span className="flex flex-col">
        <span className="text-[14px] text-ink">{label}</span>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Settings › AI Agent: an AI teammate that answers customers itself from the knowledge base and hands the
 * conversation to a person when it can't help. Off until an admin turns it on; "Test AI Agent" tries it
 * without any customer involved.
 */
export default function AiAgentSettings({ onBack, onOpenAi }: { onBack: () => void; onOpenAi: () => void }) {
  const token = useStore(s => s.token);
  const isAdmin = useStore(s => s.agent?.role === 'admin');
  const ro = !isAdmin;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [saved, setSaved] = useState<Settings | null>(null);
  const [d, setD] = useState<Settings | null>(null);
  const [topics, setTopics] = useState('');
  const [aiReady, setAiReady] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [question, setQuestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/ai-agent/settings`, { headers }).then(r => r.json()).then(r => {
      setSaved(r.settings); setD(r.settings); setTopics((r.settings.handoffTopics || []).join(', ')); setAiReady(!!r.aiReady);
    }).catch(() => setError('Couldn’t load the settings'));
    fetch(`${BACKEND_URL}/api/ai-agent/stats?days=30`, { headers }).then(r => r.json()).then(setStats).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const draft = useMemo(() => (d ? { ...d, handoffTopics: topics.split(',').map(t => t.trim()).filter(Boolean) } : null), [d, topics]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setD(x => (x ? { ...x, [k]: v } : x));

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai-agent/settings`, { method: 'PUT', headers, body: JSON.stringify(draft) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Could not save');
      setSaved(r.settings); setD(r.settings); setTopics(r.settings.handoffTopics.join(', ')); setAiReady(!!r.aiReady);
      setFlash(true); setTimeout(() => setFlash(false), 1800);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const runTest = async () => {
    if (!question.trim()) return;
    setTesting(true); setTestError(null); setTest(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai-agent/test`, { method: 'POST', headers, body: JSON.stringify({ question }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Test failed');
      setTest(r);
    } catch (e: any) { setTestError(e.message); }
    setTesting(false);
  };

  return (
    <>
      <SettingsPageHeader title="AI Agent" onBack={onBack}>
        {flash && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> Saved</span>}
        {isAdmin && (
          <button type="button" onClick={save} disabled={!dirty || saving} className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none">{saving ? 'Saving…' : 'Save'}</button>
        )}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="flex flex-col gap-4 max-w-5xl">
          {ro && <p className="ic-help">Only admins can change the AI Agent. You’re viewing it read-only.</p>}
          {!aiReady && (
            <div className="p-3 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">The AI Agent uses the provider set up in Settings › AI assistant, which isn’t ready yet. It won’t answer until it is.</span>
              <button className="underline shrink-0" onClick={onOpenAi}>Open AI assistant</button>
            </div>
          )}
          {error && <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}

          {d && (
            <>
              <SettingsFormSection
                title="AI Agent"
                description={<>
                  An AI teammate that answers customers itself, using your knowledge base. When it can’t help, the customer asks for a person, or a topic must go to a person,
                  it hands the conversation to your team (routed and summarized as usual). While it’s answering, the chat isn’t in your team’s views; find it under Inbox › AI Agent.
                </>}
              >
                <div className="flex flex-col gap-4">
                  <Toggle checked={d.enabled} disabled={ro} onChange={v => set('enabled', v)} label="Let the AI Agent answer customers"
                    hint={d.enabled ? 'On: new conversations get an AI answer first.' : 'Off: nothing changes for your customers or team.'} />
                  <label className="flex flex-col gap-1.5 max-w-sm">
                    <span className="text-[13px] font-medium text-ink">Name customers see</span>
                    <input className="ic-input" value={d.name} disabled={ro} maxLength={40} onChange={e => set('name', e.target.value)} />
                  </label>
                </div>
              </SettingsFormSection>

              <SettingsFormSection title="Where it answers" description="Which conversations the AI Agent picks up. A teammate replying, or clicking Take over, always takes the conversation from it.">
                <div className="flex flex-col gap-3">
                  <Toggle checked={d.channels.messenger} disabled={ro} onChange={v => set('channels', { ...d.channels, messenger: v })} label="New Messenger conversations" />
                  <Toggle checked={d.afterChatFlow} disabled={ro} onChange={v => set('afterChatFlow', v)} label="Chats the chat-flow bot hands to the team" hint="It answers the customer’s next message before a teammate does." />
                  <Toggle checked={d.channels.email} disabled={ro} onChange={v => set('channels', { ...d.channels, email: v })} label="New email conversations" />
                </div>
              </SettingsFormSection>

              <SettingsFormSection title="How it answers" description="Keep it to your knowledge base for the most reliable answers. It always hands over when it isn’t sure enough.">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    {([['knowledge', 'Only from the knowledge base', 'If your articles don’t cover it, it hands over.'],
                      ['general', 'Knowledge base, plus general knowledge', 'For simple, safe questions your articles don’t cover. It never invents account details, prices or policies.']] as const).map(([v, label, hint]) => (
                      <label key={v} className={`flex items-start gap-2.5 ${ro ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input type="radio" className="mt-1" disabled={ro} checked={d.answerFrom === v} onChange={() => set('answerFrom', v)} />
                        <span className="flex flex-col"><span className="text-[14px] text-ink">{label}</span><span className="text-[13px] text-muted">{hint}</span></span>
                      </label>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1.5 max-w-sm">
                    <span className="text-[13px] font-medium text-ink">Answer only when at least {Math.round(d.minConfidence * 100)}% sure</span>
                    <input type="range" min={0.3} max={0.95} step={0.05} value={d.minConfidence} disabled={ro} onChange={e => set('minConfidence', Number(e.target.value))} />
                    <span className="text-[12.5px] text-muted">Higher hands over more often; lower answers more but risks wrong answers.</span>
                  </label>
                  <label className="flex flex-col gap-1.5 max-w-[200px]">
                    <span className="text-[13px] font-medium text-ink">Replies per conversation</span>
                    <input type="number" min={1} max={20} className="ic-input" value={d.maxReplies} disabled={ro} onChange={e => set('maxReplies', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
                  </label>
                  <Toggle checked={d.askFeedback} disabled={ro} onChange={v => set('askFeedback', v)} label="Ask “Did that answer your question?”" hint="Yes resolves the conversation; No hands it to your team." />
                </div>
              </SettingsFormSection>

              <SettingsFormSection title="Handing over" description="Customers can always tap “Talk to a person”. These topics always go straight to your team.">
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-ink">Topics that always go to a person</span>
                    <input className="ic-input" value={topics} disabled={ro} onChange={e => setTopics(e.target.value)} placeholder="refund, cancel my account, legal" />
                    <span className="text-[12.5px] text-muted">Comma-separated words or phrases.</span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-ink">What the customer sees when it hands over</span>
                    <textarea className="ic-textarea" rows={2} value={d.handoffMessage} disabled={ro} maxLength={300} onChange={e => set('handoffMessage', e.target.value)} />
                  </label>
                </div>
              </SettingsFormSection>

              <SettingsFormSection title="Test AI Agent" description="Ask a question the way a customer would. Nothing is sent to anyone. Uses the saved settings.">
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input className="ic-input" value={question} onChange={e => setQuestion(e.target.value)} placeholder="How do I reset my password?"
                      onKeyDown={e => { if (e.key === 'Enter') runTest(); }} />
                    <button className="ic-btn-secondary shrink-0" onClick={runTest} disabled={testing || !question.trim()}><Send className="w-4 h-4" /> {testing ? 'Thinking…' : 'Ask'}</button>
                  </div>
                  {testError && <p className="text-[13px] text-red-600">{testError}</p>}
                  {test && (
                    <div className="rounded-xl border border-line p-3.5 flex flex-col gap-2 text-[14px]">
                      <div className="flex items-center gap-2 text-[12.5px] font-medium">
                        {test.handoff
                          ? <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><UserRound className="w-3.5 h-3.5" /> Would hand over: {test.reason}</span>
                          : <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><Sparkles className="w-3.5 h-3.5" /> Would answer · {Math.round(test.confidence * 100)}% sure</span>}
                      </div>
                      <p className="text-ink whitespace-pre-wrap">{test.wouldSay}</p>
                      {test.handoff && test.reply && <p className="text-[13px] text-muted">Its draft (not sent): {test.reply}</p>}
                      {test.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">{test.sources.map(s => <span key={s.id} className="ic-badge text-[12px]">{s.title}</span>)}</div>
                      )}
                    </div>
                  )}
                </div>
              </SettingsFormSection>

              <SettingsFormSection title="Last 30 days" description="Conversations the AI Agent took, and what happened to them.">
                {stats && stats.total > 0 ? (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        ['Conversations', String(stats.total)],
                        ['Resolved by AI', `${stats.resolved}${stats.resolutionRate !== null ? ` · ${Math.round(stats.resolutionRate * 100)}%` : ''}`],
                        ['Handed over', String(stats.handoff)],
                        ['Answering now', String(stats.active)],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-xl border border-line p-3"><div className="text-[12.5px] text-muted">{k}</div><div className="text-[18px] font-semibold text-ink tabular-nums">{v}</div></div>
                      ))}
                    </div>
                    {stats.topHandoffReasons.length > 0 && (
                      <div className="text-[13px]">
                        <div className="text-muted mb-1">Top reasons it handed over</div>
                        {stats.topHandoffReasons.map(r => <div key={r.reason} className="flex justify-between py-0.5"><span className="text-ink truncate">{r.reason}</span><span className="text-muted tabular-nums">{r.count}</span></div>)}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted flex items-center gap-2"><Bot className="w-4 h-4" /> No conversations yet.</p>
                )}
              </SettingsFormSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
