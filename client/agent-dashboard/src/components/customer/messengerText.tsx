import React, { createContext, useContext, useEffect, useState } from 'react';
import { MESSENGER_STRINGS, MessengerStringKey, MessengerStrings, fillString } from '../../../../../shared/src/messengerStrings';

/**
 * The Messenger's own text, in the visitor's language when Settings › Multilingual is on (translated
 * once per language by the server and cached), otherwise English.
 */
type T = (key: MessengerStringKey, vars?: Record<string, string | number>) => string;
type Ctx = { t: T; strings: MessengerStrings | null };

const english: T = (key, vars) => fillString(MESSENGER_STRINGS[key], vars);
const MessengerTextContext = createContext<Ctx>({ t: english, strings: null });

export const useMessengerText = () => useContext(MessengerTextContext);

/** Loads the visitor's language when enabled; English until (and unless) it arrives. */
export function useMessengerStrings(api: (path: string) => Promise<Response>, enabled: boolean): MessengerStrings | null {
  const [strings, setStrings] = useState<MessengerStrings | null>(null);
  useEffect(() => {
    const lang = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en';
    if (!enabled || /^en\b/i.test(lang)) { setStrings(null); return; }
    let live = true;
    const key = `messenger_i18n_${lang}`;
    try { const saved = sessionStorage.getItem(key); if (saved) setStrings(JSON.parse(saved)); } catch { /* storage blocked */ }
    api(`/api/messenger/i18n?lang=${encodeURIComponent(lang)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live) return;
        setStrings(d?.strings || null);
        try { if (d?.strings) sessionStorage.setItem(key, JSON.stringify(d.strings)); else sessionStorage.removeItem(key); } catch { /* storage blocked */ }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [api, enabled]);
  return strings;
}

export const MessengerTextProvider: React.FC<{ strings: MessengerStrings | null; children: React.ReactNode }> = ({ strings, children }) => {
  const t: T = (key, vars) => fillString(strings?.[key] || MESSENGER_STRINGS[key], vars);
  return <MessengerTextContext.Provider value={{ t, strings }}>{children}</MessengerTextContext.Provider>;
};
