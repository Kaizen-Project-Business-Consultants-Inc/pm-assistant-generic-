import { useState, useRef, useEffect } from 'react';
import { Settings2, ChevronDown, RotateCcw } from 'lucide-react';
import type { WidgetDef } from './WidgetRegistry';

interface CustomizeDropdownProps {
  widgets: WidgetDef[];
  enabledIds: Set<string>;
  onToggle: (id: string) => void;
  onReset?: () => void;
}

export function CustomizeDropdown({ widgets, enabledIds, onToggle, onReset }: CustomizeDropdownProps) {
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
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2">
          {[...groups.entries()].map(([group, items], gi) => (
            <div key={group}>
              <div className="px-3 py-1">
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{group}</span>
              </div>
              {items.map(w => (
                <label
                  key={w.id}
                  className="flex items-center gap-2 px-4 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabledIds.has(w.id)}
                    onChange={() => onToggle(w.id)}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">{w.label}</span>
                </label>
              ))}
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
