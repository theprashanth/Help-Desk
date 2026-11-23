import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { MacroActions } from '../../../../../shared/src/types';
import { useStore } from '../../store/useStore';
import { formatSnooze } from '../../lib/macros';

const BACKEND_URL = 'http://localhost:3000';

type ActionKey = keyof MacroActions;
const ACTION_LABELS: Record<ActionKey, string> = {
  assignTo: 'Assign',
  status: 'Change state',
  priority: 'Set priority',
  addTags: 'Add tags',
  snoozeMinutes: 'Snooze',
};
const ORDER: ActionKey[] = ['assignTo', 'status', 'priority', 'addTags', 'snoozeMinutes'];
const SNOOZE_CHOICES = [60, 180, 60 * 24, 60 * 24 * 2, 60 * 24 * 7];

/**
 * "Actions" part of the macro editor: what the macro also does to the conversation (assign,
 * state, priority, tags, snooze). Each action is a row with a picker and a remove button.
 */
export const MacroActionsEditor: React.FC<{ value: MacroActions; onChange: (v: MacroActions) => void }> = ({ value, onChange }) => {
  const token = useStore(s => s.token);
  const [teammates, setTeammates] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    fetch(`${BACKEND_URL}/api/auth/agents`, { headers: h }).then(r => (r.ok ? r.json() : [])).then(d => Array.isArray(d) && setTeammates(d)).catch(() => {});
    fetch(`${BACKEND_URL}/api/tags`, { headers: h }).then(r => (r.ok ? r.json() : [])).then(d => Array.isArray(d) && setTags(d.map((t: any) => t.name))).catch(() => {});
  }, [token]);

  const set = (patch: Partial<MacroActions>) => onChange({ ...value, ...patch });
  const remove = (k: ActionKey) => { const next = { ...value }; delete next[k]; onChange(next); };
  const unused = ORDER.filter(k => value[k] === undefined);

  const addAction = (k: ActionKey) => {
    setAdding(false);
    const defaults: MacroActions = { assignTo: 'me', status: 'resolved', priority: 'high', addTags: [], snoozeMinutes: 60 * 24 };
    set({ [k]: defaults[k] } as Partial<MacroActions>);
  };

  const addTag = (t: string) => {
    const name = t.trim();
    if (!name) return;
    set({ addTags: Array.from(new Set([...(value.addTags || []), name])) });
    setTagDraft('');
  };

  const row = (k: ActionKey, control: React.ReactNode) => (
    <div key={k} className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[13px] font-medium text-ink">{ACTION_LABELS[k]}</span>
      <div className="flex-1 min-w-0">{control}</div>
      <button type="button" onClick={() => remove(k)} title="Remove action" className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-subtle hover:text-ink shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div>
      <label className="ic-label">Actions</label>
      <p className="ic-help -mt-0.5 mb-2.5">Run these on the conversation when the macro is sent. A macro with no message runs them as soon as it's picked.</p>
      <div className="flex flex-col gap-2.5">
        {ORDER.filter(k => value[k] !== undefined).map(k => {
          switch (k) {
            case 'assignTo':
              return row(k, (
                <select className="ic-input h-9" value={value.assignTo} onChange={e => set({ assignTo: e.target.value })}>
                  <option value="me">The teammate using it</option>
                  <option value="unassigned">Unassigned</option>
                  {teammates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ));
            case 'status':
              return row(k, (
                <select className="ic-input h-9" value={value.status} onChange={e => set({ status: e.target.value as MacroActions['status'] })}>
                  <option value="open">Open (in progress)</option>
                  <option value="waiting">Waiting on customer</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              ));
            case 'priority':
              return row(k, (
                <select className="ic-input h-9" value={value.priority} onChange={e => set({ priority: e.target.value as MacroActions['priority'] })}>
                  <option value="none">No priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Urgent</option>
                </select>
              ));
            case 'snoozeMinutes':
              return row(k, (
                <select className="ic-input h-9" value={value.snoozeMinutes} onChange={e => set({ snoozeMinutes: Number(e.target.value) })}>
                  {SNOOZE_CHOICES.map(m => <option key={m} value={m}>For {formatSnooze(m)}</option>)}
                </select>
              ));
            case 'addTags':
              return row(k, (
                <div className="flex flex-wrap items-center gap-1.5 min-h-9">
                  {(value.addTags || []).map(t => (
                    <span key={t} className="ic-badge h-7 pl-2.5 pr-1 text-[13px] text-ink gap-1">
                      {t}
                      <button type="button" onClick={() => set({ addTags: (value.addTags || []).filter(x => x !== t) })} className="w-5 h-5 rounded flex items-center justify-center text-muted hover:text-ink">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    list="macro-tag-options"
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); } }}
                    onBlur={() => addTag(tagDraft)}
                    placeholder="Add a tag…"
                    className="ic-input h-8 w-36"
                  />
                  <datalist id="macro-tag-options">
                    {tags.filter(t => !(value.addTags || []).includes(t)).map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              ));
          }
          return null;
        })}
      </div>
      {unused.length > 0 && (
        <div className="relative mt-2.5">
          <button type="button" onClick={() => setAdding(a => !a)} className="ic-btn-ghost h-8 px-2.5 text-[13px]">
            <Plus className="w-3.5 h-3.5" /> Add action
          </button>
          {adding && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAdding(false)} />
              <div className="ic-menu absolute left-0 top-full mt-1 z-20 w-48">
                {unused.map(k => (
                  <button key={k} type="button" onClick={() => addAction(k)} className="ic-menu-item">{ACTION_LABELS[k]}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MacroActionsEditor;
