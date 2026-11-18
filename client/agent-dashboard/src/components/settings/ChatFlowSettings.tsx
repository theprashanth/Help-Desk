import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, Check, ChevronRight, Copy, FileText, FolderOpen, Plus, RotateCcw, Search, Trash2, X,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ChatFlow, ChatFlowOption, ChatFlowQuestion, ChatFlowQuestionType, ChatFlowSettings as ChatFlowSettingsData } from '../../../../../shared/src/types';
import Modal from '../ui/Modal';
import RichComposer from '../agent/RichComposer';
import { RichText } from '../../lib/richText';
import { BACKEND_URL, SettingsPageHeader, SettingsFormSection, relativeTime } from './shared';

// ─── Limits (mirror server/src/services/chatFlow.ts validateChatFlow) ─────────

const LIMITS = { short: 120, text: 600, answer: 6000, options: 40, depth: 5, total: 400, questions: 8 };

type TabId = 'basics' | 'details' | 'menu' | 'after' | 'buttons';
const TABS: { id: TabId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'details', label: 'Details form' },
  { id: 'menu', label: 'Menu' },
  { id: 'after', label: 'After an answer' },
  { id: 'buttons', label: 'Buttons' },
];

const QUESTION_TYPES: { id: ChatFlowQuestionType; label: string; hint: string }[] = [
  { id: 'name', label: 'Name', hint: 'Their first name fills {name} in the main menu message.' },
  { id: 'phone', label: 'Phone', hint: 'Visitors pick a country code; the number is checked before they continue.' },
  { id: 'email', label: 'Email', hint: 'Checked for a valid email address.' },
  { id: 'text', label: 'Text', hint: 'Any short answer.' },
];

const COUNTRIES: { code: string; name: string; dial: string }[] = [
  { code: 'IN', name: 'India', dial: '91' },
  { code: 'US', name: 'United States', dial: '1' },
  { code: 'GB', name: 'United Kingdom', dial: '44' },
  { code: 'CA', name: 'Canada', dial: '1' },
  { code: 'AU', name: 'Australia', dial: '61' },
  { code: 'NZ', name: 'New Zealand', dial: '64' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966' },
  { code: 'QA', name: 'Qatar', dial: '974' },
  { code: 'KW', name: 'Kuwait', dial: '965' },
  { code: 'OM', name: 'Oman', dial: '968' },
  { code: 'BH', name: 'Bahrain', dial: '973' },
  { code: 'SG', name: 'Singapore', dial: '65' },
  { code: 'MY', name: 'Malaysia', dial: '60' },
  { code: 'ID', name: 'Indonesia', dial: '62' },
  { code: 'TH', name: 'Thailand', dial: '66' },
  { code: 'PH', name: 'Philippines', dial: '63' },
  { code: 'HK', name: 'Hong Kong', dial: '852' },
  { code: 'JP', name: 'Japan', dial: '81' },
  { code: 'PK', name: 'Pakistan', dial: '92' },
  { code: 'BD', name: 'Bangladesh', dial: '880' },
  { code: 'LK', name: 'Sri Lanka', dial: '94' },
  { code: 'NP', name: 'Nepal', dial: '977' },
  { code: 'DE', name: 'Germany', dial: '49' },
  { code: 'FR', name: 'France', dial: '33' },
  { code: 'NL', name: 'Netherlands', dial: '31' },
  { code: 'IE', name: 'Ireland', dial: '353' },
  { code: 'ZA', name: 'South Africa', dial: '27' },
  { code: 'NG', name: 'Nigeria', dial: '234' },
  { code: 'KE', name: 'Kenya', dial: '254' },
];

// ─── Pure helpers ────────────────────────────────────────────────────────────

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
function newId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ID_CHARS[b % ID_CHARS.length]).join('');
}

/** JSON with sorted keys, so key order never makes two equal flows look different. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter(k => (v as any)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
const sameFlow = (a: ChatFlow | null | undefined, b: ChatFlow | null | undefined) => !!a && !!b && stable(a) === stable(b);

const countAll = (list: ChatFlowOption[]): number => list.reduce((n, o) => n + 1 + (o.kind === 'menu' ? countAll(o.children || []) : 0), 0);

function findOption(list: ChatFlowOption[], id: string | null): ChatFlowOption | null {
  if (!id) return null;
  for (const o of list) {
    if (o.id === id) return o;
    const hit = o.kind === 'menu' && o.children ? findOption(o.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** Ids of the menus that contain `id` (outermost first), or null when not found. */
function ancestorsOf(list: ChatFlowOption[], id: string, trail: string[] = []): string[] | null {
  for (const o of list) {
    if (o.id === id) return trail;
    if (o.kind === 'menu' && o.children) {
      const hit = ancestorsOf(o.children, id, [...trail, o.id]);
      if (hit) return hit;
    }
  }
  return null;
}

/** Depth of the sibling list `id` sits in (main menu = 1). */
const depthOf = (list: ChatFlowOption[], id: string) => (ancestorsOf(list, id)?.length ?? 0) + 1;

/** Replace the sibling list that contains `id` with fn(list, index). */
function editSiblingsOf(list: ChatFlowOption[], id: string, fn: (siblings: ChatFlowOption[], index: number) => ChatFlowOption[]): ChatFlowOption[] {
  const i = list.findIndex(o => o.id === id);
  if (i >= 0) return fn(list, i);
  return list.map(o => (o.kind === 'menu' && o.children ? { ...o, children: editSiblingsOf(o.children, id, fn) } : o));
}

function updateOption(list: ChatFlowOption[], id: string, fn: (o: ChatFlowOption) => ChatFlowOption): ChatFlowOption[] {
  return editSiblingsOf(list, id, (sib, i) => sib.map((o, j) => (j === i ? fn(o) : o)));
}

function cloneWithNewIds(o: ChatFlowOption): ChatFlowOption {
  return o.kind === 'menu'
    ? { id: newId(), label: o.label, kind: 'menu', prompt: o.prompt || '', children: (o.children || []).map(cloneWithNewIds) }
    : { id: newId(), label: o.label, kind: 'answer', answer: o.answer || '' };
}

/** Light theme colors (e.g. yellow) need dark text on top to stay readable. */
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

const fillName = (text: string, name?: string) => text.replace(/\{name\}/g, (name || '').trim().split(/\s+/)[0] || 'there');
const validPhone = (v: string) => /^\+[1-9]\d{7,14}$/.test(v.replace(/[\s()-]/g, ''));
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
const optionsAt = (flow: ChatFlow, node: string | null): ChatFlowOption[] => {
  const n = findOption(flow.options, node);
  return n?.kind === 'menu' && n.children?.length ? n.children : flow.options;
};

// ─── Validation (same rules and wording as the server) ───────────────────────

type Issue = { tab: TabId; message: string; optionId?: string; questionId?: string };

