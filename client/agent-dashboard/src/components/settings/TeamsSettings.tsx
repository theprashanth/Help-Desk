import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle, UsersRound, Check, Star } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, AssignmentMethod, Team } from '../../../../../shared/src/types';
import { loadTeams, useTeams } from '../../lib/teams';
import { BACKEND_URL, SettingsPageHeader } from './shared';

const METHODS: { value: AssignmentMethod; label: string; hint: string }[] = [
  { value: 'balanced', label: 'Balanced', hint: 'To the available teammate with the fewest open conversations' },
  { value: 'round_robin', label: 'Round robin', hint: 'Teammates take turns, in the order listed' },
  { value: 'manual', label: 'Manual', hint: 'Conversations wait unassigned in the team inbox' },
];

type Draft = { name: string; emoji: string; memberIds: string[]; method: AssignmentMethod; capacity: string };
const toDraft = (t?: Team): Draft => ({
  name: t?.name || '', emoji: t?.emoji || '', memberIds: t?.memberIds || [],
  method: t?.assignment.method || 'balanced', capacity: t?.assignment.capacity ? String(t.assignment.capacity) : '',
});

/**
 * Settings › Teams: team inboxes and how each one assigns new conversations. The default team
 * receives every new customer conversation. Auto-assignment only picks teammates who are online,
 * not Away, have a full seat and are under the team's capacity.
 */
