import { useEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';

/**
 * The Cloudflare Turnstile challenge on the registration form.
 *
 * Genuine people never interact with it — it watches the browser and resolves
 * itself. It exists because registration is the one endpoint a stranger can call
 * repeatedly with effect, and rate limiting only slows a script down.
 *
 * The site key comes from the API, not the build, for one reason: the widget
 * must never be live while the server check is not, or the reverse. Both halves
 * read the same configuration, so turning the CAPTCHA on or off is a single
 * change on the server. With no key set, this renders nothing and signup works
 * exactly as before.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener('load', () => resolve()));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the challenge'));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ onToken }: { onToken: (token: string | undefined) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiService
      .getTurnstileSiteKey()
      .then((key) => { if (!cancelled) setSiteKey(key || ''); })
      // If we cannot ask, assume it is off. Blocking signup because a config
      // lookup failed would cost far more than the bots it would stop.
      .catch(() => { if (!cancelled) setSiteKey(''); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!siteKey || !boxRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !boxRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(boxRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          'error-callback': () => onToken(undefined),
          'expired-callback': () => onToken(undefined),
          theme: 'auto',
        });
      })
      .catch(() => {
        // Cloudflare unreachable. The server treats a missing token as a pass
        // when it cannot reach Cloudflare either, so signup still works.
        onToken(undefined);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* already gone */ }
      }
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={boxRef} className="mt-4 flex justify-center" data-testid="turnstile" />;
}
