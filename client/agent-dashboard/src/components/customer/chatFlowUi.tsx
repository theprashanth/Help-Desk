import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronsRight } from 'lucide-react';
import { ChatFlow, ChatFlowOption, ChatFlowQuestion, ConversationBotState } from '../../../../../shared/src/types';

/** The live flow as the public workspace endpoint returns it. */
export type LiveChatFlow = ChatFlow & { version: number };

// ── Phone country codes ─────────────────────────────────────────────────────

export const COUNTRIES: { code: string; dial: string; name: string }[] = [
  { code: 'IN', dial: '91', name: 'India' }, { code: 'US', dial: '1', name: 'United States' },
  { code: 'GB', dial: '44', name: 'United Kingdom' }, { code: 'AE', dial: '971', name: 'United Arab Emirates' },
  { code: 'CA', dial: '1', name: 'Canada' }, { code: 'AU', dial: '61', name: 'Australia' },
  { code: 'SG', dial: '65', name: 'Singapore' }, { code: 'SA', dial: '966', name: 'Saudi Arabia' },
  { code: 'QA', dial: '974', name: 'Qatar' }, { code: 'KW', dial: '965', name: 'Kuwait' },
  { code: 'OM', dial: '968', name: 'Oman' }, { code: 'BH', dial: '973', name: 'Bahrain' },
  { code: 'MY', dial: '60', name: 'Malaysia' }, { code: 'NZ', dial: '64', name: 'New Zealand' },
  { code: 'DE', dial: '49', name: 'Germany' }, { code: 'FR', dial: '33', name: 'France' },
  { code: 'IE', dial: '353', name: 'Ireland' }, { code: 'NL', dial: '31', name: 'Netherlands' },
  { code: 'IT', dial: '39', name: 'Italy' }, { code: 'ES', dial: '34', name: 'Spain' },
  { code: 'LK', dial: '94', name: 'Sri Lanka' }, { code: 'NP', dial: '977', name: 'Nepal' },
  { code: 'BD', dial: '880', name: 'Bangladesh' }, { code: 'PK', dial: '92', name: 'Pakistan' },
  { code: 'ZA', dial: '27', name: 'South Africa' }, { code: 'NG', dial: '234', name: 'Nigeria' },
  { code: 'KE', dial: '254', name: 'Kenya' }, { code: 'JP', dial: '81', name: 'Japan' },
  { code: 'PH', dial: '63', name: 'Philippines' }, { code: 'ID', dial: '62', name: 'Indonesia' },
  { code: 'BR', dial: '55', name: 'Brazil' }, { code: 'MX', dial: '52', name: 'Mexico' },
];
export const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));

// ── Rules shared with the server ────────────────────────────────────────────

export const validPhone = (v: string) => /^\+[1-9]\d{7,14}$/.test(v.replace(/[\s()-]/g, ''));
export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
export const fillName = (text: string, name?: string) => text.replace(/\{name\}/g, (name || '').trim().split(/\s+/)[0] || 'there');

function findOption(options: ChatFlowOption[], id: string | null): ChatFlowOption | null {
  if (!id) return null;
  for (const o of options) {
    if (o.id === id) return o;
    const hit = o.kind === 'menu' && o.children ? findOption(o.children, id) : null;
    if (hit) return hit;
  }
  return null;
}
export function optionsAt(flow: ChatFlow, node: string | null): ChatFlowOption[] {
  const n = findOption(flow.options, node);
  return n?.kind === 'menu' && n.children?.length ? n.children : flow.options;
}

// ── Details question card ("Your name" + input + Submit) ────────────────────

