import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import {
  IntegrationEvent, SlackIntegration, WebhookIntegration, Workspace, Conversation,
} from '../../../shared/src/types';
import { workspaceIdOf } from './workspace';
import {
  INTEGRATION_EVENTS, IntegrationKind, buildSlackPayload, sendSlack, sendWebhook, recordDelivery, withIntegrationsLock,
} from '../services/notifications';

const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function requireUser(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
  return true;
}

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Only admins can manage integrations' }); return false; }
  return true;
}

function slackHint(url: string): string {
  const tail = url.replace(/\/+$/, '').slice(-4);
  return `hooks.slack.com/…/${tail}`;
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).host; } catch { return undefined; }
}

/** Browser-safe view of the integrations: never includes URLs or secrets. */
function publicIntegrations(ws: Workspace | null) {
  const slack = ws?.integrations?.slack;
  const webhook = ws?.integrations?.webhook;
  return {
    slack: slack
      ? {
          connected: true,
          enabled: !!slack.enabled,
          events: slack.events || [],
          webhookHint: slackHint(slack.webhookUrl || ''),
          ...(slack.connectedAt ? { connectedAt: slack.connectedAt } : {}),
          ...(slack.lastDeliveryAt ? { lastDeliveryAt: slack.lastDeliveryAt } : {}),
          ...(slack.lastError ? { lastError: slack.lastError } : {}),
        }
      : { connected: false, enabled: false, events: [] as IntegrationEvent[] },
    webhook: webhook
      ? {
          connected: true,
          enabled: !!webhook.enabled,
          events: webhook.events || [],
          ...(hostOf(webhook.url) ? { urlHint: hostOf(webhook.url) } : {}),
          hasSecret: !!webhook.secret,
          ...(webhook.connectedAt ? { connectedAt: webhook.connectedAt } : {}),
          ...(webhook.lastDeliveryAt ? { lastDeliveryAt: webhook.lastDeliveryAt } : {}),
          ...(webhook.lastError ? { lastError: webhook.lastError } : {}),
        }
      : { connected: false, enabled: false, events: [] as IntegrationEvent[], hasSecret: false },
  };
}

function parseEvents(input: any): IntegrationEvent[] {
  if (!Array.isArray(input) || !input.every(e => INTEGRATION_EVENTS.includes(e))) {
    throw new HttpError(400, `events must be a list containing only: ${INTEGRATION_EVENTS.join(', ')}`);
  }
  return Array.from(new Set<IntegrationEvent>(input));
}

function parseEnabled(input: any): boolean {
  if (typeof input !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  return input;
}

function validateWebhookUrl(input: any): string {
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'url is required');
  const raw = input.trim();
  if (raw.length > 2000) throw new HttpError(400, 'url is too long');
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'url must be a valid URL'); }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && localHost) return u.toString();
  throw new HttpError(400, 'url must use https:// (http:// is only allowed for localhost)');
}

/** Read-modify-write the workspace integrations object (always written whole). */
async function mutateIntegrations(workspaceId: string, fn: (current: NonNullable<Workspace['integrations']>) => NonNullable<Workspace['integrations']>) {
  return withIntegrationsLock(workspaceId, async () => {
    const repo = RepositoryFactory.getWorkspaceRepository();
    const ws = await repo.findById(workspaceId);
    if (!ws) throw new HttpError(404, 'Workspace not found');
    const next = fn({ ...(ws.integrations || {}) });
    const updated = await repo.update(workspaceId, { integrations: next });
    if (!updated) throw new HttpError(404, 'Workspace not found');
    return updated;
  });
}

function handleError(res: Response, err: any) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  return res.status(500).json({ error: err?.message || 'Something went wrong' });
}

