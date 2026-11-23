import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import CloseConversationIcon from '../ui/CloseConversationIcon';

const STATE_LABELS: Record<string, string> = {
  open: 'In progress', waiting: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed', archived: 'Archived',
};

type Choice = { status: 'resolved' | 'closed'; label: string; hint?: string; kbd?: string[]; icon: React.ReactNode };

/**
 * "Close" picker (Intercom style): choose a resolved state before closing.
 *  - Resolved: the ticket is solved and the customer sees "Resolved".
 *  - Close without resolving (⌘⇧Y): closes the conversation; the ticket isn't marked solved.
 * ↑↓ to move, Enter to pick, Esc to cancel.
 */
export const CloseDialog: React.FC<{
  currentStatus: string;
  ticketLabel?: string;            // e.g. "#41130" — shown in the header
  onPick: (status: 'resolved' | 'closed') => void;
  onClose: () => void;
}> = ({ currentStatus, ticketLabel, onPick, onClose }) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const choices = useMemo<Choice[]>(() => [
    {
      status: 'resolved', label: 'Resolved', hint: 'Customer sees "Resolved"',
      icon: <CheckCircle2 className="w-5 h-5 text-white fill-emerald-600" />,
    },
    {
      status: 'closed',
      label: currentStatus === 'resolved' ? 'Close and keep it "Resolved"' : `Close without resolving (now "${STATE_LABELS[currentStatus] || currentStatus}")`,
      kbd: ['⌘', '⇧', 'Y'],
      icon: <CloseConversationIcon className="w-[18px] h-[18px] text-ink" />,
    },
  ], [currentStatus]);

  const shown = choices.filter(c => !query.trim() || c.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(i => Math.min(i + 1, Math.max(0, shown.length - 1))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' && shown[cursor]) { e.preventDefault(); onPick(shown[cursor].status); }
      else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); onPick('closed'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-ink/25 flex items-start justify-center pt-[12vh] p-4 animate-fade-in" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[600px] max-w-full h-[min(460px,80vh)] bg-surface rounded-2xl shadow-pop border border-line flex flex-col overflow-hidden" role="dialog" aria-label="Close conversation">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
          <button onClick={onClose} className="ic-icon-btn-ghost" title="Back"><ArrowLeft className="w-[18px] h-[18px]" /></button>
          <h3 className="text-[16px] font-semibold text-ink">Close{ticketLabel ? <span className="text-muted font-normal"> · {ticketLabel}</span> : null}</h3>
        </div>
        <label className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
          <Search className="w-[18px] h-[18px] text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Choose a resolved state before closing this ticket"
            className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
        </label>
        <div className="flex-1 overflow-y-auto p-2">
          {shown.length === 0 && <p className="px-3 py-8 text-center text-[14px] text-muted">No matching option</p>}
          {shown.map((c, i) => (
            <button
              key={c.status}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(c.status)}
              className={`w-full flex items-center gap-3 px-3 h-12 rounded-xl text-left text-[15px] text-ink ${i === cursor ? 'bg-subtle' : ''}`}
            >
              <span className="w-6 flex justify-center shrink-0">{c.icon}</span>
              <span className="flex-1 min-w-0 truncate">{c.label}</span>
              {c.hint && <span className="text-[13.5px] text-muted shrink-0">{c.hint}</span>}
              {c.kbd && (
                <span className="flex items-center gap-1 shrink-0">
                  {c.kbd.map(k => <kbd key={k} className="min-w-6 h-6 px-1.5 rounded-md border border-line bg-surface text-[12px] text-muted inline-flex items-center justify-center font-sans">{k}</kbd>)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="px-5 h-11 border-t border-line flex items-center text-[12.5px] text-muted shrink-0">
          ↑↓ navigate · ↵ select · esc close
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CloseDialog;
