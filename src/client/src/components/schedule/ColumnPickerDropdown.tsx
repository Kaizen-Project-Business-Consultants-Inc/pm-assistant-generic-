import { useState, useRef, useEffect } from 'react';
import { Settings2, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ColumnDef, ColumnKey, ColumnGroup } from './tableColumns';

const groupLabels: Record<ColumnGroup, string> = {
  standard: 'Standard',
  scheduling: 'Scheduling (CPM)',
  baseline: 'Baseline',
  other: 'Other',
};

const groupOrder: ColumnGroup[] = ['standard', 'scheduling', 'baseline', 'other'];

interface ColumnPickerDropdownProps {
  columns: ColumnDef[];
  visibleKeys: Set<ColumnKey>;
  onToggle: (key: ColumnKey) => void;
  onToggleGroup: (group: ColumnGroup, visible: boolean) => void;
  onMoveColumn?: (key: ColumnKey, direction: 'left' | 'right') => void;
  columnOrder?: ColumnKey[];
  onResetOrder?: () => void;
}

export function ColumnPickerDropdown({ columns, visibleKeys, onToggle, onToggleGroup, onMoveColumn, columnOrder, onResetOrder }: ColumnPickerDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Build ordered visible columns for determining move button disabled state
  const visibleCols = columns.filter(c => visibleKeys.has(c.key));
  const orderedVisibleCols = columnOrder && columnOrder.length > 0
    ? (() => {
        const orderMap = new Map(columnOrder.map((k, i) => [k, i]));
        return [...visibleCols].sort((a, b) => {
          const ia = a.key === 'rowNum' ? -1 : (orderMap.get(a.key) ?? 999);
          const ib = b.key === 'rowNum' ? -1 : (orderMap.get(b.key) ?? 999);
          return ia - ib;
        });
      })()
    : visibleCols;

  const grouped = groupOrder.map(group => ({
    group,
    label: groupLabels[group],
    cols: columns.filter(c => c.group === group),
  }));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
        title="Choose columns"
      >
        <Settings2 className="w-3.5 h-3.5" />
        Columns
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-2 max-h-[70vh] overflow-y-auto">
          {grouped.map(({ group, label, cols }) => {
            const allVisible = cols.every(c => visibleKeys.has(c.key));
            const someVisible = cols.some(c => visibleKeys.has(c.key));

            return (
              <div key={group} className="px-1">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={allVisible}
                    ref={el => {
                      if (el) el.indeterminate = someVisible && !allVisible;
                    }}
                    onChange={() => onToggleGroup(group, !allVisible)}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                </div>
                {cols.map(col => {
                  const isFixed = col.key === 'name' || col.key === 'rowNum';
                  const visibleIdx = orderedVisibleCols.findIndex(c => c.key === col.key);
                  const isFirst = visibleIdx <= 1; // 0 = rowNum (pinned), 1 = first moveable
                  const isLast = visibleIdx === orderedVisibleCols.length - 1;

                  return (
                    <div
                      key={col.key}
                      className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={visibleKeys.has(col.key)}
                        onChange={() => onToggle(col.key)}
                        disabled={isFixed}
                        className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span
                        className="text-xs text-gray-700 dark:text-gray-300 flex-1 cursor-pointer"
                        onClick={() => !isFixed && onToggle(col.key)}
                        role="button"
                        tabIndex={isFixed ? -1 : 0}
                        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isFixed) { e.preventDefault(); onToggle(col.key); } }}
                      >{col.label}</span>
                      {onMoveColumn && !isFixed && visibleKeys.has(col.key) && (
                        <>
                          <button
                            className="p-0.5 text-primary-500 hover:text-primary-700 disabled:opacity-25 disabled:cursor-not-allowed"
                            onClick={() => onMoveColumn(col.key, 'left')}
                            disabled={isFirst}
                            title="Move column left"
                            aria-label="Move column left"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-0.5 text-primary-500 hover:text-primary-700 disabled:opacity-25 disabled:cursor-not-allowed"
                            onClick={() => onMoveColumn(col.key, 'right')}
                            disabled={isLast}
                            title="Move column right"
                            aria-label="Move column right"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {group !== 'other' && <div className="border-b border-gray-100 dark:border-gray-600 my-1 mx-2" />}
              </div>
            );
          })}
          {onResetOrder && (
            <div className="border-t border-gray-200 dark:border-gray-600 mt-1 pt-1.5 px-3 pb-1">
              <button
                className="text-xs text-primary-600 hover:text-primary-700"
                onClick={onResetOrder}
              >
                Reset column order
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
