import { useCallback, useRef } from 'react';
import type { RiskThresholds } from '../../../utils/taskRiskAssessment';
import { ThresholdConfigPopover } from './ThresholdConfigPopover';

export type QuickFilterType = 'all' | 'due' | 'late' | 'at_risk' | 'my_tasks' | 'unassigned';

interface QuickFilterPillsProps {
  activeFilter: QuickFilterType;
  onFilterChange: (filter: QuickFilterType) => void;
  dueWeeks: number;
  onDueWeeksChange: (weeks: number) => void;
  counts: Record<QuickFilterType, number>;
  thresholds: RiskThresholds;
  onThresholdsChange: (t: RiskThresholds) => void;
}

const PILLS: { type: QuickFilterType; label: string; tint?: 'danger' | 'warning' }[] = [
  { type: 'all', label: 'All' },
  { type: 'late', label: 'Late', tint: 'danger' },
  { type: 'at_risk', label: 'At Risk', tint: 'warning' },
  { type: 'my_tasks', label: 'My Tasks' },
  { type: 'unassigned', label: 'Unassigned' },
];

export function QuickFilterPills({ activeFilter, onFilterChange, dueWeeks, onDueWeeksChange, counts, thresholds, onThresholdsChange }: QuickFilterPillsProps) {
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
    e.preventDefault();
  }, []);

  const pillClass = (isActive: boolean, hasDangerTint: boolean, hasWarningTint: boolean) =>
    isActive
      ? 'bg-primary-600 text-white border-primary-600'
      : hasDangerTint
        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30'
        : hasWarningTint
          ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30'
          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700';

  const badgeClass = (isActive: boolean, hasDangerTint: boolean, hasWarningTint: boolean) =>
    isActive
      ? 'bg-white/20 text-white'
      : hasDangerTint
        ? 'bg-red-200 dark:bg-red-800/50 text-red-800 dark:text-red-200'
        : hasWarningTint
          ? 'bg-orange-200 dark:bg-orange-800/50 text-orange-800 dark:text-orange-200'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';

  const isDueActive = activeFilter === 'due';

  return (
    <div className="flex items-center gap-1.5">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Quick filters"
        className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-0.5"
        onKeyDown={handleKeyDown}
      >
        {/* All pill */}
        <button
          role="tab"
          aria-selected={activeFilter === 'all'}
          tabIndex={activeFilter === 'all' ? 0 : -1}
          onClick={() => onFilterChange('all')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${pillClass(activeFilter === 'all', false, false)}`}
        >
          All
        </button>

        {/* Due pill with native select */}
        <div className="inline-flex items-center">
          <button
            role="tab"
            aria-selected={isDueActive}
            tabIndex={isDueActive ? 0 : -1}
            onClick={() => onFilterChange('due')}
            className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-medium rounded-l-full border border-r-0 whitespace-nowrap transition-colors ${pillClass(isDueActive, false, false)}`}
          >
            Due
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${badgeClass(isDueActive, false, false)}`}>
              {counts.due}
            </span>
          </button>
          <select
            value={dueWeeks}
            onChange={(e) => {
              onDueWeeksChange(Number(e.target.value));
              onFilterChange('due');
            }}
            className={`py-1 pl-1 pr-5 text-xs font-medium rounded-r-full border border-l-0 cursor-pointer appearance-none bg-no-repeat transition-colors ${
              isDueActive
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
            }`}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${isDueActive ? 'white' : '%239ca3af'}' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: 'right 4px center' }}
            aria-label="Due date range"
          >
            <option value={1}>1w</option>
            <option value={2}>2w</option>
            <option value={3}>3w</option>
            <option value={4}>4w</option>
          </select>
        </div>

        {/* Remaining pills */}
        {PILLS.slice(1).map((pill) => {
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
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${pillClass(isActive, hasDangerTint, hasWarningTint)}`}
            >
              {pill.label}
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${badgeClass(isActive, hasDangerTint, hasWarningTint)}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <ThresholdConfigPopover thresholds={thresholds} onChange={onThresholdsChange} />
    </div>
  );
}
