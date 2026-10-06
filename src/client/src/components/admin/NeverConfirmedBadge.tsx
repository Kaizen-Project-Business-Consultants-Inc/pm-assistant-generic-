/**
 * A sign-up that never clicked "confirm your email" (user decision, 2026-10-05): labelled, left
 * out of user / trial / customer counts, never deleted. Same rule as the server's
 * constants/neverConfirmed.ts.
 */
export const NEVER_CONFIRMED_HINT =
  'Signed up but never confirmed their email, so never signed in. Not counted as a user, trial or customer. Nothing is deleted — if they confirm later, it becomes a normal account.';

export function NeverConfirmedBadge({ subject = 'account' }: { subject?: 'account' | 'company' }) {
  const hint = subject === 'company' ? `The owner ${NEVER_CONFIRMED_HINT.charAt(0).toLowerCase()}${NEVER_CONFIRMED_HINT.slice(1)}` : NEVER_CONFIRMED_HINT;
  return (
    <span
      title={hint}
      aria-label={`Never confirmed. ${hint}`}
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-gray-500"
    >
      Never confirmed
    </span>
  );
}
