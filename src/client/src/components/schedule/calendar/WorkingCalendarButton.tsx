import { CalendarRange } from 'lucide-react';

/**
 * Opens the project's working calendar. Indigo-outlined so it stands out from the
 * neighbouring toolbar buttons (indigo is not a status colour in this app).
 */
export function WorkingCalendarButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      title="Working days, company holidays and this project's days off"
      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border-[1.5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        active
          ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-600 text-white dark:bg-indigo-500'
          : 'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
      }`}
    >
      <CalendarRange className="w-3.5 h-3.5" aria-hidden="true" />
      Working calendar
    </button>
  );
}
