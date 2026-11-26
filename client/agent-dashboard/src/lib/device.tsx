import React from 'react';
import { Chrome, Compass, Globe } from 'lucide-react';

export type DeviceKind = 'ios' | 'android' | 'chrome' | 'safari' | 'firefox' | 'edge' | 'web';

export interface DeviceInfo {
  kind: DeviceKind;
  platform: 'ios' | 'android' | 'web';
  channel: 'app' | 'browser';
  browser?: string;
  os?: string;
  sourceUrl?: string;
  /** Human label, e.g. "iOS app", "Safari on iOS 17.2", "Chrome on macOS" */
  label: string;
}

type Meta = { platform?: string; channel?: string; browser?: string; os?: string; sourceUrl?: string } | undefined;
type Session = { browser?: string; os?: string; currentPage?: string } | undefined;

const browserKind = (browser?: string): DeviceKind => {
  const b = (browser || '').toLowerCase();
  if (b.startsWith('chrome')) return 'chrome';
  if (b.startsWith('safari')) return 'safari';
  if (b.startsWith('firefox')) return 'firefox';
  if (b.startsWith('edge')) return 'edge';
  return 'web';
};

const platformFromOs = (os?: string): 'ios' | 'android' | 'web' => {
  if (/ios|ipad|iphone/i.test(os || '')) return 'ios';
  if (/android/i.test(os || '')) return 'android';
  return 'web';
};

/**
 * Work out where a customer message came from. Messages sent by the current widget carry
 * `metadata.channel`; older messages fall back to the customer's session info.
 */
export function getDeviceInfo(metadata: Meta, session: Session): DeviceInfo {
  const fresh = !!metadata?.channel;
  // Older records guessed versions browsers don't really report ("macOS Catalina", "Windows 10")
  const os = (fresh ? metadata?.os : session?.os || metadata?.os)?.replace('OS X', 'macOS')
    .replace(/^macOS (Catalina|Mojave|Big Sur|Monterey)$/, 'macOS').replace(/^Windows 10$/, 'Windows');
  const browser = fresh ? metadata?.browser : session?.browser || metadata?.browser;
  const sourceUrl = customerPageUrl(metadata?.sourceUrl) || customerPageUrl(session?.currentPage);

  const declared = (metadata?.platform || '').toLowerCase();
  const platform: DeviceInfo['platform'] =
    fresh && (declared === 'ios' || declared === 'android') ? declared : platformFromOs(os);
  const channel: DeviceInfo['channel'] = fresh && metadata?.channel === 'app' ? 'app' : 'browser';

  const kind: DeviceKind = platform === 'web' ? browserKind(browser) : platform;
  const platformName = platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : '';
  const browserName = browser && !/unknown/i.test(browser) ? browser.replace(/\s+\d+$/, '') : '';

  let label: string;
  if (channel === 'app' && platformName) label = `${platformName} app`;
  else if (browserName && os) label = `${browserName} on ${os}`;
  else label = browserName || os || 'Web';

  return { kind, platform, channel, browser, os, sourceUrl, label };
}

const AppleGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={`fill-current ${className || ''}`} aria-hidden>
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.7-1.13 1.84-.99 2.94.12.08 1.12-.04 2.82-1.33z" />
  </svg>
);

const AndroidGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={`fill-current ${className || ''}`} aria-hidden>
    <path d="M17.5 12c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-11 0c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm11.56-5.81l1.79-3.11c.08-.15.03-.33-.12-.41-.15-.08-.33-.03-.41.12l-1.83 3.18C15.07 5.37 13.59 5 12 5s-3.07.37-4.49.98L5.68 2.8c-.08-.15-.26-.2-.41-.12-.15.08-.2.26-.12.41l1.79 3.11C3.69 8.25 1.5 11.37 1.5 15h21c0-3.63-2.19-6.75-5.44-8.81z" />
  </svg>
);

/** Small monochrome icon for where a message came from. */
export const DeviceIcon: React.FC<{ info: DeviceInfo; className?: string }> = ({ info, className = 'w-3.5 h-3.5' }) => {
  const cls = `${className} shrink-0`;
  switch (info.kind) {
    case 'ios': return <AppleGlyph className={cls} />;
    case 'android': return <AndroidGlyph className={cls} />;
    case 'chrome': return <Chrome className={cls} strokeWidth={2.2} />;
    case 'safari': return <Compass className={cls} strokeWidth={2.2} />;
    default: return <Globe className={cls} strokeWidth={2.2} />;
  }
};

/** A page of the customer's website, or undefined for the Messenger's own address (older records stored it). */
export function customerPageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return /\/messenger\/[^/?#]+\/?([?#].*)?$/.test(url) ? undefined : url;
}
