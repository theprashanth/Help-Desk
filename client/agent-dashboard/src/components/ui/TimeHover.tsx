import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';

/**
 * Times inside this provider are shown in another timezone (the chat's "Show timestamp in customer
 * timezone"), e.g. "November 23, 2026 at 6:39:52 PM (customer's time, Asia/Kolkata)".
 */
export const TimeZoneContext = createContext<string | undefined>(undefined);

/** "November 23, 2026 at 1:09:52 PM" */
export function longTimestamp(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tz = timeZone ? { timeZone } : {};
  try {
    const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', ...tz });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, ...tz });
    return `${date} at ${time}${timeZone ? ` (customer's time, ${timeZone.replace(/_/g, ' ')})` : ''}`;
  } catch {
    return longTimestamp(iso); // unknown zone name
  }
}

/**
 * Wraps a short time label ("17m", "Now"). Hovering shows a card with the full date and time
 * and a copy button; the card stays open while the pointer is on it.
 */
export const TimeHover: React.FC<{ iso: string; children: React.ReactNode; className?: string }> = ({ iso, children, className }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zone = useContext(TimeZoneContext);
  const text = longTimestamp(iso, zone);

  const clear = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  useEffect(() => clear, []);

  const show = () => {
    clear();
    openTimer.current = setTimeout(() => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = r.top < 64;
      setPos({ top: below ? r.bottom + 4 : r.top - 4, left: r.left + r.width / 2, below });
    }, 250);
  };
  const hide = () => {
    clear();
    closeTimer.current = setTimeout(() => { setPos(null); setCopied(false); }, 150);
  };

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  if (!text) return <span className={className}>{children}</span>;

  return (
    <>
      <span ref={anchorRef} className={`cursor-default ${className || ''}`} onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </span>
      {pos && createPortal(
        <div
          role="tooltip"
          onMouseEnter={clear}
          onMouseLeave={hide}
          className="fixed z-[80] flex items-center gap-1.5 pl-3.5 pr-1.5 h-9 rounded-xl bg-surface border border-line shadow-pop text-[13.5px] text-ink whitespace-nowrap animate-fade-in"
          style={{
            top: pos.top,
            left: Math.min(Math.max(pos.left, 160), window.innerWidth - 160),
            transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`,
          }}
        >
          {text}
          <button
            onClick={copy}
            className="ic-icon-btn-ghost w-7 h-7"
            title={copied ? 'Copied' : 'Copy date and time'}
            aria-label="Copy date and time"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

export default TimeHover;
