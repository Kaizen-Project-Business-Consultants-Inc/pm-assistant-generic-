/**
 * A paid sign-up is signed in a moment before the browser leaves for Stripe. Without this, the
 * sign-up route sees a signed-in, unconfirmed person and shows "Verify Your Email — we sent a
 * link" before Stripe opens, though the link only goes after payment (UAT U41, 2026-10-18).
 * Held in memory, so it ends with the page: coming back from Stripe starts fresh (a page the
 * browser restores from its back/forward memory is reloaded, below).
 */
let leaving = false;

/** `signIn` runs after the flag is up, so no screen reacts to the new user on the way out */
export function leaveForCheckout(url: string, signIn?: () => void): void {
  leaving = true;
  // Browser Back from Stripe can restore this very page from memory, flag still up: load it
  // fresh instead, so the app sees the signed-in person and moves on as usual
  window.addEventListener('pageshow', (e) => { if (e.persisted) window.location.reload(); }, { once: true });
  signIn?.();
  window.location.href = url;
}

/** The sign-up page sends a signed-in person on (to the dashboard), except for an invite or on the way to Stripe */
export function signUpPageSendsOn(isAuthenticated: boolean, search: string): boolean {
  return isAuthenticated && !search.includes('invite=') && !leaving;
}