export const FlowQuestionCard: React.FC<{
  question: ChatFlowQuestion;
  defaultCountry: string;
  themeColor: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (value: string | null) => void;
}> = ({ question, defaultCountry, themeColor, busy, error, onSubmit }) => {
  const [value, setValue] = useState('');
  const [country, setCountry] = useState(() => COUNTRIES.find(c => c.code === defaultCountry) || COUNTRIES[0]);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(''); setLocalError(null); inputRef.current?.focus(); }, [question.id]);

  const submit = () => {
    const v = value.trim();
    if (!v) { setLocalError(question.required ? 'Please fill this in' : null); if (!question.required) onSubmit(null); return; }
    if (question.type === 'phone') {
      const full = `+${country.dial}${v.replace(/\D/g, '')}`;
      if (!validPhone(full)) return setLocalError('Enter a valid mobile number');
      return onSubmit(full);
    }
    if (question.type === 'email' && !validEmail(v)) return setLocalError('Enter a valid email address');
    onSubmit(v);
  };

  const shownError = localError || error;
  return (
    <div className="self-stretch bg-slate-100 dark:bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
      <span className="text-sm text-slate-800 dark:text-slate-100">{question.label}</span>
      <div
        className="flex items-center bg-white dark:bg-slate-900 rounded-lg border transition-colors"
        style={{ borderColor: shownError ? '#ef4444' : value ? themeColor : undefined }}
      >
        {question.type === 'phone' && (
          <label className="relative flex items-center gap-1 pl-3 pr-2 border-r border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer">
            <span>{flagOf(country.code)}</span>
            <span>+{country.dial}</span>
            <span className="text-slate-400 text-[10px]">▾</span>
            <select
              aria-label="Country code"
              className="absolute inset-0 opacity-0 cursor-pointer"
              value={country.code}
              onChange={e => setCountry(COUNTRIES.find(c => c.code === e.target.value) || COUNTRIES[0])}
            >
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{flagOf(c.code)} {c.name} (+{c.dial})</option>)}
            </select>
          </label>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={e => { setValue(e.target.value); setLocalError(null); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder={question.placeholder}
          inputMode={question.type === 'phone' ? 'tel' : question.type === 'email' ? 'email' : 'text'}
          type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : 'text'}
          autoComplete={question.type === 'name' ? 'name' : question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel-national' : 'off'}
          maxLength={question.type === 'phone' ? 15 : 200}
          disabled={busy}
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
        />
      </div>
      {shownError && <span className="text-xs text-red-500 -mt-1">{shownError}</span>}
      {!question.required && (
        <button onClick={() => onSubmit(null)} disabled={busy} className="self-center text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1">
          Skip <ChevronsRight className="w-4 h-4" />
        </button>
      )}
      <button onClick={submit} disabled={busy} className="self-end text-sm font-medium flex items-center gap-0.5 disabled:opacity-50" style={{ color: themeColor }}>
        {busy ? 'Sending…' : 'Submit'} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};

// ── Buttons under the bot's message (options, Yes/No, Back, Restart) ────────

export type FlowAction = { action: 'choose' | 'yes' | 'no' | 'back' | 'restart'; optionId?: string; label: string };

export function flowButtons(flow: ChatFlow, bot: ConversationBotState): FlowAction[] {
  const out: FlowAction[] = [];
  if (bot.state === 'menu') {
    for (const o of optionsAt(flow, bot.node)) out.push({ action: 'choose', optionId: o.id, label: o.label });
    if (bot.node && flow.showBack) out.push({ action: 'back', label: flow.backLabel });
  } else if (bot.state === 'confirm') {
    out.push({ action: 'yes', label: flow.yesLabel }, { action: 'no', label: flow.noLabel });
    if (flow.showBack) out.push({ action: 'back', label: flow.backLabel });
  } else if (bot.state === 'done') {
    if (flow.showBack) out.push({ action: 'back', label: flow.backLabel });
  }
  if (bot.state !== 'handoff' && flow.showRestart) out.push({ action: 'restart', label: flow.restartLabel });
  return out;
}

export const FlowChips: React.FC<{ buttons: FlowAction[]; themeColor: string; busy: boolean; onPick: (b: FlowAction) => void }> = ({ buttons, themeColor, busy, onPick }) => (
  <div className="flex flex-wrap justify-end gap-2 pl-6">
    {buttons.map(b => (
      <button
        key={`${b.action}-${b.optionId || ''}`}
        onClick={() => onPick(b)}
        disabled={busy}
        className="px-3.5 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:text-[var(--flow-color)] hover:border-[var(--flow-color)] disabled:opacity-50"
        style={{ ['--flow-color' as any]: themeColor }}
      >
        {b.label}
      </button>
    ))}
  </div>
);
