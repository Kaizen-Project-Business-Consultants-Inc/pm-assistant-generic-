import React from 'react';
import type { GanttTask } from './types';

interface GanttNotesPopupProps {
  notesPopup: { taskId: string; value: string; x: number; y: number };
  tasks: GanttTask[];
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  setNotesPopup: (popup: { taskId: string; value: string; x: number; y: number } | null) => void;
}

export const GanttNotesPopup = React.memo(function GanttNotesPopup({
  notesPopup,
  tasks,
  onTaskUpdate,
  setNotesPopup,
}: GanttNotesPopupProps) {
  const saveAndClose = () => {
    const task = tasks.find(t => t.id === notesPopup.taskId);
    if (task && notesPopup.value !== (task.description || '') && onTaskUpdate) {
      onTaskUpdate(notesPopup.taskId, { description: notesPopup.value });
    }
    setNotesPopup(null);
  };

  return (
    <div
      className="gantt-notes-popup fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 w-80"
      style={{
        left: Math.min(notesPopup.x, window.innerWidth - 340),
        top: Math.min(notesPopup.y, window.innerHeight - 260),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Notes</span>
        <button
          onClick={saveAndClose}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <textarea
        ref={el => { if (el) el.focus(); }}
        className="w-full text-xs p-2 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-y"
        value={notesPopup.value}
        onChange={e => setNotesPopup({ ...notesPopup, value: e.target.value })}
        rows={6}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={() => setNotesPopup(null)}
          className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          onClick={saveAndClose}
          className="text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700"
        >
          Save
        </button>
      </div>
    </div>
  );
});
