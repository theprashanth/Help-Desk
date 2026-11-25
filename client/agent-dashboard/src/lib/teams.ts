import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Team } from '../../../../shared/src/types';
import { API_URL } from './config';

const BACKEND_URL = API_URL;

let inflight: Promise<void> | null = null;
/** Load the workspace's team inboxes into the store (shared by every component that needs them). */
export function loadTeams(force = false): Promise<void> {
  const { token } = useStore.getState();
  if (!token) return Promise.resolve();
  if (inflight && !force) return inflight;
  inflight = fetch(`${BACKEND_URL}/api/teams`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => (r.ok ? r.json() : null))
    .then((d: { teams: Team[]; defaultTeamId: string | null } | null) => { if (d) useStore.getState().setTeams(d.teams, d.defaultTeamId); })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

/** Teams from the store, loaded on first use. */
export function useTeams(): Team[] {
  const teams = useStore(s => s.teams);
  const token = useStore(s => s.token);
  useEffect(() => { if (token) loadTeams(); }, [token]);
  return teams;
}

export const teamLabel = (t?: Pick<Team, 'name' | 'emoji'> | null) => (t ? `${t.emoji ? t.emoji + ' ' : ''}${t.name}` : 'No team');

/** Roles: what each seat can do. */
export const ROLE_LABELS: Record<string, string> = { admin: 'Admin', support_agent: 'Agent', light: 'Light' };
export const ROLE_HINTS: Record<string, string> = {
  admin: 'Everything, including settings, teammates and data',
  support_agent: 'Conversations, macros and customers; no workspace settings or data',
  light: 'Read-only: can view everything and add internal notes',
};
