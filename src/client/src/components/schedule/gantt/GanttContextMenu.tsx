import React from 'react';
import type { GanttTask } from './types';

interface GanttContextMenuProps {
  contextMenu: { x: number; y: number; task: GanttTask; rowIdx: number };
  selectedIds: Set<string>;
  someSelected: boolean;
  onInsertBefore?: (taskId: string, parentTaskId?: string) => void;
  onInsertAfter?: (taskId: string, parentTaskId?: string) => void;
  onTaskClick?: (task: GanttTask) => void;
  onDeleteTask?: (taskId: string) => void;
  onBulkDelete?: (taskIds: string[]) => Promise<void>;
  onClose: () => void;
  setPendingDeleteIds: (ids: string[]) => void;
}

export const GanttContextMenu = React.memo(function GanttContextMenu({
  contextMenu,
  selectedIds,
  someSelected,
  onInsertBefore,
  onInsertAfter,
  onTaskClick,
  onDeleteTask,
  onBulkDelete,
  onClose,
  setPendingDeleteIds,
}: GanttContextMenuProps) {
  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onInsertBefore && (
        <button
          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onInsertBefore(contextMenu.task.id, contextMenu.task.parentTaskId); onClose(); }}
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
          Insert Task Above
        </button>
      )}
      {onInsertAfter && (
        <button
          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onInsertAfter(contextMenu.task.id, contextMenu.task.parentTaskId); onClose(); }}
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Insert Task Below
        </button>
      )}
      {(onInsertBefore || onInsertAfter) && onDeleteTask && (
        <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
      )}
      {onTaskClick && (
        <button
          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onTaskClick(contextMenu.task); onClose(); }}
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          Edit Task
        </button>
      )}
      {(onBulkDelete || onDeleteTask) && (
        <button
          className="w-full px-3 py-1.5 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          onClick={() => {
            if (onBulkDelete) {
              // Use bulk flow for undo support; include all selected tasks + right-clicked task
              const ids = new Set(selectedIds);
              ids.add(contextMenu.task.id);
              setPendingDeleteIds(Array.from(ids));
            } else if (onDeleteTask) {
              setPendingDeleteIds([contextMenu.task.id]);
            }
            onClose();
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          {someSelected ? `Delete ${selectedIds.size + (selectedIds.has(contextMenu.task.id) ? 0 : 1)} Tasks` : 'Delete Task'}
        </button>
      )}
    </div>
  );
});
