import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { appearanceOf } from '../services/messenger';
import { ReplyTime, SnoozePreset, Workspace } from '../../../shared/src/types';
import { isOpenAt, nextOpening, validateOfficeHours, isValidTimeZone, REPLY_TIMES } from '../services/officeHours';
import { SocketService } from '../services/socket';

export function workspaceIdOf(req: AuthenticatedRequest): string {
  return req.workspaceId || req.user?.workspaceId || 'default_workspace';
}

function openStatus(ws: Workspace | null) {
  const officeHours = ws?.officeHours || null;
  const now = new Date();
  const isOpenNow = isOpenAt(officeHours, now);
  const next = isOpenNow ? null : nextOpening(officeHours, now);
  return { isOpenNow, ...(next ? { nextOpenAt: next.toISOString() } : {}) };
}

function officeHoursResponse(ws: Workspace | null) {
  return {
    officeHours: ws?.officeHours || null,
    replyTime: ws?.replyTime || null,
    replyTimeNotice: ws?.replyTimeNotice !== false,
    ...openStatus(ws),
  };
}

const DEFAULT_ATTRIBUTION = 'Powered by Chai Samosa';

/** Teammate-facing workspace settings (never includes integrations / secrets). */
function workspaceSettingsResponse(ws: Workspace) {
  return {
    id: ws.id,
    name: ws.name,
    customerFacingName: ws.customerFacingName || '',
    timezone: ws.timezone || ws.officeHours?.timezone || null,
    showAttribution: ws.showAttribution !== false,
    attributionText: ws.attributionText || '',
    snoozeOptions: Array.isArray(ws.snoozeOptions) ? ws.snoozeOptions : [],
    replyTimeNotice: ws.replyTimeNotice !== false,
    appId: ws.id,
  };
}

/** Public (used by the Messenger widget): office hours, reply time and whether the team is open now. */
export async function getOfficeHours(req: AuthenticatedRequest, res: Response) {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceIdOf(req));
    return res.json(officeHoursResponse(ws));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Admin only: save office hours + reply time (+ reply time notice) for the current workspace. */
