import { useEffect, useState, type ReactNode } from 'react';
import { apiService } from '../../services/api';

/**
 * "Continue with Google" / "Sign up with Google" (Oct 2026), with the "or with your email" line
 * under it. Shown only when Google sign-in is set up on the server (/auth/providers) — with no
 * settings it renders nothing and the page is as before. A plain link: Google sends the person
 * back to the server, which signs them in and opens the app.
 */
export function GoogleButton({ label, intent, dividerText, note }: {
  label: string;
  /** Small print under the button (sign-up: the terms) */
  note?: ReactNode;
  intent: Parameters<typeof apiService.googleStartUrl>[0];
  dividerText: string;
}) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let live = true;
    apiService.getAuthProviders()
      .then((p) => { if (live) setAvailable(p.google); })
      .catch(() => { /* not available: the email form is enough */ });
    return () => { live = false; };
  }, []);

  if (!available) return null;

  return (
    <div className="space-y-4">
      <a
        href={apiService.googleStartUrl(intent)}
        className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
        </svg>
        {label}
      </a>
      {note && <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex-grow h-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        <span>{dividerText}</span>
        <div className="flex-grow h-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
      </div>
    </div>
  );
}