function validate(f: ChatFlow): Issue[] {
  const issues: Issue[] = [];
  const text = (tab: TabId, v: string | undefined, label: string, max: number, allowEmpty = false, extra: Partial<Issue> = {}) => {
    const t = (v || '').trim();
    if (!allowEmpty && !t) issues.push({ tab, message: `${label} can't be empty`, ...extra });
    else if (t.length > max) issues.push({ tab, message: `${label} must be at most ${max} characters`, ...extra });
  };

  text('basics', f.botName, 'Bot name', 60);
  text('basics', f.botSubtitle, 'Subtitle', 80, true);
  text('basics', f.welcome, 'Welcome message', LIMITS.text);

  f.questions.forEach((q, i) => {
    text('details', q.label, `Question ${i + 1}`, LIMITS.short, false, { questionId: q.id });
    text('details', q.placeholder, `Question ${i + 1} placeholder`, LIMITS.short, true, { questionId: q.id });
  });
  if (f.askDetails && !f.questions.length) issues.push({ tab: 'details', message: 'Add at least one question, or turn off "Ask for details"' });
  if (f.questions.length > LIMITS.questions) issues.push({ tab: 'details', message: `At most ${LIMITS.questions} questions` });
  text('details', f.detailsPlaceholder, 'Placeholder while answering', LIMITS.short, true);

  text('menu', f.menuPrompt, 'Main menu message', LIMITS.text);
  text('menu', f.menuPlaceholder, 'Placeholder in menus', LIMITS.short, true);
  if (!f.options.length) issues.push({ tab: 'menu', message: 'Add at least one option to the main menu' });
  if (f.options.length > LIMITS.options) issues.push({ tab: 'menu', message: `The main menu can have at most ${LIMITS.options} options` });
  const total = countAll(f.options);
  if (total > LIMITS.total) issues.push({ tab: 'menu', message: `At most ${LIMITS.total} options in total (you have ${total})` });
  const walk = (list: ChatFlowOption[], depth: number, where: string) => list.forEach((o, i) => {
    const label = o.label.trim();
    const name = label ? `"${label}"` : `${where} option ${i + 1}`;
    const at = { optionId: o.id };
    if (!label) issues.push({ tab: 'menu', message: `${where} option ${i + 1} needs a label`, ...at });
    else if (label.length > LIMITS.short) issues.push({ tab: 'menu', message: `${name} label must be at most ${LIMITS.short} characters`, ...at });
    if (o.kind === 'menu') {
      const kids = o.children || [];
      if (depth >= LIMITS.depth) issues.push({ tab: 'menu', message: `Menus can be nested at most ${LIMITS.depth} levels deep`, ...at });
      if (!kids.length) issues.push({ tab: 'menu', message: `${name} opens a menu but has no options in it`, ...at });
      if (kids.length > LIMITS.options) issues.push({ tab: 'menu', message: `${name} has more than ${LIMITS.options} options`, ...at });
      text('menu', o.prompt, `${name} message`, LIMITS.text, true, at);
      walk(kids, depth + 1, name);
    } else {
      text('menu', o.answer, `${name} answer`, LIMITS.answer, false, at);
    }
  });
  walk(f.options, 1, 'Main menu');

  text('after', f.resolvedQuestion, '"Did this solve" question', LIMITS.short);
  text('after', f.yesLabel, 'Yes button', 40);
  text('after', f.noLabel, 'No button', 40);
  text('after', f.yesReply, 'Reply to Yes', LIMITS.text);
  text('after', f.noReply, 'Reply to No', LIMITS.text);

  text('buttons', f.backLabel, 'Back button', 40);
  text('buttons', f.restartLabel, 'Restart button', 40);
  text('buttons', f.restartMessage, 'Restart message', LIMITS.text);
  text('buttons', f.restartPrompt, 'Restart prompt', LIMITS.text);
  return issues;
}

// ─── Small building blocks (module level so they never remount while typing) ──

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" /> <div className="min-w-0 break-words flex-1">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ic-toggle ${checked ? 'ic-toggle-on' : ''} shrink-0 disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className="ic-toggle-knob" />
    </button>
  );
}