export async function getIntegrations(req: AuthenticatedRequest, res: Response) {
  if (!requireUser(req, res)) return;
  try {
    const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceIdOf(req));
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    return res.json(publicIntegrations(ws));
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── Slack ───────────────────────────────────────────────────────────────────

export async function updateSlack(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  try {
    let webhookUrl: string | undefined;
    if (body.webhookUrl !== undefined) {
      if (typeof body.webhookUrl !== 'string' || !SLACK_URL_RE.test(body.webhookUrl.trim())) {
        throw new HttpError(400, 'Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)');
      }
      webhookUrl = body.webhookUrl.trim();
      if (webhookUrl!.length > 500) throw new HttpError(400, 'webhookUrl is too long');
    }
    const enabled = body.enabled !== undefined ? parseEnabled(body.enabled) : undefined;
    const events = body.events !== undefined ? parseEvents(body.events) : undefined;

    const updated = await mutateIntegrations(workspaceIdOf(req), current => {
      const existing = current.slack;
      if (!existing && !webhookUrl) throw new HttpError(400, 'webhookUrl is required to connect Slack');
      const next: SlackIntegration = existing
        ? { ...existing }
        : { webhookUrl: webhookUrl!, enabled: true, events: ['conversation.created'], connectedAt: new Date().toISOString(), connectedBy: req.user!.id, lastError: null };
      if (webhookUrl && existing && webhookUrl !== existing.webhookUrl) {
        next.webhookUrl = webhookUrl;
        next.lastError = null;
        delete next.lastDeliveryAt;
      }
      if (enabled !== undefined) next.enabled = enabled;
      if (events !== undefined) next.events = events;
      return { ...current, slack: next };
    });
    return res.json(publicIntegrations(updated));
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── Generic webhook ─────────────────────────────────────────────────────────

export async function updateWebhook(req: AuthenticatedRequest, res: Response) {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  try {
    const url = body.url !== undefined ? validateWebhookUrl(body.url) : undefined;
    let secret: string | null | undefined; // undefined = unchanged, null/'' = remove
    if (body.secret !== undefined) {
      if (body.secret === null || body.secret === '') secret = null;
      else if (typeof body.secret !== 'string' || body.secret.length < 8 || body.secret.length > 128) {
        throw new HttpError(400, 'secret must be between 8 and 128 characters');
      } else secret = body.secret;
    }
    const enabled = body.enabled !== undefined ? parseEnabled(body.enabled) : undefined;
    const events = body.events !== undefined ? parseEvents(body.events) : undefined;

    const updated = await mutateIntegrations(workspaceIdOf(req), current => {
      const existing = current.webhook;
      if (!existing && !url) throw new HttpError(400, 'url is required to connect a webhook');
      const next: WebhookIntegration = existing
        ? { ...existing }
        : { url: url!, enabled: true, events: ['conversation.created'], connectedAt: new Date().toISOString(), lastError: null };
      if (url && existing && url !== existing.url) {
        next.url = url;
        next.lastError = null;
        delete next.lastDeliveryAt;
      }
      if (secret === null) delete next.secret;
      else if (secret !== undefined) next.secret = secret;
      if (enabled !== undefined) next.enabled = enabled;
      if (events !== undefined) next.events = events;
      return { ...current, webhook: next };
    });
    return res.json(publicIntegrations(updated));
  } catch (err) {
    return handleError(res, err);
  }
}

// ─── Shared: disconnect + test ───────────────────────────────────────────────

function disconnect(kind: IntegrationKind) {
  return async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const updated = await mutateIntegrations(workspaceIdOf(req), current => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
      return res.json(publicIntegrations(updated));
    } catch (err) {
      return handleError(res, err);
    }
  };
}

function sampleConversation(ws: Workspace): Conversation {
  const now = new Date().toISOString();
  return {
    id: 'test_conversation',
    workspaceId: ws.id,
    ticketNumber: '#40000',
    customer: { id: 'test_customer', name: 'Test Customer', email: 'customer@example.com', session: {} as any, tags: [], notes: [] },
    status: 'open',
    priority: 'none',
    category: 'general',
    unreadCountAgent: 0,
    unreadCountCustomer: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function testIntegration(kind: IntegrationKind) {
  return async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const workspaceId = workspaceIdOf(req);
      const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      const integration = ws.integrations?.[kind];
      if (!integration) return res.status(400).json({ error: `${kind === 'slack' ? 'Slack' : 'The webhook'} isn’t connected` });

      const conversation = sampleConversation(ws);
      const message = {
        id: 'test_message', conversationId: conversation.id, content: 'This is a test message from Chai Samosa. If you can see it, your integration works! 🎉',
        sender: { type: 'customer' as const, id: 'test_customer', name: 'Test Customer' },
        isInternalNote: false, seen: false, delivered: true, createdAt: new Date().toISOString(),
      };
      const result = kind === 'slack'
        ? await sendSlack(integration as SlackIntegration, buildSlackPayload('conversation.created', { conversation, message }))
        : await sendWebhook(integration as WebhookIntegration, 'test', {
            event: 'test', workspaceId, createdAt: new Date().toISOString(),
            conversation: {
              id: conversation.id, ticketNumber: conversation.ticketNumber, status: conversation.status,
              priority: conversation.priority, category: conversation.category,
              customer: { id: conversation.customer.id, name: conversation.customer.name, email: conversation.customer.email },
            },
            message: { id: message.id, content: message.content, createdAt: message.createdAt },
          });
      await recordDelivery(workspaceId, kind, result);
      return res.json({ ok: result.ok, ...(result.status !== undefined ? { status: result.status } : {}), ...(result.error ? { error: result.error } : {}) });
    } catch (err) {
      return handleError(res, err);
    }
  };
}

export const disconnectSlack = disconnect('slack');
export const disconnectWebhook = disconnect('webhook');
export const testSlack = testIntegration('slack');
export const testWebhook = testIntegration('webhook');
