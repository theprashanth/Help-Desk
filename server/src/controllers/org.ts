import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { RecordRepository } from '../repositories/records';
import { teamsRepo } from '../services/teams';
import { auditRepo, logAudit } from '../services/audit';
import { SocketService } from '../services/socket';
import { getActiveWorkspaceId } from '../context/tenant.context';
import { AssignmentMethod, Company, CustomAttributeDef, Team } from '../../../shared/src/types';

/**
 * Teams (team inboxes + assignment rules), people data (custom attributes), companies and the
 * audit log. Reads are open to every teammate; changes to teams, attributes and the audit log are
 * admin-only (enforced in the routes).
 */

const wsId = () => getActiveWorkspaceId();
const METHODS: AssignmentMethod[] = ['manual', 'round_robin', 'balanced'];
export const companiesRepo = new RecordRepository<Company>('companies', 'company');

// ── Teams ───────────────────────────────────────────────────────────────────

async function cleanTeam(body: any, current?: Team): Promise<{ value?: Omit<Team, 'id'>; error?: string }> {
  const name = body.name !== undefined ? String(body.name).trim() : current?.name;
  if (!name) return { error: 'Team name is required' };
  if (name.length > 60) return { error: 'Team name must be 60 characters or fewer' };
  const teams = await teamsRepo.list();
  if (teams.some(t => t.id !== current?.id && t.name.toLowerCase() === name.toLowerCase())) return { error: 'A team with this name already exists' };

  const emoji = body.emoji !== undefined ? String(body.emoji || '').trim().slice(0, 8) : current?.emoji;
  let memberIds = current?.memberIds || [];
  if (body.memberIds !== undefined) {
    if (!Array.isArray(body.memberIds)) return { error: 'memberIds must be a list' };
    const agents = new Set((await RepositoryFactory.getUserRepository().findAll()).map(a => a.id));
    memberIds = Array.from(new Set(body.memberIds.filter((id: unknown) => typeof id === 'string' && agents.has(id)))) as string[];
  }
  const a = body.assignment || {};
  const method: AssignmentMethod = a.method !== undefined ? a.method : current?.assignment.method || 'balanced';
  if (!METHODS.includes(method)) return { error: 'Assignment must be manual, round_robin or balanced' };
  let capacity = a.capacity !== undefined ? a.capacity : current?.assignment.capacity;
  if (capacity === null || capacity === '' || capacity === 0) capacity = undefined;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)) return { error: 'Capacity must be 1 to 500 open conversations' };
  return {
    value: {
      name, ...(emoji ? { emoji } : {}), memberIds,
      assignment: { method, ...(capacity ? { capacity } : {}), ...(current?.assignment.lastAssignedId ? { lastAssignedId: current.assignment.lastAssignedId } : {}) },
    },
  };
}

