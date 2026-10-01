/**
 * The two resource tags used on every screen that lists people (Resources page, project Team,
 * assignee pickers), so they read the same everywhere:
 *  - "Placeholder email": a person whose real email isn't known yet (name@example.com) — they
 *    can't be invited or notified until it's added.
 *  - "Generic": a stand-in role ("Generic Developer"), not a person.
 */

export function PlaceholderEmailBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-amber-500 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/30 dark:text-amber-200 ${className}`}
      title="Not a real address yet: this person can't be invited or notified until you add their email"
    >
      Placeholder email
    </span>
  );
}

export function GenericBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-dashed border-gray-500 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-400 dark:text-gray-200 ${className}`}
      title="A stand-in for work not yet staffed. Replace it with a real person before the work starts."
    >
      Generic
    </span>
  );
}
