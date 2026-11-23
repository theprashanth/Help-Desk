import React from 'react';

/** Solid "close conversation" tray (Intercom style): a filled inbox tray with a raised notch. */
export const CloseConversationIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M4.6 2h6.8c.5 0 .94.31 1.12.78L14.5 8v4.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V8l1.98-5.22A1.2 1.2 0 0 1 4.6 2Zm-1.1 6.5h2.4l1.1-2.4a1.1 1.1 0 0 1 2 0l1.1 2.4h2.4L11 3.6H5L3.5 8.5Z"
    />
  </svg>
);

export default CloseConversationIcon;
