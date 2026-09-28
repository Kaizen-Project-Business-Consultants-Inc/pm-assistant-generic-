import { Eye } from 'lucide-react';

/**
 * Shown where change buttons are hidden because only the project's Manager or Owner can
 * make changes (Sep 2026 permissions). Says what the viewer CAN still do, if anything.
 */
export function ViewOnlyNote({ youCan, className = '' }: { youCan?: string; className?: string }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 px-3 py-2 text-sm text-sky-900 dark:text-sky-100 ${className}`}
    >
      <Eye className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>
        View only — the project's Manager or Owner makes changes here.
        {youCan && <> You can {youCan}.</>}
      </span>
    </div>
  );
}
