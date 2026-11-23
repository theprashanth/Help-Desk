import React from 'react';
import { PresenceViewer } from '../../store/useStore';

/** Initials circle for a teammate (avatars aren't sent with presence; initials are enough here). */
const Initial: React.FC<{ v: PresenceViewer; size?: number }> = ({ v, size = 22 }) => (
  <span
    className={`relative rounded-full bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100 font-semibold uppercase flex items-center justify-center ring-2 ring-surface shrink-0 ${v.typing ? 'outline outline-2 outline-emerald-500' : ''}`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    title={`${v.name} ${v.typing ? 'is typing…' : 'is viewing'}`}
  >
    {v.name.trim().charAt(0) || '?'}
  </span>
);

export const othersIn = (viewers: PresenceViewer[] | undefined, meId?: string) =>
  (viewers || []).filter(v => v.agentId !== meId);

/** Chat header: "Sarah is viewing" / "Sarah is typing…" with overlapping avatars. */
export const PresenceIndicator: React.FC<{ viewers: PresenceViewer[] }> = ({ viewers }) => {
  if (!viewers.length) return null;
  const typing = viewers.filter(v => v.typing);
  const lead = typing[0] || viewers[0];
  const rest = viewers.length - 1;
  const text = typing.length
    ? `${lead.name.split(' ')[0]}${typing.length > 1 ? ` +${typing.length - 1}` : ''} ${typing.length > 1 ? 'are' : 'is'} typing`
    : `${lead.name.split(' ')[0]}${rest ? ` +${rest}` : ''} ${rest ? 'are' : 'is'} viewing`;
  return (
    <span
      className={`inline-flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-full text-[13px] font-medium shrink-0 ${typing.length ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' : 'bg-subtle text-muted'}`}
      title={viewers.map(v => `${v.name} ${v.typing ? 'is typing…' : 'is viewing'}`).join('\n')}
      aria-live="polite"
    >
      <span className="flex -space-x-1.5">{viewers.slice(0, 3).map(v => <Initial key={v.agentId} v={v} />)}</span>
      {text}
      {typing.length > 0 && (
        <span className="flex gap-0.5">
          <span className="w-1 h-1 rounded-full bg-current typing-dot" />
          <span className="w-1 h-1 rounded-full bg-current typing-dot" />
          <span className="w-1 h-1 rounded-full bg-current typing-dot" />
        </span>
      )}
    </span>
  );
};

/** Inbox row: small avatars of teammates who have this conversation open. */
export const PresenceDots: React.FC<{ viewers: PresenceViewer[] }> = ({ viewers }) => {
  if (!viewers.length) return null;
  return (
    <span className="flex -space-x-1 shrink-0" title={viewers.map(v => `${v.name} ${v.typing ? 'is typing…' : 'is viewing'}`).join('\n')}>
      {viewers.slice(0, 2).map(v => <Initial key={v.agentId} v={v} size={16} />)}
    </span>
  );
};
