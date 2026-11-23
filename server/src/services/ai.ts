import Anthropic from '@anthropic-ai/sdk';
import { AiSettings, Conversation, Message } from '../../../shared/src/types';

/**
 * "Ask AI" for teammates: one request to the provider configured in Settings › AI assistant.
 *  - anthropic: the official Anthropic SDK (Claude).
 *  - openai / openai_compatible: the standard Chat Completions API (OpenAI, or any compatible
 *    endpoint such as Gemini, Groq, Mistral, OpenRouter or a local Ollama).
 */

export type AskTurn = { role: 'user' | 'assistant'; content: string };

export class AiError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export const DEFAULT_MODELS: Record<AiSettings['provider'], string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4o',
  openai_compatible: '',
};

// Claude models that accept server-side refusal fallbacks and the `effort` control
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const EFFORT_MODELS = /^claude-(fable|mythos|opus-5|sonnet-5|haiku-5-5|opus-4-[5-8])/;

const MAX_TRANSCRIPT_MESSAGES = 200;

function fmtTime(iso: string) {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** The conversation as plain text for the model (oldest first). */
export function transcriptOf(conv: Conversation, messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages.slice(-MAX_TRANSCRIPT_MESSAGES)) {
    const t = fmtTime(m.createdAt);
    if (m.sender?.type === 'system') {
      if (m.metadata?.type === 'event' && m.metadata?.category === 'status') lines.push(`(${t}) [event] ${m.content}`);
      continue;
    }
    if (m.metadata?.type === 'merge' || m.metadata?.type === 'merged_indicator') continue;
    const who = m.sender.type === 'customer'
      ? `${m.sender.name || conv.customer?.name || 'Customer'} (customer)`
      : m.metadata?.type === 'bot' || m.sender.id === 'bot'
        ? `${m.sender.name} (bot)`
        : `${m.sender.name} (teammate${m.isInternalNote ? ', internal note — not visible to the customer' : ''})`;
    const files = m.attachments?.length ? ` [${m.attachments.length} attachment(s): ${m.attachments.map(a => a.name).join(', ')}]` : '';
    lines.push(`(${t}) ${who}: ${m.content || ''}${files}`);
  }
  return lines.join('\n');
}

export function systemPrompt(workspaceName: string, conv: Conversation, transcript: string, extra?: string): string {
  const c = conv.customer;
  return [
    `You are the AI assistant inside ${workspaceName}'s customer support inbox. You help the support teammate who is handling the conversation below: you answer their questions about it, summarize it, suggest next steps, and draft replies to the customer when asked.`,
    '',
    'How to answer:',
    '- Base everything on the conversation and ticket details below. If something isn\'t there (an order status, a policy, an account detail), say you don\'t know rather than inventing it, and suggest how the teammate could find out.',
    '- Keep answers short and practical; the teammate is working live.',
    '- When asked to draft or write a reply to the customer, output only the message text to send, written to the customer in a friendly, clear tone, with no preamble, sign-off placeholders or notes to the teammate.',
    '- Internal notes are visible only to the team; never quote them in a reply meant for the customer.',
    extra?.trim() ? `\nInstructions from the team:\n${extra.trim()}` : '',
    '',
    '<ticket>',
    `Ticket: ${conv.ticketNumber} · state: ${conv.status} · category: ${conv.category} · priority: ${conv.priority}${conv.title ? ` · title: ${conv.title}` : ''}`,
    `Customer: ${c?.name || 'Unknown'}${c?.email ? ` <${c.email}>` : ''}${c?.phone ? ` · ${c.phone}` : ''}${c?.session?.country ? ` · ${c.session.country}` : ''}`,
    '</ticket>',
    '',
    '<conversation>',
    transcript || '(no messages yet)',
    '</conversation>',
  ].join('\n');
}

