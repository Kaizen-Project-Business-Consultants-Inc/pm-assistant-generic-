import { useState, useRef, useEffect } from 'react';
import { BookmarkPlus, ChevronDown, Trash2, RotateCw } from 'lucide-react';
import type { ColumnKey } from './tableColumns';

type SortDir = 'asc' | 'desc';

export interface SavedView {
  id: string;
  name: string;
  columns: ColumnKey[];
  sortField: ColumnKey;
  sortDir: SortDir;
  zoom?: string;
}

interface SavedViewsDropdownProps {
  scheduleId: string;
  currentColumns: Set<ColumnKey>;
  currentSortField: ColumnKey;
  currentSortDir: SortDir;
  onLoadView: (view: SavedView) => void;
}

function getStorageKey(scheduleId: string) {
  return `saved-views:${scheduleId}`;
}

function loadViews(scheduleId: string): SavedView[] {
  try {
    const stored = localStorage.getItem(getStorageKey(scheduleId));
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function persistViews(scheduleId: string, views: SavedView[]) {
  localStorage.setItem(getStorageKey(scheduleId), JSON.stringify(views));
}

export function SavedViewsDropdown({ scheduleId, currentColumns, currentSortField, currentSortDir, onLoadView }: SavedViewsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(scheduleId));
  const [newName, setNewName] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Click outside to close
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

  // Focus input when dropdown opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Check if active view has drifted from current state
  const activeView = views.find(v => v.id === activeViewId);
  const hasDrifted = activeView && (
    activeView.sortField !== currentSortField ||
    activeView.sortDir !== currentSortDir ||
    activeView.columns.length !== currentColumns.size ||
    !activeView.columns.every(c => currentColumns.has(c))
  );

  const handleSave = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const view: SavedView = {
      id: crypto.randomUUID(),
      name: trimmed,
      columns: [...currentColumns],
      sortField: currentSortField,
      sortDir: currentSortDir,
    };
    const updated = [...views, view];
    setViews(updated);
    persistViews(scheduleId, updated);
    setActiveViewId(view.id);
    setNewName('');
  };

  const handleUpdate = () => {
    if (!activeViewId) return;
    const updated = views.map(v =>
      v.id === activeViewId
        ? { ...v, columns: [...currentColumns], sortField: currentSortField, sortDir: currentSortDir }
        : v
    );
    setViews(updated);
    persistViews(scheduleId, updated);
  };

  const handleDelete = (viewId: string) => {
    const updated = views.filter(v => v.id !== viewId);
    setViews(updated);
    persistViews(scheduleId, updated);
    if (activeViewId === viewId) setActiveViewId(null);
  };

  const handleLoad = (view: SavedView) => {
    setActiveViewId(view.id);
    onLoadView(view);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
        title="Saved views"
      >
        <BookmarkPlus className="w-3.5 h-3.5" />
        Views
        {activeView && <span className="text-primary-600 ml-0.5 max-w-[80px] truncate">{activeView.name}</span>}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2">
          {/* Saved views list */}
          {views.length > 0 && (
            <div className="px-1 mb-1">
              <div className="px-2 py-1">
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Saved Views</span>
              </div>
              {views.map(view => (
                <div
                  key={view.id}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer group ${
                    activeViewId === view.id ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <button
                    className="flex-1 text-left text-xs truncate"
                    onClick={() => handleLoad(view)}
                    title={`Load "${view.name}"`}
                  >
                    {view.name}
                  </button>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{view.columns.length} cols</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(view.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 transition-opacity"
                    title="Delete saved view"
                    aria-label="Delete saved view"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
              {hasDrifted && (
                <button
                  onClick={handleUpdate}
                  className="flex items-center gap-1 w-full px-2 py-1.5 text-xs text-primary-600 hover:bg-primary-50 rounded transition-colors"
                >
                  <RotateCw className="w-3 h-3" />
                  Update "{activeView!.name}" to current
                </button>
              )}
              <div className="border-b border-gray-100 dark:border-gray-700 my-1 mx-2" />
            </div>
          )}

          {/* Save new */}
          <div className="px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                placeholder="View name..."
                aria-label="View name"
                className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              />
              <button
                onClick={handleSave}
                disabled={!newName.trim()}
                className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
