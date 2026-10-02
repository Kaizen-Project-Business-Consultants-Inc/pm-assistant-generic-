import React from 'react';

/**
 * The Kovarti mark (Oct 2026): a K built from schedule bars — a stem with task bars stepping
 * out from it. Draws in the current text colour; size it with width/height classes. Every logo
 * in the app uses this (it replaced a lightbulb icon on the public pages and a plain "K" letter
 * in the sidebar). Brand files: tile, wordmark, LinkedIn — see docs/ADMIN_MANUAL.md, Branding.
 */
export const KovartiMark: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="currentColor"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
  >
    <rect x="18" y="14" width="15" height="72" rx="3" />
    <rect x="39" y="40" width="22" height="9" rx="2.5" />
    <rect x="51" y="27" width="24" height="9" rx="2.5" />
    <rect x="63" y="14" width="22" height="9" rx="2.5" />
    <rect x="39" y="51" width="22" height="9" rx="2.5" />
    <rect x="51" y="64" width="24" height="9" rx="2.5" />
    <rect x="63" y="77" width="22" height="9" rx="2.5" />
  </svg>
);
