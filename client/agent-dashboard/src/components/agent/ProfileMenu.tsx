import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Check, ChevronLeft, ChevronRight, HelpCircle, Contrast, ExternalLink, Languages, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Agent } from '../../../../../shared/src/types';
import { API_URL } from '../../lib/config';

const BACKEND_URL = API_URL;
export type ThemePref = 'system' | 'light' | 'dark';

const THEMES: { id: ThemePref; label: string; icon: React.ElementType }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];
const HELP_LINKS = [
  { label: 'Documentation', href: 'https://github.com/theprashanth/Help-Desk#readme' },
  { label: 'Report a problem', href: 'https://github.com/theprashanth/Help-Desk/issues/new' },
];

type Sub = null | 'theme' | 'language' | 'help';

/** Menu under your avatar (bottom of the far-left rail): status, workspace, preferences, help, log out. */
export const ProfileMenu: React.FC<{
  agent: Agent;
  avatar: React.ReactNode;
  anchor: HTMLElement | null;   // the avatar button; the menu opens beside it
  themePref: ThemePref;
  onThemeChange: (t: ThemePref) => void;
  onOpenSettings: (section: string) => void;
  onLogout: () => void;
  onClose: () => void;
}> = ({ agent, avatar, anchor, themePref, onThemeChange, onOpenSettings, onLogout, onClose }) => {
  const token = useStore(s => s.token);
  const setAuth = useStore(s => s.setAuth);
  const [sub, setSub] = useState<Sub>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [savingAway, setSavingAway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const away = !!agent.away;
  // Rendered on <body> (the rail clips its children), next to the avatar, bottom-aligned
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      if (r) setPos({ left: r.right + 12, bottom: Math.max(8, window.innerHeight - r.bottom) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    if (!token) return;
    fetch(`${BACKEND_URL}/api/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(ws => setWorkspaceName(ws?.name || ''))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (sub ? setSub(null) : onClose()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sub, onClose]);

  const toggleAway = async () => {
    if (!token || savingAway) return;
    setSavingAway(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/profile/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ away: !away }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Couldn’t change your status');
      setAuth({ ...agent, away: !!data.away }, token);
    } catch (e: any) {
      setError(e.message);
    } finally { setSavingAway(false); }
  };

  const themeLabel = THEMES.find(t => t.id === themePref)?.label || 'System';
  const row = 'w-full flex items-center gap-3 px-3.5 h-10 rounded-lg text-[14px] text-ink hover:bg-subtle text-left';
  const sectionLabel = 'px-3.5 pt-2 pb-1 text-[12.5px] font-medium text-muted';

  const back = (title: string) => (
    <button onClick={() => setSub(null)} className="w-full flex items-center gap-2 px-2.5 h-10 text-[14px] font-semibold text-ink hover:bg-subtle rounded-lg">
      <ChevronLeft className="w-4 h-4 text-muted" /> {title}
    </button>
  );

  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className="ic-menu fixed w-[300px] p-1.5 animate-fade-in z-[61]" style={{ left: pos.left, bottom: pos.bottom }} role="menu">
        {sub === 'theme' ? (
          <>
            {back('Theme')}
            {THEMES.map(t => (
              <button key={t.id} className={row} onClick={() => { onThemeChange(t.id); setSub(null); }}>
                <t.icon className="w-4 h-4" /> <span className="flex-1">{t.label}</span>
                {themePref === t.id && <Check className="w-4 h-4 text-accent" />}
              </button>
            ))}
            <p className="px-3.5 py-2 text-[12.5px] text-muted">System follows your computer’s light or dark setting.</p>
          </>
        ) : sub === 'language' ? (
          <>
            {back('Language')}
            <button className={row} onClick={() => setSub(null)}>
              <span className="flex-1">English (US)</span> <Check className="w-4 h-4 text-accent" />
            </button>
            <p className="px-3.5 py-2 text-[12.5px] text-muted">More languages are coming soon.</p>
          </>
        ) : sub === 'help' ? (
          <>
            {back('Help & support')}
            {HELP_LINKS.map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className={row} onClick={onClose}>
                <span className="flex-1">{l.label}</span> <ExternalLink className="w-4 h-4 text-muted" />
              </a>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="relative shrink-0">
                {avatar}
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-surface ${away ? 'bg-amber-400' : 'bg-emerald-500'}`} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink truncate">{agent.name}</p>
                <p className="text-[12.5px] text-muted truncate">{agent.email}</p>
              </div>
            </div>

            <p className={sectionLabel}>My status</p>
            <button className={row} onClick={toggleAway} disabled={savingAway} role="menuitemcheckbox" aria-checked={away}>
              <span className={`w-2.5 h-2.5 rounded-full ${away ? 'bg-amber-400' : 'bg-emerald-500'}`} />
              <span className="flex-1">Away mode</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors ${away ? 'bg-ink' : 'bg-ink/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface shadow transition-all ${away ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </button>
            <p className="px-3.5 pb-1 text-[12px] text-faint leading-snug">
              {away ? 'Customers don’t see you as online, and new chats aren’t auto-assigned to you.' : 'You’re shown as online and can be auto-assigned new chats.'}
            </p>
            {error && <p className="px-3.5 pb-1 text-[12.5px] text-red-600">{error}</p>}

            <div className="my-1.5 border-t border-line" />
            <button className={row} onClick={() => { onOpenSettings('general'); onClose(); }}>
              <Building2 className="w-4 h-4" /> <span className="flex-1">Workspace</span>
              <span className="text-[13px] text-muted truncate max-w-[110px]">{workspaceName}</span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>

            <div className="my-1.5 border-t border-line" />
            <p className={sectionLabel}>Preferences</p>
            <button className={row} onClick={() => setSub('theme')}>
              <Contrast className="w-4 h-4" /> <span className="flex-1">Theme</span>
              <span className="text-[13px] text-muted">{themeLabel}</span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>
            <button className={row} onClick={() => setSub('language')}>
              <Languages className="w-4 h-4" /> <span className="flex-1">Language</span>
              <span className="text-[13px] text-muted">English (US)</span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>

            <div className="my-1.5 border-t border-line" />
            <button className={row} onClick={() => setSub('help')}>
              <HelpCircle className="w-4 h-4" /> <span className="flex-1">Help & support</span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>

            <div className="my-1.5 border-t border-line" />
            <button className={row} onClick={onLogout}>
              <LogOut className="w-4 h-4" /> <span className="flex-1">Log out</span>
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  );
};

export default ProfileMenu;
