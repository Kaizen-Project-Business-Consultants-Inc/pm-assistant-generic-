import { useCallback, useState } from 'react';
import { TurnstileWidget } from './TurnstileWidget';

const HUMAN_CHECK_STATUS_ID = 'human-check-status';

/**
 * The "are you a person" box on sign-in and forgot password. Hidden until the server
 * says this address has had 3 failed tries (server utils/humanCheck.ts); then Cloudflare's
 * box shows above the button, the button waits for its tick, and a status line says why
 * (`aria-describedby` on the button points at it). A token works once, so every failed
 * try gets a fresh box. If the box cannot load (an ad blocker, a company proxy) the line
 * says so instead of leaving a greyed-out button unexplained.
 */
export function useHumanCheck() {
  const [shown, setShown] = useState(false);
  const [token, setToken] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [round, setRound] = useState(0);
  const onToken = useCallback((t: string | undefined) => { setToken(t); if (t) setUnavailable(false); }, []);
  const onUnavailable = useCallback(() => setUnavailable(true), []);

  const afterFailure = useCallback((needsHumanCheck: boolean | undefined) => {
    if (needsHumanCheck) setShown(true);
    setToken(undefined);
    setUnavailable(false);
    setRound((r) => r + 1);
  }, []);

  const waiting = shown && !token;
  const status = !waiting ? '' : unavailable
    ? 'The security check could not load. Reload the page; if it keeps happening, turn off ad blockers or contact support.'
    : 'Checking you are a person…';

  return {
    token: shown ? token : undefined,
    waiting,
    describedBy: waiting ? HUMAN_CHECK_STATUS_ID : undefined,
    box: shown ? (
      <div className="space-y-2">
        <TurnstileWidget key={round} onToken={onToken} onUnavailable={onUnavailable} />
        <p id={HUMAN_CHECK_STATUS_ID} aria-live="polite"
          className={`text-sm text-center ${unavailable ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
          {status}
        </p>
      </div>
    ) : null,
    afterFailure,
  };
}
