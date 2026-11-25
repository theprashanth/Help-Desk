import { useEffect, useState } from 'react';
import { AlertCircle, Check, Languages } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAiStatus } from '../../lib/aiFeatures';
import { MESSENGER_STRINGS, MessengerStrings } from '../../../../../shared/src/messengerStrings';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection } from './shared';

const PREVIEW_LANGS: { code: string; label: string }[] = [
  { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
  { code: 'hi', label: 'Hindi' }, { code: 'te', label: 'Telugu' }, { code: 'ar', label: 'Arabic' },
  { code: 'pt-br', label: 'Portuguese (Brazil)' }, { code: 'ja', label: 'Japanese' },
];
const SAMPLE_KEYS = ['hello', 'startChat', 'yourTickets', 'message', 'replyMinutes'] as const;

/**
 * Settings › Multilingual: show the Messenger in each visitor's browser language. The Messenger's text
 * and your greeting/welcome are translated once per language by the AI assistant and reused.
 */
export default function MultilingualSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const isAdmin = useStore(s => s.agent?.role === 'admin');
  const ai = useAiStatus();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [lang, setLang] = useState('es');
  const [preview, setPreview] = useState<{ lang: string; strings: MessengerStrings | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/messenger/settings`, { headers })
      .then(r => r.json()).then(d => setOn(!!d.appearance?.autoLanguage)).catch(() => setOn(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggle = async () => {
    if (on === null) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/messenger/settings`, { method: 'PUT', headers, body: JSON.stringify({ appearance: { autoLanguage: !on } }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save');
      setOn(!!d.appearance?.autoLanguage);
      setFlash(true); setTimeout(() => setFlash(false), 1800);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const runPreview = async () => {
    setPreviewing(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/messenger/i18n?lang=${encodeURIComponent(lang)}`, { headers });
      const d = await res.json();
      setPreview({ lang, strings: d.strings || null });
      if (!d.strings) setError('Couldn’t translate right now. Check that the AI assistant is set up and has quota left.');
    } catch { setError('Couldn’t reach the server'); }
    setPreviewing(false);
  };

  return (
    <>
      <SettingsPageHeader title="Multilingual" onBack={onBack}>
        {flash && <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /> Saved</span>}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="flex flex-col gap-4 max-w-5xl">
          {!isAdmin && <p className="ic-help">Only admins can change this. You’re viewing it read-only.</p>}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          <SettingsFormSection
            title="Messenger language"
            description={<>
              Show the Messenger in each visitor’s browser language: buttons, labels, ticket states, the help center and your greeting and welcome text.
              Each language is translated once by the AI assistant and reused. Messages from your team aren’t changed here; turn on translation in Settings › AI assistant for those.
            </>}
          >
            <div className="flex flex-col gap-3">
              <label className={`flex items-center gap-3 ${!isAdmin || on === null ? 'opacity-60' : 'cursor-pointer'}`}>
                <button type="button" role="switch" aria-checked={!!on} disabled={!isAdmin || on === null || saving} onClick={toggle}
                  className={`ic-toggle ${on ? 'ic-toggle-on' : ''} disabled:cursor-not-allowed`}>
                  <span className="ic-toggle-knob" />
                </button>
                <span className="text-[14px] text-ink">Show the Messenger in the visitor’s language</span>
              </label>
              {!ai.configured && (
                <p className="text-[13px] text-amber-700 dark:text-amber-300">The AI assistant isn’t set up, so visitors will see English until it is (Settings › AI assistant).</p>
              )}
            </div>
          </SettingsFormSection>

          {on && (
            <SettingsFormSection title="Preview" description="See how the Messenger reads in another language. The first preview of a language translates it, so it can take a few seconds.">
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <select className="ic-select h-9 w-[220px]" value={lang} onChange={e => setLang(e.target.value)}>
                    {PREVIEW_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                  <button className="ic-btn-secondary h-9" onClick={runPreview} disabled={previewing}><Languages className="w-4 h-4" /> {previewing ? 'Translating…' : 'Preview'}</button>
                </div>
                {preview?.strings && (
                  <div className="rounded-xl border border-line divide-y divide-line text-[13.5px]">
                    {[...SAMPLE_KEYS, 'welcome' as const].map(k => (
                      <div key={k} className="grid grid-cols-2 gap-3 px-3 py-2">
                        <span className="text-muted">{k === 'welcome' ? '(your welcome text)' : MESSENGER_STRINGS[k]}</span>
                        <span className="text-ink" dir="auto">{preview.strings![k]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SettingsFormSection>
          )}
        </div>
      </div>
    </>
  );
}