export default function TeamsSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const defaultTeamId = useStore(s => s.defaultTeamId);
  const isAdmin = me?.role === 'admin';
  const teams = useTeams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : [])).then(d => Array.isArray(d) && setAgents(d)).catch(() => {});
  }, [token]);
  useEffect(() => { if (selected === null && teams.length) setSelected(teams[0].id); }, [teams, selected]);
  useEffect(() => {
    setError(null);
    setDraft(selected === 'new' ? toDraft() : toDraft(teams.find(t => t.id === selected)));
  }, [selected, teams]);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = {
        name: draft.name, emoji: draft.emoji, memberIds: draft.memberIds,
        assignment: { method: draft.method, capacity: draft.capacity ? Number(draft.capacity) : null },
      };
      const team = selected === 'new' ? await call('POST', '/teams', body) : await call('PUT', `/teams/${selected}`, body);
      await loadTeams(true);
      setSelected(team.id);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (t: Team) => {
    if (!window.confirm(`Delete the ${t.name} team? Its conversations stay in the inbox without a team.`)) return;
    try { await call('DELETE', `/teams/${t.id}`); await loadTeams(true); setSelected(null); } catch (e: any) { setError(e.message); }
  };

  const makeDefault = async (id: string | null) => {
    try { await call('PUT', '/teams/default', { teamId: id }); await loadTeams(true); } catch (e: any) { setError(e.message); }
  };

  const toggleMember = (id: string) =>
    setDraft(d => ({ ...d, memberIds: d.memberIds.includes(id) ? d.memberIds.filter(m => m !== id) : [...d.memberIds, id] }));

  const current = teams.find(t => t.id === selected);
  const editing = selected === 'new' || !!current;
  const ro = !isAdmin;

  return (
    <>
      <SettingsPageHeader title="Teams" onBack={onBack}>
        {isAdmin && (
          <button type="button" onClick={() => setSelected('new')} className="ic-btn-primary">
            <Plus className="w-4 h-4" /> New team
          </button>
        )}
      </SettingsPageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        <div className="max-w-5xl flex flex-col gap-4">
          <p className="text-[14px] text-muted">
            Group teammates into team inboxes. New customer conversations go to the <span className="font-medium text-ink">default team</span>, and its rule picks who gets each one.
            {ro && ' Only admins can change teams.'}
          </p>
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
            {/* Team list */}
            <div className="ic-card p-2 flex flex-col gap-0.5">
              {teams.length === 0 && selected !== 'new' && (
                <div className="p-4 text-center">
                  <UsersRound className="w-8 h-8 text-muted mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-[14px] text-muted">No teams yet. Without teams, new conversations are balanced across everyone who's online.</p>
                </div>
              )}
              {teams.map(t => (
                <button key={t.id} onClick={() => setSelected(t.id)}
                  className={`w-full flex items-center gap-2.5 px-3 h-11 rounded-xl text-left text-[14px] ${selected === t.id ? 'bg-subtle' : 'hover:bg-ink/[0.03]'}`}>
                  <span className="w-6 text-center">{t.emoji || <UsersRound className="w-4 h-4 inline text-muted" />}</span>
                  <span className="flex-1 min-w-0 truncate text-ink">{t.name}</span>
                  {defaultTeamId === t.id && <span className="ic-badge h-5 px-1.5 text-[11px] text-muted">Default</span>}
                  <span className="text-[12px] text-faint tabular-nums">{t.memberIds.length}</span>
                </button>
              ))}
              {selected === 'new' && (
                <div className="w-full flex items-center gap-2.5 px-3 h-11 rounded-xl bg-subtle text-[14px] text-ink">
                  <span className="w-6 text-center">{draft.emoji || '＋'}</span>{draft.name || 'New team'}
                </div>
              )}
            </div>

            {/* Editor */}
            {editing ? (
              <div className="ic-card p-6 flex flex-col gap-5">
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                  <div>
                    <label className="ic-label">Emoji</label>
                    <input className="ic-input text-center" value={draft.emoji} maxLength={4} disabled={ro} placeholder="🎧"
                      onChange={e => setDraft(d => ({ ...d, emoji: e.target.value }))} />
                  </div>
                  <div>
                    <label className="ic-label">Team name</label>
                    <input className="ic-input" value={draft.name} maxLength={60} disabled={ro} placeholder="e.g. Billing"
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="ic-label">Members</label>
                  <p className="ic-help -mt-0.5 mb-2">Round robin goes through members in this order. Light seats are never auto-assigned.</p>
                  <div className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                    {agents.map(a => {
                      const on = draft.memberIds.includes(a.id);
                      return (
                        <label key={a.id} className={`flex items-center gap-3 px-3 h-11 ${ro ? '' : 'cursor-pointer hover:bg-ink/[0.02]'}`}>
                          <input type="checkbox" checked={on} disabled={ro} onChange={() => toggleMember(a.id)} className="w-4 h-4 accent-current" />
                          <span className="w-6 h-6 rounded-full bg-subtle text-[11px] font-semibold flex items-center justify-center uppercase">{a.name.charAt(0)}</span>
                          <span className="flex-1 min-w-0 truncate text-[14px] text-ink">{a.name}{a.id === me?.id ? ' (you)' : ''}</span>
                          {a.role === 'light' && <span className="ic-badge h-5 px-1.5 text-[11px] text-muted">Light</span>}
                          {on && <span className="text-[12px] text-faint tabular-nums">#{draft.memberIds.indexOf(a.id) + 1}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="ic-label">Assignment</label>
                  <div className="flex flex-col gap-2">
                    {METHODS.map(m => (
                      <label key={m.value} className={`flex items-start gap-3 p-3 rounded-xl border ${draft.method === m.value ? 'border-ink/40 bg-subtle' : 'border-line'} ${ro ? '' : 'cursor-pointer'}`}>
                        <input type="radio" name="method" className="mt-1" checked={draft.method === m.value} disabled={ro}
                          onChange={() => setDraft(d => ({ ...d, method: m.value }))} />
                        <span>
                          <span className="block text-[14px] font-medium text-ink">{m.label}</span>
                          <span className="block text-[13px] text-muted">{m.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {draft.method !== 'manual' && (
                  <div>
                    <label className="ic-label">Capacity per teammate</label>
                    <div className="flex items-center gap-2">
                      <input className="ic-input w-28 tabular-nums" type="number" min={1} max={500} disabled={ro} placeholder="No limit"
                        value={draft.capacity} onChange={e => setDraft(d => ({ ...d, capacity: e.target.value }))} />
                      <span className="text-[14px] text-muted">open conversations</span>
                    </div>
                    <p className="ic-help mt-1.5">Teammates at capacity are skipped. If everyone is busy, the conversation waits unassigned in the team inbox.</p>
                  </div>
                )}

                {isAdmin && (
                  <div className="flex items-center gap-2 pt-4 border-t border-line">
                    <button type="button" onClick={save} disabled={saving || !draft.name.trim()} className="ic-btn-primary disabled:opacity-40">
                      {saving ? 'Saving…' : selected === 'new' ? 'Create team' : 'Save changes'}
                    </button>
                    {selected === 'new' && <button type="button" onClick={() => setSelected(teams[0]?.id || null)} className="ic-btn-ghost">Cancel</button>}
                    {current && (
                      defaultTeamId === current.id
                        ? <span className="inline-flex items-center gap-1.5 text-[13px] text-muted ml-2"><Check className="w-4 h-4" /> Default team for new conversations</span>
                        : <button type="button" onClick={() => makeDefault(current.id)} className="ic-btn-ghost"><Star className="w-4 h-4" /> Make default</button>
                    )}
                    {current && (
                      <button type="button" onClick={() => remove(current)} className="ic-btn-ghost ml-auto text-red-600 dark:text-red-400">
                        <Trash2 className="w-4 h-4" /> Delete team
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="ic-card p-10 text-center text-[14px] text-muted">Select a team, or create one.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
