import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
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

const PILLS: { type: QuickFilterType; label: string; tint?: 'danger' | 'warning'; hasDueDropdown?: boolean }[] = [
  { type: 'all', label: 'All' },
  { type: 'due', label: 'Due', hasDueDropdown: true },
  { type: 'late', label: 'Late', tint: 'danger' },
  { type: 'at_risk', label: 'At Risk', tint: 'warning' },
  { type: 'my_tasks', label: 'My Tasks' },
  { type: 'unassigned', label: 'Unassigned' },
];

const DUE_OPTIONS = [
  { weeks: 1, label: '1 Week' },
  { weeks: 2, label: '2 Weeks' },
  { weeks: 3, label: '3 Weeks' },
  { weeks: 4, label: '4 Weeks' },
];

export function QuickFilterPills({ activeFilter, onFilterChange, dueWeeks, onDueWeeksChange, counts, thresholds, onThresholdsChange }: QuickFilterPillsProps) {
  const tablistRef = useRef<HTMLDivElement>(null);
  const [dueDropdownOpen, setDueDropdownOpen] = useState(false);
  const dueDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dueDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dueDropdownRef.current && !dueDropdownRef.current.contains(e.target as Node)) setDueDropdownOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDueDropdownOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleEsc); };
  }, [dueDropdownOpen]);

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

          if (pill.hasDueDropdown) {
            const dueLabel = `Due ${dueWeeks}w`;
            return (
              <div key={pill.type} className="relative" ref={dueDropdownRef}>
                <div className="inline-flex items-center">
                  <button
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => { onFilterChange('due'); }}
                    className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium rounded-l-full border border-r-0 whitespace-nowrap transition-colors ${pillClass(isActive, false, false)}`}
                  >
                    {dueLabel}
                    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${badgeClass(isActive, false, false)}`}>
                      {count}
                    </span>
                  </button>
                  <button
                    onClick={() => setDueDropdownOpen(!dueDropdownOpen)}
                    aria-label="Change due date range"
                    aria-expanded={dueDropdownOpen}
                    className={`inline-flex items-center justify-center px-1.5 py-1 text-xs rounded-r-full border border-l-0 transition-colors ${pillClass(isActive, false, false)}`}
                  >
                    <ChevronDown className={`w-3 h-3 ${isActive ? 'text-white/70' : 'text-gray-400'}`} />
                  </button>
                </div>
                {dueDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-28 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
                    {DUE_OPTIONS.map(opt => (
                      <button
                        key={opt.weeks}
                        onClick={() => { onDueWeeksChange(opt.weeks); setDueDropdownOpen(false); if (activeFilter !== 'due') onFilterChange('due'); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          dueWeeks === opt.weeks ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

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
              {pill.type !== 'all' && (
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${badgeClass(isActive, hasDangerTint, hasWarningTint)}`}>
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