export async function listTeams(_req: AuthenticatedRequest, res: Response) {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsId());
    return res.json({ teams: await teamsRepo.list(), defaultTeamId: ws?.defaultTeamId || null });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function createTeam(req: AuthenticatedRequest, res: Response) {
  try {
    const { value, error } = await cleanTeam(req.body || {});
    if (error || !value) return res.status(400).json({ error });
    const team = await teamsRepo.create(value);
    // The first team becomes the default inbox for new conversations
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsId());
    if (ws && !ws.defaultTeamId) await RepositoryFactory.getWorkspaceRepository().update(ws.id, { defaultTeamId: team.id });
    await logAudit(req, 'team.created', `Created the ${team.name} team`, { target: team.name, details: { members: team.memberIds.length, method: team.assignment.method } });
    SocketService.emitGlobal('teams:changed', {});
    return res.status(201).json(team);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function updateTeam(req: AuthenticatedRequest, res: Response) {
  try {
    const current = await teamsRepo.get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Team not found' });
    const { value, error } = await cleanTeam(req.body || {}, current);
    if (error || !value) return res.status(400).json({ error });
    const team = await teamsRepo.update(current.id, value);
    const what: string[] = [];
    if (current.name !== value.name) what.push('name');
    if (JSON.stringify(current.memberIds) !== JSON.stringify(value.memberIds)) what.push('members');
    if (current.assignment.method !== value.assignment.method || current.assignment.capacity !== value.assignment.capacity) what.push('assignment rule');
    if (what.length) await logAudit(req, 'team.updated', `Changed the ${value.name} team's ${what.join(', ')}`, { target: value.name });
    SocketService.emitGlobal('teams:changed', {});
    return res.json(team);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function deleteTeam(req: AuthenticatedRequest, res: Response) {
  try {
    const team = await teamsRepo.get(req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    // Its conversations stay where they are, just without a team inbox
    const convRepo = RepositoryFactory.getConversationRepository();
    let moved = 0;
    for (const c of (await convRepo.findAll()).filter(c => c.teamId === team.id)) {
      const u = await convRepo.update(c.id, { teamId: undefined }, { touch: false });
      if (u) { moved++; SocketService.broadcastConversationUpdate(u); }
    }
    await teamsRepo.delete(team.id);
    const wsRepo = RepositoryFactory.getWorkspaceRepository();
    const ws = await wsRepo.findById(wsId());
    if (ws?.defaultTeamId === team.id) {
      const next = (await teamsRepo.list())[0];
      await wsRepo.update(ws.id, { defaultTeamId: next?.id || undefined } as any);
    }
    await logAudit(req, 'team.deleted', `Deleted the ${team.name} team`, { target: team.name, details: { conversations: moved } });
    SocketService.emitGlobal('teams:changed', {});
    return res.json({ success: true, conversations: moved });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function setDefaultTeam(req: AuthenticatedRequest, res: Response) {
  try {
    const teamId = req.body?.teamId || null;
    const team = teamId ? await teamsRepo.get(teamId) : null;
    if (teamId && !team) return res.status(404).json({ error: 'Team not found' });
    await RepositoryFactory.getWorkspaceRepository().update(wsId(), { defaultTeamId: team?.id || undefined } as any);
    await logAudit(req, 'team.default_changed', team ? `New conversations now go to the ${team.name} team` : 'New conversations no longer go to a team', { target: team?.name });
    SocketService.emitGlobal('teams:changed', {});
    return res.json({ defaultTeamId: team?.id || null });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

// ── People data: custom attributes ─────────────────────────────────────────

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TYPES: CustomAttributeDef['type'][] = ['text', 'number', 'boolean', 'date', 'list'];

export async function getAttributeDefs(_req: AuthenticatedRequest, res: Response) {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(wsId());
    return res.json(ws?.customerAttributes || []);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function saveAttributeDefs(req: AuthenticatedRequest, res: Response) {
  const list = req.body?.attributes;
  if (!Array.isArray(list) || list.length > 50) return res.status(400).json({ error: 'attributes must be a list of up to 50 fields' });
  const seen = new Set<string>();
  const defs: CustomAttributeDef[] = [];
  for (const raw of list) {
    const key = String(raw?.key || '').trim();
    const label = String(raw?.label || '').trim();
    if (!KEY_RE.test(key)) return res.status(400).json({ error: `“${key || label}”: the key must start with a letter and use only lowercase letters, digits and _` });
    if (seen.has(key)) return res.status(400).json({ error: `The key “${key}” is used twice` });
    if (!label || label.length > 60) return res.status(400).json({ error: `“${key}”: a label of up to 60 characters is required` });
    if (!TYPES.includes(raw.type)) return res.status(400).json({ error: `“${label}”: unknown type` });
    let options: string[] | undefined;
    if (raw.type === 'list') {
      options = Array.from(new Set((Array.isArray(raw.options) ? raw.options : []).map((o: unknown) => String(o).trim()).filter(Boolean))).slice(0, 50) as string[];
      if (!options.length) return res.status(400).json({ error: `“${label}”: add at least one choice` });
    }
    seen.add(key);
    defs.push({ key, label, type: raw.type, ...(options ? { options } : {}), ...(raw.archived ? { archived: true } : {}) });
  }
  try {
    const wsRepo = RepositoryFactory.getWorkspaceRepository();
    const before = (await wsRepo.findById(wsId()))?.customerAttributes || [];
    await wsRepo.update(wsId(), { customerAttributes: defs });
    const added = defs.filter(d => !before.some(b => b.key === d.key)).map(d => d.label);
    const removed = before.filter(b => !defs.some(d => d.key === b.key)).map(b => b.label);
    await logAudit(req, 'settings.people_data', [
      added.length ? `Added ${added.join(', ')}` : '', removed.length ? `Removed ${removed.join(', ')}` : '',
    ].filter(Boolean).join('; ') || 'Changed people data attributes', { details: { count: defs.length } });
    SocketService.emitGlobal('attributes:changed', {});
    return res.json(defs);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

/** Check custom attribute values against their definitions. Unknown keys are rejected; null/'' clears. */
export async function cleanAttributeValues(input: unknown, current: Record<string, any> = {}): Promise<{ value?: Record<string, any>; error?: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'attributes must be an object' };
  const defs = (await RepositoryFactory.getWorkspaceRepository().findById(wsId()))?.customerAttributes || [];
  const out: Record<string, any> = { ...current };
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    const def = defs.find(d => d.key === key);
    if (!def) return { error: `Unknown attribute “${key}”` };
    if (v === null || v === '' || v === undefined) { delete out[key]; continue; }
    switch (def.type) {
      case 'text': if (typeof v !== 'string' || v.length > 500) return { error: `${def.label} must be text up to 500 characters` }; out[key] = v.trim(); break;
      case 'number': { const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n)) return { error: `${def.label} must be a number` }; out[key] = n; break; }
      case 'boolean': if (typeof v !== 'boolean') return { error: `${def.label} must be true or false` }; out[key] = v; break;
      case 'date': if (typeof v !== 'string' || isNaN(Date.parse(v))) return { error: `${def.label} must be a date` }; out[key] = v.slice(0, 10); break;
      case 'list': if (typeof v !== 'string' || !(def.options || []).includes(v)) return { error: `${def.label} must be one of: ${(def.options || []).join(', ')}` }; out[key] = v; break;
    }
  }
  return { value: out };
}

// ── Companies ──────────────────────────────────────────────────────────────

function cleanCompany(body: any, current?: Company): { value?: Omit<Company, 'id'>; error?: string } {
  const name = body.name !== undefined ? String(body.name).trim() : current?.name;
  if (!name) return { error: 'Company name is required' };
  if (name.length > 100) return { error: 'Company name is too long' };
  const str = (k: 'website' | 'plan' | 'notes', max: number) => {
    const v = body[k] !== undefined ? String(body[k] || '').trim() : current?.[k];
    return v ? v.slice(0, max) : undefined;
  };
  let website = str('website', 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  let size = body.size !== undefined ? body.size : current?.size;
  if (size === '' || size === null) size = undefined;
  if (size !== undefined && (!Number.isInteger(Number(size)) || Number(size) < 0)) return { error: 'Size must be a whole number' };
  return { value: { name, website, plan: str('plan', 60), notes: str('notes', 2000), ...(size !== undefined ? { size: Number(size) } : {}) } };
}

export async function listCompanies(req: AuthenticatedRequest, res: Response) {
  try {
    const q = String(req.query.search || '').trim().toLowerCase();
    const customers = await RepositoryFactory.getCustomerRepository().findAll();
    const people = new Map<string, number>();
    for (const c of customers) if (c.companyId) people.set(c.companyId, (people.get(c.companyId) || 0) + 1);
    const list = (await companiesRepo.list())
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.website || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ ...c, people: people.get(c.id) || 0 }));
    return res.json(list);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function getCompany(req: AuthenticatedRequest, res: Response) {
  try {
    const company = await companiesRepo.get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const people = (await RepositoryFactory.getCustomerRepository().findAll()).filter(c => c.companyId === company.id);
    const ids = new Set(people.map(p => p.id));
    const conversations = (await RepositoryFactory.getConversationRepository().findAll())
      .filter(c => ids.has(c.customer.id) && !c.mergedInto)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return res.json({
      ...company,
      people: people.map(p => ({ id: p.id, name: p.name, email: p.email })),
      conversations: conversations.slice(0, 50).map(c => ({ id: c.id, ticketNumber: c.ticketNumber, status: c.status, customerName: c.customer.name, title: c.title, snippet: c.lastMessageSnippet, updatedAt: c.updatedAt })),
      openConversations: conversations.filter(c => c.status === 'open' || c.status === 'waiting').length,
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function createCompany(req: AuthenticatedRequest, res: Response) {
  try {
    const { value, error } = cleanCompany(req.body || {});
    if (error || !value) return res.status(400).json({ error });
    if ((await companiesRepo.list()).some(c => c.name.toLowerCase() === value.name.toLowerCase())) return res.status(409).json({ error: 'A company with this name already exists' });
    return res.status(201).json(await companiesRepo.create(value));
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function updateCompany(req: AuthenticatedRequest, res: Response) {
  try {
    const current = await companiesRepo.get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Company not found' });
    const { value, error } = cleanCompany(req.body || {}, current);
    if (error || !value) return res.status(400).json({ error });
    return res.json(await companiesRepo.update(current.id, value));
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

export async function deleteCompany(req: AuthenticatedRequest, res: Response) {
  try {
    const company = await companiesRepo.get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const custRepo = RepositoryFactory.getCustomerRepository();
    let unlinked = 0;
    for (const c of (await custRepo.findAll()).filter(c => c.companyId === company.id)) {
      await custRepo.update(c.id, { companyId: undefined });
      unlinked++;
    }
    await companiesRepo.delete(company.id);
    await logAudit(req, 'company.deleted', `Deleted the company ${company.name}`, { target: company.name, details: { people: unlinked } });
    return res.json({ success: true, people: unlinked });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}

// ── Audit log ──────────────────────────────────────────────────────────────

export async function getAuditLog(req: AuthenticatedRequest, res: Response) {
  try {
    const q = String(req.query.search || '').trim().toLowerCase();
    const area = String(req.query.area || '').trim(); // action prefix, e.g. "teammate" or "data"
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const list = (await auditRepo.list())
      .filter(e => !area || e.action.startsWith(area + '.'))
      .filter(e => !q || [e.summary, e.actor?.name, e.target, e.action].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return res.json({ total: list.length, entries: list.slice(0, limit) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
}