function ToggleRow({ checked, onChange, disabled, title, help }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title: string; help?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={title} />
      <div>
        <p className="text-[14px] font-medium text-ink">{title}</p>
        {help && <p className="ic-help">{help}</p>}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange, disabled }: {
  options: { id: T; label: string; disabled?: boolean; title?: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex self-start p-1 bg-subtle rounded-full text-[13px]">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.id)}
          className={`h-7 px-3.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed ${value === o.id ? 'bg-surface shadow-pill text-ink' : 'text-muted hover:text-ink disabled:opacity-50'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const cls = tone === 'green'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
      : 'bg-subtle text-muted';
  const dot = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-faint';
  return (
    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-medium whitespace-nowrap ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} /> {children}
    </span>
  );
}

/** Text field with label, help and a live character limit. */
function TextField({ id, label, value, onChange, max, disabled, placeholder, help, multiline, rows = 3 }: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number; disabled?: boolean;
  placeholder?: string; help?: React.ReactNode; multiline?: boolean; rows?: number;
}) {
  const over = value.trim().length > max;
  return (
    <div>
      <label className="ic-label" htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} value={value} rows={rows} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="ic-textarea" />
      ) : (
        <input id={id} value={value} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="ic-input" />
      )}
      <div className="flex items-start justify-between gap-3">
        {help ? <p className="ic-help">{help}</p> : <span />}
        {(over || value.length > max * 0.8) && (
          <span className={`ic-help tabular-nums shrink-0 ${over ? 'text-red-600 dark:text-red-400' : ''}`}>{value.trim().length}/{max}</span>
        )}
      </div>
    </div>
  );
}

/** Markdown editor box (bold/italic shown as formatting); read-only falls back to rendered text. */
function MarkdownField({ value, onChange, readOnly, placeholder, minH = 'min-h-[96px]', maxH = 'max-h-[280px]' }: {
  value: string; onChange: (v: string) => void; readOnly?: boolean; placeholder?: string; minH?: string; maxH?: string;
}) {
  if (readOnly) {
    return (
      <div className={`ic-textarea bg-subtle text-muted whitespace-pre-wrap break-words overflow-y-auto ${minH} ${maxH}`}>
        {value ? <RichText text={value} /> : <span className="text-faint">{placeholder}</span>}
      </div>
    );
  }
  return <RichComposer value={value} onChange={onChange} placeholder={placeholder} className={`ic-textarea ${minH} ${maxH}`} />;
}

// ─── Option tree editor ──────────────────────────────────────────────────────

type TreeActions = {
  update: (id: string, patch: Partial<ChatFlowOption>) => void;
  move: (id: string, dir: -1 | 1) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  add: (parentId: string | null) => void;
  setKind: (id: string, kind: ChatFlowOption['kind']) => void;
  toggle: (id: string) => void;
};

type TreeCtx = {
  readOnly: boolean;
  expanded: Set<string>;
  query: string;
  issues: Map<string, string[]>;
  focusId: string | null;
  total: number;
  actions: TreeActions;
};

const optionMatches = (o: ChatFlowOption, q: string): boolean =>
  o.label.toLowerCase().includes(q) || (o.kind === 'answer' && (o.answer || '').toLowerCase().includes(q));
const subtreeMatches = (o: ChatFlowOption, q: string): boolean =>
  optionMatches(o, q) || (o.kind === 'menu' && (o.children || []).some(c => subtreeMatches(c, q)));

function AddOptionButton({ parentId, count, ctx, label }: { parentId: string | null; count: number; ctx: TreeCtx; label: string }) {
  if (ctx.readOnly || ctx.query) return null;
  const full = count >= LIMITS.options || ctx.total >= LIMITS.total;
  return (
    <button
      type="button"
      onClick={() => ctx.actions.add(parentId)}
      disabled={full}
      title={full ? `At most ${LIMITS.options} options per menu and ${LIMITS.total} in total` : undefined}
      className="ic-add-link self-start text-[14px] disabled:opacity-40 disabled:pointer-events-none"
    >
      <Plus className="w-4 h-4" /> {label}
    </button>
  );
}

function OptionList({ list, depth, parentId, ctx }: { list: ChatFlowOption[]; depth: number; parentId: string | null; ctx: TreeCtx }) {
  const shown = ctx.query ? list.filter(o => subtreeMatches(o, ctx.query)) : list;
  return (
    <div className="flex flex-col gap-2">
      {shown.map(o => (
        <OptionNode key={o.id} o={o} depth={depth} index={list.indexOf(o)} count={list.length} ctx={ctx} />
      ))}
      <AddOptionButton parentId={parentId} count={list.length} ctx={ctx} label={parentId ? 'Add option' : 'Add category'} />
    </div>
  );
}

function OptionNode({ o, depth, index, count, ctx }: { o: ChatFlowOption; depth: number; index: number; count: number; ctx: TreeCtx }) {
  const { readOnly, actions } = ctx;
  const kids = o.children || [];
  const forced = !!ctx.query && o.kind === 'menu' && kids.some(c => subtreeMatches(c, ctx.query));
  const open = ctx.expanded.has(o.id) || forced;
  const own = ctx.issues.get(o.id) || [];
  const nestedIssue = !own.length && !open && o.kind === 'menu' && hasNestedIssue(kids, ctx.issues);
  const hit = !!ctx.query && optionMatches(o, ctx.query);
  const Icon = o.kind === 'menu' ? FolderOpen : FileText;

  return (
    <div className={`rounded-lg border bg-surface ${own.length ? 'border-red-300 dark:border-red-500/50' : 'border-line'}`} data-option-id={o.id}>
      <div className="flex items-center gap-1.5 min-h-[44px] pl-1.5 pr-2">
        <button
          type="button"
          onClick={() => actions.toggle(o.id)}
          className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left"
          aria-expanded={open}
        >
          <ChevronRight className={`w-4 h-4 text-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Icon className={`w-4 h-4 shrink-0 ${o.kind === 'menu' ? 'text-violet-600 dark:text-violet-300' : 'text-sky-600 dark:text-sky-300'}`} />
          <span className={`truncate text-[14px] font-medium ${o.label.trim() ? 'text-ink' : 'text-faint italic'} ${hit ? 'bg-amber-100 dark:bg-amber-500/20 rounded px-0.5' : ''}`}>
            {o.label.trim() || 'Untitled option'}
          </span>
          <span className="ic-badge shrink-0">
            {o.kind === 'menu' ? `Opens menu · ${kids.length}` : 'Shows answer'}
          </span>
          {(own.length > 0 || nestedIssue) && <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-label="Needs attention" />}
        </button>
        {!readOnly && (
          <div className="flex items-center shrink-0">
            <button type="button" className="ic-icon-btn-ghost w-7 h-7 disabled:opacity-30" title="Move up" disabled={index === 0 || !!ctx.query} onClick={() => actions.move(o.id, -1)}>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="ic-icon-btn-ghost w-7 h-7 disabled:opacity-30" title="Move down" disabled={index === count - 1 || !!ctx.query} onClick={() => actions.move(o.id, 1)}>
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="ic-icon-btn-ghost w-7 h-7 disabled:opacity-30" title="Duplicate" disabled={count >= LIMITS.options} onClick={() => actions.duplicate(o.id)}>
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="ic-icon-btn-ghost w-7 h-7 hover:text-red-600" title="Delete" onClick={() => actions.remove(o.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-line px-4 pt-4 pb-4 flex flex-col gap-4">
          {own.length > 0 && <ErrorBox>{own.map(m => <div key={m}>{m}</div>)}</ErrorBox>}
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
            <div>
              <label className="ic-label" htmlFor={`opt-label-${o.id}`}>Button label</label>
              <input
                id={`opt-label-${o.id}`}
                className="ic-input"
                value={o.label}
                maxLength={LIMITS.short}
                disabled={readOnly}
                autoFocus={ctx.focusId === o.id}
                placeholder="e.g. Payment issues"
                onChange={e => actions.update(o.id, { label: e.target.value })}
              />
            </div>
            <div>
              <p className="ic-label">When tapped</p>
              <Segmented
                options={[
                  { id: 'menu', label: 'Opens menu', disabled: depth >= LIMITS.depth, title: depth >= LIMITS.depth ? `Menus can be nested at most ${LIMITS.depth} levels deep` : undefined },
                  { id: 'answer', label: 'Shows answer' },
                ]}
                value={o.kind}
                disabled={readOnly}
                onChange={k => actions.setKind(o.id, k)}
              />
            </div>
          </div>

          {o.kind === 'answer' ? (
            <div>
              <p className="ic-label">Answer</p>
              <MarkdownField
                key={o.id}
                value={o.answer || ''}
                onChange={v => actions.update(o.id, { answer: v })}
                readOnly={readOnly}
                placeholder="The answer the bot sends. Use Cmd+B for bold, paste from Sheets or Docs to keep formatting."
                minH="min-h-[180px]"
                maxH="max-h-[420px]"
              />
              <div className="flex justify-between gap-3">
                <p className="ic-help">Supports **bold**, *italic*, emoji, numbered lines and links.</p>
                <span className={`ic-help tabular-nums shrink-0 ${(o.answer || '').trim().length > LIMITS.answer ? 'text-red-600 dark:text-red-400' : ''}`}>
                  {(o.answer || '').trim().length}/{LIMITS.answer}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="ic-label">Message above its options</p>
                <MarkdownField
                  key={o.id}
                  value={o.prompt || ''}
                  onChange={v => actions.update(o.id, { prompt: v })}
                  readOnly={readOnly}
                  placeholder={`Optional. If empty, the bot says "${o.label || 'the button label'}".`}
                  minH="min-h-[72px]"
                  maxH="max-h-[200px]"
                />
              </div>
              <div className="flex flex-col gap-2 pl-3 border-l-2 border-line">
                <p className="text-[13px] font-medium text-muted">Options in this menu</p>
                {kids.length === 0 && !ctx.query && <p className="text-[13px] text-faint">No options yet — add at least one.</p>}
                <OptionList list={kids} depth={depth + 1} parentId={o.id} ctx={ctx} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function hasNestedIssue(list: ChatFlowOption[], issues: Map<string, string[]>): boolean {
  return list.some(o => issues.has(o.id) || (o.kind === 'menu' && hasNestedIssue(o.children || [], issues)));
}

// ─── Live preview (client-side simulation of the draft) ──────────────────────

type PMsg = { id: number; from: 'bot' | 'user'; text: string };
type PState = {
  msgs: PMsg[];
  phase: 'question' | 'menu' | 'confirm' | 'done' | 'handoff';
  q: number;
  node: string | null;
  name: string;
};

let pmsgSeq = 0;
const bot = (text: string): PMsg => ({ id: ++pmsgSeq, from: 'bot', text });
const user = (text: string): PMsg => ({ id: ++pmsgSeq, from: 'user', text });

function startPreview(flow: ChatFlow): PState {
  const msgs = [bot(flow.welcome)];
  if (flow.askDetails && flow.questions.length) return { msgs, phase: 'question', q: 0, node: null, name: '' };
  return { msgs: [...msgs, bot(fillName(flow.menuPrompt, ''))], phase: 'menu', q: 0, node: null, name: '' };
}

function Chip({ onClick, color, children, subtle }: { onClick: () => void; color: string; children: React.ReactNode; subtle?: boolean }) {
  const text = isLightColor(color) ? '#0f172a' : color;
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full border text-[12px] font-medium bg-white hover:bg-[#f8fafc] text-left leading-snug max-w-full"
      style={subtle ? { borderColor: '#e2e8f0', color: '#475569' } : { borderColor: color, color: text }}
    >
      {children}
    </button>
  );
}

function FlowPreview({ flow, themeColor }: { flow: ChatFlow; themeColor: string }) {
  const [s, setS] = useState<PState>(() => startPreview(flow));
  const [value, setValue] = useState('');
  const [country, setCountry] = useState(flow.defaultCountry || 'IN');
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the visitor's last tap at the top so a long answer is read from its start
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const users = el.querySelectorAll<HTMLElement>('[data-from="user"]');
    const last = users[users.length - 1];
    el.scrollTo({ top: last ? last.offsetTop - 8 : 0 });
  }, [s.msgs.length, s.phase]);
  useEffect(() => { setCountry(flow.defaultCountry || 'IN'); }, [flow.defaultCountry]);

  const reset = () => { setS(startPreview(flow)); setValue(''); setErr(null); };
  const question: ChatFlowQuestion | undefined = s.phase === 'question' ? flow.questions[s.q] : undefined;
  const dial = COUNTRIES.find(c => c.code === country)?.dial || '91';
  const onTheme = isLightColor(themeColor) ? '#111827' : '#ffffff';

  const toMenuAfterDetails = (msgs: PMsg[], name: string) =>
    setS({ msgs: [...msgs, bot(fillName(flow.menuPrompt, name))], phase: 'menu', q: 0, node: null, name });

  const answerQuestion = (skip: boolean) => {
    if (!question) return;
    let v = value.trim();
    if (!skip) {
      if (!v) { setErr(question.required ? 'This is required' : 'Type an answer or tap Skip'); return; }
      if (question.type === 'phone') {
        v = `+${dial}${v.replace(/[^\d]/g, '')}`;
        if (!validPhone(v)) { setErr('Enter a valid mobile number with country code'); return; }
      }
      if (question.type === 'email' && !validEmail(v)) { setErr('Enter a valid email address'); return; }
    }
    const name = question.type === 'name' && !skip ? v : s.name;
    const msgs = [...s.msgs, bot(question.label), user(skip ? 'Skipped' : v)];
    setValue(''); setErr(null);
    if (s.q + 1 < flow.questions.length) setS({ ...s, msgs, q: s.q + 1, name });
    else toMenuAfterDetails(msgs, name);
  };

  const choose = (o: ChatFlowOption) => {
    const msgs = [...s.msgs, user(o.label)];
    if (o.kind === 'menu') { setS({ ...s, msgs: [...msgs, bot(o.prompt || o.label)], node: o.id }); return; }
    msgs.push(bot(o.answer || ''));
    if (flow.askResolved) { msgs.push(bot(flow.resolvedQuestion)); setS({ ...s, msgs, phase: 'confirm' }); }
    else setS({ ...s, msgs });
  };
  const yes = () => setS({ ...s, msgs: [...s.msgs, user(flow.yesLabel), bot(flow.yesReply)], phase: 'done' });
  const no = () => setS({ ...s, msgs: [...s.msgs, user(flow.noLabel), bot(flow.noReply)], phase: 'handoff' });
  const back = () => setS({ ...s, msgs: [...s.msgs, user(flow.backLabel), bot(fillName(flow.menuPrompt, s.name))], phase: 'menu', node: null });
  const restart = () => setS({ ...s, msgs: [...s.msgs, user(flow.restartLabel), bot(flow.restartMessage), bot(flow.restartPrompt)], phase: 'menu', node: null });

  const navChips = s.phase !== 'question' && s.phase !== 'handoff' && (
    <>
      {flow.showBack && (s.phase !== 'menu' || s.node) && <Chip subtle color={themeColor} onClick={back}>{flow.backLabel || 'Back'}</Chip>}
      {flow.showRestart && <Chip subtle color={themeColor} onClick={restart}>{flow.restartLabel || 'Restart'}</Chip>}
    </>
  );
  const placeholder = s.phase === 'question' ? flow.detailsPlaceholder : s.phase === 'handoff' ? 'Write a reply…' : flow.menuPlaceholder;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">Preview{flow.enabled ? '' : ' · flow is off'}</p>
        <button type="button" onClick={reset} className="ic-btn-ghost ic-btn-sm"><RotateCcw className="w-3.5 h-3.5" /> Reset preview</button>
      </div>
      <div className="w-[360px] h-[620px] rounded-3xl overflow-hidden shadow-card border border-line bg-[#f8fafc] flex flex-col" data-testid="chatflow-preview">
        <div className="px-4 py-3.5 flex items-center gap-2.5 shrink-0" style={{ background: themeColor, color: onTheme }}>
          <span className="w-8 h-8 rounded-full border-2 border-black/10 bg-black/10 flex items-center justify-center text-[13px] font-semibold uppercase shrink-0">
            {(flow.botName || '?').trim().charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-[14px] truncate">{flow.botName || 'Bot name'}</p>
            {flow.botSubtitle && <p className="text-[11px] opacity-85 truncate">{flow.botSubtitle}</p>}
          </div>
        </div>

        <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2">
          {s.msgs.map(m => (
            m.from === 'bot' ? (
              <div key={m.id} className="self-start max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-md bg-white border border-[#e2e8f0] text-[12.5px] text-[#0f172a] whitespace-pre-wrap break-words leading-relaxed">
                <RichText text={m.text} />
              </div>
            ) : (
              <div key={m.id} data-from="user" className="self-end max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md text-[12.5px] whitespace-pre-wrap break-words" style={{ background: themeColor, color: onTheme }}>
                {m.text}
              </div>
            )
          ))}

          {question && (
            <form
              className="self-stretch mt-1 p-3 rounded-2xl bg-white border border-[#e2e8f0] flex flex-col gap-2"
              onSubmit={e => { e.preventDefault(); answerQuestion(false); }}
            >
              <p className="text-[12.5px] font-medium text-[#0f172a]">{question.label || 'Untitled question'}</p>
              <div className="flex gap-1.5">
                {question.type === 'phone' && (
                  <select
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className="h-9 rounded-lg border border-[#e2e8f0] bg-white text-[12px] text-[#0f172a] px-1"
                    aria-label="Country code"
                  >
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code} +{c.dial}</option>)}
                  </select>
                )}
                <input
                  value={value}
                  onChange={e => { setValue(e.target.value); setErr(null); }}
                  placeholder={question.placeholder}
                  inputMode={question.type === 'phone' ? 'tel' : question.type === 'email' ? 'email' : 'text'}
                  className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-[#e2e8f0] bg-white text-[12.5px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none"
                  data-testid="preview-input"
                />
              </div>
              {err && <p className="text-[11.5px] text-red-600">{err}</p>}
              <div className="flex gap-2 justify-end">
                {!question.required && (
                  <button type="button" onClick={() => answerQuestion(true)} className="h-8 px-3 rounded-lg text-[12px] font-medium text-[#475569] hover:bg-[#f1f5f9]">Skip</button>
                )}
                <button type="submit" className="h-8 px-3.5 rounded-lg text-[12px] font-semibold" style={{ background: themeColor, color: onTheme }}>Submit</button>
              </div>
            </form>
          )}

          {s.phase === 'handoff' && (
            <p className="self-center text-[11px] text-[#64748b] text-center px-4 py-1">The conversation opens in your Inbox and the visitor can type to your team.</p>
          )}
          {s.phase === 'done' && (
            <p className="self-center text-[11px] text-[#64748b] text-center px-4 py-1">Conversation marked resolved by the bot.</p>
          )}
        </div>

        {(s.phase === 'menu' || s.phase === 'confirm' || s.phase === 'done') && (
          <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1.5 max-h-[45%] overflow-y-auto shrink-0">
            {s.phase === 'menu' && optionsAt(flow, s.node).map(o => (
              <Chip key={o.id} color={themeColor} onClick={() => choose(o)}>{o.label || 'Untitled option'}</Chip>
            ))}
            {s.phase === 'confirm' && (
              <>
                <Chip color={themeColor} onClick={yes}>{flow.yesLabel}</Chip>
                <Chip color={themeColor} onClick={no}>{flow.noLabel}</Chip>
              </>
            )}
            {navChips}
          </div>
        )}

        <div className="px-3 py-2.5 border-t border-[#e2e8f0] bg-white shrink-0">
          <div className="h-9 px-3 rounded-full bg-[#f1f5f9] text-[12px] text-[#94a3b8] flex items-center truncate">{placeholder || ' '}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Confirm = { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; action: () => Promise<void> | void };

export default function ChatFlowSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const isAdmin = me?.role === 'admin';
  const readOnly = !isAdmin;

  const [data, setData] = useState<ChatFlowSettingsData | null>(null);
  const [draft, setDraft] = useState<ChatFlow | null>(null);
  const [themeColor, setThemeColor] = useState('#8B5CF6');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('basics');
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'discard'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const authHeaders = useMemo(() => ({ 'Authorization': `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [r, m] = await Promise.all([
          fetch(`${BACKEND_URL}/api/chat-flow`, { headers: authHeaders }),
          fetch(`${BACKEND_URL}/api/messenger/settings`, { headers: authHeaders }).catch(() => null),
        ]);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not load the chat flow');
        const ms = m && m.ok ? await m.json().catch(() => null) : null;
        if (cancelled) return;
        setData(d);
        setDraft(d.draft);
        const color = ms?.appearance?.themeColor;
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) setThemeColor(color);
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, authHeaders]);

  const dirty = !!data && !!draft && !sameFlow(draft, data.draft);
  const unpublished = !!data && !!draft && (dirty || !sameFlow(data.draft, data.published));
  const issues = useMemo(() => (draft ? validate(draft) : []), [draft]);
  const optionIssues = useMemo(() => {
    const m = new Map<string, string[]>();
    issues.forEach(i => { if (i.optionId) m.set(i.optionId, [...(m.get(i.optionId) || []), i.message]); });
    return m;
  }, [issues]);
  const tabsWithIssues = useMemo(() => new Set(issues.map(i => i.tab)), [issues]);
  const valid = issues.length === 0;

  // Warn before closing the tab with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof ChatFlow>(k: K, v: ChatFlow[K]) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const setOptions = (fn: (list: ChatFlowOption[]) => ChatFlowOption[]) => setDraft(d => (d ? { ...d, options: fn(d.options) } : d));
  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2500); };

  // ── Server actions ──
  const call = async (method: 'PUT' | 'POST', path: string, body?: unknown): Promise<ChatFlowSettingsData> => {
    const res = await fetch(`${BACKEND_URL}/api/chat-flow${path}`, {
      method,
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  };
  const applyServer = (d: ChatFlowSettingsData) => { setData(d); setDraft(d.draft); };

  const save = async () => {
    if (!draft || !dirty || !valid) return;
    setBusy('save'); setActionError(null);
    try { applyServer(await call('PUT', '', { draft })); showFlash('Draft saved'); }
    catch (err: any) { setActionError(err.message); }
    finally { setBusy(null); }
  };

  const publish = async () => {
    if (!draft || !valid || !unpublished) return;
    setBusy('publish'); setActionError(null);
    try {
      if (dirty) applyServer(await call('PUT', '', { draft }));
      const d = await call('POST', '/publish');
      applyServer(d);
      showFlash(d.published?.enabled ? `Published v${d.version} — live in the Messenger` : `Published v${d.version} (flow is off)`);
    } catch (err: any) { setActionError(err.message); }
    finally { setBusy(null); }
  };

  const discard = () => {
    if (!data) return;
    const serverDiscard = !!data.published && !sameFlow(data.draft, data.published);
    setConfirm({
      title: 'Discard changes?',
      body: serverDiscard
        ? `The draft goes back to the live version (v${data.version}). Your unpublished edits will be lost.`
        : 'Your unsaved edits will be lost.',
      confirmLabel: 'Discard changes',
      danger: true,
      action: async () => {
        setActionError(null);
        if (!serverDiscard) { setDraft(data.draft); return; }
        setBusy('discard');
        try { applyServer(await call('POST', '/discard')); showFlash('Changes discarded'); }
        catch (err: any) { setActionError(err.message); }
        finally { setBusy(null); }
      },
    });
  };

  const leave = () => {
    if (!dirty) { onBack(); return; }
    setConfirm({ title: 'Leave without saving?', body: 'You have edits that aren’t saved yet.', confirmLabel: 'Leave', danger: true, action: onBack });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try { await confirm.action(); } finally { setConfirmBusy(false); setConfirm(null); }
  };

  // ── Questions ──
  const setQuestions = (fn: (qs: ChatFlowQuestion[]) => ChatFlowQuestion[]) => setDraft(d => (d ? { ...d, questions: fn(d.questions) } : d));
  const updateQuestion = (id: string, patch: Partial<ChatFlowQuestion>) => setQuestions(qs => qs.map(q => (q.id === id ? { ...q, ...patch } : q)));
  const moveQuestion = (i: number, dir: -1 | 1) => setQuestions(qs => {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return qs;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const addQuestion = () => setQuestions(qs => (qs.length >= LIMITS.questions ? qs : [...qs, { id: newId(), type: 'text', label: '', placeholder: '', required: true }]));

  // ── Option tree actions ──
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reveal = (id: string) => {
    if (!draft) return;
    const trail = ancestorsOf(draft.options, id) || [];
    setQuery('');
    setExpanded(prev => new Set([...prev, ...trail, id]));
    setTab('menu');
    setTimeout(() => document.querySelector(`[data-option-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const actions: TreeActions = {
    toggle,
    update: (id, patch) => setOptions(list => updateOption(list, id, o => ({ ...o, ...patch }))),
    move: (id, dir) => setOptions(list => editSiblingsOf(list, id, (sib, i) => {
      const j = i + dir;
      if (j < 0 || j >= sib.length) return sib;
      const next = [...sib];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    })),
    duplicate: (id) => {
      if (!draft) return;
      const o = findOption(draft.options, id);
      if (!o || countAll(draft.options) + countAll([o]) > LIMITS.total) return;
      const copy = { ...cloneWithNewIds(o), label: `${o.label} (copy)`.slice(0, LIMITS.short) };
      setOptions(list => editSiblingsOf(list, id, (sib, i) => (sib.length >= LIMITS.options ? sib : [...sib.slice(0, i + 1), copy, ...sib.slice(i + 1)])));
    },
    remove: (id) => {
      if (!draft) return;
      const o = findOption(draft.options, id);
      if (!o) return;
      const doRemove = () => setOptions(list => editSiblingsOf(list, id, sib => sib.filter(x => x.id !== id)));
      const n = o.kind === 'menu' ? countAll(o.children || []) : 0;
      if (!n) { doRemove(); return; }
      setConfirm({
        title: 'Delete option?',
        body: <>“{o.label || 'Untitled option'}” and the {n} option{n === 1 ? '' : 's'} inside it will be removed.</>,
        confirmLabel: 'Delete', danger: true, action: doRemove,
      });
    },
    add: (parentId) => {
      if (!draft || countAll(draft.options) >= LIMITS.total) return;
      const fresh: ChatFlowOption = { id: newId(), label: '', kind: 'answer', answer: '' };
      setOptions(list => {
        if (!parentId) return list.length >= LIMITS.options ? list : [...list, fresh];
        return updateOption(list, parentId, p => ((p.children || []).length >= LIMITS.options ? p : { ...p, children: [...(p.children || []), fresh] }));
      });
      setExpanded(prev => new Set([...prev, fresh.id, ...(parentId ? [parentId] : [])]));
      setFocusId(fresh.id);
    },
    setKind: (id, kind) => {
      if (!draft) return;
      const o = findOption(draft.options, id);
      if (!o || o.kind === kind) return;
      if (kind === 'menu' && depthOf(draft.options, id) >= LIMITS.depth) return;
      const apply = () => setOptions(list => updateOption(list, id, cur => (kind === 'menu'
        ? { id: cur.id, label: cur.label, kind: 'menu', prompt: '', children: [] }
        : { id: cur.id, label: cur.label, kind: 'answer', answer: '' })));
      const n = o.kind === 'menu' ? countAll(o.children || []) : 0;
      const hasAnswer = o.kind === 'answer' && !!(o.answer || '').trim();
      if (!n && !hasAnswer && !(o.prompt || '').trim()) { apply(); return; }
      setConfirm({
        title: kind === 'menu' ? 'Change to “Opens menu”?' : 'Change to “Shows answer”?',
        body: kind === 'menu'
          ? 'The answer text of this option will be removed. You’ll add the options of its menu next.'
          : `The ${n ? `${n} option${n === 1 ? '' : 's'} inside this menu` : 'message of this menu'} will be removed.`,
        confirmLabel: 'Change', danger: true, action: apply,
      });
    },
  };

  const allMenuIds = (list: ChatFlowOption[]): string[] => list.flatMap(o => (o.kind === 'menu' ? [o.id, ...allMenuIds(o.children || [])] : []));

  // ── Sections (render functions, never inner components) ──
  const renderBasics = (f: ChatFlow) => (
    <>
      <SettingsFormSection
        title="Chat flow"
        description="When on, new Messenger conversations start with this bot: it greets visitors, collects their details and answers common questions before they reach your team."
      >
        <ToggleRow
          checked={f.enabled}
          onChange={v => set('enabled', v)}
          disabled={readOnly}
          title={f.enabled ? 'On' : 'Off'}
          help="Takes effect when you publish. When off, visitors go straight to a conversation with your team."
        />
      </SettingsFormSection>
      <SettingsFormSection title="Bot identity" description="Shown in the Messenger header while the bot is talking.">
        <TextField id="cf-bot-name" label="Bot name" value={f.botName} onChange={v => set('botName', v)} max={60} disabled={readOnly} placeholder="e.g. Acme Support" />
        <TextField id="cf-bot-sub" label="Subtitle" value={f.botSubtitle} onChange={v => set('botSubtitle', v)} max={80} disabled={readOnly} placeholder="e.g. Here to help, anytime." help="Optional." />
      </SettingsFormSection>
      <SettingsFormSection title="Welcome message" description="The first message visitors see.">
        <TextField id="cf-welcome" label="Message" value={f.welcome} onChange={v => set('welcome', v)} max={LIMITS.text} disabled={readOnly} multiline rows={4} />
      </SettingsFormSection>
    </>
  );

  const renderDetails = (f: ChatFlow) => (
    <>
      <SettingsFormSection title="Ask for details" description="Questions asked one at a time before the menu. The answers are saved on the customer’s profile.">
        <ToggleRow
          checked={f.askDetails}
          onChange={v => set('askDetails', v)}
          disabled={readOnly}
          title="Ask for details first"
          help="Turn off to show the menu right after the welcome message."
        />
      </SettingsFormSection>

      <div className={`ic-card p-8 flex flex-col gap-4 ${f.askDetails ? '' : 'opacity-60'}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="ic-section-title">Questions</h3>
          <span className="text-[13px] text-muted tabular-nums">{f.questions.length}/{LIMITS.questions}</span>
        </div>
        {f.questions.length === 0 && <p className="text-[14px] text-muted">No questions yet.</p>}
        {f.questions.map((q, i) => {
          const qIssues = issues.filter(x => x.questionId === q.id);
          return (
            <div key={q.id} className={`rounded-lg border p-4 flex flex-col gap-3 ${qIssues.length ? 'border-red-300 dark:border-red-500/50' : 'border-line'}`} data-question-id={q.id}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] font-medium text-muted w-5 tabular-nums">{i + 1}.</span>
                <select
                  className="ic-select w-36"
                  value={q.type}
                  disabled={readOnly}
                  aria-label="Question type"
                  onChange={e => updateQuestion(q.id, { type: e.target.value as ChatFlowQuestionType })}
                >
                  {QUESTION_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <Segmented
                  options={[{ id: 'req', label: 'Required' }, { id: 'opt', label: 'Optional' }]}
                  value={q.required ? 'req' : 'opt'}
                  disabled={readOnly}
                  onChange={v => updateQuestion(q.id, { required: v === 'req' })}
                />
                {!readOnly && (
                  <div className="ml-auto flex items-center">
                    <button type="button" className="ic-icon-btn-ghost w-8 h-8 disabled:opacity-30" title="Move up" disabled={i === 0} onClick={() => moveQuestion(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" className="ic-icon-btn-ghost w-8 h-8 disabled:opacity-30" title="Move down" disabled={i === f.questions.length - 1} onClick={() => moveQuestion(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" className="ic-icon-btn-ghost w-8 h-8 hover:text-red-600" title="Delete question" onClick={() => setQuestions(qs => qs.filter(x => x.id !== q.id))}><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="ic-label" htmlFor={`q-label-${q.id}`}>Question</label>
                  <input id={`q-label-${q.id}`} className="ic-input" value={q.label} maxLength={LIMITS.short} disabled={readOnly}
                    placeholder="e.g. Your order number" onChange={e => updateQuestion(q.id, { label: e.target.value })} />
                </div>
                <div>
                  <label className="ic-label" htmlFor={`q-ph-${q.id}`}>Placeholder</label>
                  <input id={`q-ph-${q.id}`} className="ic-input" value={q.placeholder} maxLength={LIMITS.short} disabled={readOnly}
                    placeholder="Shown in the empty field" onChange={e => updateQuestion(q.id, { placeholder: e.target.value })} />
                </div>
              </div>
              <p className="ic-help -mt-1">
                {QUESTION_TYPES.find(t => t.id === q.type)?.hint}{!q.required && ' Visitors can tap Skip.'}
              </p>
              {qIssues.length > 0 && <ErrorBox>{qIssues.map(x => <div key={x.message}>{x.message}</div>)}</ErrorBox>}
            </div>
          );
        })}
        {!readOnly && (
          <button type="button" onClick={addQuestion} disabled={f.questions.length >= LIMITS.questions}
            className="ic-add-link self-start text-[14px] disabled:opacity-40 disabled:pointer-events-none">
            <Plus className="w-4 h-4" /> Add question
          </button>
        )}
      </div>

      <SettingsFormSection title="Form settings" description="Applies to all questions.">
        <div>
          <label className="ic-label" htmlFor="cf-country">Default country code</label>
          <select id="cf-country" className="ic-select" value={f.defaultCountry} disabled={readOnly} onChange={e => set('defaultCountry', e.target.value)}>
            {!COUNTRIES.some(c => c.code === f.defaultCountry) && <option value={f.defaultCountry}>{f.defaultCountry}</option>}
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} (+{c.dial})</option>)}
          </select>
          <p className="ic-help">Pre-selected in phone questions; visitors can change it.</p>
        </div>
        <TextField id="cf-details-ph" label="Message box text while answering" value={f.detailsPlaceholder} onChange={v => set('detailsPlaceholder', v)}
          max={LIMITS.short} disabled={readOnly} placeholder="e.g. Enter details in the input field" help="Shown in the (locked) message box until the questions are done." />
      </SettingsFormSection>
    </>
  );

  const renderMenu = (f: ChatFlow) => {
    const total = countAll(f.options);
    const q = query.trim().toLowerCase();
    const ctx: TreeCtx = { readOnly, expanded, query: q, issues: optionIssues, focusId, total, actions };
    const anyMatch = !q || f.options.some(o => subtreeMatches(o, q));
    return (
      <>
        <SettingsFormSection title="Main menu" description="Shown after the details (or right after the welcome message).">
          <TextField id="cf-menu-prompt" label="Message" value={f.menuPrompt} onChange={v => set('menuPrompt', v)} max={LIMITS.text} disabled={readOnly} multiline rows={3}
            help={<><code className="font-mono">{'{name}'}</code> is replaced with the visitor’s first name (or “there”).</>} />
          <TextField id="cf-menu-ph" label="Message box text in menus" value={f.menuPlaceholder} onChange={v => set('menuPlaceholder', v)} max={LIMITS.short} disabled={readOnly}
            placeholder="e.g. We are here to help you" help="Visitors pick a button while the bot is running; the box shows this text." />
        </SettingsFormSection>

        <div className="ic-card p-8 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="ic-section-title">Options</h3>
              <p className="text-[14px] text-muted mt-1">Each button opens a sub-menu or shows an answer. {f.options.length} categor{f.options.length === 1 ? 'y' : 'ies'} · {total} options in total.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="ic-btn-ghost ic-btn-sm" onClick={() => setExpanded(new Set(allMenuIds(f.options)))}>Expand menus</button>
              <button type="button" className="ic-btn-ghost ic-btn-sm" onClick={() => setExpanded(new Set())}>Collapse all</button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="ic-input pl-9 pr-9" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an option by label or answer text" aria-label="Find an option" />
            {query && (
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 ic-icon-btn-ghost w-6 h-6" title="Clear" onClick={() => setQuery('')}><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
          {!anyMatch && <p className="text-[14px] text-muted">No options match “{query}”.</p>}
          <OptionList list={f.options} depth={1} parentId={null} ctx={ctx} />
        </div>
      </>
    );
  };

  const renderAfter = (f: ChatFlow) => (
    <>
      <SettingsFormSection title="Did this solve your issue?" description="Asked after every answer. Yes resolves the conversation; No connects the visitor to your team in the Inbox.">
        <ToggleRow checked={f.askResolved} onChange={v => set('askResolved', v)} disabled={readOnly} title="Ask after each answer"
          help="When off, the visitor stays in the menu after an answer." />
        <TextField id="cf-resolved-q" label="Question" value={f.resolvedQuestion} onChange={v => set('resolvedQuestion', v)} max={LIMITS.short} disabled={readOnly} />
      </SettingsFormSection>
      <SettingsFormSection title="Yes" description="The conversation is marked resolved.">
        <TextField id="cf-yes-label" label="Button" value={f.yesLabel} onChange={v => set('yesLabel', v)} max={40} disabled={readOnly} />
        <TextField id="cf-yes-reply" label="Bot reply" value={f.yesReply} onChange={v => set('yesReply', v)} max={LIMITS.text} disabled={readOnly} multiline rows={2} />
      </SettingsFormSection>
      <SettingsFormSection title="No" description="Hands the conversation to your team: it opens in the Inbox and the visitor can type a message.">
        <TextField id="cf-no-label" label="Button" value={f.noLabel} onChange={v => set('noLabel', v)} max={40} disabled={readOnly} />
        <TextField id="cf-no-reply" label="Bot reply" value={f.noReply} onChange={v => set('noReply', v)} max={LIMITS.text} disabled={readOnly} multiline rows={2} />
      </SettingsFormSection>
    </>
  );

  const renderButtons = (f: ChatFlow) => (
    <>
      <SettingsFormSection title="Back to categories" description="Returns to the main menu from a sub-menu or after an answer.">
        <ToggleRow checked={f.showBack} onChange={v => set('showBack', v)} disabled={readOnly} title="Show the Back button" />
        <TextField id="cf-back" label="Button" value={f.backLabel} onChange={v => set('backLabel', v)} max={40} disabled={readOnly} />
      </SettingsFormSection>
      <SettingsFormSection title="Restart" description="Starts the menu over (the visitor’s details are kept).">
        <ToggleRow checked={f.showRestart} onChange={v => set('showRestart', v)} disabled={readOnly} title="Show the Restart button" />
        <TextField id="cf-restart" label="Button" value={f.restartLabel} onChange={v => set('restartLabel', v)} max={40} disabled={readOnly} />
        <TextField id="cf-restart-msg" label="Restart message" value={f.restartMessage} onChange={v => set('restartMessage', v)} max={LIMITS.text} disabled={readOnly} />
        <TextField id="cf-restart-prompt" label="Then" value={f.restartPrompt} onChange={v => set('restartPrompt', v)} max={LIMITS.text} disabled={readOnly}
          help="Sent right after the restart message, above the main menu." />
      </SettingsFormSection>
    </>
  );

  const renderIssues = () => {
    if (!issues.length || readOnly) return null;
    const shown = issues.slice(0, 5);
    return (
      <ErrorBox>
        <p className="font-medium mb-1">Fix {issues.length === 1 ? 'this' : `these ${issues.length} issues`} to save or publish:</p>
        <ul className="flex flex-col gap-0.5">
          {shown.map((x, i) => (
            <li key={i}>
              {x.message}{' '}
              {(x.tab !== tab || x.optionId) && (
                <button type="button" className="underline font-medium" onClick={() => (x.optionId ? reveal(x.optionId) : setTab(x.tab))}>
                  Show
                </button>
              )}
            </li>
          ))}
          {issues.length > shown.length && <li>…and {issues.length - shown.length} more</li>}
        </ul>
      </ErrorBox>
    );
  };

  const live = data?.published;
  const status = !data ? null
    : live?.enabled ? <Pill tone="green">Live v{data.version}</Pill>
      : <Pill tone="gray">{live ? `Off · v${data.version}` : 'Off · never published'}</Pill>;

  return (
    <>
      <SettingsPageHeader title="Chat flow" onBack={leave}>
        {flash && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="w-4 h-4" /> {flash}
          </span>
        )}
        {status}
        {unpublished && <Pill tone="amber">Unpublished changes</Pill>}
        {isAdmin ? (
          <>
            {data && (dirty || (!!data.published && !sameFlow(data.draft, data.published))) && (
              <button type="button" onClick={discard} disabled={!!busy} className="ic-btn-ghost disabled:opacity-40">Discard changes</button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || !valid || !!busy || loading}
              className="ic-btn-outline disabled:opacity-40 disabled:pointer-events-none"
              title={!dirty ? 'No unsaved changes' : !valid ? 'Fix the issues first' : 'Save without changing what visitors see'}
            >
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={!valid || !unpublished || !!busy || loading}
              className="ic-btn-primary disabled:opacity-40 disabled:pointer-events-none"
              title={!valid ? 'Fix the issues first' : !unpublished ? 'Nothing new to publish' : 'Save and make this version live in the Messenger'}
            >
              {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          </>
        ) : (
          <span className="ic-badge">View only</span>
        )}
      </SettingsPageHeader>

      <div className="ic-tabs pt-4 px-8 shrink-0">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`ic-tab ${tab === t.id ? 'ic-tab-active' : ''}`}>
            {t.label}
            {!readOnly && tabsWithIssues.has(t.id) && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 ml-1.5 align-middle" title="Needs attention" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        {loading && <p className="text-[14px] text-muted">Loading…</p>}
        {loadError && <ErrorBox>{loadError}</ErrorBox>}
        {data && draft && (
          <div className="flex gap-8">
            <div className="flex-1 flex flex-col gap-4 max-w-3xl min-w-0">
              {readOnly && <p className="ic-help">Only admins can change the chat flow. You’re viewing it read-only.</p>}
              {data.publishedAt && (
                <p className="ic-help -mt-1">
                  Last published {relativeTime(data.publishedAt)}{data.updatedAt && data.updatedAt !== data.publishedAt ? ` · draft saved ${relativeTime(data.updatedAt)}` : ''}
                </p>
              )}
              {actionError && <ErrorBox>{actionError}</ErrorBox>}
              {renderIssues()}
              {tab === 'basics' && renderBasics(draft)}
              {tab === 'details' && renderDetails(draft)}
              {tab === 'menu' && renderMenu(draft)}
              {tab === 'after' && renderAfter(draft)}
              {tab === 'buttons' && renderButtons(draft)}
            </div>
            <div className="hidden lg:block sticky top-0 self-start shrink-0">
              <FlowPreview flow={draft} themeColor={themeColor} />
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={!!confirm} onClose={() => !confirmBusy && setConfirm(null)} title={confirm?.title} size="sm">
        {confirm && (
          <div className="flex flex-col gap-5">
            <div className="text-[14px] text-muted leading-relaxed">{confirm.body}</div>
            <div className="flex justify-end gap-2">
              <button type="button" className="ic-btn-secondary" disabled={confirmBusy} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={`${confirm.danger ? 'ic-btn-danger' : 'ic-btn-primary'} disabled:opacity-50`} disabled={confirmBusy} onClick={runConfirm}>
                {confirmBusy ? 'Working…' : confirm.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
