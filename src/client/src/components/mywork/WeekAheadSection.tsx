import { useState } from 'react';
import { ChevronDown, ChevronRight, CalendarRange, Flag, ListTodo, ClipboardCheck } from 'lucide-react';

interface WeekDay {
  date: string;
  dayLabel: string;
  milestones: Array<{ id: number; name: string; projectName: string }>;
  tasksDue: number;
  actionItemsDue: number;
}

export default function WeekAheadSection({ days }: { days: WeekDay[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasContent = days.some(d => d.milestones.length > 0 || d.tasksDue > 0 || d.actionItemsDue > 0);

  if (!hasContent) return null;

  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="mb-6">
      <button
        className="flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <Chevron className="w-4 h-4 text-gray-400" />
        <CalendarRange className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Looking Ahead</span>
      </button>

      {!collapsed && (
        <div className="ml-2 grid grid-cols-5 gap-2 mt-1">
          {days.map(day => {
            const hasAny = day.milestones.length > 0 || day.tasksDue > 0 || day.actionItemsDue > 0;
            return (
              <div
                key={day.date}
                className={`rounded-lg border p-3 text-center ${
                  hasAny
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                    : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50'
                }`}
              >
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{day.dayLabel}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                  {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>

                {!hasAny && (
                  <span className="text-xs text-gray-400 dark:text-gray-600">--</span>
                )}

                {day.tasksDue > 0 && (
                  <div className="flex items-center justify-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <ListTodo className="w-3 h-3" />
                    <span>{day.tasksDue}</span>
                  </div>
                )}
                {day.actionItemsDue > 0 && (
                  <div className="flex items-center justify-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                    <ClipboardCheck className="w-3 h-3" />
                    <span>{day.actionItemsDue}</span>
                  </div>
                )}
                {day.milestones.map(m => (
                  <div
                    key={m.id}
                    className="flex items-center justify-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-1"
                    title={`${m.name} (${m.projectName})`}
                  >
                    <Flag className="w-3 h-3" />
                    <span className="truncate max-w-[80px]">{m.name}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
