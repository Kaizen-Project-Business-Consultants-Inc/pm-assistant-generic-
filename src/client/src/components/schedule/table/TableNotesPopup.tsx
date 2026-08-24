import React from 'react';
import { X } from 'lucide-react';

interface TableNotesPopupProps {
  taskId: string;
  value: string;
  x: number;
  y: number;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const TableNotesPopup = React.memo(function TableNotesPopup({
  taskId: _taskId,
  value,
  x,
  y,
  onChange,
  onSave,
  onCancel,
}: TableNotesPopupProps) {
  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 w-80"
      style={{
        left: Math.min(x, window.innerWidth - 340),
        top: Math.min(y, window.innerHeight - 260),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Notes</span>
        <button
          onClick={onSave}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea
        ref={el => { if (el) el.focus(); }}
        className="w-full text-xs p-2 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-y"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={6}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700"
        >
          Save
        </button>
      </div>
    </div>
  );
});
