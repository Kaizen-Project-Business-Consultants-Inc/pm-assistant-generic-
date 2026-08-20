import { useState, useRef, useEffect } from 'react';
import { Settings2, ChevronDown, RotateCcw } from 'lucide-react';
import type { WidgetDef } from './WidgetRegistry';

type WidgetSize = 'full' | 'half' | 'third';

interface CustomizeDropdownProps {
  widgets: WidgetDef[];
  enabledIds: Set<string>;
  onToggle: (id: string) => void;
  onReset?: () => void;
  widgetSizes?: Record<string, WidgetSize>;
  onResize?: (id: string, size: WidgetSize) => void;
}

const SIZE_OPTIONS: { value: WidgetSize; label: string }[] = [
  { value: 'full', label: 'F' },
  { value: 'half', label: 'H' },
  { value: 'third', label: 'T' },
];

export function CustomizeDropdown({ widgets, enabledIds, onToggle, onReset, widgetSizes, onResize }: CustomizeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group widgets
  const groups = new Map<string, WidgetDef[]>();
  for (const w of widgets) {
    if (!groups.has(w.group)) groups.set(w.group, []);
    groups.get(w.group)!.push(w);
  }

  const getSize = (id: string): WidgetSize => widgetSizes?.[id] || widgets.find(w => w.id === id)?.size || 'full';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
        title="Customize dashboard"
      >
        <Settings2 className="w-3.5 h-3.5" />
        Customize
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2">
          {[...groups.entries()].map(([group, items], gi) => (
            <div key={group}>
              <div className="px-3 py-1">
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{group}</span>
              </div>
              {items.map(w => {
                const currentSize = getSize(w.id);
                const isEnabled = enabledIds.has(w.id);
                return (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 px-4 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                  >
                    <label className="flex items-center gap-2 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => onToggle(w.id)}
                        className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300">{w.label}</span>
                    </label>
                    {onResize && isEnabled && (
                      <div className="flex gap-0.5">
                        {SIZE_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => onResize(w.id, opt.value)}
                            className={`w-5 h-5 text-[9px] font-bold rounded transition-colors ${
                              currentSize === opt.value
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                            title={opt.value === 'full' ? 'Full width' : opt.value === 'half' ? 'Half width' : 'Third width'}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {gi < groups.size - 1 && <div className="border-b border-gray-100 dark:border-gray-700 my-1 mx-2" />}
            </div>
          ))}
          {onReset && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700 my-1 mx-2" />
              <button
                onClick={() => { onReset(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Default Layout
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