/** Send one request to the configured provider and return the reply text. */
export async function complete(settings: AiSettings, system: string, turns: AskTurn[]): Promise<string> {
  if (!settings.apiKey && settings.provider !== 'openai_compatible') throw new AiError('Add an API key in Settings › AI assistant', 400);
  const model = settings.model?.trim() || DEFAULT_MODELS[settings.provider];
  if (!model) throw new AiError('Choose a model in Settings › AI assistant', 400);

  if (settings.provider === 'anthropic') return completeAnthropic(settings.apiKey!, model, system, turns);
  const baseUrl = settings.provider === 'openai'
    ? 'https://api.openai.com/v1'
    : (settings.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new AiError('Add the provider\'s base URL in Settings › AI assistant', 400);
  return completeChatCompletions(baseUrl, settings.apiKey || '', model, system, turns);
}

async function completeAnthropic(apiKey: string, model: string, system: string, turns: AskTurn[]): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 4000,
    system,
    messages: turns.map(t => ({ role: t.role, content: t.content })),
  };
  // Quick, conversational answers: low effort on models that support it
  if (EFFORT_MODELS.test(model)) params.output_config = { effort: 'low' };
  // If the model declines on a safety category, let the API retry on a suitable fallback model
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  try {
    const response = await client.beta.messages.create(params);
    if (response.stop_reason === 'refusal') {
      throw new AiError('The AI declined to answer this request. Try rephrasing the question.', 422);
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    if (!text) throw new AiError('The AI returned an empty answer. Try again.');
    return text;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('The API key was rejected by Anthropic. Check it in Settings › AI assistant.', 400);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('This API key can\'t use that model. Check the model in Settings › AI assistant.', 400);
    if (err instanceof Anthropic.NotFoundError) throw new AiError(`Model "${model}" wasn't found. Check the model name in Settings › AI assistant.`, 400);
    if (err instanceof Anthropic.RateLimitError) throw new AiError('The AI provider is rate limiting requests. Try again in a moment.', 429);
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`The AI provider rejected the request: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) throw new AiError(`The AI provider returned an error (${err.status ?? 'network'}). Try again.`);
    throw new AiError('Couldn\'t reach the AI provider. Check your network and try again.');
  }
}

// Busy/overloaded answers worth retrying (the Anthropic SDK retries these itself)
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The provider's own error text; Google's OpenAI-compatible API wraps it in a list: [{ error: {...} }]. */
function providerMessage(body: any, fallback: string): string {
  const b = Array.isArray(body) ? body[0] : body;
  return String(b?.error?.message || b?.message || b?.detail || fallback).trim();
}

async function completeChatCompletions(baseUrl: string, apiKey: string, model: string, system: string, turns: AskTurn[]): Promise<string> {
  const request = () => fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...turns], max_tokens: 4000 }),
    signal: AbortSignal.timeout(45_000),
  });

  // Up to 3 tries with a short backoff when the provider is busy (honours Retry-After up to 10s)
  let res: Response | null = null;
  let body: any = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await request();
    } catch (err: any) {
      // A request that hangs means the provider is swamped; don't make people wait through retries
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new AiError(`"${model}" didn't answer within 45 seconds. The provider may be overloaded; try again shortly or pick a different model.`, 504);
      }
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      throw new AiError(`Couldn't reach ${baseUrl}. Check the base URL and your network.`);
    }
    body = await res.json().catch(() => ({}));
    if (res.ok || !RETRYABLE.has(res.status) || attempt === 2) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1500 * (attempt + 1));
  }
  if (!res) throw new AiError(`Couldn't reach ${baseUrl}. Check the base URL and your network.`);

  if (!res.ok) {
    const detail = providerMessage(body, res.statusText);
    if (res.status === 401 || res.status === 403) throw new AiError(`The API key was rejected: ${detail}`, 400);
    if (res.status === 404) throw new AiError(`Model or endpoint not found: ${detail}`, 400);
    if (res.status === 429) throw new AiError(`The provider is rate limiting or out of quota for "${model}": ${detail}`, 429);
    if (res.status === 503 || res.status === 529) {
      throw new AiError(`"${model}" is overloaded at the provider right now (they said: ${detail}). This is on their side and usually passes in a few minutes; you can also pick a different model.`, 503);
    }
    throw new AiError(`The AI provider returned an error (${res.status}): ${detail}`);
  }
  const text = String(body?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new AiError('The AI returned an empty answer. Try again.');
  return text;
}
