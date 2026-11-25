import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { AiFeatures } from '../../../../shared/src/types';
import { API_URL } from './config';

const BACKEND_URL = API_URL;

export type AiStatus = { configured: boolean; features: AiFeatures };
const OFF: AiStatus = { configured: false, features: { handoffSummary: false, suggestedReplies: false, autoTriage: false, translation: false, teamLanguage: 'English' } };

let cache: AiStatus | null = null;
let inflight: Promise<AiStatus> | null = null;
const listeners = new Set<(s: AiStatus) => void>();

/** Reload after Settings › AI assistant changes. */
export function refreshAiStatus(): Promise<AiStatus> {
  const token = useStore.getState().token;
  if (!token) return Promise.resolve(OFF);
  inflight = fetch(`${BACKEND_URL}/api/ai/settings`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => (r.ok ? r.json() : null))
    .then(d => (d ? { configured: !!d.configured, features: { ...OFF.features, ...(d.features || {}) } } : OFF))
    .catch(() => OFF)
    .then(s => { cache = s; listeners.forEach(l => l(s)); inflight = null; return s; });
  return inflight;
}

/** Whether AI is set up, and which automations are on (Settings › AI assistant). */
export function useAiStatus(): AiStatus {
  const [s, setS] = useState<AiStatus>(cache || OFF);
  useEffect(() => {
    listeners.add(setS);
    if (!cache && !inflight) refreshAiStatus();
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}
