import { useEffect, useRef, useState } from 'react';

/**
 * Speech to text. In a browser it uses the browser's own speech recognition (Chrome, Edge, Safari; not
 * Firefox). Inside your mobile app it asks the app to listen with the phone's speech recognition (the
 * "native mic bridge", Settings › Messenger › Mobile SDKs), because web views can't do it themselves.
 * Used by the agent reply box (⋯ › Dictate) and the customer Messenger's mic button.
 *
 * Bridge protocol
 *   Messenger → app: { source: 'chai-shots', type: 'dictation', action: 'start' | 'stop' | 'cancel', lang }
 *     iOS:          window.webkit.messageHandlers.chaiShots.postMessage(object)
 *     Android:      window.ChaiShotsAndroid.postMessage(JSON string)        (@JavascriptInterface)
 *     React Native: window.ReactNativeWebView.postMessage(JSON string)      (Messenger URL has native_mic=1)
 *   App → Messenger: window.ChaiShotsNative.dictation(
 *     { state: 'listening' | 'stopped' } | { text: '…' } | { error: 'blocked' | 'failed' })
 */

/**
 * Inside a mobile app's web view (iOS WKWebView, Android WebView) web speech recognition doesn't work:
 * Android doesn't offer it, and iOS exposes it but never asks for the microphone or hears anything.
 */
export function inAppWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  if (iOS) return !/Safari\//.test(ua) || /(FBAN|FBAV|Instagram|Line\/|GSA\/)/.test(ua);
  if (/Android/.test(ua)) return /; wv\)/.test(ua);
  return false;
}

type BridgeMessage = { source: 'chai-shots'; type: 'dictation'; action: 'start' | 'stop' | 'cancel'; lang?: string };

/** The app's mic, if the app that shows the Messenger added the bridge code; otherwise null. */
export function nativeMicBridge(): { send: (m: BridgeMessage) => void } | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  try {
    if (w.webkit?.messageHandlers?.chaiShots?.postMessage) return { send: m => w.webkit.messageHandlers.chaiShots.postMessage(m) };
    if (typeof w.ChaiShotsAndroid?.postMessage === 'function') return { send: m => w.ChaiShotsAndroid.postMessage(JSON.stringify(m)) };
    // Any React Native WebView has ReactNativeWebView, so the app says it handles the mic with native_mic=1
    if (typeof w.ReactNativeWebView?.postMessage === 'function' && new URLSearchParams(window.location.search).get('native_mic') === '1') {
      return { send: m => w.ReactNativeWebView.postMessage(JSON.stringify(m)) };
    }
  } catch { /* no bridge */ }
  return null;
}

const webSpeech = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

/** Can the mic be offered here? The app's mic (bridge), or a real browser with speech recognition. */
export const dictationSupported = () => !!nativeMicBridge() || (webSpeech() && !inAppWebView());

export type DictationError = 'unsupported' | 'blocked' | 'failed';

/** Speech to text into a text box. `onText` receives each finished phrase. */
export function useDictation(onText: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<DictationError | null>(null);
  const recRef = useRef<any>(null);
  const ignoreRef = useRef(false); // after cancel(): drop text that arrives late (until the next start)
  const cb = useRef(onText);
  cb.current = onText;
  const fail = (code: DictationError | null, message: string | null) => { setErrorCode(code); setError(message); };

  useEffect(() => () => recRef.current?.abort?.(), []);

  // The app reports back through window.ChaiShotsNative.dictation(...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    const handler = (p: any) => {
      if (!p || typeof p !== 'object') return;
      if (typeof p.text === 'string' && p.text.trim() && !ignoreRef.current) cb.current(p.text.trim());
      if (p.state === 'listening') { setListening(true); fail(null, null); }
      if (p.state === 'stopped') setListening(false);
      if (p.error) {
        setListening(false);
        if (p.error === 'blocked') fail('blocked', 'Microphone access is blocked. Allow it in the app’s settings.');
        else fail('failed', 'Dictation stopped.');
      }
    };
    w.ChaiShotsNative = w.ChaiShotsNative || {};
    w.ChaiShotsNative.dictation = handler;
    return () => { if (w.ChaiShotsNative?.dictation === handler) delete w.ChaiShotsNative.dictation; };
  }, []);

  const language = () => lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

  const stop = () => {
    const bridge = nativeMicBridge();
    if (bridge) { bridge.send({ source: 'chai-shots', type: 'dictation', action: 'stop' }); return; } // the app sends the last words, then 'stopped'
    recRef.current?.stop?.();
  };

  /** Stop and throw away anything still on its way (e.g. the message was just sent). */
  const cancel = () => {
    ignoreRef.current = true;
    const bridge = nativeMicBridge();
    if (bridge) {
      if (listening) bridge.send({ source: 'chai-shots', type: 'dictation', action: 'cancel' });
      setListening(false);
      return;
    }
    recRef.current?.abort?.();
  };

  const start = () => {
    ignoreRef.current = false;
    const bridge = nativeMicBridge();
    if (bridge) {
      try {
        bridge.send({ source: 'chai-shots', type: 'dictation', action: 'start', lang: language() });
        setListening(true); // the app confirms with { state: 'listening' } or reports an error
        fail(null, null);
      } catch (e: any) { fail('failed', e?.message || 'Dictation stopped.'); }
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { fail('unsupported', 'Dictation needs Chrome, Edge or Safari.'); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = language();
    rec.onresult = (e: any) => {
      if (ignoreRef.current) return;
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

  return { listening, error, errorCode, start, stop, cancel, toggle: () => (listening ? stop() : start()), clearError: () => fail(null, null) };
}
