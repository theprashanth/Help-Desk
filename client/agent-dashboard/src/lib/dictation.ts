import { useEffect, useRef, useState } from 'react';

/**
 * Speech to text with the browser's own speech recognition (Chrome, Edge, Safari; not Firefox).
 * Used by the agent reply box (⋯ › Dictate) and the customer Messenger's mic button.
 */
/**
 * Inside a mobile app's web view (iOS WKWebView, Android WebView) speech recognition doesn't work: Android
 * doesn't offer it, and iOS exposes it but never asks for the microphone or hears anything.
 */
export function inAppWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  if (iOS) return !/Safari\//.test(ua) || /(FBAN|FBAV|Instagram|Line\/|GSA\/)/.test(ua);
  if (/Android/.test(ua)) return /; wv\)/.test(ua);
  return false;
}

/** Real browsers with speech recognition: Chrome, Edge, Safari (not Firefox, not in-app web views). */
export const dictationSupported = () => typeof window !== 'undefined'
  && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  && !inAppWebView();

export type DictationError = 'unsupported' | 'blocked' | 'failed';

/** Speech to text into a text box. `onText` receives each finished phrase. */
export function useDictation(onText: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<DictationError | null>(null);
  const recRef = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => recRef.current?.abort?.(), []);
  const fail = (code: DictationError | null, message: string | null) => { setErrorCode(code); setError(message); };
  const stop = () => { recRef.current?.stop?.(); };
  const start = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { fail('unsupported', 'Dictation needs Chrome, Edge or Safari.'); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang || navigator.language || 'en-US';
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { const t = String(e.results[i][0].transcript || '').trim(); if (t) cb.current(t); }
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail('blocked', 'Microphone access is blocked. Allow it in the browser’s address bar.');
      else if (e.error === 'no-speech' || e.error === 'aborted') fail(null, null);
      else fail('failed', `Dictation stopped (${e.error}).`);
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    try { rec.start(); recRef.current = rec; setListening(true); fail(null, null); } catch (e: any) { fail('failed', e.message); }
  };
  return { listening, error, errorCode, start, stop, toggle: () => (listening ? stop() : start()), clearError: () => fail(null, null) };
}
