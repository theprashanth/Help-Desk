import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { DeviceIcon, DeviceInfo } from '../../lib/device';
import { TimeZoneContext, longTimestamp } from './TimeHover';

/**
 * The device + time line under a customer's message ("◎ 19h"). Hovering it shows a card with the full
 * date and time, the page of your website they wrote from, and their browser and OS. The card floats
 * over the page (never inside the bubble), opens after a short pause, stays open while the pointer is
 * on it, and sits above the line when there's room, otherwise below.
 */
export const DeviceHover: React.FC<{ iso: string; device: DeviceInfo; children: React.ReactNode; className?: string }> = ({ iso, device, children, className }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zone = useContext(TimeZoneContext);
  const when = longTimestamp(iso, zone);

  const clear = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  useEffect(() => clear, []);

  const show = () => { clear(); openTimer.current = setTimeout(() => setOpen(true), 300); };
  const hide = () => { clear(); closeTimer.current = setTimeout(() => { setOpen(false); setPos(null); setCopied(false); }, 160); };

  // Place it once it has a size: above the line if it fits, else below; kept inside the window
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current?.getBoundingClientRect();
    const c = cardRef.current?.getBoundingClientRect();
    if (!a || !c) return;
    const gap = 6, margin = 8;
    const above = a.top - gap - c.height >= margin;
    const top = above ? a.top - gap - c.height : Math.min(a.bottom + gap, window.innerHeight - c.height - margin);
    const left = Math.min(Math.max(a.left - 12, margin), window.innerWidth - c.width - margin);
    setPos({ top, left });
  }, [open]);

  // Scrolling the chat moves the line away: close
  useEffect(() => {
    if (!open) return;
    const close = () => { clear(); setOpen(false); setPos(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(when); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const platform = `${device.platform === 'ios' ? 'iOS' : device.platform === 'android' ? 'Android' : 'Web'} ${device.channel === 'app' ? 'app' : 'browser'}`;
  const rows: [string, string][] = [
    ['Platform', platform],
    ['Browser', device.browser || 'Unknown'],
    ['OS', device.os || 'Unknown'],
  ];

  return (
    <>
      <span ref={anchorRef} className={`inline-flex items-center gap-1 cursor-default ${className || ''}`} onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </span>
      {open && createPortal(
        <div
          ref={cardRef}
          role="tooltip"
          onMouseEnter={clear}
          onMouseLeave={hide}
          className="fixed z-[80] w-[300px] rounded-xl bg-surface border border-line shadow-pop text-[13px] text-ink whitespace-normal animate-fade-in"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="flex items-center gap-2 pl-3.5 pr-1.5 h-10 border-b border-line">
            <span className="flex-1 min-w-0 truncate text-[13.5px] font-medium">{when}</span>
            <button onClick={copy} className="ic-icon-btn-ghost w-7 h-7 shrink-0" title={copied ? 'Copied' : 'Copy date and time'} aria-label="Copy date and time">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="px-3.5 py-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 font-medium">
              <DeviceIcon info={device} className="w-4 h-4 text-muted" />
              <span className="truncate">{device.label}</span>
            </div>
            <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[13px]">
              {rows.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 truncate">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            {/* The page of your website they wrote from (none inside a mobile app or a direct Messenger link) */}
            {device.sourceUrl && (
              <div className="pt-2.5 border-t border-line">
                <div className="text-[12px] text-muted mb-1">Page on your website</div>
                <a href={device.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-link hover:underline min-w-0" title={device.sourceUrl}>
                  <span className="truncate">{device.sourceUrl.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default DeviceHover;