export async function updateOfficeHours(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can change office hours' });

  const { officeHours, replyTime, replyTimeNotice } = req.body || {};
  const checked = validateOfficeHours(officeHours);
  if ('error' in checked) return res.status(400).json({ error: checked.error });
  if (!REPLY_TIMES.includes(replyTime)) {
    return res.status(400).json({ error: `replyTime must be one of: ${REPLY_TIMES.join(', ')}` });
  }
  if (replyTimeNotice !== undefined && typeof replyTimeNotice !== 'boolean') {
    return res.status(400).json({ error: 'replyTimeNotice must be true or false' });
  }

  try {
    const updates: Partial<Workspace> = {
      officeHours: checked.value,
      replyTime: replyTime as ReplyTime,
      timezone: checked.value.timezone, // one timezone for the whole workspace
    };
    if (typeof replyTimeNotice === 'boolean') updates.replyTimeNotice = replyTimeNotice;
    const updated = await RepositoryFactory.getWorkspaceRepository().update(workspaceIdOf(req), updates);
    if (!updated) return res.status(404).json({ error: 'Workspace not found' });
    return res.json(officeHoursResponse(updated));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Public: everything the Messenger widget needs about the workspace. Never includes integrations. */
export async function getPublicWorkspace(req: AuthenticatedRequest, res: Response) {
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceIdOf(req));
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    let onlineAgents: { id: string; name: string; avatar?: string }[] = [];
    try {
      const agents = await RepositoryFactory.getUserRepository().findAll();
      onlineAgents = agents
        .filter(a => SocketService.onlineAgents.has(a.id))
        .slice(0, 3)
        .map(a => ({ id: a.id, name: a.name, ...(a.avatar ? { avatar: a.avatar } : {}) }));
    } catch {
      onlineAgents = [];
    }
    return res.json({
      id: ws.id,
      name: (ws.customerFacingName || '').trim() || ws.name,
      showAttribution: ws.showAttribution !== false,
      attributionText: (ws.attributionText || '').trim() || DEFAULT_ATTRIBUTION,
      messenger: appearanceOf(ws),
      replyTime: ws.replyTime || null,
      replyTimeNotice: ws.replyTimeNotice !== false,
      officeHours: ws.officeHours || null,
      ...openStatus(ws),
      timezone: ws.timezone || ws.officeHours?.timezone || null,
      onlineAgents,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/** Any teammate: workspace general settings. */
export async function getWorkspace(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceIdOf(req));
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    return res.json(workspaceSettingsResponse(ws));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

const SNOOZE_KINDS: SnoozePreset['kind'][] = ['hours', 'days', 'tomorrow', 'next-week', 'next-month'];

function validateSnoozeOptions(input: any): { error: string } | { value: SnoozePreset[] } {
  if (!Array.isArray(input)) return { error: 'snoozeOptions must be an array' };
  if (input.length > 10) return { error: 'You can have at most 10 snooze options' };
  const out: SnoozePreset[] = [];
  for (const [i, p] of input.entries()) {
    if (!p || typeof p !== 'object') return { error: `Snooze option ${i + 1} is invalid` };
    if (!SNOOZE_KINDS.includes(p.kind)) return { error: `Snooze option ${i + 1}: kind must be one of ${SNOOZE_KINDS.join(', ')}` };
    const preset: SnoozePreset = { kind: p.kind };
    if (p.kind === 'hours' || p.kind === 'days') {
      if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > 365) {
        return { error: `Snooze option ${i + 1}: amount must be a whole number between 1 and 365` };
      }
      preset.amount = p.amount;
    }
    if (p.label !== undefined && p.label !== null && p.label !== '') {
      if (typeof p.label !== 'string') return { error: `Snooze option ${i + 1}: label must be text` };
      const label = p.label.trim();
      if (label.length > 40) return { error: `Snooze option ${i + 1}: label must be 40 characters or fewer` };
      if (label) preset.label = label;
    }
    out.push(preset);
  }
  return { value: out };
}

/** Admin only: update general workspace settings. */
export async function updateWorkspace(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can change workspace settings' });

  const body = req.body || {};
  const updates: Partial<Workspace> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ error: 'Workspace name is required' });
    if (body.name.trim().length > 80) return res.status(400).json({ error: 'Workspace name must be 80 characters or fewer' });
    updates.name = body.name.trim();
  }
  if (body.customerFacingName !== undefined) {
    if (body.customerFacingName !== null && typeof body.customerFacingName !== 'string') {
      return res.status(400).json({ error: 'customerFacingName must be text' });
    }
    const v = (body.customerFacingName || '').trim();
    if (v.length > 80) return res.status(400).json({ error: 'Customer-facing name must be 80 characters or fewer' });
    updates.customerFacingName = v;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) return res.status(400).json({ error: 'timezone must be a valid IANA timezone' });
    updates.timezone = body.timezone.trim();
  }
  if (body.showAttribution !== undefined) {
    if (typeof body.showAttribution !== 'boolean') return res.status(400).json({ error: 'showAttribution must be true or false' });
    updates.showAttribution = body.showAttribution;
  }
  if (body.attributionText !== undefined) {
    if (typeof body.attributionText !== 'string' || body.attributionText.length > 60) {
      return res.status(400).json({ error: 'attributionText must be text of at most 60 characters' });
    }
    updates.attributionText = body.attributionText.trim(); // empty = default text
  }
  if (body.snoozeOptions !== undefined) {
    const checked = validateSnoozeOptions(body.snoozeOptions);
    if ('error' in checked) return res.status(400).json({ error: checked.error });
    updates.snoozeOptions = checked.value;
  }

  try {
    const repo = RepositoryFactory.getWorkspaceRepository();
    const id = workspaceIdOf(req);
    const current = await repo.findById(id);
    if (!current) return res.status(404).json({ error: 'Workspace not found' });
    if (Object.keys(updates).length === 0) return res.json(workspaceSettingsResponse(current));
    if (updates.timezone && current.officeHours && current.officeHours.timezone !== updates.timezone) {
      updates.officeHours = { ...current.officeHours, timezone: updates.timezone };
    }
    const updated = await repo.update(id, updates);
    if (!updated) return res.status(404).json({ error: 'Workspace not found' });
    return res.json(workspaceSettingsResponse(updated));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
