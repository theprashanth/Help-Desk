import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Clock, User, Mail, Activity, Briefcase, Building2, Phone, FileText, CalendarDays,
  ShieldCheck, CalendarClock, Bell, ChevronRight, AlertCircle, MessageSquare, Camera, Upload, Trash2
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent, Conversation } from '../../../../../shared/src/types';
import Button from '../ui/Button';
import { BACKEND_URL, SettingsPageHeader, PersonAvatar, relativeTime, timezoneOptions, tzLabel, browserTimeZone } from './shared';

type ProfileForm = {
  name: string; jobTitle: string; department: string; phone: string; bio: string;
  calendarLink: string; location: string; timezone: string;
};

const toForm = (a: Partial<Agent> | null): ProfileForm => ({
  name: a?.name || '',
  jobTitle: a?.jobTitle || '',
  department: a?.department || '',
  phone: a?.phone || '',
  bio: a?.bio || '',
  calendarLink: a?.calendarLink || '',
  location: a?.location || '',
  timezone: a?.timezone || '',
});

function localTimeIn(tz: string | undefined, now: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, hour: 'numeric', minute: '2-digit' }).format(now);
  } catch {
    return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

const isHttpUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};

function DetailRow({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="w-[18px] h-[18px] text-muted shrink-0 mt-[1px]" />
      <div className="min-w-0 flex-1 text-[14px] text-ink break-words">{children}</div>
    </div>
  );
}

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Large header avatar with a camera button: upload / remove a profile photo. */
function AvatarEditor({ name, avatar, token, onUpdated }: {
  name: string; avatar?: string; token: string | null; onUpdated: (a: Agent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const request = async (init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/profile/avatar`, { ...init, headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update your photo');
      onUpdated(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return setError('Choose a PNG, JPEG, WebP or GIF image');
    if (file.size > AVATAR_MAX_BYTES) return setError('Images must be 2 MB or smaller');
    const body = new FormData();
    body.append('avatar', file);
    request({ method: 'POST', body });
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <div className={`rounded-full ring-4 ring-surface ${busy ? 'opacity-60' : ''}`}>
        <PersonAvatar name={name} src={avatar || undefined} size={88} />
      </div>
      <button
        type="button"
        onClick={() => setMenuOpen(o => !o)}
        disabled={busy}
        title="Change profile photo"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-surface border border-line shadow-card flex items-center justify-center text-ink hover:bg-subtle transition-colors"
      >
        <Camera className="w-4 h-4" />
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} />
      {menuOpen && (
        <div role="menu" className="ic-menu absolute left-0 top-full mt-2">
          <button type="button" role="menuitem" className="ic-menu-item" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}>
            <Upload className="w-4 h-4 text-muted" /> Upload photo
          </button>
          {avatar && (
            <button type="button" role="menuitem" className="ic-menu-item text-red-600 dark:text-red-400"
              onClick={() => { setMenuOpen(false); request({ method: 'DELETE' }); }}>
              <Trash2 className="w-4 h-4" /> Remove photo
            </button>
          )}
          <p className="px-3.5 pt-1.5 pb-1 text-[12px] text-faint whitespace-nowrap">PNG, JPEG, WebP or GIF · max 2 MB</p>
        </div>
      )}
      {error && (
        <p className="absolute left-0 top-full mt-2 w-64 text-[13px] text-red-600 dark:text-red-400 flex items-start gap-1.5" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" /> {error}
        </p>
      )}
    </div>
  );
}

const Placeholder = ({ children }: { children: React.ReactNode }) => <span className="text-faint">{children}</span>;

export default function ProfileSettings({ onBack, onOpenNotifications }: { onBack: () => void; onOpenNotifications: () => void }) {
  const token = useStore(s => s.token);
  const storeAgent = useStore(s => s.agent);
  const setAuth = useStore(s => s.setAuth);

  const [profile, setProfile] = useState<Agent | null>(storeAgent);
  const [online, setOnline] = useState<boolean>(true);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(toForm(storeAgent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Live clock — re-render at the top of every minute
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    fetch(`${BACKEND_URL}/api/auth/profile`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then((a: Agent | null) => { if (a) { setProfile(a); setForm(toForm(a)); } })
      .catch(() => {});
    fetch(`${BACKEND_URL}/api/auth/agents`, { headers })
      .then(r => (r.ok ? r.json() : []))
      .then((list: (Agent & { online?: boolean })[]) => {
        const mine = list.find(a => a.id === storeAgent?.id);
        if (mine) setOnline(!!mine.online);
      })
      .catch(() => {});
  }, [token, storeAgent?.id]);

  useEffect(() => {
    if (!token || !storeAgent?.id) return;
    fetch(`${BACKEND_URL}/api/tickets?assignedAgentId=${encodeURIComponent(storeAgent.id)}&status=open,waiting,resolved`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Conversation[]) => {
        const sorted = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setConversations(sorted.slice(0, 8));
      })
      .catch(() => setConversations([]));
  }, [token, storeAgent?.id]);

  const tzOptions = useMemo(() => timezoneOptions(profile?.timezone), [profile?.timezone]);
  const effectiveTz = profile?.timezone || browserTimeZone();
  const localTime = localTimeIn(effectiveTz, now);

  const startEdit = () => {
    setForm(toForm(profile));
    setError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Name is required');
    if (form.bio.length > 280) return setError('Bio must be 280 characters or fewer');
    if (form.calendarLink.trim() && !isHttpUrl(form.calendarLink.trim())) return setError('Calendar link must start with http:// or https://');
    setSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your profile');
      setProfile(data);
      setAuth({ ...(storeAgent || {}), ...data } as Agent, token);
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const name = profile?.name || storeAgent?.name || '';
  const roleLabel = profile?.role === 'admin' ? 'Admin' : 'Support agent';
  const set = (k: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <SettingsPageHeader title="Details" onBack={onBack} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header band */}
        <div className="bg-sidebar border-b border-line px-8 pt-10 pb-8">
          <div className="max-w-6xl flex items-end gap-5">
            <AvatarEditor
              name={name}
              avatar={profile?.avatar}
              token={token}
              onUpdated={(a) => { setProfile(a); setAuth({ ...(storeAgent || {}), ...a } as Agent, token); }}
            />
            <div className="min-w-0 pb-1">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[24px] font-semibold text-ink truncate">{name}</h3>
                <span className="ic-badge">You</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[14px] text-muted">
                {profile?.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {profile.location}</span>
                )}
                <span className="inline-flex items-center gap-1.5" title={effectiveTz}>
                  <Clock className="w-4 h-4" /> {localTime} local time
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-faint'}`} />
                  {online ? 'Active' : 'Away'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 max-w-6xl">
          {/* Left column */}
          <div className="flex flex-col gap-4 min-w-0">
            <h3 className="ic-section-title">You</h3>

            <div className="ic-card p-6">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[15px] font-semibold text-ink">Public profile</p>
                {!editing && (
                  <div className="flex items-center gap-2">
                    {savedFlash && <span className="text-[13px] text-emerald-700 dark:text-emerald-300">Saved</span>}
                    <Button size="sm" type="button" onClick={startEdit}>Edit</Button>
                  </div>
                )}
              </div>

              {!editing ? (
                <div className="divide-y divide-line">
                  <DetailRow icon={User}>{name}</DetailRow>
                  <DetailRow icon={Mail}>{profile?.email}</DetailRow>
                  <DetailRow icon={Activity}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-faint'}`} /> {online ? 'Active' : 'Away'}
                    </span>
                  </DetailRow>
                  <DetailRow icon={MapPin}>
                    {profile?.location || <Placeholder>No location yet</Placeholder>}
                    <span className="text-muted"> · {localTime} ({(effectiveTz).replace(/_/g, ' ')}{profile?.timezone ? '' : ', from your browser'})</span>
                  </DetailRow>
                  <DetailRow icon={Briefcase}>{profile?.jobTitle || <Placeholder>No job title yet</Placeholder>}</DetailRow>
                  <DetailRow icon={Building2}>{profile?.department || <Placeholder>No department yet</Placeholder>}</DetailRow>
                  <DetailRow icon={Phone}>{profile?.phone || <Placeholder>No phone number yet</Placeholder>}</DetailRow>
                  <DetailRow icon={FileText}>
                    {profile?.bio ? <span className="whitespace-pre-wrap">{profile.bio}</span> : <Placeholder>Introduce yourself</Placeholder>}
                  </DetailRow>
                  <DetailRow icon={CalendarDays}>
                    {profile?.calendarLink
                      ? <a href={profile.calendarLink} target="_blank" rel="noopener noreferrer" className="ic-link break-all">{profile.calendarLink}</a>
                      : <Placeholder>Add a link to your calendar</Placeholder>}
                  </DetailRow>
                </div>
              ) : (
                <form onSubmit={save} className="flex flex-col gap-4 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="ic-label">Name</label>
                      <input className="ic-input" value={form.name} onChange={set('name')} maxLength={80} />
                    </div>
                    <div>
                      <label className="ic-label">Email</label>
                      <span className="ic-input flex items-center bg-subtle text-muted truncate" title="Email can’t be changed here">{profile?.email}</span>
                    </div>
                    <div>
                      <label className="ic-label">Job title</label>
                      <input className="ic-input" value={form.jobTitle} onChange={set('jobTitle')} maxLength={80} placeholder="e.g. Support lead" />
                    </div>
                    <div>
                      <label className="ic-label">Department</label>
                      <input className="ic-input" value={form.department} onChange={set('department')} maxLength={80} placeholder="e.g. Customer success" />
                    </div>
                    <div>
                      <label className="ic-label">Phone</label>
                      <input className="ic-input" value={form.phone} onChange={set('phone')} maxLength={40} placeholder="+91 98765 43210" />
                    </div>
                    <div>
                      <label className="ic-label">Location</label>
                      <input className="ic-input" value={form.location} onChange={set('location')} maxLength={100} placeholder="e.g. Hyderabad, India" />
                    </div>
                    <div>
                      <label className="ic-label">Timezone</label>
                      <select className="ic-select" value={form.timezone} onChange={set('timezone')}>
                        <option value="">Use my browser’s timezone ({browserTimeZone().replace(/_/g, ' ')})</option>
                        {tzOptions.map(z => <option key={z} value={z}>{tzLabel(z)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="ic-label">Calendar link</label>
                      <input className="ic-input" value={form.calendarLink} onChange={set('calendarLink')} placeholder="https://cal.com/you" />
                    </div>
                  </div>
                  <div>
                    <label className="ic-label">Bio</label>
                    <textarea className="ic-textarea" rows={3} value={form.bio} onChange={set('bio')} maxLength={280} placeholder="Introduce yourself" />
                    <p className="ic-help mt-1 text-right">{form.bio.length}/280</p>
                  </div>
                  {error && (
                    <div className="p-3 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-lg text-[13px] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                    <Button type="submit" loading={saving}>Save</Button>
                  </div>
                </form>
              )}
            </div>

            <div className="ic-card p-6">
              <p className="text-[15px] font-semibold text-ink mb-2">Your account</p>
              <div className="divide-y divide-line">
                <DetailRow icon={CalendarClock}>
                  {profile?.createdAt
                    ? <>Created {relativeTime(profile.createdAt)} <span className="text-muted">· {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></>
                    : <Placeholder>Created date unknown</Placeholder>}
                </DetailRow>
                <DetailRow icon={ShieldCheck}>
                  {roleLabel} <span className="text-muted">· {profile?.role === 'admin' ? 'Complete access' : 'Inbox access'}</span>
                </DetailRow>
              </div>
            </div>

            <button type="button" onClick={onOpenNotifications} className="ic-card-hover p-5 flex items-center gap-4 text-left">
              <div className="ic-tile-icon bg-violet-200/70 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200">
                <Bell className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-ink">Notifications & preferences</p>
                <p className="text-[14px] text-muted mt-0.5">Dark mode, desktop and sound alerts, auto-assign and your support hours.</p>
              </div>
              <ChevronRight className="w-4 h-4 text-faint" />
            </button>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4 min-w-0">
            <h3 className="ic-section-title">Your conversations</h3>
            {conversations === null && <p className="text-[14px] text-muted">Loading…</p>}
            {conversations && conversations.length === 0 && (
              <div className="ic-card p-6 text-center">
                <MessageSquare className="w-6 h-6 text-faint mx-auto mb-2" />
                <p className="text-[14px] text-muted">No conversations are assigned to you yet.</p>
              </div>
            )}
            {conversations?.map(c => {
              const customer = c.customer?.name || 'Customer';
              const isTicket = c.kind === 'ticket' || c.kind === 'issue';
              return (
                <div key={c.id} className="ic-card p-4 flex gap-3">
                  <PersonAvatar name={customer} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] text-ink leading-snug min-w-0">
                        {isTicket && c.title
                          ? <span className="font-medium">{c.title}</span>
                          : <><span className="font-medium">{customer}</span> <span className="text-muted">replied to this conversation with</span> <span className="font-medium">You</span></>}
                      </p>
                      <span className="text-[12px] text-faint shrink-0">{relativeTime(c.updatedAt)}</span>
                    </div>
                    {c.lastMessageSnippet && (
                      <p className="text-[13px] text-muted mt-1 line-clamp-2 break-words">{c.lastMessageSnippet}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="ic-badge">{c.ticketNumber}</span>
                      <span className="ic-badge capitalize">{c.status}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
