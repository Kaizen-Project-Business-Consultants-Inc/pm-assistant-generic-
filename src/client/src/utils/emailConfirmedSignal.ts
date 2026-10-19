/**
 * The confirm link opens in a new tab, and the "check your email" tab left open also moves on —
 * two tabs on the same screen (UAT U45, 2026-10-19). The link's tab tells the others in this
 * browser that it has confirmed, so they say "You're confirmed — Kovarti is open in the other tab"
 * instead. A link opened in another browser (or on a phone) sends nothing, and the waiting tab
 * moves on by itself as before.
 */
const CHANNEL = 'kovarti-auth';
const CONFIRMED = 'email-confirmed';

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

/** The link's tab: tell the other tabs in this browser that the email is confirmed */
export function announceEmailConfirmed(): void {
  const ch = channel();
  if (!ch) return;
  ch.postMessage({ type: CONFIRMED });
  ch.close();
}

/** The waiting tab: call `onConfirmed` when another tab confirms. Returns the stop function. */
export function onEmailConfirmedElsewhere(onConfirmed: () => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  ch.onmessage = (e: MessageEvent) => { if (e.data?.type === CONFIRMED) onConfirmed(); };
  return () => ch.close();
}
