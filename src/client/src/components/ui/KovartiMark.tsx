import React from 'react';

/**
 * The Kovarti mark (Oct 2026): the Enso K — a K inside an open brush circle, shared with the
 * parent company, Kaizen Project & Business Consultants ("kaizen": better every day). Draws in
 * the current text colour, the circle a little lighter; size it with width/height classes. Every
 * logo in the app uses this. Full-colour files (navy #0f1b33, sky #0ea5e9) for icons, LinkedIn
 * and documents: see docs/ADMIN_MANUAL.md, Branding.
 */
export const KovartiMark: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
  >
    <path d="M78 26 A38 38 0 1 0 86 58" stroke="currentColor" strokeOpacity={0.7} strokeWidth={8} strokeLinecap="round" />
    <rect x="35" y="30" width="10" height="40" rx="2.5" fill="currentColor" />
    <path d="M47 51 L63 33 M47 51 L64 69" stroke="currentColor" strokeWidth={10} strokeLinecap="round" />
  </svg>
);
