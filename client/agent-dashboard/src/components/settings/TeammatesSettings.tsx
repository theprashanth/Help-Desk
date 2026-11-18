import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Search, Download, MoreHorizontal, Trash2, Copy, Check, Users, ShieldCheck, Inbox as InboxIcon, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext';
import { Agent, UserRole } from '../../../../../shared/src/types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { BACKEND_URL, SettingsPageHeader, PersonAvatar } from './shared';

type Teammate = Agent & { online?: boolean };

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', support_agent: 'Support agent' };
const PERMISSION_LABEL: Record<UserRole, string> = { admin: 'Complete access', support_agent: 'Inbox access' };
const INTRO_KEY = 'settings_teammates_intro_dismissed';

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function TeammatesSettings({ onBack }: { onBack: () => void }) {
  const token = useStore(s => s.token);
  const me = useStore(s => s.agent);
  const socket = useSocket();
  const isAdmin = me?.role === 'admin';

  const [tab, setTab] = useState<'teammates' | 'roles'>('teammates');
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [introDismissed, setIntroDismissed] = useState(() => localStorage.getItem(INTRO_KEY) === '1');
  const [rowError, setRowError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Teammate | null>(null);
  const [removing, setRemoving] = useState(false);

  // New teammate modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'support_agent' as UserRole, password: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agent: Teammate; temporaryPassword?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const authHeaders = useMemo(() => ({ 'Authorization': `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/agents`, { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load teammates');
      setTeammates(await res.json());
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, authHeaders]);

  useEffect(() => { load(); }, [load]);

  // Live online/offline dots
  useEffect(() => {
    if (!socket) return;
    const on = ({ agentId }: { agentId: string }) => setTeammates(prev => prev.map(t => t.id === agentId ? { ...t, online: true } : t));
    const off = ({ agentId }: { agentId: string }) => setTeammates(prev => prev.map(t => t.id === agentId ? { ...t, online: false } : t));
    socket.on('agent:online', on);
    socket.on('agent:offline', off);
    return () => { socket.off('agent:online', on); socket.off('agent:offline', off); };
  }, [socket]);

  // Close the row menu on outside click
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuFor) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuFor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...teammates].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter(t => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q));
  }, [teammates, search]);

  const dismissIntro = () => {
    localStorage.setItem(INTRO_KEY, '1');
    setIntroDismissed(true);
  };

  const openModal = () => {
    setForm({ name: '', email: '', role: 'support_agent', password: '' });
    setCreateError(null);
    setCreated(null);
    setCopied(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCreated(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!form.name.trim()) return setCreateError('Name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return setCreateError('Enter a valid email address');
    if (form.password && form.password.length < 8) return setCreateError('Password must be at least 8 characters');
    setCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/agents`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add teammate');
      setTeammates(prev => [...prev, data.agent]);
      setCreated(data);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (t: Teammate, role: UserRole) => {
    if (role === t.role) return;
    setRowError(null);
    const prevRole = t.role;
    setTeammates(prev => prev.map(x => x.id === t.id ? { ...x, role } : x));
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/agents/${t.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change role');
      setTeammates(prev => prev.map(x => x.id === t.id ? { ...x, ...data } : x));
    } catch (err: any) {
      setTeammates(prev => prev.map(x => x.id === t.id ? { ...x, role: prevRole } : x));
      setRowError(err.message);
    }
  };

  const removeTeammate = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    setRowError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/agents/${confirmRemove.id}`, { method: 'DELETE', headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove teammate');
      setTeammates(prev => prev.filter(x => x.id !== confirmRemove.id));
      setConfirmRemove(null);
    } catch (err: any) {
      setRowError(err.message);
      setConfirmRemove(null);
    } finally {
      setRemoving(false);
    }
  };

  const exportCsv = () => {
    const rows = [['name', 'email', 'role', 'status']];
    filtered.forEach(t => rows.push([t.name, t.email, t.role, t.online ? 'active' : 'offline']));
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `teammates-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyPassword = (pw: string) => {
    navigator.clipboard.writeText(pw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <SettingsPageHeader title="Teammates" onBack={onBack}>
        {isAdmin && (
          <button type="button" onClick={openModal} className="ic-btn-primary">
            <Plus className="w-4 h-4" /> New teammate
          </button>
        )}
      </SettingsPageHeader>

      <div className="ic-tabs pt-4 px-8 shrink-0">
        <button type="button" onClick={() => setTab('teammates')} className={`ic-tab ${tab === 'teammates' ? 'ic-tab-active' : ''}`}>Teammates</button>
        <button type="button" onClick={() => setTab('roles')} className={`ic-tab ${tab === 'roles' ? 'ic-tab-active' : ''}`}>Roles</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-8">
        {tab === 'teammates' && (
          <div className="flex flex-col gap-6 max-w-6xl">
            {!introDismissed && (
              <div className="ic-card p-6 flex items-start gap-4 relative">
                <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200">
                  <Users className="w-5 h-5" strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0 pr-8">
                  <p className="text-[15px] font-semibold text-ink">Invite your teammates to Chai Samosa</p>
                  <p className="text-[14px] text-muted mt-1 leading-relaxed">
                    You can add them one by one, choose whether they get complete access as an Admin or inbox access as a
                    Support agent, and change their role at any time.
                  </p>
                  {isAdmin && (
                    <button type="button" onClick={openModal} className="ic-add-link mt-3 text-[14px]">
                      <Plus className="w-4 h-4" /> Add new teammates
                    </button>
                  )}
                </div>
                <button type="button" onClick={dismissIntro} className="ic-icon-btn-ghost absolute top-4 right-4" title="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-xs">
                  <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or email"
                    className="ic-input pl-9"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="ic-section-title">
                  {filtered.length} teammate{filtered.length === 1 ? '' : 's'}
                </h3>
                <button type="button" onClick={exportCsv} className="ic-btn-secondary ic-btn-sm" disabled={filtered.length === 0}>
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>

              {!isAdmin && (
                <p className="ic-help -mt-1">Only admins can add, remove or change the role of teammates.</p>
              )}

              {rowError && (
                <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {rowError}
                  <button type="button" className="ml-auto" onClick={() => setRowError(null)}><X className="w-4 h-4" /></button>
                </div>
              )}

              <div className="ic-card overflow-visible">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[13px] text-muted border-b border-line">
                      <th className="font-medium px-5 py-3">Name</th>
                      <th className="font-medium px-5 py-3 w-[140px]">Status</th>
                      <th className="font-medium px-5 py-3 w-[180px]">Permission</th>
                      <th className="font-medium px-5 py-3 w-[190px]">Role</th>
                      <th className="px-3 py-3 w-[56px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={5} className="px-5 py-10 text-center text-muted">Loading teammates…</td></tr>
                    )}
                    {!loading && loadError && (
                      <tr><td colSpan={5} className="px-5 py-10 text-center text-red-600">{loadError}</td></tr>
                    )}
                    {!loading && !loadError && filtered.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-10 text-center text-muted">No teammates match “{search}”.</td></tr>
                    )}
                    {!loading && filtered.map(t => {
                      const isMe = t.id === me?.id;
                      return (
                        <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-ink/[0.02]">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <PersonAvatar name={t.name} src={t.avatar} size={32} online={t.online ? true : undefined} />
                              <div className="min-w-0">
                                <p className="font-medium text-ink truncate flex items-center gap-2">
                                  {t.name}
                                  {isMe && <span className="ic-badge">You</span>}
                                </p>
                                <p className="text-[13px] text-muted truncate">{t.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {t.online ? (
                              <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 text-[12px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-subtle text-muted text-[12px] font-medium">
                                Offline
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-ink">{PERMISSION_LABEL[t.role] || t.role}</td>
                          <td className="px-5 py-3">
                            {isAdmin ? (
                              <select
                                value={t.role}
                                onChange={e => changeRole(t, e.target.value as UserRole)}
                                className="ic-select h-8 text-[13px]"
                                aria-label={`Role for ${t.name}`}
                              >
                                <option value="admin">Admin</option>
                                <option value="support_agent">Support agent</option>
                              </select>
                            ) : (
                              <span className="text-ink">{ROLE_LABEL[t.role] || t.role}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isAdmin && !isMe && (
                              <div className="relative inline-block" ref={menuFor === t.id ? menuRef : undefined}>
                                <button
                                  type="button"
                                  onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                                  className="ic-icon-btn-ghost"
                                  title="More"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                                {menuFor === t.id && (
                                  <div className="ic-menu absolute right-0 top-9 z-20 w-44">
                                    <button
                                      type="button"
                                      className="ic-menu-item w-full text-red-600"
                                      onClick={() => { setMenuFor(null); setConfirmRemove(t); }}
                                    >
                                      <Trash2 className="w-4 h-4" /> Remove
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'roles' && (
          <div className="flex flex-col gap-4 max-w-4xl">
            <p className="text-[14px] text-muted">Every teammate has one of two roles. Admins can change a teammate’s role from the Teammates tab.</p>
            {[
              {
                role: 'Admin', icon: ShieldCheck, access: 'Complete access',
                items: ['Everything a Support agent can do', 'Add and remove teammates and change their roles', 'Change workspace settings such as office hours'],
              },
              {
                role: 'Support agent', icon: InboxIcon, access: 'Inbox access',
                items: ['Reply to, assign, snooze and resolve conversations', 'Create tickets, macros and tags', 'Edit their own profile and notification preferences'],
              },
            ].map(r => (
              <div key={r.role} className="ic-card p-6 flex items-start gap-4">
                <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200">
                  <r.icon className="w-5 h-5" strokeWidth={2.2} />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{r.role} <span className="text-muted font-normal">· {r.access}</span></p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {r.items.map(i => (
                      <li key={i} className="text-[14px] text-muted flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New teammate */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={created ? 'Teammate added' : 'New teammate'}>
        {created ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <PersonAvatar name={created.agent.name} size={40} />
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{created.agent.name}</p>
                <p className="text-[13px] text-muted truncate">{created.agent.email} · {ROLE_LABEL[created.agent.role]}</p>
              </div>
            </div>
            {created.temporaryPassword ? (
              <div className="flex flex-col gap-2">
                <label className="ic-label">Temporary password</label>
                <div className="flex items-center gap-2">
                  <code className="ic-input flex items-center font-mono text-[14px] select-all bg-subtle">{created.temporaryPassword}</code>
                  <button type="button" onClick={() => copyPassword(created.temporaryPassword!)} className="ic-btn-secondary shrink-0">
                    {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
                  </button>
                </div>
                <p className="ic-help">
                  This password is shown only once. Share it with your teammate securely (not over a public channel) —
                  they can sign in at the agent dashboard with their email and this password.
                </p>
              </div>
            ) : (
              <p className="text-[14px] text-muted">They can now sign in with their email and the password you set.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => { setCreated(null); setForm({ name: '', email: '', role: 'support_agent', password: '' }); }}>
                Add another
              </Button>
              <Button type="button" onClick={closeModal}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div>
              <label className="ic-label">Name</label>
              <input className="ic-input" value={form.name} autoFocus onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Sharma" />
            </div>
            <div>
              <label className="ic-label">Email</label>
              <input className="ic-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
            </div>
            <div>
              <label className="ic-label">Role</label>
              <select className="ic-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                <option value="support_agent">Support agent — Inbox access</option>
                <option value="admin">Admin — Complete access</option>
              </select>
            </div>
            <div>
              <label className="ic-label">Password <span className="text-faint font-normal">(optional)</span></label>
              <input className="ic-input" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to generate one" />
              <p className="ic-help mt-1">At least 8 characters. Leave blank and we’ll generate a strong temporary password.</p>
            </div>
            {createError && (
              <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {createError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={closeModal}>Cancel</Button>
              <Button type="submit" loading={creating}>Add teammate</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Remove confirmation */}
      <Modal isOpen={!!confirmRemove} onClose={() => !removing && setConfirmRemove(null)} title="Remove teammate?" size="sm">
        {confirmRemove && (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-muted leading-relaxed">
              <span className="text-ink font-medium">{confirmRemove.name}</span> ({confirmRemove.email}) will lose access to Chai Samosa.
              Their open and waiting conversations will move back to Unassigned; past conversations stay as they are.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setConfirmRemove(null)} disabled={removing}>Cancel</Button>
              <Button variant="danger" type="button" onClick={removeTeammate} loading={removing}>Remove</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
