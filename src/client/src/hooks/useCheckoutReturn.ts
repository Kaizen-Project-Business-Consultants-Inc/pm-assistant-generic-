import { useEffect, useRef } from 'react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * When someone comes back from Stripe checkout, ask the server to re-check their
 * subscription directly with Stripe rather than waiting for the webhook.
 *
 * The webhook is the normal path, but it can arrive late, be dropped, or fail. If that
 * happens the customer has paid and the app does not know it, so they land on a
 * "complete your payment" screen for something they just bought. This closes that gap
 * within a second of them returning. A daily server-side sweep is the backstop.
 *
 * Stripe appends `session_id` to the return URL, which is how we know they came from
 * checkout. Runs once per page load.
 */
export function useCheckoutReturn(): void {
  const setUser = useAuthStore((s) => s.setUser);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;

    const params = new URLSearchParams(window.location.search);
    if (!params.has('session_id')) return;
    done.current = true;

    (async () => {
      try {
        await apiService.reconcileSubscription();
        // Pull the refreshed account so the banner and gates update immediately.
        const me = await apiService.getCurrentUser();
        if (me) setUser(me as any);
      } catch {
        // Never block the page on this — the daily sweep will catch it.
      }
    })();
  }, [setUser]);
}
