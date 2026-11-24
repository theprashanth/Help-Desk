import { RecordRepository } from '../repositories/records';
import { RepositoryFactory } from '../repositories/factory';
import { SocketService } from './socket';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { Agent, Team } from '../../../shared/src/types';

/**
 * Team inboxes and assignment rules (Settings › Teams).
 *  - Every new customer conversation goes to the workspace's default team, if one is set.
 *  - The team's rule picks a teammate: manual (none), round robin (take turns) or balanced
 *    (fewest open conversations). Only teammates who are online, not Away, have a full seat and
 *    are under the team's capacity are picked.
 *  - No teams yet: the whole workspace is balanced, as before.
 */
export const teamsRepo = new RecordRepository<Team>('teams', 'team');

type Pick = { teamId?: string; assignedAgentId?: string; reason?: string };

async function openCounts(): Promise<Record<string, number>> {
  const open = await RepositoryFactory.getConversationRepository().findFiltered({ status: ['open', 'waiting'] });
  const counts: Record<string, number> = {};
  for (const c of open) if (c.assignedAgentId && !c.mergedInto) counts[c.assignedAgentId] = (counts[c.assignedAgentId] || 0) + 1;
  return counts;
}

function available(agents: Agent[]): Agent[] {
  return agents.filter(a => SocketService.onlineAgents.has(a.id) && !a.away && a.role !== 'light');
}

/** Pick a teammate from a team by its rule. Updates the round-robin pointer. */
export async function pickFromTeam(team: Team): Promise<string | undefined> {
  if (team.assignment.method === 'manual') return undefined;
  const all = await RepositoryFactory.getUserRepository().findAll();
  const byId = new Map(all.map(a => [a.id, a]));
  const members = available(team.memberIds.map(id => byId.get(id)).filter((a): a is Agent => !!a));
  if (!members.length) return undefined;
  const counts = await openCounts();
  const cap = team.assignment.capacity;
  const eligible = members.filter(a => !cap || (counts[a.id] || 0) < cap);
  if (!eligible.length) return undefined;

  let chosen: Agent;
  if (team.assignment.method === 'round_robin') {
    // Next one after whoever got the last conversation, in the team's member order
    const order = team.memberIds;
    const start = team.assignment.lastAssignedId ? order.indexOf(team.assignment.lastAssignedId) + 1 : 0;
    const rotated = [...order.slice(start), ...order.slice(0, start)];
    chosen = rotated.map(id => eligible.find(a => a.id === id)).find((a): a is Agent => !!a) || eligible[0];
    await teamsRepo.update(team.id, { assignment: { ...team.assignment, lastAssignedId: chosen.id } });
  } else {
    chosen = [...eligible].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0))[0];
  }
  return chosen.id;
}

/** Where a brand-new customer conversation goes: its team (the default team) and, by that team's rule, a teammate. */
export async function routeNewConversation(): Promise<Pick> {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(getActiveWorkspaceId());
  const team = ws?.defaultTeamId ? await teamsRepo.get(ws.defaultTeamId) : null;
  if (team) {
    const id = await pickFromTeam(team);
    return { teamId: team.id, assignedAgentId: id, reason: id ? `${team.name} · ${team.assignment.method === 'round_robin' ? 'round robin' : 'balanced'}` : undefined };
  }
  // No teams: balanced across everyone available (the original behaviour)
  const agents = available(await RepositoryFactory.getUserRepository().findAll());
  if (!agents.length) return {};
  const counts = await openCounts();
  const chosen = [...agents].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0))[0];
  return { assignedAgentId: chosen.id, reason: 'balanced' };
}
