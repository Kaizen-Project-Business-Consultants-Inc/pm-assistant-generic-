import { useCallback, useRef } from 'react';
import type { RiskThresholds } from '../../../utils/taskRiskAssessment';
import { ThresholdConfigPopover } from './ThresholdConfigPopover';

export type QuickFilterType = 'all' | 'due_this_week' | 'due_next_2_weeks' | 'late' | 'at_risk' | 'my_tasks' | 'unassigned';

interface QuickFilterPillsProps {
  activeFilter: QuickFilterType;
  onFilterChange: (filter: QuickFilterType) => void;
  counts: Record<QuickFilterType, number>;
  thresholds: RiskThresholds;
  onThresholdsChange: (t: RiskThresholds) => void;
}

const PILLS: { type: QuickFilterType; label: string; tint?: 'danger' | 'warning' }[] = [
  { type: 'all', label: 'All' },
  { type: 'due_this_week', label: 'Due This Week' },
  { type: 'due_next_2_weeks', label: 'Due 2 Weeks' },
  { type: 'late', label: 'Late', tint: 'danger' },
  { type: 'at_risk', label: 'At Risk', tint: 'warning' },
  { type: 'my_tasks', label: 'My Tasks' },
  { type: 'unassigned', label: 'Unassigned' },
];

export function QuickFilterPills({ activeFilter, onFilterChange, counts, thresholds, onThresholdsChange }: QuickFilterPillsProps) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons) return;
    const currentIdx = Array.from(buttons).findIndex(b => b.getAttribute('aria-selected') === 'true');
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % buttons.length;
    if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + buttons.length) % buttons.length;
    buttons[nextIdx].focus();
    onFilterChange(PILLS[nextIdx].type);
    e.preventDefault();
  }, [onFilterChange]);

  return (
    <div className="flex items-center gap-1.5">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Quick filters"
        className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-0.5"
        onKeyDown={handleKeyDown}
      >
        {PILLS.map((pill) => {
          const isActive = activeFilter === pill.type;
          const count = counts[pill.type];
          const hasDangerTint = !isActive && pill.tint === 'danger' && count > 0;
          const hasWarningTint = !isActive && pill.tint === 'warning' && count > 0;

          return (
            <button
              key={pill.type}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onFilterChange(pill.type)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white border-primary-600'
                  : hasDangerTint
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30'
                    : hasWarningTint
                      ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {pill.label}
              {pill.type !== 'all' && (
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : hasDangerTint
                      ? 'bg-red-200 dark:bg-red-800/50 text-red-800 dark:text-red-200'
                      : hasWarningTint
                        ? 'bg-orange-200 dark:bg-orange-800/50 text-orange-800 dark:text-orange-200'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ThresholdConfigPopover thresholds={thresholds} onChange={onThresholdsChange} />
    </div>
  );
}
