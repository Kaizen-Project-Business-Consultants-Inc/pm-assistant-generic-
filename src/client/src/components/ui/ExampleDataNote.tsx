import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * Shown above example results. The free trial runs every analysis on the user's own data; only
 * when there is nothing to analyse yet (no tasks, no RAID items, no projects) does the server send
 * an example instead (`sample: true`, 2026-10-10). Says that it is an example, why, and how to
 * see real results (`children`).
 */
export function ExampleDataNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="note"
      aria-label="Example data"
      className={`flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 ${className}`}
    >
      <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Example — not your project's data</p>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{children}</p>
      </div>
    </div>
  );
}
