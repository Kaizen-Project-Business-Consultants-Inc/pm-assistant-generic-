import { useEffect, useRef } from 'react';

export interface OAuthResult {
  type: 'oauth-callback';
  success: boolean;
  error: string | null;
  provider: string | null;
  connectorId?: string | null;
}

/**
 * Connecting an outside account happens in a pop-up that ends on /oauth/callback, which reports
 * back by postMessage (when the opener survived) and by a localStorage event (when it did not).
 * Shared by the Integrations page and Meeting Intelligence → From Teams.
 */
export function useOAuthResult(onResult: (result: OAuthResult) => void): void {
  const handler = useRef(onResult);
  handler.current = onResult;

  useEffect(() => {
    const handle = (data: any) => {
      if (data?.type === 'oauth-callback') handler.current(data as OAuthResult);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) handle(event.data);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'oauth-callback-result' || !event.newValue) return;
      try { handle(JSON.parse(event.newValue)); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
}
