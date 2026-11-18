import React from 'react';

/** Intercom-style priority levels. "critical" is stored, "Urgent" is shown. */
export const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
];

export const priorityLabel = (p?: string) =>
  PRIORITY_OPTIONS.find(o => o.value === p)?.label || 'No priority';

/** Signal-bar icon (red square with "!" for Urgent), like Intercom's priority menu. */
export const PriorityIcon: React.FC<{ priority?: string; className?: string }> = ({ priority = 'none', className = 'w-4 h-4' }) => {
  if (priority === 'critical') {
    return (
      <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#dc2626" />
        <rect x="7.1" y="4" width="1.8" height="5.2" rx="0.9" fill="#fff" />
        <circle cx="8" cy="11.4" r="1.05" fill="#fff" />
      </svg>
    );
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  const color = priority === 'high' ? '#dc2626' : priority === 'medium' ? '#ea580c' : '#eab308';
  const off = 'rgb(var(--ic-ink) / 0.18)';
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden>
      <rect x="2" y="9" width="3" height="5" rx="0.8" fill={level >= 1 ? color : off} />
      <rect x="6.5" y="5.5" width="3" height="8.5" rx="0.8" fill={level >= 2 ? color : off} />
      <rect x="11" y="2" width="3" height="12" rx="0.8" fill={level >= 3 ? color : off} />
    </svg>
  );
};
