import crypto from 'crypto';
import { RepositoryFactory } from '../repositories/factory';
import {
  Conversation, Message, IntegrationEvent, Workspace, SlackIntegration, WebhookIntegration,
} from '../../../shared/src/types';

/**
 * Outbound notifications to the workspace's integrations (Slack incoming webhook + a generic
 * signed JSON webhook). Everything here is best-effort: it never throws and never blocks a request.
 */

export const INTEGRATION_EVENTS: IntegrationEvent[] = ['conversation.created', 'message.customer'];
export const SIGNATURE_HEADER = 'X-ChaiSamosa-Signature';
export const EVENT_HEADER = 'X-ChaiSamosa-Event';
const TIMEOUT_MS = 5000;

export type IntegrationKind = 'slack' | 'webhook';
export interface DeliveryResult { ok: boolean; status?: number; error?: string }

const dashboardUrl = () => (process.env.DASHBOARD_URL || 'http://localhost:5173').replace(/\/+$/, '');

function conversationLink(conversationId: string): string {
  return `${dashboardUrl()}/agent/inbox?conversation=${encodeURIComponent(conversationId)}`;
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** POST a JSON body with a 5s timeout. Resolves to a result; never rejects. */
async function postJson(url: string, body: string, headers: Record<string, string> = {}): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ChaiSamosa-Webhooks/1.0', ...headers },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    if (res.ok) return { ok: true, status: res.status };
    let detail = '';
    try { detail = (await res.text()).slice(0, 200).trim(); } catch { /* ignore */ }
    return { ok: false, status: res.status, error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
  } catch (err: any) {
    const error = err?.name === 'AbortError' ? `Timed out after ${TIMEOUT_MS / 1000}s` : (err?.cause?.message || err?.message || 'Request failed');
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Payload builders ────────────────────────────────────────────────────────

function firstText(data: { conversation: Conversation; message?: Message }): string {
  return (data.message?.content || data.conversation.description || data.conversation.customerSnippet || data.conversation.title || '').trim();
}

export function buildSlackPayload(event: IntegrationEvent, data: { conversation: Conversation; message?: Message }) {
  const { conversation } = data;
  const customer = conversation.customer || ({} as Conversation['customer']);
  const name = customer.name || 'A customer';
  const header = event === 'conversation.created' ? '💬 New conversation' : '✉️ New message';
  const text = truncate(firstText(data), 500);
  const who = `*${escapeSlack(name)}*${customer.email ? ` (${escapeSlack(customer.email)})` : ''}`;
  const link = conversationLink(conversation.id);
  const fallback = `${header.replace(/^\S+\s/, '')} from ${name}${conversation.ticketNumber ? ` (${conversation.ticketNumber})` : ''}${text ? `: ${text}` : ''}`;

  return {
    text: fallback,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: header, emoji: true } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Customer*\n${who}` },
          { type: 'mrkdwn', text: `*Ticket*\n${escapeSlack(conversation.ticketNumber || '—')}` },
        ],
      },
      ...(text ? [{ type: 'section', text: { type: 'mrkdwn', text: `>${escapeSlack(text).replace(/\n/g, '\n>')}` } }] : []),
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Chai Samosa', emoji: true }, url: link, style: 'primary' }],
      },
    ],
  };
}

export function buildWebhookPayload(workspaceId: string, event: IntegrationEvent, data: { conversation: Conversation; message?: Message }) {
  const { conversation: c, message } = data;
  return {
    event,
    workspaceId,
    createdAt: new Date().toISOString(),
    conversation: {
      id: c.id,
      ticketNumber: c.ticketNumber,
      status: c.status,
      priority: c.priority,
      category: c.category,
      customer: { id: c.customer?.id, name: c.customer?.name, email: c.customer?.email },
    },
    ...(message ? { message: { id: message.id, content: message.content, createdAt: message.createdAt } } : {}),
  };
}

// ─── Senders ────────────────────────────────────────────────────────────────

export function sendSlack(integration: SlackIntegration, payload: object): Promise<DeliveryResult> {
  return postJson(integration.webhookUrl, JSON.stringify(payload));
}

export function signBody(secret: string, rawBody: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function sendWebhook(integration: WebhookIntegration, event: IntegrationEvent | 'test', payload: object): Promise<DeliveryResult> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { [EVENT_HEADER]: event };
  if (integration.secret) headers[SIGNATURE_HEADER] = signBody(integration.secret, raw);
  return postJson(integration.url, raw, headers);
}

const writeChains = new Map<string, Promise<unknown>>();

/** Run read-modify-write updates of a workspace's integrations one at a time (per workspace). */
export function withIntegrationsLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(workspaceId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  writeChains.set(workspaceId, next);
  next.finally(() => { if (writeChains.get(workspaceId) === next) writeChains.delete(workspaceId); }).catch(() => undefined);
  return next;
}

/**
 * Record the outcome of a delivery on the integration. Re-reads the workspace first so that
 * concurrent settings changes aren't clobbered; skips if the integration was removed meanwhile.
 */
export function recordDelivery(workspaceId: string, kind: IntegrationKind, result: DeliveryResult): Promise<void> {
  return withIntegrationsLock(workspaceId, () => writeDelivery(workspaceId, kind, result));
}

async function writeDelivery(workspaceId: string, kind: IntegrationKind, result: DeliveryResult): Promise<void> {
  try {
    const repo = RepositoryFactory.getWorkspaceRepository();
    const ws = await repo.findById(workspaceId);
    const current = ws?.integrations?.[kind];
    if (!ws || !current) return;
    const patch = result.ok
      ? { lastDeliveryAt: new Date().toISOString(), lastError: null }
      : { lastError: (result.error || 'Delivery failed').slice(0, 300) };
    await repo.update(workspaceId, { integrations: { ...ws.integrations, [kind]: { ...current, ...patch } } as Workspace['integrations'] });
  } catch (err: any) {
    console.error(`[integrations] could not record ${kind} delivery:`, err?.message || err);
  }
}

async function deliverAll(workspaceId: string, event: IntegrationEvent, data: { conversation: Conversation; message?: Message }) {
  const ws = await RepositoryFactory.getWorkspaceRepository().findById(workspaceId);
  const slack = ws?.integrations?.slack;
  const webhook = ws?.integrations?.webhook;
  const jobs: Promise<void>[] = [];

  if (slack?.webhookUrl && slack.enabled && (slack.events || []).includes(event)) {
    jobs.push(sendSlack(slack, buildSlackPayload(event, data)).then(async result => {
      if (!result.ok) console.warn(`[integrations] Slack delivery failed (${event}):`, result.error);
      await recordDelivery(workspaceId, 'slack', result);
    }));
  }
  if (webhook?.url && webhook.enabled && (webhook.events || []).includes(event)) {
    jobs.push(sendWebhook(webhook, event, buildWebhookPayload(workspaceId, event, data)).then(async result => {
      if (!result.ok) console.warn(`[integrations] Webhook delivery failed (${event}):`, result.error);
      await recordDelivery(workspaceId, 'webhook', result);
    }));
  }
  await Promise.all(jobs);
}

/** Fire-and-forget: notify Slack / the generic webhook about an event. Never throws or blocks. */
export function notifyIntegrations(workspaceId: string, event: IntegrationEvent, data: { conversation: Conversation; message?: Message }): void {
  try {
    if (data?.message?.isInternalNote) return; // never leak internal notes
    setImmediate(() => {
      deliverAll(workspaceId, event, data).catch(err => {
        console.error('[integrations] notify failed:', err?.message || err);
      });
    });
  } catch (err: any) {
    console.error('[integrations] notify failed:', err?.message || err);
  }
}
